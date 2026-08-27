"""Download raw sources into ``data/raw/``.

Idempotent: an existing, non-empty artefact is left alone unless ``--force`` is passed.
The pipeline must be reproducible from this script on a clean machine, so everything it
writes is a verbatim upstream response plus a small sidecar recording where it came from
and when.

Usage:
    uv run python -m pipeline.fetch                 # boundaries + attributes
    uv run python -m pipeline.fetch --with-roads    # also the 312 MB OSM extract
    uv run python -m pipeline.fetch --force
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import requests

from pipeline import sources
from pipeline.constants import CRS_STEREO70, EXPECTED_COUNTY_COUNT, EXPECTED_UAT_COUNT
from pipeline.paths import RAW_DIR

USER_AGENT = (
    "administrative-reform-simulator/0.1 (+https://github.com/; open-source civic tool; "
    "contact via repository issues)"
)
TIMEOUT = 120

# Transparenta.eu is a volunteer-run public service. Page politely and identify ourselves.
GRAPHQL_PAGE_SIZE = 500
GRAPHQL_PAGE_DELAY_S = 0.5


def _sidecar(path: Path, source: sources.Source, **extra: object) -> None:
    """Record provenance next to the artefact, so a stale download is diagnosable."""
    meta = {
        "source": asdict(source),
        "fetched_at": datetime.now(UTC).isoformat(),
        "artefact": path.name,
        **extra,
    }
    path.with_suffix(path.suffix + ".meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _skip(path: Path, force: bool) -> bool:
    if path.exists() and path.stat().st_size > 0 and not force:
        mb = path.stat().st_size / 1_048_576
        print(f"  exists, skipping ({mb:.1f} MB) — use --force to refetch")
        return True
    return False


def fetch_boundaries(force: bool = False) -> Path:
    """UAT polygons from the geo-spatial.org WFS mirror of ANCPI, in EPSG:3844."""
    out = RAW_DIR / "uat_boundaries.geojson"
    print(f"[boundaries] {out.name}")
    if _skip(out, force):
        return out

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": sources.WFS_LAU_TYPENAME,
        "outputFormat": "application/json",
        # Ask for the native CRS explicitly rather than trusting the server default.
        # Everything downstream buffers in metres; a silent WGS84 response would produce
        # radii that are wrong by latitude and a map that still looks plausible.
        "srsName": f"urn:ogc:def:crs:EPSG::{CRS_STEREO70.split(':')[1]}",
    }
    r = requests.get(
        sources.WFS_BASE, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
    )
    r.raise_for_status()
    payload = r.json()

    n = len(payload.get("features", []))
    if n != EXPECTED_UAT_COUNT:
        raise SystemExit(
            f"  FATAL: WFS returned {n} features, expected {EXPECTED_UAT_COUNT}.\n"
            "  The upstream layer changed. Do not proceed — a wrong UAT set silently\n"
            "  changes every region in every scenario."
        )

    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _sidecar(out, sources.BOUNDARIES, feature_count=n, srs_requested=CRS_STEREO70)
    print(f"  {n} features, {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def fetch_boundary_lines(force: bool = False) -> Path:
    """Shared boundary segments, each carrying the SIRUTA on either side."""
    out = RAW_DIR / "uat_boundary_lines.geojson"
    print(f"[boundary lines] {out.name}")
    if _skip(out, force):
        return out

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": sources.WFS_LAU_LINE_TYPENAME,
        "outputFormat": "application/json",
        "srsName": f"urn:ogc:def:crs:EPSG::{CRS_STEREO70.split(':')[1]}",
    }
    r = requests.get(
        sources.WFS_BASE, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
    )
    r.raise_for_status()
    payload = r.json()

    n = len(payload.get("features", []))
    # No exact expected count here: unlike the UAT set, the segment count is an artefact of
    # how boundaries were digitised and can legitimately shift between vintages. The brief
    # anticipates 8-9k edges nationally, so treat a wild departure as a signal.
    if not 5_000 <= n <= 15_000:
        raise SystemExit(
            f"  FATAL: {n} boundary segments, expected roughly 8,000-9,000.\n"
            "  The upstream layer changed shape. Adjacency underpins the whole model."
        )

    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _sidecar(out, sources.BOUNDARY_LINES, feature_count=n, srs_requested=CRS_STEREO70)
    print(f"  {n} segments, {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def fetch_display_geometry(force: bool = False) -> Path:
    """Simplified UAT polygons in WGS84, for drawing rather than measuring."""
    out = RAW_DIR / "uat_display.geojson"
    print(f"[display geometry] {out.name}")
    if _skip(out, force):
        return out

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": sources.WFS_LAU_SIMPLIFIED_TYPENAME,
        "outputFormat": "application/json",
        # WGS84 here, not Stereo 70: this layer is drawn by MapLibre, never measured.
        "srsName": "urn:ogc:def:crs:EPSG::4326",
    }
    r = requests.get(
        sources.WFS_BASE, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
    )
    r.raise_for_status()
    payload = r.json()

    n = len(payload.get("features", []))
    if n != EXPECTED_UAT_COUNT:
        raise SystemExit(f"  FATAL: display layer has {n} features, expected {EXPECTED_UAT_COUNT}")

    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _sidecar(out, sources.BOUNDARIES, feature_count=n, srs_requested="EPSG:4326")
    print(f"  {n} features, {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def _fetch_wfs_geojson(typename: str, out: Path, label: str, force: bool) -> Path:
    """Fetch a WFS layer as WGS84 GeoJSON. Used for the map's context layers."""
    print(f"[{label}] {out.name}")
    if _skip(out, force):
        return out
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": typename,
        "outputFormat": "application/json",
        "srsName": "urn:ogc:def:crs:EPSG::4326",
    }
    r = requests.get(
        sources.WFS_BASE, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
    )
    r.raise_for_status()
    payload = r.json()
    n = len(payload.get("features", []))
    if n == 0:
        raise SystemExit(f"  FATAL: {typename} returned no features")
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"  {n} features, {out.stat().st_size / 1024:.0f} KB")
    return out


