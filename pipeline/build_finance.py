"""Join budget execution onto the UAT set and validate it.

Feeds the savings metric (brief §2):

    savings = sum(operating_expenditure of all members) - operating_expenditure(absorber)

Development spending is excluded on purpose. Merging two town halls removes duplicated
administration; it does not remove the need to build a road or a school, so counting
investment as "saved" would overstate the case for merging — which is exactly the kind of
overstatement this tool exists to let people argue with.

Output:
    web/public/data/finance.parquet     per-UAT operating and development expenditure
    data/processed/reports/finance.md
    data/processed/reports/finance.json

Usage:
    uv run python -m pipeline.build_finance
"""

from __future__ import annotations

import argparse
import json
import sys

import geopandas as gpd
import pandas as pd

from pipeline.build_geometry import Check, Report, normalise_siruta, write_report
from pipeline.paths import PROCESSED_DIR, RAW_DIR, REPORTS_DIR
from pipeline.sources import EXPENSE_TYPES, FINANCE_YEAR

# Romanian local budgets ran to roughly 160 bn RON of expenditure in 2024. A total far
# outside this band means the report-type filter changed and figures are being double
# counted, which would inflate every savings number on the map.
PLAUSIBLE_TOTAL_BN = (100, 250)

# UATs legitimately vary enormously in spend per head, but a figure this far above the
# national average is a data error rather than a rich commune.
IMPLAUSIBLE_PER_CAPITA_RON = 100_000


def load_raw() -> dict:
    path = RAW_DIR / "uat_finance.json"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.fetch")
    return json.loads(path.read_text(encoding="utf-8"))


def load_uats() -> gpd.GeoDataFrame:
    path = PROCESSED_DIR / "uat_geometry.gpkg"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.build_geometry")
    return gpd.read_file(path, layer="uat")[["siruta", "name_uat", "county_code", "population"]]


def reshape(raw: dict, report: Report) -> pd.DataFrame:
    """One row per UAT, one column per expense type."""
    frames = []
    for expense_type in EXPENSE_TYPES:
        rows = raw["by_expense_type"][expense_type]
        df = pd.DataFrame(rows)
        df["siruta"] = normalise_siruta(df["siruta_code"])
        df = df[["siruta", "total_amount"]].rename(columns={"total_amount": expense_type})
        duplicated = int(df["siruta"].duplicated().sum())
        if duplicated:
            raise SystemExit(f"  FATAL: {duplicated} duplicate SIRUTA in {expense_type} rows")
        frames.append(df.set_index("siruta"))

    for key in ("administrative", "personnel", "admin_personnel", "income"):
        rows = raw.get(key) or []
        if not rows:
            raise SystemExit(f"  FATAL: the {key} series is empty, live and cached")
        frame = pd.DataFrame(rows)
        frame["siruta"] = normalise_siruta(frame["siruta_code"])
        frames.append(
            frame[["siruta", "total_amount"]]
            .rename(columns={"total_amount": key})
            .set_index("siruta")
        )

    wide = pd.concat(frames, axis=1).reset_index()
    money_cols = [*EXPENSE_TYPES, "administrative", "personnel", "admin_personnel", "income"]
    wide[money_cols] = wide[money_cols].fillna(0.0)

    report.add(
        Check(
            "source_rows",
            True,
            f"{len(wide)} UAT-level rows returned for {FINANCE_YEAR}, "
            f"one column per expense type ({', '.join(EXPENSE_TYPES)})",
        )
    )
    return wide


def check_totals(wide: pd.DataFrame, report: Report) -> None:
    operating = wide["functionare"].sum()
    development = wide["dezvoltare"].sum()
    total = operating + development

    low, high = PLAUSIBLE_TOTAL_BN
    ok = low <= total / 1e9 <= high
    report.add(
        Check(
            "national_total",
            ok,
            f"{total / 1e9:.1f} bn RON total expenditure "
            f"({operating / 1e9:.1f} operating + {development / 1e9:.1f} development); "
            f"plausible band {low}-{high} bn",
            fatal=not ok,
        )
    )

    admin = wide["administrative"].sum()
    admin_share = admin / operating if operating else 0
    report.add(
        Check(
            "administrative_share",
            0.05 <= admin_share <= 0.35,
            f"{admin / 1e9:.1f} bn RON is town-hall administration, {admin_share:.1%} of "
            "operating spending. The rest is schools, social assistance, health and "
            "utilities, which a merger does not remove — this is why the savings headline "
            "uses administration rather than all operating spending",
            fatal=not 0.05 <= admin_share <= 0.35,
        )
    )

    # Each narrower series must sit inside the one it is carved from, or the classification
    # filters have returned something that is not what their names claim.
    personnel = wide["personnel"].sum()
    admin_personnel = wide["admin_personnel"].sum()
    income = wide["income"].sum()
    report.add(
        Check(
            "classification_nesting",
            admin_personnel <= admin and admin_personnel <= personnel and personnel <= operating,
            f"admin personnel {admin_personnel / 1e9:.1f} bn sits inside administration "
            f"{admin / 1e9:.1f} bn and personnel {personnel / 1e9:.1f} bn, which sits inside "
            f"operating {operating / 1e9:.1f} bn",
            fatal=not (
                admin_personnel <= admin and admin_personnel <= personnel and personnel <= operating
            ),
        )
    )
    report.add(
        Check(
            "income_vs_expenditure",
            0.8 <= income / total <= 1.25 if total else False,
            f"income {income / 1e9:.1f} bn against expenditure {total / 1e9:.1f} bn "
            f"({income / total:.2f}x) — local budgets are close to balanced by law",
            fatal=not (0.8 <= income / total <= 1.25 if total else False),
        )
    )

    share = operating / total if total else 0
    # Operating spending dominates local budgets everywhere; if development ever exceeded
    # it nationally, the two columns would have been swapped somewhere.
    report.add(
        Check(
            "operating_share",
            0.5 <= share <= 0.9,
            f"operating is {share:.1%} of total expenditure",
            fatal=not 0.5 <= share <= 0.9,
        )
    )


