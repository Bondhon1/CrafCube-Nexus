"""Slicer discovery (design doc §41).

Every estimate now comes from slicing, so finding a slicer is the engine's
most important job after serving requests. The search order encodes one rule:
**a slicer the user already installed always wins over one this app fetched.**
Downloading 164 MB for someone who already has Anycubic Slicer Next, or using
a pinned copy while theirs sits unused, would both be wrong.

  1. NEXUS_SLICER_PATH             an explicit override
  2. installed Anycubic Slicer Next (registry, then PATH, then default paths)
  3. installed OrcaSlicer           (same)
  4. the app's downloaded OrcaSlicer (NEXUS_SLICER_DIR)
  5. tools/orca beside the repo     (development only)

The registry is the primary source for installs because it records where the
installer actually put the program. Hard-coded Program Files paths miss any
custom install folder, and missing one here means a pointless download.
"""
from __future__ import annotations

import os
import re
import shutil
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator

# Where a slicer came from. The desktop app uses this to decide whether to
# download one: anything but "downloaded"/"bundled" means the user has their own.
Source = str  # "configured" | "installed" | "downloaded" | "bundled"


@dataclass
class SlicerInfo:
    name: str
    executable: str
    source: Source = "installed"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class _Product:
    name: str
    # Matched against the registry DisplayName.
    display_pattern: re.Pattern[str]
    executables: tuple[str, ...]
    commands: tuple[str, ...]
    default_paths: tuple[str, ...]


# In §41's preference order.
_PRODUCTS: tuple[_Product, ...] = (
    _Product(
        name="Anycubic Slicer Next",
        display_pattern=re.compile(r"anycubic\s*slicer\s*next", re.I),
        executables=("AnycubicSlicerNext.exe", "anycubic-slicer-next.exe"),
        commands=("anycubic-slicer-next", "AnycubicSlicerNext"),
        default_paths=(
            r"C:\Program Files\Anycubic Slicer Next\AnycubicSlicerNext.exe",
            r"C:\Program Files\AnycubicSlicerNext\AnycubicSlicerNext.exe",
            "/Applications/AnycubicSlicerNext.app/Contents/MacOS/AnycubicSlicerNext",
            "/usr/bin/anycubic-slicer-next",
        ),
    ),
    _Product(
        name="OrcaSlicer",
        display_pattern=re.compile(r"^orca\s*slicer", re.I),
        executables=("orca-slicer.exe", "OrcaSlicer.exe"),
        commands=("orca-slicer", "orcaslicer", "OrcaSlicer"),
        default_paths=(
            r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
            r"C:\Program Files\OrcaSlicer\OrcaSlicer.exe",
            "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
            "/usr/bin/orca-slicer",
        ),
    ),
)

_ORCA_EXECUTABLES = ("orca-slicer.exe", "OrcaSlicer.exe", "orca-slicer", "OrcaSlicer")


def _registry_install_dirs(pattern: re.Pattern[str]) -> Iterator[Path]:
    """Install folders Windows has recorded for programs matching `pattern`.

    Looks in all three uninstall hives: machine-wide 64-bit, machine-wide
    32-bit, and per-user — a per-user install is invisible to the first two.
    """
    if sys.platform != "win32":
        return
    import winreg

    hives = (
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE,
         r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    )
    for hive, path in hives:
        try:
            root = winreg.OpenKey(hive, path)
        except OSError:
            continue
        with root:
            index = 0
            while True:
                try:
                    sub = winreg.EnumKey(root, index)
                except OSError:
                    break
                index += 1
                try:
                    with winreg.OpenKey(root, sub) as key:
                        display = _read(winreg, key, "DisplayName")
                        if not display or not pattern.search(display):
                            continue
                        location = _read(winreg, key, "InstallLocation")
                        if location:
                            yield Path(location.strip().strip('"'))
                        # Some installers leave InstallLocation empty but point
                        # DisplayIcon at the executable itself.
                        icon = _read(winreg, key, "DisplayIcon")
                        if icon:
                            yield Path(icon.split(",")[0].strip().strip('"')).parent
                except OSError:
                    continue


def _read(winreg: Any, key: Any, name: str) -> str | None:
    try:
        value, _ = winreg.QueryValueEx(key, name)
    except OSError:
        return None
    return value if isinstance(value, str) and value else None


def _find_installed(product: _Product) -> str | None:
    for folder in _registry_install_dirs(product.display_pattern):
        for exe in product.executables:
            candidate = folder / exe
            if candidate.is_file():
                return str(candidate)

    for command in product.commands:
        resolved = shutil.which(command)
        if resolved:
            return resolved

    for path in product.default_paths:
        if Path(path).is_file():
            return path
    return None


def _find_orca_in(folder: Path) -> str | None:
    for exe in _ORCA_EXECUTABLES:
        candidate = folder / exe
        if candidate.is_file():
            return str(candidate)
    return None


def _downloaded_dir() -> Path | None:
    """Where the desktop app unpacks its own OrcaSlicer, if it told us."""
    configured = os.environ.get("NEXUS_SLICER_DIR")
    return Path(configured) if configured else None


def _repo_tools_dirs() -> list[Path]:
    """A portable build kept beside the repository, for development."""
    engine_root = Path(__file__).resolve().parents[2]
    return [engine_root.parents[1] / "tools" / "orca", engine_root / "tools" / "orca"]


def find_slicers() -> list[SlicerInfo]:
    """Every usable slicer, best first. Called per request, so an install or a
    finished download is picked up without restarting the engine."""
    found: list[SlicerInfo] = []

    override = os.environ.get("NEXUS_SLICER_PATH")
    if override and Path(override).is_file():
        found.append(SlicerInfo("Configured slicer", override, "configured"))

    for product in _PRODUCTS:
        executable = _find_installed(product)
        if executable:
            found.append(SlicerInfo(product.name, executable, "installed"))

    downloaded = _downloaded_dir()
    if downloaded:
        executable = _find_orca_in(downloaded)
        if executable:
            found.append(SlicerInfo("OrcaSlicer (downloaded)", executable, "downloaded"))

    for folder in _repo_tools_dirs():
        executable = _find_orca_in(folder)
        if executable:
            found.append(SlicerInfo("OrcaSlicer (bundled)", executable, "bundled"))
            break

    return found


def preferred_slicer() -> SlicerInfo | None:
    slicers = find_slicers()
    return slicers[0] if slicers else None


def has_own_slicer(slicers: list[SlicerInfo]) -> bool:
    """True when the user already has a slicer, so nothing should be downloaded."""
    return any(s.source in ("configured", "installed") for s in slicers)
