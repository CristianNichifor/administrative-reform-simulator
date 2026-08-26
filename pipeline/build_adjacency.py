"""Build the adjacency graph and flag which shared borders a road actually crosses.

This is a verification gate. The whole model rests on this graph: accretion can only reach a
UAT through a road-connected shared border, so a wrong flag here produces a map that looks
entirely plausible and is quietly incorrect. Nothing downstream should be built until the
report this emits has been read.

Roads are used for a *binary border-crossing test only*. There is no routing, no distance
matrix and no network analysis anywhere in this project — brief §8 designs that out
deliberately.

Output:
    data/processed/adjacency.parquet       one row per unordered UAT pair
    data/processed/reports/adjacency.md    the data-quality report
    data/processed/reports/adjacency.json

Usage:
    uv run python -m pipeline.build_adjacency
"""

from __future__ import annotations

import argparse
import sys

import geopandas as gpd
import pandas as pd

from pipeline.build_geometry import Check, Report, normalise_siruta, write_report
from pipeline.constants import (
    CRS_STEREO70,
    MAX_EXPECTED_ROAD_ISOLATED_UATS,
    OSM_ROAD_CLASSES,
    SHARED_BORDER_BUFFER_M,
)
from pipeline.paths import PROCESSED_DIR, RAW_DIR, REPORTS_DIR

# Highest-class-wins ordering when several road classes cross the same border. Index 0 is
# the most significant; this is only reported, never used by the model, which cares solely
# about whether *any* road crosses.
ROAD_CLASS_RANK = {cls: i for i, cls in enumerate(OSM_ROAD_CLASSES)}

# A leftid/rightid of 0 means the other side of the segment is outside Romania.
EXTERIOR_CODE = "0"


def load_boundary_lines() -> gpd.GeoDataFrame:
    path = RAW_DIR / "uat_boundary_lines.geojson"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch")
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(CRS_STEREO70)
    elif gdf.crs.to_epsg() != int(CRS_STEREO70.split(":")[1]):
        gdf = gdf.to_crs(CRS_STEREO70)
    return gdf


def load_uats() -> gpd.GeoDataFrame:
    path = PROCESSED_DIR / "uat_geometry.gpkg"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.build_geometry")
    return gpd.read_file(path, layer="uat")


def load_roads() -> gpd.GeoDataFrame:
    """Read the road network from the OSM extract, in EPSG:3844.

    GDAL's OSM driver assembles ways into geometries for us, so this needs no dedicated
    OSM parsing dependency.
    """
    path = RAW_DIR / "romania-latest.osm.pbf"
    if not path.exists():
        raise SystemExit(
            f"Missing {path}. Run: uv run python -m pipeline.fetch --with-roads\n(~312 MB download)"
        )
    classes = ",".join(f"'{c}'" for c in OSM_ROAD_CLASSES)
    roads = gpd.read_file(
        path,
        layer="lines",
        columns=["highway"],
        where=f"highway IN ({classes})",
        engine="pyogrio",
    )
    if roads.crs is None:
        roads = roads.set_crs("EPSG:4326")
    return roads.to_crs(CRS_STEREO70)


def build_pairs(lines: gpd.GeoDataFrame, report: Report) -> gpd.GeoDataFrame:
    """Dissolve boundary segments onto one row per unordered UAT pair."""
    lines = lines.copy()
    lines["a_raw"] = normalise_siruta(lines["leftid"])
    lines["b_raw"] = normalise_siruta(lines["rightid"])

    total_segments = len(lines)
    exterior = lines[(lines["a_raw"] == EXTERIOR_CODE) | (lines["b_raw"] == EXTERIOR_CODE)]
    report.add(
        Check(
            "exterior_segments",
            True,
            f"{len(exterior)} of {total_segments} segments lie on the national border "
            "(one side outside Romania) and are excluded from adjacency",
        )
    )

    interior = lines.drop(exterior.index)

    # Order each pair so (a, b) and (b, a) collapse to the same key. Without this the same
    # border appears twice and every degree count is wrong.
    lo = interior[["a_raw", "b_raw"]].min(axis=1)
    hi = interior[["a_raw", "b_raw"]].max(axis=1)
    interior = interior.assign(a_siruta=lo, b_siruta=hi)

    self_loops = interior[interior["a_siruta"] == interior["b_siruta"]]
    report.add(
        Check(
            "self_loops",
            len(self_loops) == 0,
            f"{len(self_loops)} segments where both sides are the same UAT",
            fatal=len(self_loops) > 0,
        )
    )
    interior = interior.drop(self_loops.index)

    dissolved = interior.dissolve(by=["a_siruta", "b_siruta"], as_index=False, aggfunc="first")
    dissolved = dissolved[["a_siruta", "b_siruta", "legalstat", "geometry"]]

    report.add(
        Check(
            "pair_dissolve",
            True,
            f"{len(interior)} interior segments dissolved into {len(dissolved)} "
            "unique adjacent pairs",
        )
    )

    # The brief anticipates roughly 8,000-9,000 edges nationally.
    plausible = 6_000 <= len(dissolved) <= 12_000
    report.add(
        Check(
            "edge_count",
            plausible,
            f"{len(dissolved)} edges (brief anticipates ~8,000-9,000)",
            fatal=not plausible,
        )
    )
    return gpd.GeoDataFrame(dissolved, geometry="geometry", crs=CRS_STEREO70)


