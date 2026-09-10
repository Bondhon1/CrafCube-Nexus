"""Plate layout (design doc §20)."""
from __future__ import annotations

import math

import pytest
import trimesh

from app.slicer.layout import (
    EDGE_MARGIN_MM, Bed, LayoutError, bed_from_machine_profile, pack,
)

KOBRA = Bed(260.0, 260.0, 260.0)


def block(width: float, depth: float, height: float, at=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=(width, depth, height))
    mesh.apply_translation(at)
    return mesh


def test_a_single_part_stays_on_one_plate():
    plates = pack([block(50, 50, 20)], KOBRA)
    assert len(plates) == 1
    assert plates[0].part_count == 1


def test_parts_spread_beyond_the_bed_are_brought_back_onto_it():
    # The failing case: a project 3MF whose objects sit 475 mm apart, which is
    # wider than any real bed and which OrcaSlicer refuses outright.
    parts = [block(70, 35, 74, at=(x, 0, 0)) for x in (0, 150, 300, 450)]
    plates = pack(parts, KOBRA)

    assert len(plates) == 1, "four small parts fit one 260 mm plate once re-laid out"
    low, high = plates[0].mesh.bounds
    assert high[0] - low[0] <= KOBRA.usable_x
    assert high[1] - low[1] <= KOBRA.usable_y


def test_everything_lands_inside_the_printable_area():
    parts = [block(60, 60, 10) for _ in range(4)]
    for plate in pack(parts, KOBRA):
        low, high = plate.mesh.bounds
        assert low[0] >= -0.001 and low[1] >= -0.001
        assert high[0] <= KOBRA.x_mm + 0.001
        assert high[1] <= KOBRA.y_mm + 0.001
        # Parts must sit on the bed, not float above or sink below it.
        assert math.isclose(low[2], 0.0, abs_tol=1e-6)


def test_more_than_one_plate_when_the_parts_do_not_fit_together():
    # Six 120 mm squares cannot share a 260 mm bed.
    parts = [block(120, 120, 10) for _ in range(6)]
    plates = pack(parts, KOBRA)

    assert len(plates) > 1
    assert sum(p.part_count for p in plates) == 6, "no part may be dropped"


def test_a_part_is_turned_when_that_is_what_makes_it_fit():
    # Rotation can only help on a bed that is not square, so KOBRA would pass
    # this test without ever turning anything.
    narrow = Bed(100.0, 300.0, 200.0)
    part = block(200, 50, 10)          # too wide as-is, fits turned 90 degrees

    plates = pack([part], narrow)

    assert len(plates) == 1
    low, high = plates[0].mesh.bounds
    assert high[0] - low[0] == pytest.approx(50, abs=0.01), "should now be 50 wide"
    assert high[1] - low[1] == pytest.approx(200, abs=0.01), "and 200 deep"


def test_a_part_that_fits_neither_way_is_refused():
    with pytest.raises(LayoutError):
        pack([block(200, 200, 10)], Bed(100.0, 300.0, 200.0))


def test_a_part_larger_than_the_bed_is_refused_with_its_measurements():
    with pytest.raises(LayoutError) as excinfo:
        pack([block(400, 400, 10)], KOBRA)
    message = str(excinfo.value)
    assert "400" in message and "260" in message, message


def test_a_part_taller_than_the_build_height_is_refused():
    with pytest.raises(LayoutError) as excinfo:
        pack([block(20, 20, 400)], KOBRA)
    assert "tall" in str(excinfo.value)


def test_nothing_to_place_is_an_error_not_an_empty_plate():
    with pytest.raises(LayoutError):
        pack([], KOBRA)


def test_bed_comes_from_the_machine_profile(tmp_path):
    profile = tmp_path / "machine.json"
    profile.write_text(
        '{"printable_area": ["0x0", "260x0", "260x260", "0x260"], "printable_height": 260}',
        encoding="utf-8",
    )
    bed = bed_from_machine_profile(profile, Bed(1, 1, 1))
    assert (bed.x_mm, bed.y_mm, bed.z_mm) == (260.0, 260.0, 260.0)


def test_an_unreadable_profile_falls_back_rather_than_crashing(tmp_path):
    missing = tmp_path / "nope.json"
    fallback = Bed(180.0, 180.0, 180.0)
    assert bed_from_machine_profile(missing, fallback) == fallback


def test_a_profile_without_a_printable_area_falls_back(tmp_path):
    profile = tmp_path / "machine.json"
    profile.write_text('{"name": "no area here"}', encoding="utf-8")
    fallback = Bed(180.0, 180.0, 180.0)
    assert bed_from_machine_profile(profile, fallback) == fallback


def test_parts_do_not_overlap_on_a_plate():
    parts = [block(80, 80, 10) for _ in range(4)]
    plate = pack(parts, KOBRA)[0]
    # Four 80 mm squares plus gaps: the merged volume must equal the sum of
    # the parts, which it cannot if any two intersect.
    assert math.isclose(plate.mesh.volume, 4 * 80 * 80 * 10, rel_tol=1e-6)


def test_the_edge_margin_is_respected():
    plate = pack([block(10, 10, 10)], Bed(100, 100, 100))[0]
    low, high = plate.mesh.bounds
    assert low[0] >= EDGE_MARGIN_MM - 0.001
    assert high[0] <= 100 - EDGE_MARGIN_MM + 0.001
