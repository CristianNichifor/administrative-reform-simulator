"""Precompute candidacy: which UATs each potential absorber can reach, at each radius.

Candidacy depends on radius, and radius is a slider. Buffering 686 polygons in the browser
on every drag would blow the 150 ms budget many times over, so the whole grid is computed
here and the UI slider snaps to the precomputed radii.

Per brief §2 step 2, a UAT `u` is a candidate for absorber `a` when:

    overlap_fraction(u, buffer(a)) >= min_overlap   OR   u.seat_point inside buffer(a)

`min_overlap` is a slider too, so the *fraction* is stored rather than the boolean, and the
threshold is applied at runtime. The seat test has no threshold, so it is stored as a flag.

The buffer is taken around **the absorber's polygon**, not its seat point. Buffering a point
would give Cluj-Napoca and a 3,000-person commune the same reach from very different
footprints.

This is a verification gate. Nothing downstream should be built until the report is read.

Output:
    web/public/data/candidacy.parquet       the grid, packed
    data/processed/reports/candidacy.md
    data/processed/reports/candidacy.json

Usage:
    uv run python -m pipeline.build_candidacy
"""

from __future__ import annotations

import argparse
import sys

import geopandas as gpd
import numpy as np
import pandas as pd

from pipeline.build_geometry import Check, Report, write_report
from pipeline.constants import (
    BUCHAREST_COUNTY_CODE,
    BUCHAREST_RING_COUNTY,
    CRS_STEREO70,
    OVERLAP_QUANTISATION_DECIMALS,
    POTENTIAL_ABSORBER_POP_FLOOR,
    RADIUS_GRID_M,
    TIER_COUNTY_CAPITAL,
    TIER_POPULATION,
)
from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA, EXPECTED_CAPITAL_COUNT
from pipeline.paths import PROCESSED_DIR, REPORTS_DIR

# Overlap fractions below this are dropped entirely. The brief stores every UAT with
# overlap_fraction > 0, but quantising to 2 decimals turns everything under 0.005 into 0.00,
# which can never satisfy a min_overlap of 0 < x. Keeping those rows would inflate the
# artefact with entries that carry no information.
MIN_STORED_OVERLAP = 0.005


def load_inputs() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    uat_path = PROCESSED_DIR / "uat_geometry.gpkg"
    seat_path = PROCESSED_DIR / "uat_seats.gpkg"
    for path, cmd in ((uat_path, "build_geometry"), (seat_path, "build_seats")):
        if not path.exists():
            raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.{cmd}")
    uats = gpd.read_file(uat_path, layer="uat")
    seats = gpd.read_file(seat_path, layer="seat")[["siruta", "geometry"]]
    return uats, seats.rename(columns={"geometry": "seat_geometry"})


def select_absorbers(uats: gpd.GeoDataFrame, report: Report) -> gpd.GeoDataFrame:
    """Every UAT that could ever be an absorber at any slider setting.

    Nothing below the population floor can be a tier-1 seed, so nothing below it needs a
    precomputed row. County capitals are included regardless of population — they are
    tier-0 absorbers by rule, not by size.
    """
    is_capital = uats["siruta"].isin(COUNTY_CAPITAL_SIRUTA)

    found = int(is_capital.sum())
    report.add(
        Check(
            "county_capitals_present",
            found == EXPECTED_CAPITAL_COUNT,
            f"{found} of {EXPECTED_CAPITAL_COUNT} county capitals matched by SIRUTA",
            fatal=found != EXPECTED_CAPITAL_COUNT,
        )
    )

    # Bucharest's sectors are tier-0 seeds in their own right (brief §2 step 1).
    is_sector = uats["county_code"].str.upper() == "B"
    over_floor = uats["population"] >= POTENTIAL_ABSORBER_POP_FLOOR

    absorbers = uats[is_capital | is_sector | over_floor].copy()
    absorbers["is_capital"] = absorbers["siruta"].isin(COUNTY_CAPITAL_SIRUTA) | is_sector
    absorbers["tier"] = np.where(absorbers["is_capital"], TIER_COUNTY_CAPITAL, TIER_POPULATION)

    report.add(
        Check(
            "absorber_count",
            600 <= len(absorbers) <= 900,
            f"{len(absorbers)} potential absorbers "
            f"(brief estimates ~700; floor is population >= {POTENTIAL_ABSORBER_POP_FLOOR:,} "
            f"plus all capitals and the {int(is_sector.sum())} Bucharest sectors)",
            fatal=not 600 <= len(absorbers) <= 900,
        )
    )

    below = absorbers[absorbers["population"] < POTENTIAL_ABSORBER_POP_FLOOR]
    report.add(
        Check(
            "capitals_below_population_floor",
            True,
            f"{len(below)} absorbers are included despite being under the floor, because "
            "they are county capitals or Bucharest sectors",
            rows=[
                {"siruta": r.siruta, "name": r.name_uat, "population": int(r.population)}
                for r in below.itertuples()
            ],
        )
    )
    return absorbers


