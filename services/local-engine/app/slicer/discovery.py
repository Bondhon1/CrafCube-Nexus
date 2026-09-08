"""Slicer discovery (design doc §41).

Preference order is Anycubic Slicer Next, then OrcaSlicer, then nothing. When
no slicer is installed the engine still runs — it simply reports that Level B
is unavailable, so callers fall back to geometry estimates and label the
confidence accordingly rather than pretending to have sliced.
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

# Ordered by §41's preference. Each entry lists the executable names to look for
# on PATH and the usual install locations per platform.
_CANDIDATES: list[tuple[str, list[str], list[str]]] = [
    (
        "Anycubic Slicer Next",
        ["anycubic-slicer-next", "AnycubicSlicerNext"],
        [
            r"C:\Program Files\Anycubic Slicer Next\AnycubicSlicerNext.exe",
            r"C:\Program Files (x86)\Anycubic Slicer Next\AnycubicSlicerNext.exe",
            "/Applications/AnycubicSlicerNext.app/Contents/MacOS/AnycubicSlicerNext",
            "/usr/bin/anycubic-slicer-next",
        ],
    ),
    (
        "OrcaSlicer",
        ["orca-slicer", "orcaslicer", "OrcaSlicer"],
        [
            r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
            r"C:\Program Files\OrcaSlicer\OrcaSlicer.exe",
            "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
            "/usr/bin/orca-slicer",
        ],
    ),
]


@dataclass
class SlicerInfo:
    name: str
    executable: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _bundled_candidates() -> list[Path]:
    """Portable slicer builds kept beside the project.

    A downloaded portable build is not on PATH and not in Program Files, so
    without this the engine reports "no slicer installed" while one sits in the
    repository — which is exactly what happened.
    """
    engine_root = Path(__file__).resolve().parents[2]
    project_root = engine_root.parents[1]
    names = ["orca-slicer.exe", "OrcaSlicer.exe", "orca-slicer", "OrcaSlicer"]
    roots = [project_root / "tools" / "orca", engine_root / "tools" / "orca"]
    return [root / name for root in roots for name in names]


def find_slicers() -> list[SlicerInfo]:
    """Every slicer found, in preference order."""
    found: list[SlicerInfo] = []

    override = os.environ.get("NEXUS_SLICER_PATH")
    if override and Path(override).exists():
        found.append(SlicerInfo(name="Configured slicer", executable=override))

    for candidate in _bundled_candidates():
        if candidate.exists():
            found.append(SlicerInfo(name="OrcaSlicer (bundled)", executable=str(candidate)))
            break

    for name, commands, paths in _CANDIDATES:
        executable = None
        for command in commands:
            resolved = shutil.which(command)
            if resolved:
                executable = resolved
                break
        if executable is None:
            for path in paths:
                if Path(path).exists():
                    executable = path
                    break
        if executable:
            found.append(SlicerInfo(name=name, executable=executable))

    return found


def preferred_slicer() -> SlicerInfo | None:
    slicers = find_slicers()
    return slicers[0] if slicers else None
