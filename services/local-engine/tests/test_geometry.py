"""Geometry tests against primitives whose exact answers are known.

Checking a cube's volume against 20³ is worth far more than asserting whatever
the code happens to return, because it catches unit errors — mm³ versus cm³ is
the single most likely way this module goes wrong.
"""
from __future__ import annotations

import math

import pytest
import trimesh

from app.geometry.analyzer import (
    Dimensions,
    MeshLoadError,
    analyze_mesh,
    check_bed_fit,
    load_mesh,
)


def test_cube_dimensions_and_volume():
    mesh = trimesh.creation.box(extents=(20.0, 30.0, 40.0))
    result = analyze_mesh(mesh)

    assert result.dimensions.width_mm == pytest.approx(20.0)
    assert result.dimensions.depth_mm == pytest.approx(30.0)
    assert result.dimensions.height_mm == pytest.approx(40.0)

    # 20 x 30 x 40 mm = 24000 mm3 = 24 cm3. Catches a mm3/cm3 mix-up.
    assert result.volume_cm3 == pytest.approx(24.0, rel=1e-6)

    # Surface area 2(20*30 + 20*40 + 30*40) = 5200 mm2 = 52 cm2.
    assert result.surface_area_cm2 == pytest.approx(52.0, rel=1e-6)

    assert result.is_watertight
    assert result.volume_is_reliable
    assert result.triangle_count == 12


def test_sphere_volume_matches_formula():
    mesh = trimesh.creation.icosphere(subdivisions=4, radius=10.0)
    result = analyze_mesh(mesh)

    exact_cm3 = (4.0 / 3.0) * math.pi * (10.0**3) / 1000.0
    # A subdivided icosphere is slightly inscribed, so it comes in just under.
    assert result.volume_cm3 == pytest.approx(exact_cm3, rel=0.01)
    assert result.bounding_box_fill_ratio == pytest.approx(math.pi / 6.0, rel=0.02)


def test_open_mesh_is_flagged_unreliable():
    # A single triangle: valid geometry, but it encloses nothing.
    mesh = trimesh.Trimesh(
        vertices=[[0, 0, 0], [10, 0, 0], [0, 10, 0]],
        faces=[[0, 1, 2]],
        process=False,
    )
    result = analyze_mesh(mesh)

    assert not result.is_watertight
    assert not result.volume_is_reliable
    assert any("watertight" in w.lower() for w in result.warnings)


def test_inverted_normals_do_not_produce_negative_volume():
    mesh = trimesh.creation.box(extents=(10.0, 10.0, 10.0))
    mesh.invert()
    result = analyze_mesh(mesh)

    # The reported figure stays positive so it can never become a negative cost.
    assert result.volume_cm3 > 0
    assert not result.volume_is_reliable


def test_flat_overhang_detected():
    # A box has a fully downward-facing bottom: 1 of 6 faces by area.
    result = analyze_mesh(trimesh.creation.box(extents=(10.0, 10.0, 10.0)))
    assert result.overhang_area_ratio == pytest.approx(1 / 6, rel=0.01)


def test_empty_mesh_rejected(tmp_path):
    empty = tmp_path / "empty.stl"
    empty.write_bytes(b"")
    with pytest.raises(MeshLoadError):
        load_mesh(str(empty))


def test_stl_round_trip(tmp_path):
    source = trimesh.creation.box(extents=(50.0, 60.0, 70.0))
    path = tmp_path / "box.stl"
    source.export(path)

    result = analyze_mesh(load_mesh(str(path)))
    assert result.dimensions.height_mm == pytest.approx(70.0)
    assert result.volume_cm3 == pytest.approx(210.0, rel=1e-4)


class TestBedFit:
    KOBRA = (260.0, 260.0, 260.0)

    def test_fits_as_oriented(self):
        fit = check_bed_fit(Dimensions(100, 100, 100), *self.KOBRA)
        assert fit.fits and not fit.fits_after_rotation

    def test_fits_after_z_rotation(self):
        # 280 deep exceeds Y, but swapping the footprint axes fits.
        fit = check_bed_fit(Dimensions(100, 280, 100), 300.0, 200.0, 260.0)
        assert not fit.fits
        assert fit.fits_after_rotation
        assert fit.required_rotation_deg == 90

    def test_too_tall_cannot_be_rotated_flat(self):
        fit = check_bed_fit(Dimensions(400, 400, 400), *self.KOBRA)
        assert not fit.fits and not fit.fits_after_rotation
        assert "exceeds the build volume" in fit.message

    def test_tall_part_fits_when_laid_down(self):
        # 400 mm tall exceeds Z, but it lies flat within the footprint.
        fit = check_bed_fit(Dimensions(50, 50, 400), 500.0, 200.0, 260.0)
        assert fit.fits_after_rotation
