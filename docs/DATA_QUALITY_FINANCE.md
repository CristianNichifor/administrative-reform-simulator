# Data-quality report — geometry and the SIRUTA join

Generated 2026-08-26T18:58:28+00:00 by `pipeline/build_geometry.py`.

| Check | Status | Detail |
|---|---|---|
| `source_rows` | pass | 3228 UAT-level rows returned for 2024, one column per expense type (functionare, dezvoltare) |
| `national_total` | pass | 164.7 bn RON total expenditure (109.4 operating + 55.2 development); plausible band 100-250 bn |
| `operating_share` | pass | operating is 66.5% of total expenditure |
| `uats_without_finance` | pass | 0 UATs have no budget row and would show a savings figure of zero |
| `finance_rows_outside_uat_set` | pass | 42 budget rows dropped as not-a-UAT — expected to be the 42 county-level rows, including Municipiul București, which is reported separately from its six sectors and would otherwise double-count the city |
| `per_capita_outliers` | pass | 0 UATs spend over 100,000 RON per head (median is 2,521) |
| `no_negative_expenditure` | pass | 0 UATs report negative expenditure |
| `zero_operating_expenditure` | pass | 0 UATs report no operating expenditure; these contribute nothing to any savings figure |