def join_to_uats(wide: pd.DataFrame, uats: gpd.GeoDataFrame, report: Report) -> pd.DataFrame:
    finance_codes = set(wide["siruta"])
    uat_codes = set(uats["siruta"])

    missing = sorted(uat_codes - finance_codes)
    extra = sorted(finance_codes - uat_codes)

    report.add(
        Check(
            "uats_without_finance",
            len(missing) == 0,
            f"{len(missing)} UATs have no budget row and would show a savings figure of zero",
            # Not fatal: a commune can legitimately be missing from one year's execution
            # reporting. It must be visible rather than silently treated as costing nothing.
            fatal=False,
            rows=[{"siruta": s} for s in missing[:25]],
        )
    )
    report.add(
        Check(
            "finance_rows_outside_uat_set",
            True,
            f"{len(extra)} budget rows dropped as not-a-UAT — expected to be the 42 "
            "county-level rows, including Municipiul București, which is reported "
            "separately from its six sectors and would otherwise double-count the city",
        )
    )

    merged = uats.merge(wide, on="siruta", how="left", validate="one_to_one")
    money_cols = [*EXPENSE_TYPES, "administrative", "personnel", "admin_personnel", "income"]
    merged[money_cols] = merged[money_cols].fillna(0.0)
    merged = merged.rename(
        columns={
            "functionare": "operating_ron",
            "dezvoltare": "development_ron",
            "administrative": "administrative_ron",
            "personnel": "personnel_ron",
            "admin_personnel": "admin_personnel_ron",
            "income": "income_ron",
        }
    )

    # build_geometry already fails the build if any population is missing or non-positive,
    # so this division cannot produce an infinity.
    merged["operating_per_capita_ron"] = merged["operating_ron"] / merged["population"]

    outliers = merged[merged["operating_per_capita_ron"] > IMPLAUSIBLE_PER_CAPITA_RON]
    report.add(
        Check(
            "per_capita_outliers",
            len(outliers) == 0,
            f"{len(outliers)} UATs spend over {IMPLAUSIBLE_PER_CAPITA_RON:,} RON per head "
            f"(median is {merged['operating_per_capita_ron'].median():,.0f})",
            fatal=False,
            rows=[
                {
                    "siruta": r.siruta,
                    "name": r.name_uat,
                    "population": int(r.population),
                    "per_capita": round(float(r.operating_per_capita_ron)),
                }
                for r in outliers.head(25).itertuples()
            ],
        )
    )

    negative = merged[(merged["operating_ron"] < 0) | (merged["development_ron"] < 0)]
    report.add(
        Check(
            "no_negative_expenditure",
            len(negative) == 0,
            f"{len(negative)} UATs report negative expenditure",
            fatal=len(negative) > 0,
        )
    )

    zero = merged[merged["operating_ron"] <= 0]
    report.add(
        Check(
            "zero_operating_expenditure",
            True,
            f"{len(zero)} UATs report no operating expenditure; these contribute nothing "
            "to any savings figure",
            rows=[{"siruta": r.siruta, "name": r.name_uat} for r in zero.head(25).itertuples()],
        )
    )
    return merged


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--allow-failures", action="store_true")
    args = ap.parse_args(argv)

    report = Report()

    print("Loading budget execution...")
    raw = load_raw()
    uats = load_uats()

    print("\nFinance checks:")
    wide = reshape(raw, report)
    check_totals(wide, report)
    merged = join_to_uats(wide, uats, report)

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "finance.md", REPORTS_DIR / "finance.json")

    if report.failed and not args.allow_failures:
        print(f"\n{len(report.failed)} fatal check(s) failed. No output written.")
        return 1

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = PROCESSED_DIR / "finance.parquet"
    merged[
        [
            "siruta",
            "operating_ron",
            "administrative_ron",
            "development_ron",
            "personnel_ron",
            "admin_personnel_ron",
            "income_ron",
            "operating_per_capita_ron",
        ]
    ].sort_values("siruta", ignore_index=True).to_parquet(out, index=False, compression="zstd")

    print(f"\nWrote {out} ({len(merged)} UATs, {out.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {REPORTS_DIR / 'finance.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
