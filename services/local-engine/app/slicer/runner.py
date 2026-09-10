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
from app.slicer.layout import Bed, LayoutError, bed_from_machine_profile, load_parts, pack
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
    # How many plates the parts needed, and how many parts were laid out (§20).
    plate_count: int = 1
    part_count: int = 1
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


def _plate_files(model_path: Path, workdir: Path, bed: Bed) -> tuple[list[Path], list[str], int]:
    """Lay the file's parts out on plates and write each as an STL.

    Two problems are solved in one place. OrcaSlicer's CLI rejects many
    perfectly valid mesh-only 3MF files — the ones people download from model
    sites — with a bare `Slic3r::CLI::run found error` and no detail, so
    everything is handed over as STL. And a multi-object project carries its
    own layout, which can be wider than any real bed; re-laying the parts out
    is what makes such a file costable at all rather than simply refused.
    """
    notes: list[str] = []

    try:
        parts = load_parts(model_path)
    except (LayoutError, ValueError) as exc:
        raise ValueError(f"could not read {model_path.name}: {exc}") from exc

    plates = pack(parts, bed)

    paths: list[Path] = []
    for index, plate in enumerate(plates, start=1):
        target = workdir / f"{model_path.stem}-plate{index}.stl"
        target.write_bytes(plate.mesh.export(file_type="stl"))
        paths.append(target)

    if model_path.suffix.lower() != ".stl":
        notes.append(f"{model_path.suffix.lstrip('.')} converted to STL for slicing")
    if len(parts) > 1:
        notes.append(
            f"{len(parts)} parts arranged onto {len(plates)} "
            f"plate{'s' if len(plates) != 1 else ''}"
        )

    return paths, notes, len(parts)


def _combine(results: list[GcodeResult]) -> GcodeResult:
    """Sum several plates into the single figure a quote needs.

    Filament adds up across plates. Time does too — the plates run one after
    another on one machine, so the job really does take their sum. Layer count
    is the tallest plate rather than a total, because layers are not a quantity
    that accumulates across separate prints.
    """
    if len(results) == 1:
        return results[0]

    def total(pick, places: int = 3) -> float | None:
        values = [pick(r) for r in results]
        if any(v is None for v in values):
            return None
        # Rounded: summing floats across plates otherwise yields figures like
        # 249.71999999999997, which then reach a quote and the ledger.
        return round(sum(values), places)  # type: ignore[arg-type]

    per_tool: dict[int, float] = {}
    for result in results:
        for tool, mm in result.per_tool_filament_mm.items():
            per_tool[tool] = round(per_tool.get(tool, 0.0) + mm, 3)

    first = results[0]
    warnings: list[str] = []
    for result in results:
        for warning in result.warnings:
            if warning not in warnings:
                warnings.append(warning)

    seconds = total(lambda r: r.slicer_print_time_seconds)
    return GcodeResult(
        calculated_filament_mm=round(sum(r.calculated_filament_mm for r in results), 3),
        calculated_filament_cm3=round(sum(r.calculated_filament_cm3 for r in results), 4),
        calculated_filament_grams=total(lambda r: r.calculated_filament_grams),
        slicer_filament_grams=total(lambda r: r.slicer_filament_grams),
        slicer_filament_mm=total(lambda r: r.slicer_filament_mm),
        slicer_print_time_seconds=None if seconds is None else int(seconds),
        layer_count=max(r.layer_count for r in results),
        density_g_cm3=first.density_g_cm3,
        max_z_mm=max(r.max_z_mm for r in results),
        line_count=sum(r.line_count for r in results),
        slicer_name=first.slicer_name,
        filament_diameter_mm=first.filament_diameter_mm,
        per_tool_filament_mm=per_tool,
        warnings=warnings,
    )


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
    bed_x_mm: float = 256.0,
    bed_y_mm: float = 256.0,
    bed_z_mm: float = 256.0,
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

        # The machine profile knows the real build volume; the caller's figures
        # are only a fallback for a profile that does not state one.
        bed = bed_from_machine_profile(
            profiles.machine, Bed(bed_x_mm, bed_y_mm, bed_z_mm),
        )

        try:
            plate_files, notes, part_count = _plate_files(model_path, workdir, bed)
        except LayoutError as exc:
            # A part larger than the bed is a fact about the model, not a
            # slicer failure, and saying so beats relaying exit -50.
            return SliceResult(
                False, chosen.name, time.monotonic() - started, part_count=0,
                error=str(exc),
            )
        except ValueError as exc:
            return SliceResult(False, chosen.name, time.monotonic() - started, error=str(exc))

        parsed_plates: list[GcodeResult] = []
        kept_path: str | None = None
        last_stdout = last_stderr = ""

        for index, sliceable in enumerate(plate_files, start=1):
            plate_dir = workdir / f"out{index}"
            plate_dir.mkdir(exist_ok=True)
            args = _build_args(
                chosen.executable, sliceable, plate_dir,
                profiles.machine, profiles.process, profiles.filament,
            )
            try:
                completed = subprocess.run(
                    args,
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                    cwd=str(plate_dir),
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

            last_stdout, last_stderr = completed.stdout, completed.stderr
            produced = sorted(plate_dir.glob("*.gcode")) + sorted(plate_dir.glob("**/*.gcode"))
            if not produced:
                # A non-zero exit with no output is the usual signal that the
                # CLI rejected an argument; surface its own message rather
                # than guess.
                where = "" if len(plate_files) == 1 else f" on plate {index} of {len(plate_files)}"
                return SliceResult(
                    False, chosen.name, time.monotonic() - started,
                    stdout=completed.stdout[-4000:],
                    stderr=completed.stderr[-4000:],
                    plate_count=len(plate_files), part_count=part_count,
                    error=(
                        f"slicer produced no G-code{where} (exit {completed.returncode})"
                        + (f": {completed.stdout.strip().splitlines()[-1]}"
                           if completed.stdout.strip() else "")
                    ),
                )

            gcode_file = produced[0]
            parsed_plates.append(parse_gcode(
                gcode_file.read_text(encoding="utf-8", errors="ignore").splitlines(),
                default_density_g_cm3=density_g_cm3,
            ))
            if kept_path is None:
                kept_path = str(gcode_file)

        parsed: GcodeResult = _combine(parsed_plates)
        gcode_file = Path(kept_path) if kept_path else plate_files[0]
        conversion_note = "; ".join(notes) if notes else None
        completed_stdout, completed_stderr = last_stdout, last_stderr

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
            plate_count=len(plate_files),
            part_count=part_count,
            stdout=completed_stdout[-2000:],
            stderr=completed_stderr[-2000:],
            warnings=parsed.warnings + ([conversion_note] if conversion_note else []),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
