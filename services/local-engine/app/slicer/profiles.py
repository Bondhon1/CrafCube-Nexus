"""OrcaSlicer profile resolution (design doc §42, §43).

OrcaSlicer ships vendor profiles as JSON with an `inherits` chain. Loading one
file directly through the CLI leaves the parent's values unset, so the child's
own constraints fail validation. Flattening the chain first is what makes
non-interactive slicing work at all.

Using the vendor's own Kobra X profiles matters for accuracy: they carry the
real machine limits, flow rates and retraction behaviour, which a hand-built
profile would get wrong in ways that quietly change the filament figure.
"""
from __future__ import annotations

import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ResolvedProfiles:
    machine: Path
    process: Path
    filament: Path
    machine_name: str
    process_name: str
    filament_name: str


class ProfileError(RuntimeError):
    """No usable profile could be resolved."""


def profiles_root(slicer_executable: str | Path) -> Path:
    """`resources/profiles` beside the OrcaSlicer executable."""
    return Path(slicer_executable).parent / "resources" / "profiles"


def _load_chain(directory: Path, name: str) -> dict[str, Any]:
    """Merge a profile with its ancestors, child values winning."""
    chain: list[dict[str, Any]] = []
    current: str | None = name
    seen: set[str] = set()

    while current:
        if current in seen:
            raise ProfileError(f"circular inherits at {current}")
        seen.add(current)

        path = directory / f"{current}.json"
        if not path.exists():
            raise ProfileError(f"profile not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        chain.append(data)
        current = data.get("inherits") or None

    merged: dict[str, Any] = {}
    for data in reversed(chain):
        merged.update(data)
    merged.pop("inherits", None)
    merged["name"] = name
    return _apply_cli_fixups(merged)


def _apply_cli_fixups(profile: dict[str, Any]) -> dict[str, Any]:
    """Work around validation the CLI applies to values it then ignores.

    OrcaSlicer range-checks `retraction_distances_when_cut` against [10, 18]
    even when `enable_long_retraction_when_cut` is 0, and the stock Anycubic
    profiles ship 0 — so an unmodified vendor profile fails to slice. The
    feature stays disabled; only the inert value is made legal.
    """
    if "retraction_distances_when_cut" in profile:
        values = profile["retraction_distances_when_cut"]
        if isinstance(values, list):
            profile["retraction_distances_when_cut"] = [
                v if str(v) not in ("0", "0.0") else "10" for v in values
            ]
    return profile


def _pick(directory: Path, patterns: list[str]) -> str | None:
    """First profile whose filename matches every term of a pattern.

    Terms are matched on word boundaries, not as bare substrings. Plain
    `in` matching selected "Anycubic Kobra 2 Max" for printer "Kobra X",
    because the single letter x occurs inside "Max" — which would have sliced
    on the wrong machine and produced a confidently wrong cost.
    """
    if not directory.exists():
        return None
    names = sorted(p.stem for p in directory.glob("*.json"))
    for pattern in patterns:
        terms = [re.escape(t.lower()) for t in pattern.split()]
        for name in names:
            lowered = name.lower()
            if all(re.search(rf"(?<![a-z0-9]){t}(?![a-z0-9])", lowered) for t in terms):
                return name
    return None


def resolve(
    slicer_executable: str | Path,
    *,
    vendor: str = "Anycubic",
    printer: str = "Kobra X",
    nozzle_mm: float = 0.4,
    layer_height_mm: float = 0.20,
    material: str = "PLA",
) -> ResolvedProfiles:
    root = profiles_root(slicer_executable) / vendor
    if not root.exists():
        raise ProfileError(f"no bundled profiles for vendor {vendor} at {root}")

    nozzle = f"{nozzle_mm:g} nozzle"
    layer = f"{layer_height_mm:.2f}mm"

    machine_name = _pick(root / "machine", [f"{printer} {nozzle}", printer])
    if not machine_name:
        raise ProfileError(f"no machine profile for {printer}")

    process_name = _pick(
        root / "process",
        [
            f"{layer} standard {printer} {nozzle}",
            f"{layer} {printer} {nozzle}",
            f"standard {printer} {nozzle}",
            f"{printer} {nozzle}",
        ],
    )
    if not process_name:
        raise ProfileError(f"no process profile for {printer} at {layer}")

    filament_name = _pick(
        root / "filament",
        [f"generic {material}", material, "generic pla"],
    )
    if not filament_name:
        raise ProfileError(f"no filament profile for {material}")

    workdir = Path(tempfile.mkdtemp(prefix="nexus-profiles-"))
    written: dict[str, Path] = {}
    for kind, name in (
        ("machine", machine_name),
        ("process", process_name),
        ("filament", filament_name),
    ):
        merged = _load_chain(root / kind, name)
        path = workdir / f"{kind}.json"
        path.write_text(json.dumps(merged), encoding="utf-8")
        written[kind] = path

    return ResolvedProfiles(
        machine=written["machine"],
        process=written["process"],
        filament=written["filament"],
        machine_name=machine_name,
        process_name=process_name,
        filament_name=filament_name,
    )


def available_printers(slicer_executable: str | Path, vendor: str = "Anycubic") -> list[str]:
    directory = profiles_root(slicer_executable) / vendor / "machine"
    if not directory.exists():
        return []
    # Collapse the per-nozzle variants into the printer names themselves.
    names = {re.sub(r"\s+[\d.]+ nozzle$", "", p.stem) for p in directory.glob("*.json")}
    return sorted(names)