def check_pairs_against_uats(
    pairs: gpd.GeoDataFrame, uats: gpd.GeoDataFrame, report: Report
) -> gpd.GeoDataFrame:
    known = set(uats["siruta"])
    unknown_a = set(pairs["a_siruta"]) - known
    unknown_b = set(pairs["b_siruta"]) - known
    unknown = sorted(unknown_a | unknown_b)

    report.add(
        Check(
            "pair_siruta_known",
            not unknown,
            f"{len(unknown)} SIRUTA codes in the boundary layer that are not in the UAT set",
            fatal=bool(unknown),
            rows=[{"siruta": s} for s in unknown[:25]],
        )
    )

    county = uats.set_index("siruta")["county_code"]
    pairs = pairs.copy()
    pairs["a_county"] = pairs["a_siruta"].map(county)
    pairs["b_county"] = pairs["b_siruta"].map(county)
    cross = pairs[pairs["a_county"] != pairs["b_county"]]

    # Cross-county adjacency is real geography and is kept in the graph. The model forbids
    # cross-county *merges* (brief §3), which is enforced during accretion, not here.
    report.add(
        Check(
            "cross_county_edges",
            True,
            f"{len(cross)} of {len(pairs)} edges cross a county line "
            "(kept in the graph; the model rejects them during accretion)",
        )
    )
    return pairs


def flag_road_crossings(
    pairs: gpd.GeoDataFrame,
    roads: gpd.GeoDataFrame,
    uats: gpd.GeoDataFrame,
    report: Report,
) -> gpd.GeoDataFrame:
    """Flag borders a road genuinely crosses.

    The brief describes buffering the shared boundary by ~50 m and intersecting it against
    the road network. Measured on the real data, that test alone is wrong in both
    directions:

      - 358 borders (5.7% of those it flagged) had no road entering both UATs at all. These
        are roads running *parallel* to a border, inside one UAT, close enough to fall in
        the buffer. A road along one side of a county boundary is not a connection across
        it.
      - 100 borders had a road present in both UATs but lying further than 50 m from the
        digitised boundary line. The roads come from OSM and the boundaries from ANCPI, so
        the two do not align perfectly, and a fixed tolerance misses real crossings.

    So a road counts only if it satisfies both conditions: it passes within the tolerance of
    the shared border **and** it enters both UATs. That is what "a road crosses that shared
    border" actually means, and it is robust to the two sources being slightly misaligned.
    """
    report.add(Check("road_segments", True, f"{len(roads):,} road features loaded from OSM"))

    roads = roads.reset_index(drop=True)
    roads["rid"] = roads.index

    # Which UATs does each road touch? A road crossing the A|B border must be in both.
    in_uat = gpd.sjoin(
        roads[["rid", "geometry"]],
        uats[["siruta", "geometry"]],
        how="inner",
        predicate="intersects",
    )
    roads_by_uat = in_uat.groupby("siruta")["rid"].apply(set)

    pairs = pairs.reset_index(drop=True)
    pairs["edge_id"] = pairs.index

    buffered = pairs[["edge_id", "a_siruta", "b_siruta", "geometry"]].copy()
    buffered["geometry"] = pairs.geometry.buffer(SHARED_BORDER_BUFFER_M)

    near = gpd.sjoin(
        buffered, roads[["rid", "highway", "geometry"]], how="inner", predicate="intersects"
    )

    # Keep only roads that also enter both UATs of the pair.
    empty: set = set()
    keep = [
        rid in roads_by_uat.get(a, empty) and rid in roads_by_uat.get(b, empty)
        for rid, a, b in zip(near["rid"], near["a_siruta"], near["b_siruta"], strict=True)
    ]
    crossing = near[keep]

    n_dropped = len(near) - len(crossing)
    report.add(
        Check(
            "parallel_roads_rejected",
            True,
            f"{n_dropped:,} road/border matches fell inside the {SHARED_BORDER_BUFFER_M} m "
            "buffer but did not enter both UATs, and were rejected as parallel rather than "
            "crossing",
        )
    )

    if crossing.empty:
        # Guard the degenerate case: groupby().first() on an empty frame drops the
        # columns entirely, so the column selection below would raise rather than
        # yield "no border has a road".
        best = pd.DataFrame(
            {
                "edge_id": pd.Series(dtype=pairs["edge_id"].dtype),
                "road_class": pd.Series(dtype=object),
            }
        )
    else:
        crossing = crossing.assign(rank=crossing["highway"].map(ROAD_CLASS_RANK))
        best = (
            crossing.sort_values(["rank", "rid"])
            .groupby("edge_id", as_index=False)
            .first()[["edge_id", "highway"]]
            .rename(columns={"highway": "road_class"})
        )

    out = pairs.merge(best, on="edge_id", how="left")
    out["has_road"] = out["road_class"].notna()

    n_road = int(out["has_road"].sum())
    report.add(
        Check(
            "road_crossing_rate",
            True,
            f"{n_road} of {len(out)} shared borders are crossed by a road "
            f"({n_road / len(out) * 100:.1f}%), buffer {SHARED_BORDER_BUFFER_M} m",
        )
    )
    return out


