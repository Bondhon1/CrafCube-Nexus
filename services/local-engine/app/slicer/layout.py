"""Arrange the parts of a multi-object file onto build plates (design doc §20).

A 3MF downloaded from a model site is often a whole project: several objects
already laid out, sometimes across a plate wider than any real printer. Merging
them into one mesh keeps those positions, so the combined footprint can be far
larger than the bed — and OrcaSlicer then refuses the job with nothing but
`Slic3r::CLI::run found error` and exit -50.

Costing has to answer "what does printing all of this take?", so the parts are
re-laid out here onto as many plates as they need, and each plate is sliced.
That is also what actually happens on the machine, which is what §20's batch
economics are about.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh


# Clearance from the bed edge, and between parts. The gantry needs room and
# parts printed shoulder to shoulder weld together at the brim.
EDGE_MARGIN_MM = 5.0
PART_GAP_MM = 4.0


class LayoutError(ValueError):
    """A part cannot be placed on the bed at any orientation."""


@dataclass(frozen=True)
class Bed:
    x_mm: float
    y_mm: float
    z_mm: float

    @property
    def usable_x(self) -> float:
        return self.x_mm - 2 * EDGE_MARGIN_MM

    @property
    def usable_y(self) -> float:
        return self.y_mm - 2 * EDGE_MARGIN_MM


@dataclass
class Plate:
    mesh: trimesh.Trimesh
    part_count: int


# Orca stores the bed as polygon corners, e.g. ["0x0", "260x0", ...].
_POINT = re.compile(r"^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$", re.I)


def bed_from_machine_profile(path: str | Path, fallback: Bed) -> Bed:
    """Read the real build volume from the resolved machine profile.

    Falling back to a guess would defeat the point: a layout computed against
    the wrong bed either wastes plates or produces one the slicer rejects.
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback

    corners: list[tuple[float, float]] = []
    for entry in data.get("printable_area", []) or []:
        match = _POINT.match(str(entry))
        if match:
            corners.append((float(match.group(1)), float(match.group(2))))
    if len(corners) < 3:
        return fallback

    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    height = data.get("printable_height")
    try:
        z = float(height)
    except (TypeError, ValueError):
        z = fallback.z_mm

    return Bed(max(xs) - min(xs), max(ys) - min(ys), z)


def load_parts(path: str | Path) -> list[trimesh.Trimesh]:
    """Every separate object in the file, as its own mesh.

    Falls back to one mesh for formats that carry no scene graph, so callers
    have a single code path.
    """
    loaded = trimesh.load(str(path))

    if isinstance(loaded, trimesh.Scene):
        parts = [g for g in loaded.geometry.values()
                 if isinstance(g, trimesh.Trimesh) and len(g.faces) > 0]
        if parts:
            return [p.copy() for p in parts]

    if isinstance(loaded, trimesh.Trimesh) and len(loaded.faces) > 0:
        return [loaded.copy()]

    raise LayoutError("file contains no printable geometry")


def _rest_at_origin(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Move a part so its bounding box starts at (0, 0, 0)."""
    out = mesh.copy()
    out.apply_translation(-out.bounds[0])
    return out


def _rotate_z(mesh: trimesh.Trimesh, degrees: float) -> trimesh.Trimesh:
    out = mesh.copy()
    out.apply_transform(trimesh.transformations.rotation_matrix(
        math.radians(degrees), [0, 0, 1], out.centroid))
    return out


def pack(parts: list[trimesh.Trimesh], bed: Bed) -> list[Plate]:
    """Shelf-pack the parts onto as few plates as this simple scheme manages.

    Deliberately not an optimal packer. Parts are laid in rows, tallest row
    first, turning a part 90 degrees when that is what makes it fit. Costing
    needs a plate count that is achievable and honest, not the theoretical
    minimum — and an operator will rearrange the real plate anyway.
    """
    if not parts:
        raise LayoutError("nothing to lay out")

    prepared: list[trimesh.Trimesh] = []
    for index, part in enumerate(parts):
        candidate = _rest_at_origin(part)
        width, depth, height = candidate.extents

        if height > bed.z_mm:
            raise LayoutError(
                f"part {index + 1} is {height:.0f} mm tall and the printer's build height "
                f"is {bed.z_mm:.0f} mm"
            )

        if width > bed.usable_x or depth > bed.usable_y:
            turned = _rest_at_origin(_rotate_z(candidate, 90))
            t_width, t_depth, _ = turned.extents
            if t_width <= bed.usable_x and t_depth <= bed.usable_y:
                candidate = turned
            else:
                raise LayoutError(
                    f"part {index + 1} is {width:.0f} x {depth:.0f} mm and does not fit a "
                    f"{bed.x_mm:.0f} x {bed.y_mm:.0f} mm bed, even turned"
                )
        prepared.append(candidate)

    # Tallest rows first keeps the wasted strip at the top of each shelf small.
    order = sorted(range(len(prepared)), key=lambda i: prepared[i].extents[1], reverse=True)

    plates: list[Plate] = []
    placed: list[trimesh.Trimesh] = []
    cursor_x = 0.0
    cursor_y = 0.0
    shelf_depth = 0.0

    def flush() -> None:
        nonlocal placed, cursor_x, cursor_y, shelf_depth
        if placed:
            plates.append(Plate(trimesh.util.concatenate(placed), len(placed)))
        placed = []
        cursor_x = cursor_y = shelf_depth = 0.0

    for i in order:
        part = prepared[i]
        width, depth, _ = part.extents

        if cursor_x > 0 and cursor_x + width > bed.usable_x:
            # Next shelf.
            cursor_x = 0.0
            cursor_y += shelf_depth + PART_GAP_MM
            shelf_depth = 0.0

        if cursor_y + depth > bed.usable_y:
            flush()

        positioned = part.copy()
        positioned.apply_translation((EDGE_MARGIN_MM + cursor_x, EDGE_MARGIN_MM + cursor_y, 0.0))
        placed.append(positioned)

        cursor_x += width + PART_GAP_MM
        shelf_depth = max(shelf_depth, depth)

    flush()

    # Centre each plate's contents, which is where a slicer expects the work
    # and where the machine prints most reliably.
    centred: list[Plate] = []
    for plate in plates:
        mesh = plate.mesh
        low, high = mesh.bounds
        offset = np.array([
            (bed.x_mm - (high[0] - low[0])) / 2 - low[0],
            (bed.y_mm - (high[1] - low[1])) / 2 - low[1],
            -low[2],
        ])
        mesh.apply_translation(offset)
        centred.append(Plate(mesh, plate.part_count))

    return centred
