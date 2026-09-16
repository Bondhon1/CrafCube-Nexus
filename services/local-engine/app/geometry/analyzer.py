"""Level A geometry analysis (design doc §4, §5 phase 1-2).

This is deliberately *not* a slicer. Everything here is derived from the mesh
alone, so it is fast and always available, but it can never match a real slice
for filament or time. Callers must surface it as an estimate; §4 is explicit
that geometry-only numbers must not be presented as final.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Any

import numpy as np
import trimesh


# Anything at or above this angle from vertical is treated as an overhang that
# would usually need support. 45 degrees is the common rule of thumb; the doc's
# example warning uses 55.
OVERHANG_ANGLE_DEG = 45.0

# Below this the wall is thinner than a single 0.4 mm extrusion and will not
# print reliably.
THIN_WALL_MM = 0.8

# Above this a mesh is slow to process and usually over-tessellated for FDM.
HIGH_TRIANGLE_COUNT = 500_000


@dataclass
class Dimensions:
    width_mm: float
    depth_mm: float
    height_mm: float

    @property
    def sorted_desc(self) -> list[float]:
        return sorted([self.width_mm, self.depth_mm, self.height_mm], reverse=True)


@dataclass
class GeometryResult:
    dimensions: Dimensions
    volume_cm3: float
    surface_area_cm2: float
    triangle_count: int
    vertex_count: int
    is_watertight: bool
    is_winding_consistent: bool
    # A mesh that is not watertight has no reliable enclosed volume, so the
    # figure above is only trustworthy when this is True.
    volume_is_reliable: bool
    euler_number: int
    center_of_mass: list[float]
    overhang_area_ratio: float
    bounding_box_fill_ratio: float
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["dimensions"] = asdict(self.dimensions)
        return data


class MeshLoadError(ValueError):
    """The file could not be read as a mesh."""


def load_mesh(path: str) -> trimesh.Trimesh:
    """Load a mesh, flattening scenes so multi-object files still analyse.

    A 3MF or OBJ may contain a whole scene. Concatenating the parts gives the
    combined footprint, which is what matters for bed fit and material use.
    """
    try:
        loaded = trimesh.load(path, force="mesh")
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as-is
        raise MeshLoadError(f"could not read mesh: {exc}") from exc

    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise MeshLoadError("file contains no geometry")
        loaded = trimesh.util.concatenate(tuple(loaded.geometry.values()))

    if not isinstance(loaded, trimesh.Trimesh):
        raise MeshLoadError("file did not contain a triangle mesh")
    if loaded.faces.shape[0] == 0:
        raise MeshLoadError("mesh has no faces")

    return loaded


def _overhang_ratio(mesh: trimesh.Trimesh) -> float:
    """Fraction of surface area whose normal points downwards steeply enough
    to need support.

    Face normals are unit vectors, so the z component alone gives the angle
    from vertical. Faces are weighted by area rather than counted, so one large
    overhanging face is not outvoted by many small vertical ones.
    """
    normals = mesh.face_normals
    areas = mesh.area_faces
    total = float(areas.sum())
    if total <= 0:
        return 0.0

    # cos of the angle between the normal and straight down.
    downwardness = -normals[:, 2]
    threshold = math.cos(math.radians(90.0 - OVERHANG_ANGLE_DEG))
    overhanging = downwardness > threshold
    return float(areas[overhanging].sum() / total)


def _thin_wall_hint(mesh: trimesh.Trimesh, dims: Dimensions) -> str | None:
    """Cheap thin-wall heuristic: compare volume against surface area.

    A true thickness check needs ray casting or a medial axis, which is far too
    slow for an instant estimate. Mean thickness ~ 2V/A holds well enough for
    shell-like parts to justify a warning, and it is described as advisory.
    """
    if not mesh.is_watertight or mesh.area <= 0:
        return None
    mean_thickness_mm = 2.0 * mesh.volume / mesh.area
    if mean_thickness_mm < THIN_WALL_MM and min(dims.sorted_desc) > THIN_WALL_MM:
        return (
            f"Average wall thickness is around {mean_thickness_mm:.2f} mm, "
            f"below the {THIN_WALL_MM} mm a 0.4 mm nozzle prints reliably."
        )
    return None


def analyze_mesh(mesh: trimesh.Trimesh) -> GeometryResult:
    extents = mesh.extents
    dims = Dimensions(
        width_mm=round(float(extents[0]), 3),
        depth_mm=round(float(extents[1]), 3),
        height_mm=round(float(extents[2]), 3),
    )

    watertight = bool(mesh.is_watertight)
    winding_ok = bool(mesh.is_winding_consistent)

    # trimesh returns a signed volume; a mesh with flipped normals can report a
    # negative figure, which would silently become a negative material cost.
    raw_volume_mm3 = float(mesh.volume)
    volume_reliable = watertight and winding_ok and raw_volume_mm3 > 0
    volume_cm3 = round(abs(raw_volume_mm3) / 1000.0, 4)

    bbox_volume_mm3 = float(np.prod(extents)) if np.all(extents > 0) else 0.0
    fill_ratio = (
        round(abs(raw_volume_mm3) / bbox_volume_mm3, 4)
        if bbox_volume_mm3 > 0 and volume_reliable
        else 0.0
    )

    warnings: list[str] = []
    notes: list[str] = []

    if not watertight:
        warnings.append(
            "Mesh is not watertight, so the enclosed volume — and any material "
            "estimate from it — is unreliable."
        )
    if not winding_ok:
        warnings.append("Face winding is inconsistent; normals may be flipped.")
    if raw_volume_mm3 < 0:
        warnings.append("Mesh volume is negative, which means the normals point inwards.")
    if mesh.faces.shape[0] > HIGH_TRIANGLE_COUNT:
        warnings.append(
            f"{mesh.faces.shape[0]:,} triangles is unusually dense for FDM and will "
            "slow slicing; consider decimating."
        )
    if min(dims.width_mm, dims.depth_mm, dims.height_mm) <= 0:
        warnings.append("Model is flat in at least one axis and has no printable volume.")

    overhang_ratio = _overhang_ratio(mesh)
    if overhang_ratio > 0.25:
        warnings.append(
            f"{overhang_ratio * 100:.0f}% of the surface overhangs beyond "
            f"{OVERHANG_ANGLE_DEG:.0f}°; expect significant support."
        )
    elif overhang_ratio > 0.05:
        notes.append(f"Estimated support requirement: low ({overhang_ratio * 100:.0f}% overhang).")
    else:
        notes.append("Estimated support requirement: minimal.")

    thin = _thin_wall_hint(mesh, dims)
    if thin:
        warnings.append(thin)

    return GeometryResult(
        dimensions=dims,
        volume_cm3=volume_cm3,
        surface_area_cm2=round(float(mesh.area) / 100.0, 4),
        triangle_count=int(mesh.faces.shape[0]),
        vertex_count=int(mesh.vertices.shape[0]),
        is_watertight=watertight,
        is_winding_consistent=winding_ok,
        volume_is_reliable=volume_reliable,
        euler_number=int(mesh.euler_number),
        center_of_mass=[round(float(v), 3) for v in mesh.center_mass],
        overhang_area_ratio=round(overhang_ratio, 4),
        bounding_box_fill_ratio=fill_ratio,
        warnings=warnings,
        notes=notes,
    )


@dataclass
class BedFit:
    fits: bool
    fits_after_rotation: bool
    required_rotation_deg: int | None
    message: str


def check_bed_fit(dims: Dimensions, bed_x: float, bed_y: float, bed_z: float) -> BedFit:
    """Bed-fit check with the single rotation the doc's example calls out.

    Only Z-axis rotation by 90 degrees is considered, plus laying the part down.
    Arbitrary orientation search belongs with the slicer, not a quick estimate.
    """
    w, d, h = dims.width_mm, dims.depth_mm, dims.height_mm

    if w <= bed_x and d <= bed_y and h <= bed_z:
        return BedFit(True, False, None, "Model fits the build plate as oriented.")

    # Swap footprint axes — equivalent to rotating 90 degrees about Z.
    if d <= bed_x and w <= bed_y and h <= bed_z:
        return BedFit(False, True, 90, "Model fits the build plate after rotating 90° about Z.")

    # Lay it down: the longest edge becomes the footprint's long side.
    longest, middle, shortest = dims.sorted_desc
    if longest <= max(bed_x, bed_y) and middle <= min(bed_x, bed_y) and shortest <= bed_z:
        return BedFit(
            False, True, 90,
            "Model fits only if laid down; check that the new orientation is printable.",
        )

    over = []
    if w > bed_x or d > bed_y:
        over.append(f"footprint {w:.0f}×{d:.0f} mm vs bed {bed_x:.0f}×{bed_y:.0f} mm")
    if h > bed_z:
        over.append(f"height {h:.0f} mm vs {bed_z:.0f} mm")
    return BedFit(False, False, None, "Model exceeds the build volume: " + "; ".join(over) + ".")


