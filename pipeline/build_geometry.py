"""Validate the raw boundaries, join them to attributes on SIRUTA, emit a quality report.

This is the step the brief warns about. SIRUTA codes have changed over time, INS and MF use
different vintages, and some UATs have split or renamed. So the rule here is: **fail loudly
on unmatched rows rather than silently dropping them.** A silent drop becomes a hole in the
map that nobody notices for weeks.

Output:
    data/processed/uat_geometry.gpkg      geometry + attributes, EPSG:3844
    data/processed/reports/geometry.md    the data-quality report
    data/processed/reports/geometry.json  the same, machine-readable, for CI thresholds

Usage:
    uv run python -m pipeline.build_geometry
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.validation import explain_validity

from pipeline.constants import (
    COUNTY_CODES,
    CRS_STEREO70,
    EXPECTED_UAT_COUNT,
)
from pipeline.paths import PROCESSED_DIR, RAW_DIR, REPORTS_DIR

# Thresholds above which the build fails rather than warns. These are deliberately strict:
# both sources independently report exactly 3,186 UATs keyed by SIRUTA, so any mismatch at
# all means an assumption broke, not that the data is merely untidy.
MAX_UNMATCHED_SIRUTA = 0
MAX_COUNTY_DISAGREEMENTS = 0
MAX_INVALID_GEOMETRIES = 0


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    fatal: bool = False
    rows: list[dict] = field(default_factory=list)


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def add(self, check: Check) -> Check:
        self.checks.append(check)
        status = "ok  " if check.passed else ("FAIL" if check.fatal else "warn")
        print(f"  [{status}] {check.name}: {check.detail}")
        return check

    @property
    def failed(self) -> list[Check]:
        return [c for c in self.checks if not c.passed and c.fatal]


def load_boundaries() -> gpd.GeoDataFrame:
    path = RAW_DIR / "uat_boundaries.geojson"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch")
    gdf = gpd.read_file(path)
    # The WFS was asked for EPSG:3844 explicitly. Trust but verify: everything downstream
    # buffers in metres, and a WGS84 slip would produce radii wrong by latitude and a map
    # that still looks entirely plausible.
    if gdf.crs is None:
        gdf = gdf.set_crs(CRS_STEREO70)
    elif gdf.crs.to_epsg() != int(CRS_STEREO70.split(":")[1]):
        gdf = gdf.to_crs(CRS_STEREO70)
    return gdf


def load_attributes() -> pd.DataFrame:
    path = RAW_DIR / "uat_attributes.json"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch")
    return pd.DataFrame(json.loads(path.read_text(encoding="utf-8")))


def normalise_siruta(series: pd.Series) -> pd.Series:
    """Both sides key on SIRUTA but type it differently: int in the WFS, string in the API.

    Normalise to a string with no leading zeros so the two agree. Leading zeros are the
    classic way this join silently loses rows.
    """
    return (
        series.astype(str)
        .str.strip()
        .str.replace(r"\.0$", "", regex=True)
        .str.lstrip("0")
        .replace("", "0")
    )


def check_geometry(gdf: gpd.GeoDataFrame, report: Report) -> gpd.GeoDataFrame:
    report.add(
        Check(
            "crs",
            gdf.crs.to_epsg() == int(CRS_STEREO70.split(":")[1]),
            f"{gdf.crs.to_epsg()} (expected {CRS_STEREO70}); "
            f"units={gdf.crs.axis_info[0].unit_name}",
            fatal=True,
        )
    )

    report.add(
        Check(
            "feature_count",
            len(gdf) == EXPECTED_UAT_COUNT,
            f"{len(gdf)} features (expected {EXPECTED_UAT_COUNT})",
            fatal=True,
        )
    )

    invalid = gdf[~gdf.geometry.is_valid]
    report.add(
        Check(
            "geometry_validity",
            len(invalid) <= MAX_INVALID_GEOMETRIES,
            f"{len(invalid)} invalid geometries (threshold {MAX_INVALID_GEOMETRIES})",
            fatal=len(invalid) > MAX_INVALID_GEOMETRIES,
            rows=[
                {"siruta": str(r.siruta), "reason": explain_validity(r.geometry)[:120]}
                for r in invalid.head(20).itertuples()
            ],
        )
    )

    empty = gdf[gdf.geometry.is_empty | gdf.geometry.isna()]
    report.add(
        Check(
            "geometry_non_empty",
            len(empty) == 0,
            f"{len(empty)} empty or null geometries",
            fatal=len(empty) > 0,
        )
    )

    # A UAT of a few square metres is a data error, not a small commune. Romania's
    # smallest UATs are a few km2; flag anything under 0.5 km2 for eyeballing.
    areas_km2 = gdf.geometry.area / 1_000_000
    tiny = gdf[areas_km2 < 0.5]
    report.add(
        Check(
            "implausibly_small_uats",
            len(tiny) == 0,
            f"{len(tiny)} UATs under 0.5 km2 "
            f"(min={areas_km2.min():.2f} km2, median={areas_km2.median():.1f} km2)",
            fatal=False,
            rows=[{"siruta": str(r.siruta)} for r in tiny.head(20).itertuples()],
        )
    )

    # Total area is a blunt but effective check that we have the whole country once:
    # Romania is ~238,400 km2. A duplicated or missing region shows up here immediately.
    total_km2 = float(areas_km2.sum())
    plausible = 230_000 <= total_km2 <= 245_000
    report.add(
        Check(
            "total_area",
            plausible,
            f"{total_km2:,.0f} km2 (Romania is ~238,400 km2)",
            fatal=not plausible,
        )
    )
    return gdf


def check_join(gdf: gpd.GeoDataFrame, attrs: pd.DataFrame, report: Report) -> gpd.GeoDataFrame:
    geo_codes = set(gdf["siruta"])
    attr_codes = set(attrs["siruta"])

    only_geo = sorted(geo_codes - attr_codes)
    only_attr = sorted(attr_codes - geo_codes)
    unmatched = len(only_geo) + len(only_attr)

    report.add(
        Check(
            "siruta_duplicates_boundaries",
            gdf["siruta"].duplicated().sum() == 0,
            f"{int(gdf['siruta'].duplicated().sum())} duplicate SIRUTA in boundaries",
            fatal=bool(gdf["siruta"].duplicated().any()),
        )
    )
    report.add(
        Check(
            "siruta_duplicates_attributes",
            attrs["siruta"].duplicated().sum() == 0,
            f"{int(attrs['siruta'].duplicated().sum())} duplicate SIRUTA in attributes",
            fatal=bool(attrs["siruta"].duplicated().any()),
        )
    )
    report.add(
        Check(
            "siruta_join",
            unmatched <= MAX_UNMATCHED_SIRUTA,
            f"{len(only_geo)} boundary-only, {len(only_attr)} attribute-only "
            f"(threshold {MAX_UNMATCHED_SIRUTA})",
            fatal=unmatched > MAX_UNMATCHED_SIRUTA,
            rows=(
                [{"side": "boundaries_only", "siruta": s} for s in only_geo[:25]]
                + [{"side": "attributes_only", "siruta": s} for s in only_attr[:25]]
            ),
        )
    )

    merged = gdf.merge(attrs, on="siruta", how="inner", validate="one_to_one")

    # Independent cross-check: the two sources each carry a county for every UAT, derived
    # from different upstreams. If they disagree, one of them has the wrong SIRUTA vintage
    # and the join is matching codes that refer to different places.
    disagree = merged[
        merged["county_code_boundary"].str.upper() != merged["county_code"].str.upper()
    ]
    report.add(
        Check(
            "county_agreement",
            len(disagree) <= MAX_COUNTY_DISAGREEMENTS,
            f"{len(disagree)} UATs where the two sources disagree on county "
            f"(threshold {MAX_COUNTY_DISAGREEMENTS})",
            fatal=len(disagree) > MAX_COUNTY_DISAGREEMENTS,
            rows=[
                {
                    "siruta": r.siruta,
                    "name": r.name_uat,
                    "boundary_county": r.county_code_boundary,
                    "attribute_county": r.county_code,
                }
                for r in disagree.head(25).itertuples()
            ],
        )
    )

    unknown = sorted(set(merged["county_code"].str.upper()) - set(COUNTY_CODES))
    report.add(
        Check(
            "county_codes_known",
            not unknown,
            f"{len(unknown)} unrecognised county codes" + (f": {unknown}" if unknown else ""),
            fatal=bool(unknown),
        )
    )

    n_counties = merged["county_code"].nunique()
    report.add(
        Check(
            "county_coverage",
            n_counties == len(COUNTY_CODES),
            f"{n_counties}/{len(COUNTY_CODES)} counties represented",
            fatal=n_counties != len(COUNTY_CODES),
        )
    )
    return merged


def check_population(merged: gpd.GeoDataFrame, report: Report) -> None:
    pop = merged["population"]

    missing = merged[pop.isna() | (pop <= 0)]
    report.add(
        Check(
            "population_present",
            len(missing) == 0,
            f"{len(missing)} UATs with missing or non-positive population",
            fatal=False,
            rows=[
                {"siruta": r.siruta, "name": r.name_uat, "population": r.population}
                for r in missing.head(25).itertuples()
            ],
        )
    )

    total = int(pop.fillna(0).sum())
    # Census 2021 resident population was ~19.05 million. UAT totals should land close;
    # a large gap means we are missing UATs or double-counting Bucharest.
    plausible = 18_000_000 <= total <= 20_000_000
    report.add(
        Check(
            "population_total",
            plausible,
            f"{total:,} (Census 2021 resident population was ~19.05 million)",
            fatal=not plausible,
        )
    )

    # These drive the model's tier-1 seed selection, so they are worth stating explicitly
    # in the report rather than discovering later.
    for threshold in (5_000, 15_000, 50_000):
        n = int((pop >= threshold).sum())
        report.add(
            Check(
                f"absorbers_at_pop_{threshold}",
                True,
                f"{n} UATs at or above {threshold:,} population",
            )
        )


def _jsonable(o: object) -> object:
    """numpy scalars leak in from pandas comparisons and are not JSON-serialisable."""
    if hasattr(o, "item"):
        return o.item()
    return str(o)


def write_report(report: Report, out_md: Path, out_json: Path) -> None:
    out_md.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).isoformat(timespec="seconds")

    lines = [
        "# Data-quality report — geometry and the SIRUTA join",
        "",
        f"Generated {stamp} by `pipeline/build_geometry.py`.",
        "",
        "| Check | Status | Detail |",
        "|---|---|---|",
    ]
    for c in report.checks:
        status = "pass" if c.passed else ("**FAIL**" if c.fatal else "warn")
        lines.append(f"| `{c.name}` | {status} | {c.detail} |")

    detailed = [c for c in report.checks if c.rows]
    if detailed:
        lines += ["", "## Offending rows", ""]
        for c in detailed:
            body = json.dumps(c.rows, indent=2, ensure_ascii=False, default=_jsonable)
            lines += [f"### `{c.name}`", "", "```json", body, "```", ""]

    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    out_json.write_text(
        json.dumps(
            {
                "generated_at": stamp,
                "checks": [
                    {
                        "name": c.name,
                        "passed": c.passed,
                        "fatal": c.fatal,
                        "detail": c.detail,
                        "rows": c.rows,
                    }
                    for c in report.checks
                ],
            },
            indent=2,
            ensure_ascii=False,
            default=_jsonable,
        )
        + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--allow-failures",
        action="store_true",
        help="write outputs even if fatal checks fail (for inspecting a broken join)",
    )
    args = ap.parse_args(argv)

    print("Loading raw sources...")
    gdf = load_boundaries()
    attrs = load_attributes()

    # Normalise both sides onto the same key and the same column names before any check
    # touches them.
    gdf = gdf.rename(columns={"countymn": "county_code_boundary"})
    gdf["siruta"] = normalise_siruta(gdf["natcode"])
    attrs = attrs.rename(columns={"name": "name_uat"})
    attrs["siruta"] = normalise_siruta(attrs["siruta_code"])

    report = Report()

    print("\nGeometry checks:")
    gdf = check_geometry(gdf, report)

    print("\nSIRUTA join checks:")
    merged = check_join(gdf, attrs, report)

    print("\nPopulation checks:")
    check_population(merged, report)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "geometry.md", REPORTS_DIR / "geometry.json")

    if report.failed and not args.allow_failures:
        print(f"\n{len(report.failed)} fatal check(s) failed. No output written.")
        print(f"See {REPORTS_DIR / 'geometry.md'}")
        return 1

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = PROCESSED_DIR / "uat_geometry.gpkg"
    keep = [
        "siruta",
        "name_uat",
        "county_code",
        "county_name",
        "natlevname",
        "uat_code",
        "population",
        "geometry",
    ]
    merged[keep].to_file(out, driver="GPKG", layer="uat")
    print(f"\nWrote {out} ({out.stat().st_size / 1_048_576:.1f} MB)")
    print(f"Wrote {REPORTS_DIR / 'geometry.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
