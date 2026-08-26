# Administrative Reform Simulator (Romania)

An interactive map of Romania's 3,186 UATs (unități administrativ-teritoriale) that
simulates administrative consolidation under a **deterministic gravitational accretion
model**. Move the sliders — radii, population thresholds, seeds per county — and the map
recomputes immediately.

> **This is a tool for public debate, not an official proposal.**
> It is an analysis instrument. It does not represent a government position, and no
> scenario it produces is a recommendation.

## Status

Early. The data pipeline is being built. The frontend has not been started, deliberately —
see [Build order](#build-order).

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
- [ ] `fetch.py` + `build_geometry.py` + data-quality report on boundaries and the SIRUTA join
- [ ] `build_adjacency.py` — adjacency with road-crossing flags **(verification gate)**
- [ ] `build_candidacy.py` — precomputed overlap fractions per radius **(verification gate)**
- [ ] `reference_model.py` — Python implementation of the algorithm
- [ ] TypeScript port + parity tests
- [ ] Frontend

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

# Web (not yet scaffolded)
cd web && npm install && npm run dev
```

## Licence

Code: [Apache-2.0](LICENSE).
Data artefacts derive from public sources; see `docs/PRIOR_ART.md` for per-source terms.
