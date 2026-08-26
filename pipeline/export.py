"""Emit `web/public/data/` in a form the browser can load without a parser.

Parquet is right for the pipeline and wrong for the web: it needs a decoder before the
model can run. Everything the model touches is therefore written as flat typed arrays that
map straight onto `Uint16Array`/`Float32Array` with no parsing step at all, plus one small
JSON file for the things only the UI needs (names, and the index the model is keyed on).

Layout, all little-endian:

    manifest.json       shapes and offsets; the only thing that needs parsing
    attributes.json     siruta, name, county per UAT — for the UI, not the hot path
    attributes.bin      population u32 | seatX f32 | seatY f32 | admin f32 | operating f32
    adjacency.bin       a u16 | b u16 | traversable u8
    candidacy.bin       absorber u16 | uat u16 | overlap u8 (percent) | seatInside u8

UATs are addressed by **index**, not by SIRUTA string, everywhere in the binary payload.
The index is the SIRUTA sort order, which is stable across builds, and it keeps the hot
path in integers rather than string hashing.

Usage:
    uv run python -m pipeline.export
"""

from __future__ import annotations

import argparse
import json
import sys

import geopandas as gpd
import numpy as np
import pandas as pd

from pipeline.build_geometry import Check, Report, write_report
from pipeline.constants import (
    OVERLAP_QUANTISATION_DECIMALS,
    RADIUS_GRID_M,
)
from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA
from pipeline.paths import DOCS_DIR, PROCESSED_DIR, RAW_DIR, REPORTS_DIR, WEB_DATA_DIR

# Overlap is stored as a percentage in a single byte. The pipeline already quantises to two
# decimals, so this loses nothing that was ever there.
OVERLAP_SCALE = 100