def check_connectivity(edges: gpd.GeoDataFrame, uats: gpd.GeoDataFrame, report: Report) -> None:
    """The brief's headline sanity check: how many UATs have no road-connected neighbour?

    Anything above a handful means the road extract or the buffer tolerance is wrong. Danube
    Delta communes are legitimate exceptions and are reported by name so they cannot hide a
    systematic bug behind them.
    """
    all_codes = set(uats["siruta"])
    name = uats.set_index("siruta")["name_uat"]
    county = uats.set_index("siruta")["county_code"]

    with_any = set(edges["a_siruta"]) | set(edges["b_siruta"])
    road = edges[edges["has_road"]]
    with_road = set(road["a_siruta"]) | set(road["b_siruta"])

    no_neighbour = sorted(all_codes - with_any)
    report.add(
        Check(
            "uats_without_any_neighbour",
            len(no_neighbour) == 0,
            f"{len(no_neighbour)} UATs share no border with any other UAT",
            fatal=len(no_neighbour) > 0,
            rows=[
                {"siruta": s, "name": name.get(s), "county": county.get(s)}
                for s in no_neighbour[:25]
            ],
        )
    )

    road_isolated = sorted(all_codes - with_road)
    report.add(
        Check(
            "uats_without_road_neighbour",
            len(road_isolated) <= MAX_EXPECTED_ROAD_ISOLATED_UATS,
            f"{len(road_isolated)} UATs have no road-connected neighbour "
            f"(threshold {MAX_EXPECTED_ROAD_ISOLATED_UATS}); these can neither absorb "
            "nor be absorbed",
            fatal=len(road_isolated) > MAX_EXPECTED_ROAD_ISOLATED_UATS,
            rows=[
                {"siruta": s, "name": name.get(s), "county": county.get(s)}
                for s in road_isolated[:50]
            ],
        )
    )

    degrees = pd.concat([edges["a_siruta"], edges["b_siruta"]]).value_counts()
    report.add(
        Check(
            "degree_distribution",
            True,
            f"neighbours per UAT: min={int(degrees.min())}, "
            f"median={int(degrees.median())}, max={int(degrees.max())}",
        )
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--allow-failures", action="store_true")
    args = ap.parse_args(argv)

    report = Report()

    print("Loading boundary segments and UATs...")
    lines = load_boundary_lines()
    uats = load_uats()

    print("\nPair construction:")
    pairs = build_pairs(lines, report)
    pairs = check_pairs_against_uats(pairs, uats, report)

    print("\nLoading roads from the OSM extract (this takes a minute)...")
    roads = load_roads()

    print("\nRoad crossing:")
    edges = flag_road_crossings(pairs, roads, uats, report)

    print("\nConnectivity:")
    check_connectivity(edges, uats, report)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "adjacency.md", REPORTS_DIR / "adjacency.json")

    if report.failed and not args.allow_failures:
        print(f"\n{len(report.failed)} fatal check(s) failed. No output written.")
        print(f"See {REPORTS_DIR / 'adjacency.md'}")
        return 1

    out = PROCESSED_DIR / "adjacency.parquet"
    table = pd.DataFrame(
        {
            "a_siruta": edges["a_siruta"],
            "b_siruta": edges["b_siruta"],
            "has_road": edges["has_road"],
            "road_class": edges["road_class"],
            "legalstat": edges["legalstat"],
        }
    ).sort_values(["a_siruta", "b_siruta"], ignore_index=True)
    table.to_parquet(out, index=False)

    print(f"\nWrote {out} ({len(table)} edges)")
    print(f"Wrote {REPORTS_DIR / 'adjacency.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
