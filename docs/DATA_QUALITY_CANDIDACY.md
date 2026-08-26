# Data-quality report — geometry and the SIRUTA join

Generated 2026-08-26T18:43:35+00:00 by `pipeline/build_geometry.py`.

| Check | Status | Detail |
|---|---|---|
| `county_capitals_present` | pass | 41 of 41 county capitals matched by SIRUTA |
| `absorber_count` | pass | 686 potential absorbers (brief estimates ~700; floor is population >= 5,000 plus all capitals and the 6 Bucharest sectors) |
| `capitals_below_population_floor` | pass | 0 absorbers are included despite being under the floor, because they are county capitals or Bucharest sectors |
| `cross_county_pairs_dropped` | pass | 98,101 candidate pairs dropped because the model forbids cross-county merges |
| `negligible_pairs_dropped` | pass | 4,732 pairs dropped as sliver contacts: overlap quantises to below 0.005 and the seat is outside |
| `grid_size` | pass | 213,633 entries across 11 radii (brief estimates ~230k) |
| `overlap_fraction_range` | pass | overlap fraction min=0.00, max=1.00 |
| `monotonic_in_radius` | pass | candidate count is non-decreasing as radius grows (6,702 at 5 km to 32,440 at 30 km) |
| `absorbers_with_no_candidates` | pass | 0 absorbers reach no UAT even at 30 km |
| `reach_distribution` | pass | at 30 km an absorber reaches min=5, median=45, max=94 UATs |
| `seat_rule_contribution` | pass | 207 pairs qualify only via the seat-point rule at the default min_overlap of 0.10 — this is what that rule buys |
