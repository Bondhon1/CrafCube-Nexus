"""Slicer discovery order (design doc §41).

The rule under test: a slicer the user installed always wins over the one this
app downloads, and the app downloads nothing when the user already has one.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.slicer import discovery
from app.slicer.discovery import SlicerInfo, find_slicers, has_own_slicer, preferred_slicer


def _exe(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(b"MZ")
    return path


@pytest.fixture()
def clean(monkeypatch, tmp_path):
    """No real installs, no PATH hits, no repo tools — only what a test adds."""
    monkeypatch.delenv("NEXUS_SLICER_PATH", raising=False)
    monkeypatch.delenv("NEXUS_SLICER_DIR", raising=False)
    monkeypatch.setattr(discovery, "_registry_install_dirs", lambda pattern: iter(()))
    monkeypatch.setattr(discovery.shutil, "which", lambda command: None)
    monkeypatch.setattr(discovery, "_repo_tools_dirs", lambda: [tmp_path / "no-tools"])
    # Products are frozen, so replace them with copies that have no default
    # paths — otherwise a real install on the test machine would leak in.
    monkeypatch.setattr(
        discovery, "_PRODUCTS",
        tuple(discovery._Product(p.name, p.display_pattern, p.executables, p.commands, ())
              for p in discovery._PRODUCTS),
    )
    return tmp_path


def _registry(monkeypatch, installs: dict[str, Path]):
    """Pretend Windows recorded these installs: display-name -> folder."""
    def fake(pattern):
        for display, folder in installs.items():
            if pattern.search(display):
                yield folder
    monkeypatch.setattr(discovery, "_registry_install_dirs", fake)


def test_nothing_installed_means_no_slicer(clean):
    assert find_slicers() == []
    assert preferred_slicer() is None


def test_an_installed_orcaslicer_beats_the_downloaded_copy(clean, monkeypatch):
    installed = clean / "Program Files" / "OrcaSlicer"
    _exe(installed, "orca-slicer.exe")
    downloaded = clean / "userData" / "slicer" / "orca"
    _exe(downloaded, "orca-slicer.exe")
    monkeypatch.setenv("NEXUS_SLICER_DIR", str(downloaded))
    _registry(monkeypatch, {"OrcaSlicer": installed})

    chosen = preferred_slicer()
    assert chosen is not None
    assert chosen.source == "installed"
    assert Path(chosen.executable).parent == installed


def test_anycubic_is_preferred_over_orca(clean, monkeypatch):
    anycubic = clean / "Anycubic Slicer Next"
    _exe(anycubic, "AnycubicSlicerNext.exe")
    orca = clean / "OrcaSlicer"
    _exe(orca, "orca-slicer.exe")
    _registry(monkeypatch, {"Anycubic Slicer Next 1.3.9": anycubic, "OrcaSlicer": orca})

    assert [s.name for s in find_slicers()][:2] == ["Anycubic Slicer Next", "OrcaSlicer"]


def test_a_custom_install_folder_is_found_through_the_registry(clean, monkeypatch):
    # The case hard-coded Program Files paths missed.
    custom = clean / "D-drive" / "Tools" / "Slicers" / "Orca"
    _exe(custom, "orca-slicer.exe")
    _registry(monkeypatch, {"OrcaSlicer": custom})

    assert preferred_slicer().executable == str(custom / "orca-slicer.exe")


def test_a_registry_entry_whose_program_was_deleted_is_ignored(clean, monkeypatch):
    # Uninstallers sometimes leave the key behind; a stale entry must not
    # suppress the download.
    _registry(monkeypatch, {"OrcaSlicer": clean / "gone"})
    assert find_slicers() == []
    assert not has_own_slicer(find_slicers())


def test_the_download_is_used_when_nothing_is_installed(clean, monkeypatch):
    downloaded = clean / "userData" / "slicer" / "orca"
    _exe(downloaded, "orca-slicer.exe")
    monkeypatch.setenv("NEXUS_SLICER_DIR", str(downloaded))

    chosen = preferred_slicer()
    assert chosen.source == "downloaded"
    assert not has_own_slicer(find_slicers()), "our own download is not the user's slicer"


def test_an_installed_slicer_means_do_not_download(clean, monkeypatch):
    installed = clean / "OrcaSlicer"
    _exe(installed, "orca-slicer.exe")
    _registry(monkeypatch, {"OrcaSlicer": installed})
    assert has_own_slicer(find_slicers())


def test_an_explicit_override_wins_over_everything(clean, monkeypatch):
    installed = clean / "OrcaSlicer"
    _exe(installed, "orca-slicer.exe")
    _registry(monkeypatch, {"OrcaSlicer": installed})
    override = _exe(clean / "elsewhere", "my-orca.exe")
    monkeypatch.setenv("NEXUS_SLICER_PATH", str(override))

    chosen = preferred_slicer()
    assert chosen.source == "configured"
    assert chosen.executable == str(override)


def test_unrelated_programs_do_not_match(clean, monkeypatch):
    other = clean / "Bambu Studio"
    _exe(other, "orca-slicer.exe")  # same exe name, wrong product
    _registry(monkeypatch, {"Bambu Studio": other, "Prusa Orca Tools": other})
    assert find_slicers() == []


def test_slicer_info_serialises_its_source():
    assert SlicerInfo("OrcaSlicer", "x.exe", "downloaded").to_dict()["source"] == "downloaded"
