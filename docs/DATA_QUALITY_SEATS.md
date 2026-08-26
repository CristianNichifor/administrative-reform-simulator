# Data-quality report — geometry and the SIRUTA join

Generated 2026-08-26T18:40:33+00:00 by `pipeline/build_geometry.py`.

| Check | Status | Detail |
|---|---|---|
| `seat_overrides_applied` | pass | 1 manual seat corrections applied |
| `seats_snapped_into_uat` | pass | 1 seats lay outside their own UAT and were snapped onto it (the locality and boundary layers disagree at a few edges) |
| `seat_count` | pass | 3186 seats for 3186 UATs |
| `seat_source_mix` | pass | centroid=6, name=226, name_prefix=1, name_prefix_ambiguous=3, override=1, rank=2947, rank+snapped=1, sole_locality=1 |
| `centroid_fallbacks` | pass | 6 UATs fell back to a polygon representative point (expected: exactly the 6 Bucharest sectors, which have no SIRUTA localities) |
| `seat_geometry_present` | pass | 0 seats with no geometry |
| `seat_inside_own_uat` | pass | 0 seats fall outside the UAT they belong to |
| `seat_uniqueness` | pass | 0 UATs share a seat locality with another UAT |
| `seat_vs_centroid_offset` | pass | seat-to-centroid distance: median=1,987 m, p90=4,865 m, max=18,974 m (the brief's reason for not using centroids) |
| `seats_needing_review` | pass | 4 seats rest on a deterministic tiebreak rather than evidence, and should be confirmed via pipeline/seat_overrides.csv |

## Offending rows

### `seat_overrides_applied`

```json
[
  {
    "siruta": "100326",
    "seat": "Hărmăneștii Vechi",
    "note": "Comuna Harmanesti (IS): the seat is Harmanestii Vechi, not Harmanestii Noi. The commune was re-established in 2004 out of Todiresti, after this SIRUTA vintage, so all three villages still carry rank V and the automatic tiebreak picked the lower code. https://ro.wikipedia.org/wiki/Comuna_H%C4%83rm%C4%83ne%C8%99ti,_Ia%C8%99i"
  }
]
```

### `seats_snapped_into_uat`

```json
[
  {
    "siruta": "114382",
    "name": "SÂNCRAIU DE MUREȘ",
    "seat": "Sâncraiu de Mureș",
    "moved_m": 704.7
  }
]
```

### `centroid_fallbacks`

```json
[
  {
    "siruta": "179141",
    "name": "SECTORUL 1",
    "county": "B"
  },
  {
    "siruta": "179150",
    "name": "SECTORUL 2",
    "county": "B"
  },
  {
    "siruta": "179169",
    "name": "SECTORUL 3",
    "county": "B"
  },
  {
    "siruta": "179178",
    "name": "SECTORUL 4",
    "county": "B"
  },
  {
    "siruta": "179187",
    "name": "SECTORUL 5",
    "county": "B"
  },
  {
    "siruta": "179196",
    "name": "SECTORUL 6",
    "county": "B"
  }
]
```

### `seats_needing_review`

```json
[
  {
    "siruta": "130366",
    "uat": "SÂRBII - MĂGURA",
    "picked": "Vitănești",
    "county": "OT",
    "rule": "sole_locality"
  },
  {
    "siruta": "60455",
    "uat": "ORAȘ EFORIE",
    "picked": "Eforie Sud",
    "county": "CT",
    "rule": "name_prefix_ambiguous"
  },
  {
    "siruta": "86487",
    "uat": "PORUMBENI",
    "picked": "Porumbenii Mari",
    "county": "HR",
    "rule": "name_prefix_ambiguous"
  },
  {
    "siruta": "179917",
    "uat": "RÂU ALB",
    "picked": "Râu Alb de Jos",
    "county": "DB",
    "rule": "name_prefix_ambiguous"
  }
]
```

