"""3MF inspection (design doc §16).

3MF is a ZIP of XML parts, not a mesh format, and the doc is explicit that the
analyzer must look inside before treating one as a plain STL.

The valuable case is a *sliced* 3MF. OrcaSlicer, Bambu Studio and Anycubic
Slicer Next all export project files containing the generated G-code plus the
printer, filament and process settings used. When that is present we already
have slicer-grade numbers without running a slicer at all — §41 ranks this
third, above the G-code parser and far above a geometry guess.
"""
from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

# The core 3MF namespace. Vendors add their own, which is why lookups below are
# written against local tag names rather than fully qualified ones.
_MODEL_PART = "3D/3dmodel.model"

# Slicers store the plate G-code under Metadata/ with varying names.
_GCODE_PATTERNS = [
    re.compile(r"^Metadata/plate_\d+\.gcode$", re.I),
    re.compile(r"^Metadata/.*\.gcode$", re.I),
    re.compile(r".*\.gcode$", re.I),
]

_CONFIG_PATTERNS = [
    re.compile(r"^Metadata/.*process.*\.config$", re.I),
    re.compile(r"^Metadata/.*slice.*\.config$", re.I),
    re.compile(r"^Metadata/project_settings\.config$", re.I),
]


@dataclass
class ThreeMfInfo:
    is_zip: bool
    has_model_part: bool
    object_count: int
    unit: str
    metadata: dict[str, str] = field(default_factory=dict)
    part_names: list[str] = field(default_factory=list)

    # Sliced-project extras.
    contains_gcode: bool = False
    gcode_part: str | None = None
    settings: dict[str, Any] = field(default_factory=dict)
    filament_used_grams: float | None = None
    print_time_seconds: int | None = None

    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _local(tag: str) -> str:
    """Strip the XML namespace so vendor variants still match."""
    return tag.rsplit("}", 1)[-1].lower()


def _parse_model_part(data: bytes) -> tuple[int, str, dict[str, str]]:
    root = ElementTree.fromstring(data)
    unit = root.attrib.get("unit", "millimeter")

    objects = 0
    metadata: dict[str, str] = {}
    for element in root.iter():
        name = _local(element.tag)
        if name == "object":
            objects += 1
        elif name == "metadata":
            key = element.attrib.get("name", "").strip()
            if key and element.text:
                metadata[key] = element.text.strip()

    return objects, unit, metadata


def _extract_config(text: str) -> dict[str, Any]:
    """Slicer .config parts are either JSON or `key = value` lines."""
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

    settings: dict[str, Any] = {}
    for line in stripped.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            settings[key.strip()] = value.strip()
    return settings


def inspect_3mf(path: str | Path) -> ThreeMfInfo:
    path = Path(path)

    if not zipfile.is_zipfile(path):
        return ThreeMfInfo(
            is_zip=False,
            has_model_part=False,
            object_count=0,
            unit="unknown",
            warnings=["File is not a valid 3MF archive."],
        )

    warnings: list[str] = []
    objects = 0
    unit = "millimeter"
    metadata: dict[str, str] = {}
    settings: dict[str, Any] = {}
    gcode_part: str | None = None

    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()

        model_part = next((n for n in names if n.lower() == _MODEL_PART.lower()), None)
        if model_part:
            try:
                objects, unit, metadata = _parse_model_part(archive.read(model_part))
            except ElementTree.ParseError as exc:
                warnings.append(f"3D model part is malformed: {exc}")
        else:
            warnings.append("Archive has no 3D/3dmodel.model part; it may not be a real 3MF.")

        for pattern in _GCODE_PATTERNS:
            match = next((n for n in names if pattern.match(n)), None)
            if match:
                gcode_part = match
                break

        for pattern in _CONFIG_PATTERNS:
            for name in names:
                if pattern.match(name):
                    try:
                        settings.update(_extract_config(archive.read(name).decode("utf-8", "ignore")))
                    except Exception as exc:  # noqa: BLE001
                        warnings.append(f"Could not read {name}: {exc}")
            if settings:
                break

        info = ThreeMfInfo(
            is_zip=True,
            has_model_part=model_part is not None,
            object_count=objects,
            unit=unit,
            metadata=metadata,
            part_names=names[:50],
            contains_gcode=gcode_part is not None,
            gcode_part=gcode_part,
            settings=settings,
            warnings=warnings,
        )

        if gcode_part:
            # Import here to keep the module importable without the parser.
            from app.gcode.parser import parse_gcode

            text = archive.read(gcode_part).decode("utf-8", "ignore")
            parsed = parse_gcode(text.splitlines())
            info.filament_used_grams = parsed.slicer_filament_grams or parsed.calculated_filament_grams
            info.print_time_seconds = parsed.slicer_print_time_seconds

    if unit not in ("millimeter", "millimetre"):
        # A 3MF in metres or inches would silently misprice by orders of
        # magnitude if the unit were ignored.
        warnings.append(
            f"Model unit is '{unit}', not millimetres; dimensions need conversion before costing."
        )
        info.warnings = warnings

    return info


def read_embedded_gcode(path: str | Path) -> str | None:
    """The raw G-code text from a sliced 3MF, if it has any."""
    path = Path(path)
    if not zipfile.is_zipfile(path):
        return None
    with zipfile.ZipFile(path) as archive:
        for pattern in _GCODE_PATTERNS:
            match = next((n for n in archive.namelist() if pattern.match(n)), None)
            if match:
                return archive.read(match).decode("utf-8", "ignore")
    return None
