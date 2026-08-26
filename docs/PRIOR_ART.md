# Prior art — what is actually reusable

Investigated 2026-08-26, before any data-fetching code was written, per the project brief §6/§9.

**Summary:** one of the two leads is a large win, the other is a dead end.

- **Transparenta.eu (`hack-for-facts-eb-*`)** — Apache-2.0, public, actively maintained.
  Its budget-execution data model already contains the SIRUTA-keyed UAT table *and* the
  operating-vs-development expenditure split this project's savings metric needs.
  This removes most of the reason `build_finance.py` looked expensive.
- **`reformaadm`** — the site is live, but **the source repository is not public**, contrary
  to the brief's assumption. Nothing is reusable from it. The data work is not pre-done.

---

## 1. Transparenta.eu — `ClaudiuBogdan/hack-for-facts-eb-*`

| Repo | Licence | Language | Last push | Relevance |
|---|---|---|---|---|
| `hack-for-facts-eb-server` | **Apache-2.0** | TypeScript | 2026-08-26 | **High** — the data model |
| `hack-for-facts-eb-client` | **Apache-2.0** | TypeScript | 2026-08-25 | Medium — scaffold, i18n |
| `transparenta-eu-ins-loader` | **MIT** | TypeScript | 2026-02-05 | Medium — INS ingestion |
| `hack-for-facts-eb-maintenance` | *none stated* | HTML | 2026-02-11 | None — a maintenance page |

All licences are permissive and compatible with this project's Apache-2.0. No permission
needed to reuse code from the first three, subject to attribution and NOTICE requirements.

### 1.1 The find: `eb-server` already models what we need

`src/infra/database/budget/schema.sql` contains a `UATs` dimension table keyed exactly the
way this project needs:

```sql
CREATE TABLE UATs (
    id SERIAL PRIMARY KEY,
    uat_key VARCHAR(35) NOT NULL,     -- county name + uat name
    uat_code VARCHAR(20) UNIQUE NOT NULL,   -- CIF, from uat_cif_pop_2021.csv
    siruta_code VARCHAR(20) UNIQUE NOT NULL,-- SIRUTA, from uat_cif_pop_2021.csv
    name TEXT NOT NULL,
    county_code VARCHAR(2) NOT NULL,
    county_name VARCHAR(50) NOT NULL,
    region VARCHAR(50) NOT NULL,
    population INT CHECK (population >= 0),
    ...
);
```

That is the entire attribute layer from the brief's size budget — population, county, name,
SIRUTA — already assembled and, critically, **already reconciled between SIRUTA and CIF**.
The source file is named `uat_cif_pop_2021.csv`, i.e. the 2021 census vintage the brief
specifies.

The one thing it does not contain is **geometry**. Boundaries and seat points remain ours to
build. That is expected — `eb-server` is a finance API, not a geospatial one.

### 1.2 The second find: the expenditure split is already in the schema

The brief's savings metric is:

> `Σ operating_expenditure(all members) − operating_expenditure(absorber)`
> Development/investment spending is excluded — merging doesn't eliminate it.

`eb-server` models precisely this distinction as a first-class enum on the fact table:

```sql
CREATE TYPE expense_type AS ENUM (
    'dezvoltare',    -- development
    'functionare'    -- operational
);
```

So the savings metric reduces to summing `ExecutionLineItems` where
`expense_type = 'functionare'`, grouped by entity, joined to `UATs.siruta_code`. We do not
have to derive the operating/development split ourselves from COFOG3 economic codes, which
was the genuinely tedious part.

Also present and useful:

- `FunctionalClassifications` — COFOG functional codes.
- `EconomicClassifications` — economic classification codes.
- `Entities` — 13,000+ reporting entities, with `is_uat` flag and `uat_id` FK, plus
  `main_creditor_1_cui` / `main_creditor_2_cui` for the ordonator hierarchy. This matters:
  a UAT's budget is reported by an *entity* (CUI), not by the UAT directly, and subordinate
  institutions report separately. `is_uat` plus the creditor chain is how we avoid
  double-counting a commune's spending when we aggregate.