def build_grid(
    uats: gpd.GeoDataFrame, absorbers: gpd.GeoDataFrame, seats: pd.DataFrame, report: Report
) -> pd.DataFrame:
    """For each (absorber, radius), every UAT it overlaps or whose seat it contains."""
    targets = uats[["siruta", "county_code", "geometry"]].copy()
    targets["area"] = targets.geometry.area
    targets = targets.merge(seats, on="siruta", how="left")
    seat_points = gpd.GeoSeries(targets["seat_geometry"].values, crs=CRS_STEREO70)

    frames = []
    for radius in RADIUS_GRID_M:
        buffered = absorbers.copy()
        buffered["geometry"] = absorbers.geometry.buffer(radius)

        # Only pairs whose geometries actually meet can contribute; the spatial index makes
        # this tractable where a 686 x 3186 dense pass would not be.
        pairs = gpd.sjoin(
            targets[["siruta", "county_code", "area", "geometry"]],
            buffered[["siruta", "geometry"]].rename(columns={"siruta": "absorber_siruta"}),
            how="inner",
            predicate="intersects",
        )
        if pairs.empty:
            continue

        buf_geom = buffered.set_index("siruta").geometry
        target_geom = targets.set_index("siruta").geometry

        a = gpd.GeoSeries(buf_geom.loc[pairs["absorber_siruta"]].values, crs=CRS_STEREO70)
        t = gpd.GeoSeries(target_geom.loc[pairs["siruta"]].values, crs=CRS_STEREO70)
        overlap = t.intersection(a, align=False).area.to_numpy()
        fraction = overlap / pairs["area"].to_numpy()

        seat_lookup = dict(zip(targets["siruta"], seat_points, strict=True))
        seat_series = gpd.GeoSeries([seat_lookup[s] for s in pairs["siruta"]], crs=CRS_STEREO70)
        seat_inside = a.covers(seat_series, align=False).to_numpy()

        frames.append(
            pd.DataFrame(
                {
                    "radius_m": radius,
                    "absorber_siruta": pairs["absorber_siruta"].to_numpy(),
                    "uat_siruta": pairs["siruta"].to_numpy(),
                    "overlap_fraction": np.round(fraction, OVERLAP_QUANTISATION_DECIMALS),
                    "seat_inside": seat_inside,
                }
            )
        )
        print(f"  radius {radius / 1000:4.1f} km: {len(frames[-1]):>7,} raw pairs")

    grid = pd.concat(frames, ignore_index=True)

    # An absorber is trivially a candidate for itself; the model handles the absorber's own
    # membership directly, so storing it wastes space and invites double-counting.
    grid = grid[grid["absorber_siruta"] != grid["uat_siruta"]]

    # Regions cross county lines in exactly one place — Bucharest and its Ilfov ring — so
    # every other cross-county pair is dropped here rather than filtered on every model run.
    #
    # Keeping the Bucharest pairs is what makes that exception mean anything. Without them
    # the only Ilfov communes the city could see were those directly bordering a sector,
    # because the model's adjacency fallback is the sole remaining route in: Cernica borders
    # Pantelimon and Glina, both already part of the city, and still could not be absorbed.
    county = uats.set_index("siruta")["county_code"]
    absorber_county = county.loc[grid["absorber_siruta"]].to_numpy()
    uat_county = county.loc[grid["uat_siruta"]].to_numpy()
    same_county = absorber_county == uat_county
    bucharest_ring = (absorber_county == BUCHAREST_COUNTY_CODE) & (
        uat_county == BUCHAREST_RING_COUNTY
    )
    keep = same_county | bucharest_ring
    dropped_cross = int((~keep).sum())
    kept_ring = int(bucharest_ring.sum())
    grid = grid[keep]

    report.add(
        Check(
            "cross_county_pairs_dropped",
            kept_ring > 0,
            f"{dropped_cross:,} candidate pairs dropped because the model forbids "
            f"cross-county merges; {kept_ring:,} Bucharest-to-Ilfov pairs kept, the one "
            "county line a unit may cross",
            fatal=kept_ring == 0,
        )
    )

    # A row that is neither above the storage threshold nor a seat hit carries no
    # information at any slider setting.
    informative = (grid["overlap_fraction"] >= MIN_STORED_OVERLAP) | grid["seat_inside"]
    dropped_empty = int((~informative).sum())
    grid = grid[informative]

    report.add(
        Check(
            "negligible_pairs_dropped",
            True,
            f"{dropped_empty:,} pairs dropped as sliver contacts: overlap quantises to "
            f"below {MIN_STORED_OVERLAP} and the seat is outside",
        )
    )

    return grid.sort_values(["radius_m", "absorber_siruta", "uat_siruta"], ignore_index=True)


