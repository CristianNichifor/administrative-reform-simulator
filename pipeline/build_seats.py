"""Resolve one seat point per UAT from the SIRUTA locality nomenclator.

The brief is explicit that seats must not be polygon centroids: a centroid sits in the
geometric middle of a commune, which for a long river-valley commune can be several km from
where anyone actually lives. Seats matter because candidacy (brief §2 step 2) admits a UAT
whose seat point falls inside an absorber's buffer, and because seed separation is measured
between them.

Resolution is a cascade, and **which rule fired is recorded per UAT** in `seat_source`, so
any seat can be audited and disputed individually rather than taken on trust:

    rank                    SIRUTA rank marks the locality as the residence (I-IV)
    name                    no ranked child, but a child's name matches the UAT's
    name_prefix             exactly one child's name extends the UAT's, or vice versa
    name_prefix_ambiguous   several do; picked by deterministic tiebreak — NEEDS REVIEW
    sole_locality           the UAT has one locality, so that is the seat by definition
    override                corrected by hand in pipeline/seat_overrides.csv
    centroid                no locality children at all — Bucharest sectors only
    ...+snapped             the resolved point lay outside its UAT and was pulled onto it

The rank data is stale for communes created after this SIRUTA vintage: 231 communes have
only rank-V children because their seat was still a component village of its old parent
when the layer was cut. The name rules recover those.

Output:
    data/processed/uat_seats.gpkg       one point per UAT, EPSG:3844
    data/processed/reports/seats.md
    data/processed/reports/seats.json

Usage:
    uv run python -m pipeline.build_seats
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import nearest_points

from pipeline.build_geometry import Check, Report, normalise_siruta, write_report
from pipeline.constants import CRS_STEREO70, EXPECTED_UAT_COUNT
from pipeline.paths import PROCESSED_DIR, RAW_DIR, REPORTS_DIR
from pipeline.sources import SEAT_RANKS

# Most significant first. A rank-V locality is a component village and is never a seat.
RANK_ORDER = {rank: i for i, rank in enumerate(SEAT_RANKS)}

# Administrative prefixes carried by UAT names but never by locality names.
_PREFIX_RE = re.compile(r"^(COMUNA|ORASUL|ORAS|MUNICIPIUL|MUNICIPIU|SECTORUL)\s+")


def normalise_name(value: object) -> str:
    """Fold a UAT or locality name for comparison.

    Romanian orthography uses both comma-below (ș, ț) and the legacy cedilla forms (ş, ţ),
    and the two sources do not agree on which. Strip diacritics entirely and drop the
    administrative prefix, so "Comuna Valea Lupului" and "Valea Lupului" compare equal.
    """
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(c for c in text if not unicodedata.combining(c))
    # NFKD does not decompose the comma-below letters, so map them explicitly.
    for src, dst in (("ș", "s"), ("ț", "t"), ("ş", "s"), ("ţ", "t")):
        text = text.replace(src, dst).replace(src.upper(), dst.upper())
    text = _PREFIX_RE.sub("", text.upper().strip())
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def normalise_name_loose(value: object) -> str:
    """As `normalise_name`, but also folds the Romanian definite-article plural.

    A commune and its seat village are frequently the same word in different grammatical
    forms: the commune ALBEȘTII DE MUSCEL has the village Albești, and the commune
    HĂRMĂNEȘTI has the village Hărmăneștii Vechi. Collapsing a word-final "-ii" to "-i"
    makes the two comparable without resorting to fuzzy string distance, which would
    introduce false matches between genuinely different villages.
    """
    return re.sub(r"II\b", "I", normalise_name(value))


def _prefix_match(children: pd.DataFrame, uat_name: str) -> pd.DataFrame:
    """Children whose name extends the UAT's, or whose name the UAT's extends.

    Matching is on whole words so that "ALBESTI" matches "ALBESTI DE MUSCEL" but never
    "ALBESTIU".
    """
    target = normalise_name_loose(uat_name)
    loose = children["name_norm"].map(normalise_name_loose)
    return children[
        loose.str.startswith(target + " ")
        | loose.eq(target)
        | loose.map(lambda n: target.startswith(n + " "))
    ]


def load_localities() -> gpd.GeoDataFrame:
    path = RAW_DIR / "localities.geojson"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch")
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(CRS_STEREO70)
    elif gdf.crs.to_epsg() != int(CRS_STEREO70.split(":")[1]):
        gdf = gdf.to_crs(CRS_STEREO70)

    gdf["parent_siruta"] = normalise_siruta(gdf["supCode"])
    gdf["locality_siruta"] = normalise_siruta(gdf["natCode"])
    gdf["rank_clean"] = gdf["rank"].astype(str).str.strip()
    gdf["rank_order"] = gdf["rank_clean"].map(RANK_ORDER)
    gdf["name_norm"] = gdf["name"].map(normalise_name)
    return gdf


def load_uats() -> gpd.GeoDataFrame:
    path = PROCESSED_DIR / "uat_geometry.gpkg"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.build_geometry")
    gdf = gpd.read_file(path, layer="uat")
    gdf["name_norm"] = gdf["name_uat"].map(normalise_name)
    return gdf


def _pick(candidates: pd.DataFrame) -> pd.Series:
    """Choose deterministically when several localities remain equally good."""
    return candidates.sort_values(["rank_order", "locality_siruta"], na_position="last").iloc[0]


def resolve_seats(uats: gpd.GeoDataFrame, localities: gpd.GeoDataFrame) -> pd.DataFrame:
    by_parent = dict(tuple(localities.groupby("parent_siruta")))
    rows = []

    for uat in uats.itertuples():
        children = by_parent.get(uat.siruta)
        source = None
        pick = None

        if children is not None and len(children):
            ranked = children[children["rank_order"].notna()]
            if len(ranked):
                best = ranked[ranked["rank_order"] == ranked["rank_order"].min()]
                # Several localities can share the best rank when a commune was split and
                # the old parent kept its rank. Prefer the one named like the UAT.
                named = best[best["name_norm"] == uat.name_norm]
                pick = _pick(named if len(named) else best)
                source = "rank"
            else:
                exact = children[children["name_norm"] == uat.name_norm]
                prefix = _prefix_match(children, uat.name_uat)
                if len(exact):
                    pick = _pick(exact)
                    source = "name"
                elif len(prefix) == 1:
                    pick = _pick(prefix)
                    source = "name_prefix"
                elif len(prefix) > 1:
                    # e.g. commune PORUMBENI contains both Porumbenii Mari and Porumbenii
                    # Mici. Neither name identifies the seat, so pick deterministically and
                    # surface it in the report rather than pretending it was resolved.
                    pick = _pick(prefix)
                    source = "name_prefix_ambiguous"
                elif len(children) == 1:
                    # A commune with a single locality has that locality as its seat by
                    # definition, whatever the two names say.
                    pick = _pick(children)
                    source = "sole_locality"

        if pick is None:
            # Bucharest sectors have no locality children in SIRUTA. A representative
            # point is guaranteed to lie inside the polygon, unlike a centroid.
            geom = uats.loc[uat.Index, "geometry"].representative_point()
            rows.append(
                {
                    "siruta": uat.siruta,
                    "name_uat": uat.name_uat,
                    "county_code": uat.county_code,
                    "seat_name": None,
                    "seat_siruta": None,
                    "seat_rank": None,
                    "seat_source": "centroid",
                    "geometry": geom,
                }
            )
            continue

        rows.append(
            {
                "siruta": uat.siruta,
                "name_uat": uat.name_uat,
                "county_code": uat.county_code,
                "seat_name": pick["name"],
                "seat_siruta": pick["locality_siruta"],
                "seat_rank": pick["rank_clean"],
                "seat_source": source,
                "geometry": pick["geometry"],
            }
        )

    return gpd.GeoDataFrame(rows, geometry="geometry", crs=CRS_STEREO70)


def apply_overrides(
    seats: gpd.GeoDataFrame, localities: gpd.GeoDataFrame, report: Report
) -> gpd.GeoDataFrame:
    """Apply manual seat corrections from `pipeline/seat_overrides.csv`.

    The automatic cascade resolves 3,186 seats, but a handful rest on a deterministic
    tiebreak between two equally plausible villages rather than on evidence. Those are
    corrected here rather than by editing the resolution logic, so the correction carries a
    citable reason and shows up in the report.
    """
    path = Path(__file__).with_name("seat_overrides.csv")
    overrides = pd.read_csv(path, comment="#", dtype=str).dropna(subset=["uat_siruta"])

    applied = []
    if len(overrides):
        by_code = localities.set_index("locality_siruta")
        seats = seats.set_index("siruta")
        for row in overrides.itertuples():
            if row.uat_siruta not in seats.index:
                raise SystemExit(f"  FATAL: override for unknown UAT {row.uat_siruta}")
            if row.seat_siruta not in by_code.index:
                raise SystemExit(f"  FATAL: override names unknown locality {row.seat_siruta}")
            locality = by_code.loc[row.seat_siruta]
            seats.at[row.uat_siruta, "geometry"] = locality["geometry"]
            seats.at[row.uat_siruta, "seat_name"] = locality["name"]
            seats.at[row.uat_siruta, "seat_siruta"] = row.seat_siruta
            seats.at[row.uat_siruta, "seat_source"] = "override"
            applied.append({"siruta": row.uat_siruta, "seat": locality["name"], "note": row.note})
        seats = seats.reset_index()

    report.add(
        Check(
            "seat_overrides_applied",
            True,
            f"{len(applied)} manual seat corrections applied",
            rows=applied,
        )
    )
    return seats


def check_needs_review(seats: gpd.GeoDataFrame, report: Report) -> None:
    """Surface every seat that was not resolved by direct evidence.

    These are the seats to argue about. Keeping them in the report rather than burying them
    in the data is the difference between a defensible map and a plausible one.
    """
    unconfirmed = seats[seats["seat_source"].isin(["name_prefix_ambiguous", "sole_locality"])]
    report.add(
        Check(
            "seats_needing_review",
            True,
            f"{len(unconfirmed)} seats rest on a deterministic tiebreak rather than "
            "evidence, and should be confirmed via pipeline/seat_overrides.csv",
            rows=[
                {
                    "siruta": r.siruta,
                    "uat": r.name_uat,
                    "picked": r.seat_name,
                    "county": r.county_code,
                    "rule": r.seat_source,
                }
                for r in unconfirmed.itertuples()
            ],
        )
    )


def snap_stray_seats(seats: gpd.GeoDataFrame, uats: gpd.GeoDataFrame, report: Report):
    """Pull seats that fall outside their own UAT back onto it.

    The locality points and the boundaries are separate layers and disagree at a few edges:
    Sâncraiu de Mureș's seat sits 705 m outside its commune, inside Municipiul Târgu Mureș.
    Left alone, candidacy would test that seat against the wrong absorber's buffer.

    Snapping to the nearest point on the correct polygon keeps the seat next to the real
    settlement, which a centroid would not — but the move is recorded per UAT so it stays
    auditable.
    """
    polys = uats.set_index("siruta")["geometry"]
    seats = seats.copy()
    seats["snap_distance_m"] = 0.0

    stray = []
    for i, row in seats.iterrows():
        poly = polys.get(row["siruta"])
        if poly is None or poly.covers(row["geometry"]):
            continue
        distance = poly.distance(row["geometry"])
        snapped = nearest_points(poly, row["geometry"])[0]
        seats.at[i, "geometry"] = snapped
        seats.at[i, "snap_distance_m"] = distance
        seats.at[i, "seat_source"] = f"{row['seat_source']}+snapped"
        stray.append(
            {
                "siruta": row["siruta"],
                "name": row["name_uat"],
                "seat": row["seat_name"],
                "moved_m": round(distance, 1),
            }
        )

    report.add(
        Check(
            "seats_snapped_into_uat",
            len(stray) <= 5,
            f"{len(stray)} seats lay outside their own UAT and were snapped onto it "
            "(the locality and boundary layers disagree at a few edges)",
            fatal=len(stray) > 5,
            rows=stray,
        )
    )
    return seats


def check_seats(seats: gpd.GeoDataFrame, uats: gpd.GeoDataFrame, report: Report) -> None:
    report.add(
        Check(
            "seat_count",
            len(seats) == EXPECTED_UAT_COUNT,
            f"{len(seats)} seats for {EXPECTED_UAT_COUNT} UATs",
            fatal=len(seats) != EXPECTED_UAT_COUNT,
        )
    )

    counts = seats["seat_source"].value_counts().to_dict()
    report.add(
        Check(
            "seat_source_mix",
            True,
            ", ".join(f"{k}={v}" for k, v in sorted(counts.items())),
        )
    )

    fallback = seats[seats["seat_source"] == "centroid"]
    report.add(
        Check(
            "centroid_fallbacks",
            len(fallback) <= 6,
            f"{len(fallback)} UATs fell back to a polygon representative point "
            "(expected: exactly the 6 Bucharest sectors, which have no SIRUTA localities)",
            fatal=len(fallback) > 6,
            rows=[
                {"siruta": r.siruta, "name": r.name_uat, "county": r.county_code}
                for r in fallback.itertuples()
            ],
        )
    )

    missing = seats[seats.geometry.is_empty | seats.geometry.isna()]
    report.add(
        Check(
            "seat_geometry_present",
            len(missing) == 0,
            f"{len(missing)} seats with no geometry",
            fatal=len(missing) > 0,
        )
    )

    # The load-bearing check. Candidacy asks whether a UAT's seat point falls inside an
    # absorber's buffer; a seat sitting outside its own UAT would quietly corrupt that.
    joined = seats.merge(
        uats[["siruta", "geometry"]].rename(columns={"geometry": "poly"}), on="siruta"
    )
    # `covers` rather than `within`: a snapped seat sits exactly on the boundary, which is
    # inside the UAT for every purpose this project has.
    inside = gpd.GeoSeries(joined["poly"], crs=CRS_STEREO70).covers(
        gpd.GeoSeries(joined["geometry"], crs=CRS_STEREO70)
    )
    outside = joined[~inside.to_numpy()]
    report.add(
        Check(
            "seat_inside_own_uat",
            len(outside) == 0,
            f"{len(outside)} seats fall outside the UAT they belong to",
            fatal=len(outside) > 0,
            rows=[
                {
                    "siruta": r.siruta,
                    "name": r.name_uat,
                    "seat": r.seat_name,
                    "source": r.seat_source,
                }
                for r in outside.head(25).itertuples()
            ],
        )
    )

    dup = seats[seats["seat_siruta"].notna() & seats["seat_siruta"].duplicated(keep=False)]
    report.add(
        Check(
            "seat_uniqueness",
            len(dup) == 0,
            f"{len(dup)} UATs share a seat locality with another UAT",
            fatal=len(dup) > 0,
            rows=[
                {"siruta": r.siruta, "name": r.name_uat, "seat": r.seat_name}
                for r in dup.head(25).itertuples()
            ],
        )
    )

    # How far a seat sits from the polygon centroid is a useful proxy for how much this
    # step mattered. If it were near zero everywhere, centroids would have done.
    centroids = uats.set_index("siruta").loc[seats["siruta"], "geometry"].centroid
    dist = gpd.GeoSeries(seats.geometry.values, crs=CRS_STEREO70).distance(
        gpd.GeoSeries(centroids.values, crs=CRS_STEREO70)
    )
    report.add(
        Check(
            "seat_vs_centroid_offset",
            True,
            f"seat-to-centroid distance: median={dist.median():,.0f} m, "
            f"p90={dist.quantile(0.9):,.0f} m, max={dist.max():,.0f} m "
            "(the brief's reason for not using centroids)",
        )
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--allow-failures", action="store_true")
    args = ap.parse_args(argv)

    print("Loading localities and UATs...")
    localities = load_localities()
    uats = load_uats()

    print("Resolving seats...")
    seats = resolve_seats(uats, localities)

    report = Report()
    print("\nSeat checks:")
    seats = apply_overrides(seats, localities, report)
    seats = snap_stray_seats(seats, uats, report)
    check_seats(seats, uats, report)
    check_needs_review(seats, report)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "seats.md", REPORTS_DIR / "seats.json")

    if report.failed and not args.allow_failures:
        print(f"\n{len(report.failed)} fatal check(s) failed. No output written.")
        print(f"See {REPORTS_DIR / 'seats.md'}")
        return 1

    out = PROCESSED_DIR / "uat_seats.gpkg"
    seats.sort_values("siruta", ignore_index=True).to_file(out, driver="GPKG", layer="seat")
    print(f"\nWrote {out} ({len(seats)} seats)")
    print(f"Wrote {REPORTS_DIR / 'seats.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