- `ExecutionLineItems` — the fact table, partitioned by `(year, month, report_type)`.
- `report_type` enum distinguishes aggregated-at-principal-ordonator from detailed reports.
  **We must pick one and be consistent**, or we will double-count. See open questions.

### 1.3 Access route

`eb-server` exposes a **GraphQL API** (Fastify + Mercurius over PostgreSQL 16), with a
dedicated `uat` module (`src/modules/uat/shell/graphql/schema.ts`) exposing a `UAT` type with
`siruta_code`, `population`, `county_code`, `county_name`, `region`, and a `UATFilterInput`
supporting filtering by county. There is also a `uat-analytics` module with heatmap queries
and a `normalization` module with a `population-repo`.

There are three possible routes to the finance data, in decreasing order of preference:

1. **Query the public API** at transparenta.eu (live, HTTP 200) at build time, cache the
   response in `data/raw/`. Cheapest. Needs a stable public endpoint and courtesy rate
   limiting — this is someone else's server and we would be a heavy anonymous client.
2. **Stand up `eb-server` locally** from its Apache-2.0 source and load MF data with its own
   loader. Reproducible, no dependence on their uptime, but drags in PostgreSQL + Redis as
   pipeline build dependencies, which conflicts with the brief's "reproducible from
   `fetch.py` on a clean machine".
3. **Reuse only the schema as documentation** and parse MF COFOG3 reports ourselves, using
   their `expense_type` mapping as the specification for the operating/development split.
   Most work, fewest dependencies, and still a large saving over deriving the split blind.

**Recommendation: (1) with (3) as the documented fallback**, and the raw response committed
to `data/raw/` cache so the build stays reproducible even if the API changes. Route (2) is
the wrong shape for a pipeline that must run on a clean machine.

**This needs a decision before `build_finance.py`** — see open questions.

### 1.4 `transparenta-eu-ins-loader` (MIT)

Separate repo, MIT-licensed, dedicated to loading INS statistical data. Ships a documented
INS API specification (`docs/INS_SPEC/INS_API_SPEC.md`), a CLI, and — notably —
`docs/TERRITORY_SYNC_ANALYSIS_REPORT.md`, `docs/territory-sync-key-findings.md` and
`docs/TERRITORY_SYNC_INVESTIGATION.md`.

Those three documents are about reconciling INS territorial codes, which is exactly the
"single most annoying part of the project" the brief warns about. Worth reading in full
before writing the SIRUTA crosswalk — someone has already mapped this minefield and written
down where the mines are. `eb-server` additionally carries
`.claude/decisions/active/ins-county-data-investigation.md` on the same subject.

### 1.5 `eb-client` (Apache-2.0)

React + TS + Vite + Tailwind + shadcn + TanStack Router/Query + GraphQL + Lingui.
Tables-and-charts public-finance explorer. **No map code, no geospatial logic**, as the brief
predicted.

Assessment: **do not fork it.** The brief specifies no React for v1 — one map, one panel, a
slider tray — and adopting this scaffold would import a router, a query layer, a component
library and a GraphQL client to render a page that makes no runtime network calls at all.
That is a direct conflict with the client-side/GitHub-Pages constraint.

Worth borrowing selectively, as reference rather than dependency:
- the **Lingui i18n setup** (RO/EN from day one), if we want a mature i18n layer;
- the **normalization vocabulary** (per-capita, inflation-adjusted, EUR) — if our
  savings figures use the same language as theirs, the two tools stay comparable;
- the **"no floats" discipline** — `eb-server` stores all monetary values as strings and
  parses with `decimal.js`. Our savings figures should adopt the same rule.

---

## 2. `reformaadm` — dead end for code, useful as context

**The source repository is not public.** The brief expected it would be:

> "It is a GitHub Pages project site on a personal account, so the source repo is very likely
> public. […] **Check it first.**"

Checked. It is not:

- `https://cosettechichirau.github.io/reformaadm/` → **HTTP 200**, the site is live.
- `gh api users/cosettechichirau` → the account exists but reports **`public_repos: 0`**.
- `gh search repos "reformaadm"` → no results. Same for `companiipublice`.

