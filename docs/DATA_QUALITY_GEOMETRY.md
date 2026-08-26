# Data-quality report — geometry and the SIRUTA join

Generated 2026-08-26T16:20:51+00:00 by `pipeline/build_geometry.py`.

| Check | Status | Detail |
|---|---|---|
| `crs` | pass | 3844 (expected EPSG:3844); units=metre |
| `feature_count` | pass | 3186 features (expected 3186) |
| `geometry_validity` | pass | 0 invalid geometries (threshold 0) |
| `geometry_non_empty` | pass | 0 empty or null geometries |
| `implausibly_small_uats` | pass | 0 UATs under 0.5 km2 (min=1.41 km2, median=61.2 km2) |
| `total_area` | pass | 238,397 km2 (Romania is ~238,400 km2) |
| `siruta_duplicates_boundaries` | pass | 0 duplicate SIRUTA in boundaries |
| `siruta_duplicates_attributes` | pass | 0 duplicate SIRUTA in attributes |
| `siruta_join` | pass | 0 boundary-only, 0 attribute-only (threshold 0) |
| `county_agreement` | pass | 0 UATs where the two sources disagree on county (threshold 0) |
| `county_codes_known` | pass | 0 unrecognised county codes |
| `county_coverage` | pass | 42/42 counties represented |
| `population_present` | pass | 0 UATs with missing or non-positive population |
| `population_total` | pass | 19,053,815 (Census 2021 resident population was ~19.05 million) |
| `absorbers_at_pop_5000` | pass | 686 UATs at or above 5,000 population |
| `absorbers_at_pop_15000` | pass | 134 UATs at or above 15,000 population |
| `absorbers_at_pop_50000` | pass | 47 UATs at or above 50,000 population |
