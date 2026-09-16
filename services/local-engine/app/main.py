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
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.geometry.analyzer import (
    Dimensions,
    MeshLoadError,
    analyze_mesh,
    check_bed_fit,
    load_mesh,
)
from app.gcode.parser import confidence_from_agreement, parse_gcode
from app.slicer.discovery import find_slicers, has_own_slicer, preferred_slicer
from app.slicer.profiles import available_printers
from app.slicer.runner import slice_model
from app.three_mf.reader import inspect_3mf

VERSION = "0.5.0"

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

    With no slicer, jobs have no weight or time at all — estimates come only
    from slicing. `has_own_slicer` tells the desktop app whether the user
    already has one, which is what decides whether it downloads OrcaSlicer.
    """
    slicers = find_slicers()
    chosen = slicers[0] if slicers else None
    printers = available_printers(chosen.executable) if chosen else []
    return {
        "version": VERSION,
        "geometry": True,
        "gcode_parsing": True,
        "three_mf": True,
        "slicing": bool(slicers),
        "slicers": [s.to_dict() for s in slicers],
        "has_own_slicer": has_own_slicer(slicers),
        "printer_profiles": printers,
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
) -> dict[str, Any]:
    """Level A analysis: dimensions, volume, printability warnings, bed fit.

    Measurement only. Filament and time come from a real slice (level B) —
    §4 forbids passing a geometry guess off as a costing figure, and the
    guess was out by +32% and +49% on two of this shop's own models, so it
    is no longer produced at all.
    """
    path = _save_upload(file, SUPPORTED_MESH_SUFFIXES)
    try:
        mesh = load_mesh(str(path))
    except MeshLoadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        path.unlink(missing_ok=True)

    result = analyze_mesh(mesh)
    fit = check_bed_fit(result.dimensions, bed_x_mm, bed_y_mm, bed_z_mm)

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


@app.post("/mesh-preview")
async def mesh_preview(
    file: UploadFile = File(...),
    max_faces: int = Form(120_000),
) -> Response:
    """Return the mesh as binary STL, whatever format came in.

    The renderer can draw STL and nothing else. Writing a 3MF/OBJ/PLY parser in
    the renderer would duplicate trimesh badly, so conversion happens here and
    one code path covers every supported format.

    Dense meshes are decimated first: a preview does not need 500k triangles,
    and shipping them over IPC to draw a 280px canvas is wasted work.
    """
    path = _save_upload(file, SUPPORTED_MESH_SUFFIXES)
    try:
        mesh = load_mesh(str(path))
    except MeshLoadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        path.unlink(missing_ok=True)

    if max_faces > 0 and mesh.faces.shape[0] > max_faces:
        try:
            mesh = mesh.simplify_quadric_decimation(max_faces)
        except Exception:  # noqa: BLE001 - preview quality, never fatal
            pass

    return Response(content=mesh.export(file_type="stl"), media_type="model/stl")


@app.post("/slice")
async def slice_endpoint(
    file: UploadFile = File(...),
    layer_height_mm: float = Form(0.2),
    infill_percent: int = Form(15),
    wall_count: int = Form(3),
    supports: bool = Form(False),
    nozzle_mm: float = Form(0.4),
    density_g_cm3: float = Form(1.24),
    printer: str = Form("Kobra X"),
    vendor: str = Form("Anycubic"),
    material: str = Form("PLA"),
    # Only a fallback: the machine profile states the real build volume, and
    # these are used when it does not.
    bed_x_mm: float = Form(256.0),
    bed_y_mm: float = Form(256.0),
    bed_z_mm: float = Form(256.0),
) -> dict[str, Any]:
    """Level B: a real slice, the primary costing source (§4).

    Returns the slicer's own figures alongside an independent recomputation
    from the produced G-code, plus the confidence their agreement implies.
    """
    path = _save_upload(file, SUPPORTED_MESH_SUFFIXES)
    try:
        result = slice_model(
            path,
            layer_height_mm=layer_height_mm,
            infill_percent=infill_percent,
            wall_count=wall_count,
            supports=supports,
            nozzle_mm=nozzle_mm,
            density_g_cm3=density_g_cm3,
            printer=printer,
            vendor=vendor,
            material=material,
            bed_x_mm=bed_x_mm,
            bed_y_mm=bed_y_mm,
            bed_z_mm=bed_z_mm,
        )
    finally:
        path.unlink(missing_ok=True)

    if not result.ok:
        # Deliberately not an HTTP error: a failed slice is a normal outcome
        # that the caller handles by falling back to a geometry estimate.
        return {"status": "failed", "level": "B", "slice": result.to_dict()}

    gcode = result.gcode or {}
    level, reason = confidence_from_agreement(
        gcode.get("calculated_filament_grams"), gcode.get("slicer_filament_grams")
    )
    return {
        "status": "success",
        "level": "B",
        "slice": result.to_dict(),
        "confidence": {"level": level, "reason": reason},
    }


@app.post("/analyze-3mf")
async def analyze_3mf(file: UploadFile = File(...)) -> dict[str, Any]:
    """Inspect a 3MF before treating it as a plain mesh (§16).

    A sliced project already carries the slicer's own filament and time
    figures, which §41 ranks above anything this service can recompute.
    """
    path = _save_upload(file, {".3mf"})
    try:
        info = inspect_3mf(path)
    finally:
        path.unlink(missing_ok=True)

    return {
        "status": "success",
        "three_mf": info.to_dict(),
        "has_slicer_data": info.contains_gcode,
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
