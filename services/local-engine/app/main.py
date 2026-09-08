"""CrafCube Nexus local engine.

A small FastAPI service that runs on the operator's machine and does the
CPU-heavy, OS-dependent work the desktop app cannot: mesh analysis, G-code
parsing and (later) driving a slicer. Design doc §37-§40.

It binds to loopback only. Nothing here is authenticated, so it must never be
exposed on a network interface — the desktop app is the only intended caller.

Run:
    .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.geometry.analyzer import (
    Dimensions,
    MeshLoadError,
    analyze_mesh,
    check_bed_fit,
    estimate_filament_grams,
    load_mesh,
)
from app.gcode.parser import confidence_from_agreement, parse_gcode
from app.slicer.discovery import find_slicers

VERSION = "0.1.0"

# Formats trimesh can read that are meaningful for printing.
SUPPORTED_MESH_SUFFIXES = {".stl", ".3mf", ".obj", ".ply", ".off", ".glb", ".gltf"}

app = FastAPI(title="CrafCube Nexus local engine", version=VERSION)

# The desktop renderer runs from file://, which sends Origin: null.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(file://.*|null|http://localhost:\d+|http://127\.0\.0\.1:\d+)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


class BedSpec(BaseModel):
    x_mm: float = Field(260, gt=0)
    y_mm: float = Field(260, gt=0)
    z_mm: float = Field(260, gt=0)


@app.get("/status")
def status() -> dict[str, Any]:
    return {"status": "ok", "version": VERSION, "pid": os.getpid()}


@app.get("/capabilities")
def capabilities() -> dict[str, Any]:
    """What this machine can actually do.

    Reported honestly: with no slicer installed, Level B is unavailable and the
    caller must treat filament figures as geometry estimates (§4).
    """
    slicers = find_slicers()
    return {
        "version": VERSION,
        "geometry": True,
        "gcode_parsing": True,
        "slicing": bool(slicers),
        "slicers": [s.to_dict() for s in slicers],
        "supported_mesh_formats": sorted(SUPPORTED_MESH_SUFFIXES),
        "analysis_levels": {
            "A_geometry": "available",
            "B_slicer": "available" if slicers else "no slicer installed",
            "C_gcode": "available",
        },
    }


def _save_upload(upload: UploadFile, allowed: set[str] | None = None) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if allowed is not None and suffix not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported file type {suffix or '(none)'}; expected one of {sorted(allowed)}",
        )

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".bin")
    try:
        while chunk := upload.file.read(1024 * 1024):
            handle.write(chunk)
    finally:
        handle.close()
    return Path(handle.name)


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    bed_x_mm: float = Form(260.0),
    bed_y_mm: float = Form(260.0),
    bed_z_mm: float = Form(260.0),
    density_g_cm3: float = Form(1.24),
    infill_percent: float = Form(15.0),
    wall_count: int = Form(3),
    layer_height_mm: float = Form(0.2),
    nozzle_mm: float = Form(0.4),
) -> dict[str, Any]:
    """Level A analysis: dimensions, volume, printability warnings, bed fit."""
    path = _save_upload(file, SUPPORTED_MESH_SUFFIXES)
    try:
        mesh = load_mesh(str(path))
    except MeshLoadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        path.unlink(missing_ok=True)

    result = analyze_mesh(mesh)
    fit = check_bed_fit(result.dimensions, bed_x_mm, bed_y_mm, bed_z_mm)

    grams = estimate_filament_grams(
        volume_cm3=result.volume_cm3,
        density_g_cm3=density_g_cm3,
        infill_percent=infill_percent,
        wall_count=wall_count,
        layer_height_mm=layer_height_mm,
        nozzle_mm=nozzle_mm,
        surface_area_cm2=result.surface_area_cm2,
    )

    return {
        "status": "success",
        "level": "A",
        "geometry": result.to_dict(),
        "bed_fit": {
            "fits": fit.fits,
            "fits_after_rotation": fit.fits_after_rotation,
            "required_rotation_deg": fit.required_rotation_deg,
            "message": fit.message,
        },
        "estimate": {
            "filament_grams": grams,
            "basis": "geometry",
            # §4: a geometry estimate is never presented as a final figure.
            "confidence": "LOW" if result.volume_is_reliable else "UNRELIABLE",
            "reason": (
                "Geometry-only estimate. Slice the model for a costing-grade figure."
                if result.volume_is_reliable
                else "Mesh is not watertight, so its volume cannot be trusted."
            ),
        },
    }


@app.post("/validate-mesh")
async def validate_mesh(file: UploadFile = File(...)) -> dict[str, Any]:
    """Fast pass/fail check without the full analysis payload."""
    path = _save_upload(file, SUPPORTED_MESH_SUFFIXES)
    try:
        mesh = load_mesh(str(path))
    except MeshLoadError as exc:
        return {"status": "invalid", "valid": False, "reason": str(exc)}
    finally:
        path.unlink(missing_ok=True)

    result = analyze_mesh(mesh)
    return {
        "status": "success",
        "valid": result.is_watertight and result.is_winding_consistent,
        "is_watertight": result.is_watertight,
        "is_winding_consistent": result.is_winding_consistent,
        "triangle_count": result.triangle_count,
        "warnings": result.warnings,
    }


@app.post("/parse-gcode")
async def parse_gcode_endpoint(
    file: UploadFile = File(...),
    density_g_cm3: float = Form(1.24),
) -> dict[str, Any]:
    """Level C: independent extrusion total, compared against the slicer's claim."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8", errors="ignore")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"could not read G-code: {exc}") from exc

    result = parse_gcode(text.splitlines(), default_density_g_cm3=density_g_cm3)
    level, reason = confidence_from_agreement(
        result.calculated_filament_grams, result.slicer_filament_grams
    )

    return {
        "status": "success",
        "level": "C",
        "gcode": result.to_dict(),
        "confidence": {"level": level, "reason": reason},
    }


@app.post("/bed-fit")
def bed_fit(
    width_mm: float,
    depth_mm: float,
    height_mm: float,
    bed: BedSpec | None = None,
) -> dict[str, Any]:
    spec = bed or BedSpec()
    fit = check_bed_fit(
        Dimensions(width_mm, depth_mm, height_mm), spec.x_mm, spec.y_mm, spec.z_mm
    )
    return {
        "fits": fit.fits,
        "fits_after_rotation": fit.fits_after_rotation,
        "required_rotation_deg": fit.required_rotation_deg,
        "message": fit.message,
    }
