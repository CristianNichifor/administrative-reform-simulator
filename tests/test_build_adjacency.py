"""Tests for adjacency pair construction.

The graph these produce decides which UATs the model can ever reach. Two failure modes are
silent and expensive: a border counted twice because (a,b) and (b,a) did not collapse, and a
national-border segment treated as adjacency to a UAT that does not exist.
"""

import geopandas as gpd
import pytest
from shapely.geometry import LineString, box

from pipeline.build_adjacency import ROAD_CLASS_RANK, build_pairs, flag_road_crossings
from pipeline.build_geometry import Report
from pipeline.constants import CRS_STEREO70, OSM_ROAD_CLASSES


def _lines(rows: list[tuple[int, int]]) -> gpd.GeoDataFrame:
    """Build a boundary-segment frame; geometry is irrelevant to pair construction."""
    return gpd.GeoDataFrame(
        {
            "leftid": [a for a, _ in rows],
            "rightid": [b for _, b in rows],
            "legalstat": ["agreed"] * len(rows),
            "geometry": [LineString([(0, i), (1, i)]) for i in range(len(rows))],
        },
        crs=CRS_STEREO70,
    )


class TestBuildPairs:
    def test_reversed_pairs_collapse_to_one_edge(self) -> None:
        # The same border digitised in both directions must not become two edges.
        pairs = build_pairs(_lines([(100, 200), (200, 100)]), Report())
        assert len(pairs) == 1
        assert (pairs.iloc[0]["a_siruta"], pairs.iloc[0]["b_siruta"]) == ("100", "200")

    def test_multiple_segments_of_one_border_dissolve(self) -> None:
        # One shared border is frequently split across several segments upstream.
        pairs = build_pairs(_lines([(100, 200), (100, 200), (100, 200)]), Report())
        assert len(pairs) == 1

    def test_exterior_segments_are_dropped(self) -> None:
        # leftid/rightid == 0 means the other side is outside Romania. Keeping these would
        # invent a neighbour with SIRUTA 0 that no UAT row matches.
        pairs = build_pairs(_lines([(0, 74907), (100, 200), (73736, 0)]), Report())
        assert len(pairs) == 1
        assert "0" not in set(pairs["a_siruta"]) | set(pairs["b_siruta"])

    def test_distinct_borders_stay_distinct(self) -> None:
        pairs = build_pairs(_lines([(100, 200), (100, 300), (200, 300)]), Report())
        assert len(pairs) == 3

    def test_pair_ordering_is_canonical(self) -> None:
        # a_siruta must always be the lexicographically smaller code, so downstream joins
        # can rely on one representation.
        pairs = build_pairs(_lines([(300, 100), (200, 400)]), Report())
        for row in pairs.itertuples():
            assert row.a_siruta < row.b_siruta

    def test_self_loop_is_fatal(self) -> None:
        report = Report()
        build_pairs(_lines([(100, 100), (100, 200)]), report)
        failed = [c.name for c in report.failed]
        assert "self_loops" in failed

    def test_output_is_deterministic(self) -> None:
        # Determinism is a hard project requirement; the same input must give byte-identical
        # edges, in the same order.
        rows = [(300, 100), (200, 400), (100, 200), (400, 300)]
        first = build_pairs(_lines(rows), Report())
        second = build_pairs(_lines(rows), Report())
        assert list(first["a_siruta"]) == list(second["a_siruta"])
        assert list(first["b_siruta"]) == list(second["b_siruta"])


class TestRoadCrossing:
    """A road counts only if it is near the border *and* enters both UATs.

    The parallel-road case is not hypothetical: on the real data, 358 borders were flagged
    by the buffer alone with no road entering both sides.
    """

    @staticmethod
    def _fixture(road: LineString) -> tuple:
        # Two 1 km squares meeting on the line x = 1000.
        a = box(0, 0, 1000, 1000)
        b = box(1000, 0, 2000, 1000)
        uats = gpd.GeoDataFrame({"siruta": ["100", "200"], "geometry": [a, b]}, crs=CRS_STEREO70)
        pairs = gpd.GeoDataFrame(
            {
                "a_siruta": ["100"],
                "b_siruta": ["200"],
                "legalstat": ["agreed"],
                "geometry": [LineString([(1000, 0), (1000, 1000)])],
            },
            crs=CRS_STEREO70,
        )
        roads = gpd.GeoDataFrame({"highway": ["secondary"], "geometry": [road]}, crs=CRS_STEREO70)
        return pairs, roads, uats

    def test_road_crossing_the_border_is_flagged(self) -> None:
        pairs, roads, uats = self._fixture(LineString([(500, 500), (1500, 500)]))
        out = flag_road_crossings(pairs, roads, uats, Report())
        assert bool(out.iloc[0]["has_road"]) is True
        assert out.iloc[0]["road_class"] == "secondary"

    def test_road_parallel_to_the_border_is_not_flagged(self) -> None:
        # Runs 20 m inside UAT 100, well within the 50 m buffer, but never enters 200.
        pairs, roads, uats = self._fixture(LineString([(980, 100), (980, 900)]))
        out = flag_road_crossings(pairs, roads, uats, Report())
        assert bool(out.iloc[0]["has_road"]) is False

    def test_road_far_from_the_border_is_not_flagged(self) -> None:
        pairs, roads, uats = self._fixture(LineString([(100, 100), (200, 200)]))
        out = flag_road_crossings(pairs, roads, uats, Report())
        assert bool(out.iloc[0]["has_road"]) is False


class TestRoadClassRank:
    def test_ranks_cover_every_configured_class(self) -> None:
        assert set(ROAD_CLASS_RANK) == set(OSM_ROAD_CLASSES)

    @pytest.mark.parametrize(
        ("better", "worse"),
        [("motorway", "trunk"), ("trunk", "primary"), ("tertiary", "unclassified")],
    )
    def test_higher_class_sorts_first(self, better: str, worse: str) -> None:
        assert ROAD_CLASS_RANK[better] < ROAD_CLASS_RANK[worse]