So the repo is private, deleted, or the site is published from a private source. Either way
there is **no code and no cleaned dataset to inspect**, and the hoped-for shortcut — "if it
contains cleaned UAT GeoJSON joined to SIRUTA + census population + 2025 budget execution,
that is most of the data work already done" — **is not available**. Assume the geometry and
join work is entirely ours. That is the single biggest correction to the brief's assumptions.

### 2.1 What the live site tells us anyway

From the public page (read only; nothing downloaded, nothing copied):

- It covers the same 3,186 UATs, with **INS 2021 census** population and **2025 budget
  execution**, boundaries from **ANCPI geoportal** — confirming the brief's source list is
  the right one and that this combination is achievable.
- Its budget breakdown is **income tax collected, own revenues, operating expenses
  (salaries, goods, services, social assistance), development expenses (fixed assets,
  European/PNRR financing)**. The operating-vs-development split again, matching
  `eb-server`'s `functionare`/`dezvoltare` enum. Two independent projects converging on the
  same split is good evidence our savings metric is defined the conventional way.
- Its merger scenario uses **Max-P Regionalization** to reach 1,333 units (58% reduction)
  at a 5,000-resident threshold.

That last point is worth stating plainly, because it defines this project's reason to exist.
**Max-P is explicitly a non-goal here** (brief §8). `reformaadm` optimizes; we accrete
deterministically. Their map will score better on compactness and population balance; ours
can be re-derived by hand from a paragraph of rules and disputed by a mayor line by line.
When we publish, that contrast is the argument, and `reformaadm` is the thing to contrast
*against* — not a competitor to quietly duplicate.

Useful calibration: their 5,000-threshold scenario yields **1,333 regions**. When our
`P_orphan = 5,000` default produces a number, a wildly different one is a signal to check our
work, not automatically a finding.

### 2.2 Flagged for permission

Nothing to flag. There is no accessible source to copy from. If the repository becomes
public, the item worth revisiting is whether their ANCPI boundary cleaning and SIRUTA join
can be reused — but per the brief, the *data* is reusable regardless of their licence, since
ANCPI/INS/MF are public sources, and only their *code* would need permission.

---

## 3. Consequences for the plan

**Cheaper than the brief assumed:**
- `build_finance.py` — the operating/development split and the SIRUTA↔CIF reconciliation
  already exist in an Apache-2.0 schema, and possibly behind a live API.
- The SIRUTA crosswalk — `transparenta-eu-ins-loader`'s territory-sync docs are a written
  account of the same problem.

**Unchanged (still entirely ours):**
- All geometry: ANCPI boundaries, EPSG:3844 reprojection, seat points, polygon buffering.
- The adjacency graph and road-crossing flags.
- The candidacy grid.
- The model itself, both implementations, and the parity suite.

**More expensive than the brief assumed:**
- Everything `reformaadm` was hoped to provide. Budget for building the boundary + census
  join from scratch, including the SIRUTA vintage reconciliation, with no reference
  implementation to check against.

## 4. Open questions

1. **Finance access route** — API (1), local `eb-server` (2), or parse MF ourselves (3)?
   Recommendation is (1) with (3) documented as fallback. Blocks `build_finance.py`, not
   the geometry work.
2. **Report-type consistency** — `eb-server`'s `report_type` enum separates aggregated
   (principal/secondary ordonator) from detailed execution. Aggregating the wrong mix
   double-counts. Needs a decision, and the decision needs to be recorded in
   `METHODOLOGY.md` because it materially changes every savings figure.
3. **Attribution** — if we consume Transparenta.eu data or code, Apache-2.0 requires
   attribution and NOTICE propagation. Worth doing visibly and generously in the UI
   regardless of the strict legal minimum; they are the reason the finance layer is cheap.
4. **`X` floor (brief §4, marked DECISION)** — confirm 5,000 as the hard floor for the
   absorber population threshold. Not blocking until `build_candidacy.py`, but it is baked
   into the precomputed grid, so changing it later forces a full rebuild.
