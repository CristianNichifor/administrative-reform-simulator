"""Guards on the shared constants.

These are cheap, but they are not ceremonial: the radius grid and the tier ordering are
baked into precomputed artefacts and into every conflict resolution the model performs.
A silent edit to either is a silent change to every published map.
"""

from pipeline import constants as c


class TestParameterDefaults:
    """Every default must sit inside its own advertised UI range."""

    def test_defaults_within_ranges(self) -> None:
        cases = [
            ("X", c.ABSORBER_POP_THRESHOLD_DEFAULT, c.ABSORBER_POP_THRESHOLD_RANGE),
            ("R_cap", c.R_CAP_DEFAULT_M, c.RADIUS_RANGE_M),
            ("R_town", c.R_TOWN_DEFAULT_M, c.RADIUS_RANGE_M),
            ("N_min", c.N_MIN_DEFAULT, c.N_MIN_RANGE),
            ("R_sep", c.R_SEP_DEFAULT_M, c.R_SEP_RANGE_M),
            ("min_overlap", c.MIN_OVERLAP_DEFAULT, c.MIN_OVERLAP_RANGE),
            ("P_orphan", c.P_ORPHAN_DEFAULT, c.P_ORPHAN_RANGE),
        ]
        for name, value, (low, high) in cases:
            assert low <= value <= high, f"{name}={value} outside range [{low}, {high}]"

    def test_x_floor_matches_slider_minimum(self) -> None:
        # The candidacy grid is precomputed only for UATs at or above this floor. If the
        # slider could go below it, the model would silently ignore legal absorbers.
        assert c.ABSORBER_POP_THRESHOLD_RANGE[0] == c.POTENTIAL_ABSORBER_POP_FLOOR


class TestRadiusGrid:
    def test_grid_spans_the_slider_range(self) -> None:
        assert c.RADIUS_GRID_M[0] == c.RADIUS_RANGE_M[0]
        assert c.RADIUS_GRID_M[-1] == c.RADIUS_RANGE_M[1]

    def test_grid_is_sorted_and_unique(self) -> None:
        assert list(c.RADIUS_GRID_M) == sorted(set(c.RADIUS_GRID_M))

    def test_grid_has_expected_shape(self) -> None:
        # 5 to 30 km in 2.5 km steps. The size budget for the candidacy artefact is
        # computed against this count, so a change here is a change to the payload budget.
        assert len(c.RADIUS_GRID_M) == 11
        steps = {b - a for a, b in zip(c.RADIUS_GRID_M, c.RADIUS_GRID_M[1:], strict=False)}
        assert steps == {2_500}

    def test_defaults_snap_to_the_grid(self) -> None:
        # A default that is not on the grid cannot be served from the precomputed
        # candidacy artefact, which would mean the very first render is a special case.
        assert c.R_CAP_DEFAULT_M in c.RADIUS_GRID_M
        assert c.R_TOWN_DEFAULT_M in c.RADIUS_GRID_M


class TestCounties:
    def test_county_count(self) -> None:
        assert len(c.COUNTY_CODES) == c.EXPECTED_COUNTY_COUNT

    def test_county_codes_unique(self) -> None:
        assert len(set(c.COUNTY_CODES)) == len(c.COUNTY_CODES)

    def test_bucharest_present(self) -> None:
        assert c.BUCHAREST_COUNTY_CODE in c.COUNTY_CODES


class TestTierOrdering:
    def test_tiers_are_strictly_ordered(self) -> None:
        # Capitals must be processed before population seeds, which must be processed
        # before promoted seeds. Conflict resolution depends on this exact ordering.
        assert c.TIER_COUNTY_CAPITAL < c.TIER_POPULATION < c.TIER_PROMOTED


class TestRelaxation:
    def test_relaxation_shrinks_and_terminates(self) -> None:
        # The separation constraint relaxes by repeated multiplication and stops at a
        # floor. A factor >= 1 would loop forever; a floor <= 0 would never be reached.
        assert 0 < c.R_SEP_RELAXATION_FACTOR < 1
        assert c.R_SEP_RELAXATION_FLOOR_M > 0