def load() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    paths = {
        "uat": PROCESSED_DIR / "uat_geometry.gpkg",
        "seat": PROCESSED_DIR / "uat_seats.gpkg",
        "adjacency": PROCESSED_DIR / "adjacency.parquet",
        "candidacy": PROCESSED_DIR / "candidacy.parquet",
        "finance": PROCESSED_DIR / "finance.parquet",
    }
    for name, path in paths.items():
        if not path.exists():
            raise SystemExit(f"Missing {path} — build {name} first")
    return (
        gpd.read_file(paths["uat"], layer="uat"),
        gpd.read_file(paths["seat"], layer="seat"),
        pd.read_parquet(paths["adjacency"]),
        pd.read_parquet(paths["candidacy"]),
        pd.read_parquet(paths["finance"]),
    )


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__).parse_args(argv)
    report = Report()

    uats, seats, adjacency, candidacy, finance = load()

    # The canonical index: SIRUTA ascending. Everything downstream depends on this order,
    # so it is computed once and asserted rather than assumed.
    uats = uats.sort_values("siruta", ignore_index=True)
    order = list(uats["siruta"])
    index_of = {siruta: i for i, siruta in enumerate(order)}

    seats = seats.set_index("siruta").loc[order]
    finance = finance.set_index("siruta").loc[order]

    report.add(
        Check(
            "index_is_sorted_siruta",
            order == sorted(order),
            f"{len(order)} UATs indexed in SIRUTA order",
            fatal=order != sorted(order),
        )
    )

    # --- attributes -------------------------------------------------------------------
    population = uats["population"].to_numpy(dtype=np.uint32)
    seat_x = np.array([g.x for g in seats.geometry], dtype=np.float32)
    seat_y = np.array([g.y for g in seats.geometry], dtype=np.float32)
    admin = finance["administrative_ron"].to_numpy(dtype=np.float32)
    operating = finance["operating_ron"].to_numpy(dtype=np.float32)

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DATA_DIR / "attributes.bin").write_bytes(
        population.tobytes()
        + seat_x.tobytes()
        + seat_y.tobytes()
        + admin.tobytes()
        + operating.tobytes()
    )

    (WEB_DATA_DIR / "attributes.json").write_text(
        json.dumps(
            {
                "siruta": order,
                "name": list(uats["name_uat"]),
                "county": list(uats["county_code"]),
                # Tier-0 membership is a rule, not a property of the data, so it ships
                # resolved rather than being re-derived in two languages.
                "isCapital": [
                    bool(s in COUNTY_CAPITAL_SIRUTA or c == "B")
                    for s, c in zip(uats["siruta"], uats["county_code"], strict=True)
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    # --- display geometry ---------------------------------------------------------------
    # Every property is stripped: the map needs only a feature id it can hand to
    # setFeatureState, and that id is the UAT index the model already speaks. Names and
    # figures are looked up from attributes.json, so nothing is duplicated into the
    # geometry payload — which is what keeps it under a megabyte gzipped.
    display_path = RAW_DIR / "uat_display.geojson"
    if not display_path.exists():
        raise SystemExit(f"Missing {display_path} — run pipeline.fetch")
    display = json.loads(display_path.read_text(encoding="utf-8"))

    lean_features = []
    missing_geometry = []
    for feature in display["features"]:
        siruta = str(feature["properties"]["natcode"]).strip().lstrip("0") or "0"
        idx = index_of.get(siruta)
        if idx is None:
            missing_geometry.append(siruta)
            continue
        lean_features.append(
            {"type": "Feature", "id": idx, "properties": {}, "geometry": feature["geometry"]}
        )

    report.add(
        Check(
            "display_geometry_join",
            not missing_geometry,
            f"{len(lean_features)} display polygons keyed to the model index; "
            f"{len(missing_geometry)} could not be matched",
            fatal=bool(missing_geometry),
            rows=[{"siruta": s} for s in missing_geometry[:25]],
        )
    )

    lean_features.sort(key=lambda f: f["id"])
    (WEB_DATA_DIR / "uats.geojson").write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": lean_features},
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    # --- adjacency --------------------------------------------------------------------
    usable = adjacency[adjacency["traversable"]]
    a_idx = np.array([index_of[s] for s in usable["a_siruta"]], dtype=np.uint16)
    b_idx = np.array([index_of[s] for s in usable["b_siruta"]], dtype=np.uint16)
    (WEB_DATA_DIR / "adjacency.bin").write_bytes(a_idx.tobytes() + b_idx.tobytes())

    report.add(
        Check(
            "adjacency_exported",
            True,
            f"{len(usable)} traversable edges of {len(adjacency)} total",
        )
    )

    # --- candidacy --------------------------------------------------------------------
    # Grouped by radius so the model can slice exactly one radius per recompute rather
    # than filtering 213k rows on every slider frame.
    candidacy = candidacy.sort_values(
        ["radius_m", "absorber_siruta", "uat_siruta"], ignore_index=True
    )
    radius_offsets = {}
    chunks = []
    cursor = 0
    for radius in RADIUS_GRID_M:
        block = candidacy[candidacy["radius_m"] == radius]
        absorber = np.array([index_of[s] for s in block["absorber_siruta"]], dtype=np.uint16)
        target = np.array([index_of[s] for s in block["uat_siruta"]], dtype=np.uint16)
        overlap = np.round(block["overlap_fraction"].to_numpy() * OVERLAP_SCALE).astype(np.uint8)
        seat_inside = block["seat_inside"].to_numpy().astype(np.uint8)
        chunks.append(
            absorber.tobytes() + target.tobytes() + overlap.tobytes() + seat_inside.tobytes()
        )
        radius_offsets[str(radius)] = {"start": cursor, "count": len(block)}
        cursor += len(block)

    (WEB_DATA_DIR / "candidacy.bin").write_bytes(b"".join(chunks))

    # Quantile breaks for the cost choropleth, computed from the data rather than picked
    # by eye. Administration cost per resident is the figure that actually argues for
    # merging: a commune of 1,200 people still needs a mayor, a secretary and a budget.
    per_capita = np.divide(
        admin.astype(np.float64),
        population.astype(np.float64),
        out=np.zeros(len(order)),
        where=population > 0,
    )
    positive = per_capita[per_capita > 0]
    cost_breaks = [float(np.quantile(positive, q)) for q in (0.25, 0.5, 0.75)]
    report.add(
        Check(
            "admin_cost_per_resident",
            True,
            "quartile breaks "
            + ", ".join(f"{b:,.0f}" for b in cost_breaks)
            + f" RON/resident (median {np.median(positive):,.0f}, max {positive.max():,.0f})",
        )
    )

    manifest = {
        "uatCount": len(order),
        "adminCostBreaks": cost_breaks,
        "overlapScale": OVERLAP_SCALE,
        "overlapDecimals": OVERLAP_QUANTISATION_DECIMALS,
        "radiusGrid": list(RADIUS_GRID_M),
        "edgeCount": int(len(usable)),
        "candidacyCount": int(cursor),
        "candidacyByRadius": radius_offsets,
    }
    (WEB_DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Ship the methodology alongside the app so the in-app link resolves on GitHub Pages
    # rather than pointing at a repository the reader may not think to go looking for.
    methodology = DOCS_DIR / "METHODOLOGY.md"
    if methodology.exists():
        (WEB_DATA_DIR.parent / "METHODOLOGY.md").write_text(
            methodology.read_text(encoding="utf-8"), encoding="utf-8"
        )

    sizes = {
        p.name: p.stat().st_size
        for p in sorted(WEB_DATA_DIR.glob("*"))
        if p.suffix in {".bin", ".json", ".geojson"}
    }
    total = sum(sizes.values())
    report.add(
        Check(
            "payload_size",
            total < 8 * 1_048_576,
            ", ".join(f"{k}={v / 1024:.0f}KB" for k, v in sizes.items())
            + f" — total {total / 1_048_576:.2f} MB",
            fatal=total >= 8 * 1_048_576,
        )
    )

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_report(report, REPORTS_DIR / "export.md", REPORTS_DIR / "export.json")

    if report.failed:
        return 1
    print(f"\nWrote {WEB_DATA_DIR} ({total / 1_048_576:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
