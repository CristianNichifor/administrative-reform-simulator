"""Tests for candidacy grid construction and the county-capital table.

The grid decides which UATs an absorber can ever reach. Its two subtle properties are that
it must grow monotonically with radius (a bigger buffer strictly contains a smaller one) and
that it must never contain a cross-county pair, since the model forbids those merges.
"""

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point, box

from pipeline.build_candidacy import MIN_STORED_OVERLAP, build_grid, select_absorbers
from pipeline.build_geometry import Report
from pipeline.constants import (
    CRS_STEREO70,
    POTENTIAL_ABSORBER_POP_FLOOR,
    RADIUS_GRID_M,
    TIER_COUNTY_CAPITAL,
    TIER_POPULATION,
)
from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA, EXPECTED_CAPITAL_COUNT


class TestCountyCapitals:
    def test_one_capital_per_county(self) -> None:
        counties = list(COUNTY_CAPITAL_SIRUTA.values())
        assert len(counties) == EXPECTED_CAPITAL_COUNT
        assert len(set(counties)) == EXPECTED_CAPITAL_COUNT

    def test_bucharest_is_not_a_county_capital_row(self) -> None:
        # Bucharest's six sectors are tier-0 seeds individually, so B must not appear here
        # or the city would gain a 42nd capital that is not a UAT.
        assert "B" not in COUNTY_CAPITAL_SIRUTA.values()

    def test_ilfov_capital_is_buftea(self) -> None:
        # The regression this table exists for: Otopeni is larger and shares Buftea's rank,
        # so any size-based heuristic picks the wrong capital for Ilfov.
        assert COUNTY_CAPITAL_SIRUTA["100576"] == "IF"

    def test_siruta_keys_are_unique(self) -> None:
        assert len(COUNTY_CAPITAL_SIRUTA) == EXPECTED_CAPITAL_COUNT


def _uats() -> gpd.GeoDataFrame:
    """Four 10 km squares in a row: three in county XX, one in county YY."""
    return gpd.GeoDataFrame(
        {
            "siruta": ["1", "2", "3", "4"],
            "name_uat": ["A", "B", "C", "D"],
            "county_code": ["XX", "XX", "XX", "YY"],
            "population": [50_000, 1_000, 1_000, 1_000],
            "geometry": [box(i * 10_000, 0, (i + 1) * 10_000, 10_000) for i in range(4)],
        },
        crs=CRS_STEREO70,
    )


def _seats() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "siruta": ["1", "2", "3", "4"],
            "seat_geometry": [Point(i * 10_000 + 5_000, 5_000) for i in range(4)],
        }
    )


class TestSelectAbsorbers:
    def test_population_floor_applies(self) -> None:
        chosen = select_absorbers(_uats(), Report())
        assert set(chosen["siruta"]) == {"1"}

    def test_capitals_are_included_below_the_floor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A county capital is an absorber by rule, not by size.
        monkeypatch.setattr("pipeline.build_candidacy.COUNTY_CAPITAL_SIRUTA", {"2": "XX"})
        monkeypatch.setattr("pipeline.build_candidacy.EXPECTED_CAPITAL_COUNT", 1)
        chosen = select_absorbers(_uats(), Report())
        assert set(chosen["siruta"]) == {"1", "2"}
        tiers = dict(zip(chosen["siruta"], chosen["tier"], strict=True))
        assert tiers["2"] == TIER_COUNTY_CAPITAL
        assert tiers["1"] == TIER_POPULATION

    def test_floor_matches_the_configured_constant(self) -> None:
        uats = _uats()
        uats.loc[1, "population"] = POTENTIAL_ABSORBER_POP_FLOOR
        chosen = select_absorbers(uats, Report())
        assert "2" in set(chosen["siruta"])


class TestBuildGrid:
    def test_no_cross_county_pairs(self) -> None:
        # UAT 4 is in county YY and adjacent to UAT 3, so a 30 km buffer certainly reaches
        # it — but the model forbids cross-county merges, so it must not be stored.
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        assert "4" not in set(grid["uat_siruta"])

    def test_absorber_is_not_its_own_candidate(self) -> None:
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        assert not (grid["absorber_siruta"] == grid["uat_siruta"]).any()

    def test_candidates_grow_monotonically_with_radius(self) -> None:
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        counts = grid.groupby("radius_m").size().reindex(RADIUS_GRID_M).fillna(0)
        assert (counts.diff().dropna() >= 0).all()

    def test_stored_rows_are_informative(self) -> None:
        # Every stored row must be reachable at some slider setting: either the overlap can
        # clear a min_overlap threshold, or the seat rule fires.
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        assert ((grid["overlap_fraction"] >= MIN_STORED_OVERLAP) | grid["seat_inside"]).all()

    def test_overlap_fraction_is_a_proportion(self) -> None:
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        assert grid["overlap_fraction"].between(0.0, 1.0).all()

    def test_enclosed_uat_has_full_overlap_and_seat_inside(self) -> None:
        # UAT 2 abuts the absorber, so a 30 km buffer swallows it whole.
        grid = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        row = grid[
            (grid["radius_m"] == 30_000)
            & (grid["absorber_siruta"] == "1")
            & (grid["uat_siruta"] == "2")
        ]
        assert len(row) == 1
        assert row.iloc[0]["overlap_fraction"] == pytest.approx(1.0)
        assert bool(row.iloc[0]["seat_inside"]) is True

    def test_output_is_deterministic(self) -> None:
        a = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        b = build_grid(_uats(), select_absorbers(_uats(), Report()), _seats(), Report())
        pd.testing.assert_frame_equal(a, b)
