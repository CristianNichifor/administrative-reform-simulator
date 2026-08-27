"""Road-network distance between the seats of every adjacent pair of UATs.

The brief ruled road distance out (§8) in favour of a Euclidean radius plus a binary
border-crossing test. On the real map that produces indefensible results: Sarichioi is
12 km from Babadag and shares a road-connected border with it, but ends up assigned to
Tulcea 27 km away, because Tulcea is a county capital and capitals are processed first.
Around the Razim lagoon straight-line distance understates travel badly, so measuring the
road makes the difference larger and the assignment more defensible, not less.

This computes one number per adjacency edge: the driving distance between the two UATs'
seat villages. The model then accumulates those along the path it grows, so "how far is
this commune from its centre" is a road distance rather than a straight line.

Output:
    data/processed/road_distance.parquet    a_siruta, b_siruta, road_m
    data/processed/reports/road_distance.md

Usage:
    uv run python -m pipeline.build_road_distance
"""

from __future__ import annotations

import argparse
import sys

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import get_coordinates

from pipeline.build_geometry import Check, Report, write_report
from pipeline.constants import CRS_STEREO70, CRS_WGS84
from pipeline.paths import PROCESSED_DIR, RAW_DIR, REPORTS_DIR

# The whole public road network, down to the residential streets inside villages.
#
# An earlier version stopped at the classified network to keep the graph small, on the
# argument that residential streets only change a route in the last few hundred metres. That
# is true of the distance and false of the topology: where a village connects to its
# neighbour by an unclassified lane that OSM records as `residential`, leaving it out does
# not lengthen the route, it removes it — and a commune with no route is a commune the model
# cannot place sensibly.
#
# It costs: 511k ways instead of 169k, roughly six million junctions instead of 2.6.
ROUTING_CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "road",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
)

# Vertices closer than this are treated as the same junction. OSM ways that meet at a
# junction share a node, but ways digitised separately can miss by centimetres; snapping to
# a grid joins them instead of leaving the network in disconnected pieces.
SNAP_GRID_M = 1.0

# A seat further than this from any road is not on the network — reported, not silently
# attached to something far away.
MAX_SEAT_SNAP_M = 5_000.0

# Routing is bounded: adjacent seats are close, and an unbounded search over a national
# graph would explore the whole country for every one of 3,186 sources.
SEARCH_LIMIT_M = 60_000.0

# Sources per Dijkstra call. Each call allocates one float64 row per source over every node
# in the graph, so this trades memory against the number of calls.
SOURCE_CHUNK = 4


def load_roads() -> gpd.GeoDataFrame:
    path = RAW_DIR / "romania-latest.osm.pbf"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch --with-roads")
    classes = ",".join(f"'{c}'" for c in ROUTING_CLASSES)
    roads = gpd.read_file(
        path,
        layer="lines",
        columns=["highway"],
        where=f"highway IN ({classes})",
        engine="pyogrio",
    )
    if roads.crs is None:
        roads = roads.set_crs(CRS_WGS84)
    return roads.to_crs(CRS_STEREO70)


def build_graph(roads: gpd.GeoDataFrame, report: Report):
    """Turn road linestrings into a weighted node graph.

    Every vertex becomes a node and every consecutive pair an undirected edge weighted by
    its length. Vertices are snapped to a 1 m grid first so that ways meeting at a junction
    share a node rather than passing through each other.
    """
    coords, index = get_coordinates(roads.geometry, return_index=True)
    snapped = np.round(coords / SNAP_GRID_M).astype(np.int64)

    # Identify junctions by hashing the snapped (x, y) into one integer and uniquing that.
    #
    # `np.unique(..., axis=0)` on a ten-million-row array is what killed the first attempt:
    # the row-wise path builds a structured view and lexsorts it, and the peak allocation
    # is several times the input. Packing into a single int64 first turns the same job into
    # an ordinary 1-D sort.
    x0, y0 = snapped[:, 0].min(), snapped[:, 1].min()
    span_y = int(snapped[:, 1].max() - y0) + 1
    key = (snapped[:, 0] - x0) * span_y + (snapped[:, 1] - y0)
    _, node_of_vertex = np.unique(key, return_inverse=True)
    del snapped, key
    n_nodes = int(node_of_vertex.max()) + 1

    # Consecutive vertices belong to the same edge only when they belong to the same line.
    same_line = index[:-1] == index[1:]
    a = node_of_vertex[:-1][same_line]
    b = node_of_vertex[1:][same_line]
    seg = coords[1:][same_line] - coords[:-1][same_line]
    length = np.hypot(seg[:, 0], seg[:, 1])

    # Drop self-loops created by snapping.
    keep = a != b
    a, b, length = a[keep], b[keep], length[keep]

    # Built symmetric directly: duplicate entries are summed by coo_matrix, which would
    # double the weight of any segment appearing twice, so `directed=False` is used at
    # query time and each segment is stored once in each direction.
    graph = coo_matrix(
        (np.concatenate([length, length]), (np.concatenate([a, b]), np.concatenate([b, a]))),
        shape=(n_nodes, n_nodes),
    ).tocsr()

    report.add(
        Check(
            "road_graph",
            n_nodes > 100_000,
            f"{len(roads):,} road features -> {n_nodes:,} junctions, {len(a):,} segments",
            fatal=n_nodes <= 100_000,
        )
    )
    return graph, node_of_vertex, coords, n_nodes