def check_grid(grid: pd.DataFrame, absorbers: gpd.GeoDataFrame, report: Report) -> None:
    report.add(
        Check(
            "grid_size",
            True,
            f"{len(grid):,} entries across {len(RADIUS_GRID_M)} radii (brief estimates ~230k)",
        )
    )

    report.add(
        Check(
            "overlap_fraction_range",
            bool(grid["overlap_fraction"].between(0, 1).all()),
            f"overlap fraction min={grid['overlap_fraction'].min():.2f}, "
            f"max={grid['overlap_fraction'].max():.2f}",
            fatal=not bool(grid["overlap_fraction"].between(0, 1).all()),
        )
    )

    per_radius = grid.groupby("radius_m").size()
    monotonic = bool((per_radius.diff().dropna() >= 0).all())
    report.add(
        Check(
            "monotonic_in_radius",
            monotonic,
            "candidate count is non-decreasing as radius grows "
            f"({per_radius.iloc[0]:,} at 5 km to {per_radius.iloc[-1]:,} at 30 km)",
            # A larger buffer strictly contains a smaller one, so a drop means the geometry
            # or the join is wrong.
            fatal=not monotonic,
        )
    )

    reach = grid[grid["radius_m"] == max(RADIUS_GRID_M)].groupby("absorber_siruta").size()
    silent = set(absorbers["siruta"]) - set(grid["absorber_siruta"])
    report.add(
        Check(
            "absorbers_with_no_candidates",
            len(silent) == 0,
            f"{len(silent)} absorbers reach no UAT even at {max(RADIUS_GRID_M) / 1000:.0f} km",
            fatal=False,
            rows=[{"siruta": s} for s in sorted(silent)[:25]],
        )
    )
    report.add(
        Check(
            "reach_distribution",
            True,
            f"at 30 km an absorber reaches min={int(reach.min())}, "
            f"median={int(reach.median())}, max={int(reach.max())} UATs",
        )
    )

    seat_only = grid[(grid["overlap_fraction"] < 0.10) & grid["seat_inside"]]
    report.add(
        Check(
            "seat_rule_contribution",
            True,
            f"{len(seat_only):,} pairs qualify only via the seat-point rule at the default "
            "min_overlap of 0.10 — this is what that rule buys",
        )
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--allow-failures", action="store_true")
    args = ap.parse_args(argv)

    report = Report()

    print("Loading geometry and seats...")
    uats, seats = load_inputs()

    print("\nAbsorber selection:")
    absorbers = select_absorbers(uats, report)

    print("\nBuilding candidacy grid:")
    grid = build_grid(uats, absorbers, seats, report)

    print("\nGrid checks:")
    check_grid(grid, absorbers, report)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "candidacy.md", REPORTS_DIR / "candidacy.json")

    if report.failed and not args.allow_failures:
        print(f"\n{len(report.failed)} fatal check(s) failed. No output written.")
        print(f"See {REPORTS_DIR / 'candidacy.md'}")
        return 1

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = PROCESSED_DIR / "candidacy.parquet"
    packed = grid.astype(
        {
            "radius_m": "uint16",
            "absorber_siruta": "string",
            "uat_siruta": "string",
            "overlap_fraction": "float32",
            "seat_inside": "bool",
        }
    )
    packed.to_parquet(out, index=False, compression="zstd")

    size_mb = out.stat().st_size / 1_048_576
    print(f"\nWrote {out} ({len(grid):,} entries, {size_mb:.2f} MB)")
    print(f"Wrote {REPORTS_DIR / 'candidacy.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
