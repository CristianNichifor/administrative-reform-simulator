# Data-quality report — geometry and the SIRUTA join

Generated 2026-08-26T18:55:52+00:00 by `pipeline/build_geometry.py`.

| Check | Status | Detail |
|---|---|---|
| `exterior_segments` | pass | 263 of 9644 segments lie on the national border (one side outside Romania) and are excluded from adjacency |
| `self_loops` | pass | 0 segments where both sides are the same UAT |
| `pair_dissolve` | pass | 9381 interior segments dissolved into 9281 unique adjacent pairs |
| `edge_count` | pass | 9281 edges (brief anticipates ~8,000-9,000) |
| `pair_siruta_known` | pass | 0 SIRUTA codes in the boundary layer that are not in the UAT set |
| `cross_county_edges` | pass | 1349 of 9281 edges cross a county line (kept in the graph; the model rejects them during accretion) |
| `road_segments` | pass | 162,347 road features loaded from OSM |
| `parallel_roads_rejected` | pass | 12,375 road/border matches fell inside the 50 m buffer but did not enter both UATs, and were rejected as parallel rather than crossing |
| `road_crossing_rate` | pass | 5934 of 9281 shared borders are crossed by a road (63.9%), buffer 50 m |
| `water_separated_fallback` | pass | 0 UATs have no road-connected neighbour and fall back to plain shared-border adjacency, enabling 0 edges |
| `uats_without_any_neighbour` | pass | 0 UATs share no border with any other UAT |
| `uats_without_road_neighbour` | pass | 0 UATs have no road-connected neighbour (threshold 10); these can neither absorb nor be absorbed |
| `degree_distribution` | pass | neighbours per UAT: min=1, median=6, max=14 |
