"""Slicer invocation — Level B, the primary costing source (design doc §4, §41).

Anycubic Slicer Next is based on OrcaSlicer, so one code path covers both.
Despite the PrusaSlicer lineage the CLI has diverged: Orca rejects
`--export-gcode` and wants `--slice 0` with profiles loaded from files, which
is what this module drives.

Nothing in this module guesses. If the slicer is missing, fails, or produces no
G-code, that is reported as a failure and the caller falls back to a geometry
estimate with the confidence lowered — §4 forbids passing off an estimate as a
slice.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from app.geometry.analyzer import MeshLoadError, load_mesh
from app.gcode.parser import GcodeResult, parse_gcode
from app.slicer.discovery import SlicerInfo, preferred_slicer
from app.slicer.profiles import ProfileError, resolve
from app.three_mf.reader import inspect_3mf

# Slicing a dense mesh is genuinely slow; this is a ceiling, not a target.
DEFAULT_TIMEOUT_SECONDS = 300


@dataclass
class SliceResult:
    ok: bool
    slicer_name: str | None
    duration_seconds: float
    gcode: dict[str, Any] | None = None
    gcode_path: str | None = None
    stdout: str = ""
    stderr: str = ""
    error: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _build_args(
    executable: str,
    model: Path,
    output_dir: Path,
    machine: Path,
    process: Path,
    filament: Path,
) -> list[str]:
    """OrcaSlicer CLI form.

    Orca is not argument-compatible with PrusaSlicer here: it wants `--slice 0`
    plus loaded profiles, and rejects `--export-gcode` outright. Settings come
    from the vendor profiles rather than individual flags so the machine limits
    and flow behaviour match the real printer.
    """
    return [
        executable,
        "--slice", "0",
        "--outputdir", str(output_dir),
        "--load-settings", f"{machine};{process}",
        "--load-filaments", str(filament),
        str(model),
    ]


def _prepare_input(model_path: Path, workdir: Path) -> tuple[Path, str | None]:
    """Give the slicer a file its CLI will actually accept.

    OrcaSlicer's CLI rejects many perfectly valid mesh-only 3MF files — the ones
    people download from model sites — with a bare `Slic3r::CLI::run found
    error` and no detail. trimesh reads them without complaint, so anything that
    is not already STL is converted first.

    A *sliced project* 3MF is different: it carries the slicer's own figures,
    which §41 ranks above anything we can recompute, and the caller checks for
    that before reaching here.
    """
    if model_path.suffix.lower() == ".stl":
        return model_path, None

    try:
        mesh = load_mesh(str(model_path))
    except MeshLoadError as exc:
        raise ValueError(f"could not read {model_path.name}: {exc}") from exc

    converted = workdir / f"{model_path.stem}.stl"
    converted.write_bytes(mesh.export(file_type="stl"))
    return converted, f"{model_path.suffix.lstrip('.')} converted to STL for slicing"


def slice_model(
    model_path: str | Path,
    *,
    layer_height_mm: float = 0.2,
    infill_percent: int = 15,
    wall_count: int = 3,
    supports: bool = False,
    nozzle_mm: float = 0.4,
    filament_diameter_mm: float = 1.75,
    density_g_cm3: float = 1.24,
    printer: str = "Kobra X",
    vendor: str = "Anycubic",
    material: str = "PLA",
    slicer: SlicerInfo | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> SliceResult:
    import time

    chosen = slicer or preferred_slicer()
    if chosen is None:
        return SliceResult(
            ok=False,
            slicer_name=None,
            duration_seconds=0.0,
            error="No slicer installed. Install OrcaSlicer or Anycubic Slicer Next for "
                  "costing-grade estimates.",
        )

    model_path = Path(model_path)
    if not model_path.exists():
        return SliceResult(False, chosen.name, 0.0, error=f"model not found: {model_path}")

    started = time.monotonic()
    workdir = Path(tempfile.mkdtemp(prefix="nexus-slice-"))

    try:
        try:
            profiles = resolve(
                chosen.executable,
                vendor=vendor,
                printer=printer,
                nozzle_mm=nozzle_mm,
                layer_height_mm=layer_height_mm,
                material=material,
            )
        except ProfileError as exc:
            return SliceResult(
                False, chosen.name, time.monotonic() - started,
                error=f"could not resolve slicer profiles: {exc}",
            )

        try:
            sliceable, conversion_note = _prepare_input(model_path, workdir)
        except ValueError as exc:
            return SliceResult(False, chosen.name, time.monotonic() - started, error=str(exc))

        args = _build_args(
            chosen.executable, sliceable, workdir,
            profiles.machine, profiles.process, profiles.filament,
        )
        try:
            completed = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                cwd=str(workdir),
            )
        except subprocess.TimeoutExpired:
            return SliceResult(
                False, chosen.name, time.monotonic() - started,
                error=f"slicer timed out after {timeout_seconds}s",
            )
        except OSError as exc:
            return SliceResult(
                False, chosen.name, time.monotonic() - started,
                error=f"could not run slicer: {exc}",
            )

        produced = sorted(workdir.glob("*.gcode")) + sorted(workdir.glob("**/*.gcode"))
        if not produced:
            # A non-zero exit with no output is the usual signal that the CLI
            # rejected an argument; surface its own message rather than guess.
            return SliceResult(
                False, chosen.name, time.monotonic() - started,
                stdout=completed.stdout[-4000:],
                stderr=completed.stderr[-4000:],
                error=(
                    f"slicer produced no G-code (exit {completed.returncode})"
                ),
            )

        gcode_file = produced[0]
        parsed: GcodeResult = parse_gcode(
            gcode_file.read_text(encoding="utf-8", errors="ignore").splitlines(),
            default_density_g_cm3=density_g_cm3,
        )

        # Keep the G-code: §43 wants an estimate to be reproducible, and the
        # file is the evidence behind the number.
        kept = Path(tempfile.gettempdir()) / f"nexus-{gcode_file.name}"
        shutil.copy2(gcode_file, kept)

        return SliceResult(
            ok=True,
            slicer_name=f"{chosen.name} · {profiles.machine_name} · {profiles.process_name}",
            duration_seconds=round(time.monotonic() - started, 2),
            gcode=parsed.to_dict(),
            gcode_path=str(kept),
            stdout=completed.stdout[-2000:],
            stderr=completed.stderr[-2000:],
            warnings=parsed.warnings + ([conversion_note] if conversion_note else []),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