def fetch_boundary_context(force: bool = False) -> None:
    """County and development-region boundaries, for map context only."""
    _fetch_wfs_geojson(
        sources.WFS_COUNTY_LINE_TYPENAME, RAW_DIR / "county_lines.geojson", "counties", force
    )
    _fetch_wfs_geojson(
        sources.WFS_REGION_LINE_TYPENAME, RAW_DIR / "region_lines.geojson", "regions", force
    )


def fetch_localities(force: bool = False) -> Path:
    """SIRUTA locality points, from which UAT seats are resolved."""
    out = RAW_DIR / "localities.geojson"
    print(f"[localities] {out.name}")
    if _skip(out, force):
        return out

    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": sources.WFS_LOCALITIES_TYPENAME,
        "outputFormat": "application/json",
        "srsName": f"urn:ogc:def:crs:EPSG::{CRS_STEREO70.split(':')[1]}",
    }
    r = requests.get(
        sources.WFS_BASE, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
    )
    r.raise_for_status()
    payload = r.json()

    n = len(payload.get("features", []))
    # Romania has ~13,000 localities; the exact count shifts between SIRUTA vintages, so
    # this is a plausibility band rather than an equality check.
    if not 12_000 <= n <= 15_000:
        raise SystemExit(
            f"  FATAL: {n} localities, expected roughly 13,750.\n"
            "  Every seat point derives from this layer."
        )

    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _sidecar(out, sources.LOCALITIES, feature_count=n, srs_requested=CRS_STEREO70)
    print(f"  {n} localities, {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def _graphql_page(session: requests.Session, limit: int, offset: int) -> dict:
    query = """
    query UATs($limit: Int!, $offset: Int!) {
      uats(filter: { is_county: false }, limit: $limit, offset: $offset) {
        pageInfo { totalCount }
        nodes {
          siruta_code
          uat_code
          name
          county_code
          county_name
          population
        }
      }
    }
    """
    r = session.post(
        sources.GRAPHQL_ENDPOINT,
        json={"query": query, "variables": {"limit": limit, "offset": offset}},
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    body = r.json()
    if "errors" in body:
        raise SystemExit(f"  FATAL: GraphQL errors: {json.dumps(body['errors'])[:400]}")
    return body["data"]["uats"]


def fetch_attributes(force: bool = False) -> Path:
    """SIRUTA, name, county and Census-2021 population for every non-county UAT."""
    out = RAW_DIR / "uat_attributes.json"
    print(f"[attributes] {out.name}")
    if _skip(out, force):
        return out

    session = requests.Session()
    nodes: list[dict] = []
    offset = 0
    total: int | None = None

    while True:
        page = _graphql_page(session, GRAPHQL_PAGE_SIZE, offset)
        if total is None:
            total = page["pageInfo"]["totalCount"]
            print(f"  totalCount={total}")
        batch = page["nodes"]
        if not batch:
            break
        nodes.extend(batch)
        print(f"  fetched {len(nodes)}/{total}", end="\r", flush=True)
        offset += len(batch)
        if offset >= total:
            break
        time.sleep(GRAPHQL_PAGE_DELAY_S)
    print()

    if len(nodes) != EXPECTED_UAT_COUNT:
        raise SystemExit(
            f"  FATAL: got {len(nodes)} UATs, expected {EXPECTED_UAT_COUNT}.\n"
            "  Refusing to write a partial attribute set — it would show up later as a\n"
            "  hole in the map rather than as an error here."
        )

    duplicates = len(nodes) - len({n["siruta_code"] for n in nodes})
    if duplicates:
        raise SystemExit(f"  FATAL: {duplicates} duplicate SIRUTA codes in the response.")

    out.write_text(json.dumps(nodes, ensure_ascii=False, indent=1), encoding="utf-8")
    _sidecar(
        out,
        sources.ATTRIBUTES,
        record_count=len(nodes),
        expected_county_rows_excluded=EXPECTED_COUNTY_COUNT,
    )
    print(f"  {len(nodes)} records, {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def fetch_finance(force: bool = False) -> Path:
    """Budget execution per UAT, one call per expense type."""
    out = RAW_DIR / "uat_finance.json"
    print(f"[finance] {out.name}")
    if _skip(out, force):
        return out

    def _income_query() -> str:
        return f"""
        query Income($year: PeriodDate!) {{
          heatmapUATData(
            filter: {{
              account_category: vn
              report_type: {sources.FINANCE_REPORT_TYPE}
              is_uat: true
              report_period: {{ type: YEAR, selection: {{ dates: [$year] }} }}
            }}
          ) {{
            siruta_code
            total_amount
          }}
        }}
        """

    def _query(
        expense_type: str,
        functional_prefix: str | None = None,
        economic_prefix: str | None = None,
    ) -> str:
        parts = []
        if functional_prefix:
            parts.append(f'functional_prefixes: ["{functional_prefix}"]')
        if economic_prefix:
            parts.append(f'economic_prefixes: ["{economic_prefix}"]')
        prefix_filter = " ".join(parts)
        return f"""
        query Finance($year: PeriodDate!) {{
          heatmapUATData(
            filter: {{
              account_category: {sources.FINANCE_ACCOUNT_CATEGORY}
              report_type: {sources.FINANCE_REPORT_TYPE}
              is_uat: true
              expense_types: [{expense_type}]
              {prefix_filter}
              report_period: {{ type: YEAR, selection: {{ dates: [$year] }} }}
            }}
          ) {{
            siruta_code
            uat_name
            county_code
            population
            total_amount
          }}
        }}
        """

    session = requests.Session()
    payload: dict[str, object] = {"year": sources.FINANCE_YEAR, "by_expense_type": {}}

    for expense_type in sources.EXPENSE_TYPES:
        r = session.post(
            sources.GRAPHQL_ENDPOINT,
            json={
                "query": _query(expense_type),
                "variables": {"year": str(sources.FINANCE_YEAR)},
            },
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
        if "errors" in body:
            raise SystemExit(f"  FATAL: GraphQL errors: {json.dumps(body['errors'])[:400]}")
        rows = body["data"]["heatmapUATData"]
        total = sum(row["total_amount"] or 0 for row in rows)
        print(f"  {expense_type:12s} {len(rows):5d} rows, {total / 1e9:7.1f} bn RON")
        payload["by_expense_type"][expense_type] = rows  # type: ignore[index]
        time.sleep(GRAPHQL_PAGE_DELAY_S)

    def _run(query: str, label: str) -> list[dict] | None:
        """Run one query, returning None if the server rejects it.

        The classification filters are the fragile part of this API: queries using
        `functional_prefixes` returned results one day and "Internal server error" the next,
        with plain queries unaffected throughout. A transient upstream fault should not lose
        the whole finance layer, so a failed series falls back to whatever was cached.
        """
        response = session.post(
            sources.GRAPHQL_ENDPOINT,
            json={"query": query, "variables": {"year": str(sources.FINANCE_YEAR)}},
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        if response.status_code >= 500 or "errors" in response.json():
            print(f"  {label:14s} upstream refused the query — keeping any cached series")
            return None
        rows = response.json()["data"]["heatmapUATData"]
        total = sum(row["total_amount"] or 0 for row in rows)
        print(f"  {label:14s} {len(rows):5d} rows, {total / 1e9:7.1f} bn RON")
        time.sleep(GRAPHQL_PAGE_DELAY_S)
        return rows

    cached = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}

    income = _run(_income_query(), "income")
    payload["income"] = income if income is not None else cached.get("income", [])

    # Administration only, which is the slice a merger actually removes.
    admin = _run(_query("functionare", sources.ADMIN_FUNCTIONAL_PREFIX), "administrative")
    payload["administrative"] = admin if admin is not None else cached.get("administrative", [])
    personnel = _run(
        _query("functionare", economic_prefix=sources.PERSONNEL_ECONOMIC_PREFIX),
        "personnel",
    )
    payload["personnel"] = personnel if personnel is not None else cached.get("personnel", [])

    admin_personnel = _run(
        _query(
            "functionare",
            functional_prefix=sources.ADMIN_FUNCTIONAL_PREFIX,
            economic_prefix=sources.PERSONNEL_ECONOMIC_PREFIX,
        ),
        "admin personnel",
    )
    payload["admin_personnel"] = (
        admin_personnel if admin_personnel is not None else cached.get("admin_personnel", [])
    )

    if not payload["administrative"]:
        raise SystemExit(
            "  FATAL: no administrative series, live or cached. The savings headline "
            "depends on it, so the build stops rather than reporting zero."
        )

    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _sidecar(out, sources.FINANCE, year=sources.FINANCE_YEAR)
    print(f"  {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def fetch_roads(force: bool = False) -> Path:
    """The OSM Romania extract. Large; only needed from build_adjacency.py onwards."""
    out = RAW_DIR / "romania-latest.osm.pbf"
    print(f"[roads] {out.name}")
    if _skip(out, force):
        return out

    with requests.get(
        sources.ROADS.url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=TIMEOUT
    ) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        tmp = out.with_suffix(".partial")
        with tmp.open("wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total:
                    print(f"  {done / 1_048_576:6.0f}/{total / 1_048_576:.0f} MB", end="\r")
        print()
        tmp.rename(out)

    _sidecar(out, sources.ROADS, bytes=out.stat().st_size)
    print(f"  {out.stat().st_size / 1_048_576:.1f} MB")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="refetch even if present")
    ap.add_argument(
        "--with-roads",
        action="store_true",
        help="also download the ~312 MB OSM extract (needed for build_adjacency.py)",
    )
    args = ap.parse_args(argv)

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    fetch_boundaries(args.force)
    fetch_boundary_lines(args.force)
    fetch_display_geometry(args.force)
    fetch_boundary_context(args.force)
    fetch_localities(args.force)
    fetch_attributes(args.force)
    fetch_finance(args.force)
    if args.with_roads:
        fetch_roads(args.force)
    else:
        print("[roads] skipped — pass --with-roads when you need the adjacency graph")

    print("\nDone. Next: uv run python -m pipeline.build_geometry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
