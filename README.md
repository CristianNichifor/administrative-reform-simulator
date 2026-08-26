# Administrative Reform Simulator (Romania)

An interactive map of Romania's 3,186 UATs (unități administrativ-teritoriale) that
simulates administrative consolidation under a **deterministic gravitational accretion
model**. Move the sliders — radii, population thresholds, seeds per county — and the map
recomputes immediately.

> **This is a tool for public debate, not an official proposal.**
> It is an analysis instrument. It does not represent a government position, and no
> scenario it produces is a recommendation.

## Status

Working end to end. The pipeline builds every data layer, the model runs in both Python and
TypeScript with verified parity, and the app renders Romania with live sliders.

At the default settings: **3,186 UATs collapse to 682 regions (78.6%)**, recomputed in about
15 ms — comfortably inside the 150 ms budget.

## Two constraints that shape everything

1. **Runs entirely client-side.** No backend, no solver service, no runtime API calls.
   Target: full recomputation under 150 ms so slider drags feel continuous.
   Hosting is GitHub Pages.
2. **Deterministic and explainable.** Same inputs → byte-identical output, every time.
   A journalist must be able to read the rules in a paragraph, and a mayor must be able to
   dispute them. No optimization heuristics, no randomness, no simulated annealing.

The second constraint is a deliberate position, not a simplification. Optimization-based
regionalization (Max-P and friends) produces better-scoring maps that nobody can audit or
argue with. This project trades that away on purpose.

## The model, in a paragraph

County capitals and towns above a population threshold become **absorbers**. Each absorber's
polygon is buffered outward by a radius that depends on its tier. Neighbouring UATs that
overlap that buffer enough — and that are connected to it by a road crossing a shared border —
are absorbed, in concentric waves, never leapfrogging. Absorbers are processed in a strict,
documented order, so conflicts resolve identically on every run. Whatever is left over can
optionally be merged into small orphan clusters. Regions never cross county lines.

Full specification: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) (RO + EN).

## Layout

```
pipeline/   Python 3.11+ — fetches sources, builds geometry, adjacency, candidacy, finance
web/        Vite + TypeScript + MapLibre GL — the app; model runs in a Web Worker
tests/      Includes the parity suite: Python reference model vs TypeScript port
docs/       METHODOLOGY.md, PRIOR_ART.md
data/       Gitignored. Reproducible from `pipeline/fetch.py` on a clean machine.
```

## Build order

The model rests entirely on the adjacency graph and the candidacy grid. A wrong
road-crossing flag produces a map that looks plausible and is quietly incorrect — so those
are verified before any frontend work begins.

- [x] Repo skeleton, license, CI
- [x] Prior-art investigation ([`docs/PRIOR_ART.md`](docs/PRIOR_ART.md))
- [x] `fetch.py` + `build_geometry.py` + data-quality report on boundaries and the SIRUTA join
- [x] `build_seats.py` — one seat point per UAT, from the SIRUTA nomenclator
- [x] `build_adjacency.py` — adjacency with road-crossing flags **(verification gate)**
- [x] `build_candidacy.py` — precomputed overlap fractions per radius **(verification gate)**
- [x] `build_finance.py` — operating vs development expenditure per UAT
- [x] `reference_model.py` — Python implementation of the algorithm
- [x] `export.py` — typed-array payload for the browser
- [x] TypeScript port + parity tests
- [x] Frontend — MapLibre map, model in a Web Worker, RO/EN, deep-linkable scenarios
- [x] METHODOLOGY.md written out in full, RO + EN

## Determinism and how to check it

Same inputs must give the same map. Two of the pipeline's artefact formats behave
differently under that requirement, and the difference has already caused one false alarm:

- **Parquet** (`adjacency.parquet`) is byte-reproducible. `md5sum` is a valid check.
- **GeoPackage** (`uat_geometry.gpkg`, `uat_seats.gpkg`) is **not**. GPKG records a
  `last_change` timestamp in its `gpkg_contents` table, so two runs producing identical
  data still produce different bytes.

Check a GeoPackage by hashing its *content* — attributes sorted by SIRUTA, plus geometry
WKB — not the file. A changed `.gpkg` checksum on its own means nothing.

## Data sources

| Layer | Source |
|---|---|
| UAT boundaries | ANCPI geoportal, fallback OSM `admin_level=8` |
| Population | INS, Census 2021 (provisional, 1 Dec 2021) |
| Commune seats | SIRUTA `reședință de comună` + OSM `place=village/town` coordinates |
| Roads | OSM Romania extract (Geofabrik) |
| Budget execution | Ministerul Finanțelor, COFOG3 reports |

**SIRUTA is the join key for everything.** Codes have changed over time, INS and MF use
different vintages, and some UATs have split or renamed. The pipeline builds an explicit
crosswalk with a documented resolution for every mismatch and **fails loudly on unmatched
rows** rather than dropping them. A silent drop here becomes a hole in the map that nobody
notices for weeks.

Source data is public (ANCPI / INS / MF / OSM). See [`docs/PRIOR_ART.md`](docs/PRIOR_ART.md)
for what was reused and under which licence.

## Development

```bash
# Pipeline
uv sync
uv run ruff check pipeline tests
uv run pytest

# Web
cd web && npm install
npm run typecheck && npm run lint && npm test
```

## Licence

Code: [Apache-2.0](LICENSE).
Data artefacts derive from public sources; see `docs/PRIOR_ART.md` for per-source terms.