def snap_seats(
    coords: np.ndarray, node_of_vertex: np.ndarray, seats: gpd.GeoDataFrame, report: Report
):
    """Attach every UAT seat to its nearest road junction."""
    from scipy.spatial import cKDTree

    tree = cKDTree(coords)
    seat_xy = np.column_stack([seats.geometry.x.to_numpy(), seats.geometry.y.to_numpy()])
    distance, vertex = tree.query(seat_xy, k=1)
    nodes = node_of_vertex[vertex]

    far = int((distance > MAX_SEAT_SNAP_M).sum())
    report.add(
        Check(
            "seat_snapping",
            far == 0,
            f"seats snapped to the road network: median {np.median(distance):,.0f} m, "
            f"max {distance.max():,.0f} m; {far} beyond {MAX_SEAT_SNAP_M:,.0f} m",
            fatal=False,
        )
    )
    return nodes, distance


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__).parse_args(argv)
    report = Report()

    adjacency_path = PROCESSED_DIR / "adjacency.parquet"
    seats_path = PROCESSED_DIR / "uat_seats.gpkg"
    for path, cmd in ((adjacency_path, "build_adjacency"), (seats_path, "build_seats")):
        if not path.exists():
            raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.{cmd}")

    print("Loading roads...")
    roads = load_roads()

    print("Building the road graph...")
    graph, node_of_vertex, coords, _ = build_graph(roads, report)

    seats = gpd.read_file(seats_path, layer="seat").sort_values("siruta", ignore_index=True)
    order = list(seats["siruta"])
    row_of = {s: i for i, s in enumerate(order)}
    seat_nodes, _ = snap_seats(coords, node_of_vertex, seats, report)

    adjacency = pd.read_parquet(adjacency_path)
    pairs = list(zip(adjacency["a_siruta"], adjacency["b_siruta"], strict=True))

    # Which neighbours each seat needs a distance to.
    wanted: dict[int, list[tuple[int, int]]] = {}
    for edge_index, (a, b) in enumerate(pairs):
        wanted.setdefault(row_of[a], []).append((row_of[b], edge_index))

    print(f"Routing between {len(pairs):,} adjacent seat pairs...")
    road_m = np.full(len(pairs), np.inf)
    sources = sorted(wanted)
    for start in range(0, len(sources), SOURCE_CHUNK):
        chunk = sources[start : start + SOURCE_CHUNK]
        distances = dijkstra(
            graph,
            directed=False,
            indices=seat_nodes[chunk],
            limit=SEARCH_LIMIT_M,
        )
        for row, source_row in enumerate(chunk):
            for target_row, edge_index in wanted[source_row]:
                road_m[edge_index] = distances[row, seat_nodes[target_row]]
        done = min(start + SOURCE_CHUNK, len(sources))
        print(f"  {done}/{len(sources)} seats", end="\r", flush=True)
    print()

    unreachable = int(np.isinf(road_m).sum())
    finite = road_m[np.isfinite(road_m)]
    report.add(
        Check(
            "routed_pairs",
            unreachable < len(pairs) * 0.05,
            f"{len(pairs) - unreachable:,} of {len(pairs):,} adjacent pairs routed; "
            f"{unreachable} unreachable by road",
            fatal=unreachable >= len(pairs) * 0.05,
        )
    )
    report.add(
        Check(
            "road_distance_distribution",
            True,
            f"seat-to-seat road distance: median {np.median(finite) / 1000:,.1f} km, "
            f"p90 {np.quantile(finite, 0.9) / 1000:,.1f} km, max {finite.max() / 1000:,.1f} km",
        )
    )

    # How much further the road is than the straight line. A ratio near 1 everywhere would
    # mean routing had added nothing and the extra machinery was not worth it.
    seat_xy = np.column_stack([seats.geometry.x.to_numpy(), seats.geometry.y.to_numpy()])
    straight = np.array(
        [float(np.hypot(*(seat_xy[row_of[a]] - seat_xy[row_of[b]]))) for a, b in pairs]
    )
    ratio = road_m[np.isfinite(road_m)] / np.maximum(straight[np.isfinite(road_m)], 1.0)
    report.add(
        Check(
            "detour_ratio",
            True,
            f"road distance over straight line: median {np.median(ratio):.2f}x, "
            f"p90 {np.quantile(ratio, 0.9):.2f}x, max {ratio.max():.1f}x "
            "— the tail is where a straight line is most misleading",
        )
    )

    out = PROCESSED_DIR / "road_distance.parquet"
    pd.DataFrame(
        {
            "a_siruta": [a for a, _ in pairs],
            "b_siruta": [b for _, b in pairs],
            "road_m": road_m,
            "straight_m": straight,
        }
    ).sort_values(["a_siruta", "b_siruta"], ignore_index=True).to_parquet(out, index=False)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "road_distance.md", REPORTS_DIR / "road_distance.json")

    if report.failed:
        return 1
    print(f"\nWrote {out} ({len(pairs):,} edges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
