"""Painted Orca/Bambu projects are sliced as themselves, not flattened to STL."""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

from app.slicer.runner import _build_args, _project_filaments


def _project(path: Path, *, colours=None, paint=True) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        tri = '<triangle v1="0" v2="1" v3="2"%s/>' % (' paint_color="8"' if paint else "")
        z.writestr("3D/Objects/object_1.model", f"<model><mesh>{tri}</mesh></model>")
        if colours is not None:
            z.writestr("Metadata/project_settings.config", json.dumps({"filament_colour": colours}))
    return path


def test_a_painted_three_colour_project_needs_three_slots(tmp_path):
    f = _project(tmp_path / "a.3mf", colours=["#000000", "#FFD700", "#FF69B4"])
    assert _project_filaments(f) == 3


def test_paint_without_a_filament_list_still_counts_as_multi_colour(tmp_path):
    assert _project_filaments(_project(tmp_path / "b.3mf", colours=None)) == 2


def test_a_plain_single_filament_3mf_is_not_a_project(tmp_path):
    f = _project(tmp_path / "c.3mf", colours=["#FFFFFF"], paint=False)
    assert _project_filaments(f) == 0


def test_objects_assigned_different_filaments_count_without_paint(tmp_path):
    # The brick container: two filaments, each on whole objects, no paint.
    f = _project(tmp_path / "d.3mf", colours=["#FFFFFF", "#000000"], paint=False)
    assert _project_filaments(f) == 2


def test_stl_and_broken_archives_are_never_projects(tmp_path):
    stl = tmp_path / "e.stl"
    stl.write_bytes(b"solid x\nendsolid x\n")
    broken = tmp_path / "f.3mf"
    broken.write_bytes(b"not a zip")
    assert _project_filaments(stl) == 0
    assert _project_filaments(broken) == 0


def test_each_colour_gets_its_own_filament_slot():
    args = _build_args("orca.exe", Path("m.3mf"), Path("out"), Path("machine.json"),
                       Path("process.json"), Path("pla.json"), filament_slots=3)
    assert args[args.index("--load-filaments") + 1] == "pla.json;pla.json;pla.json"
