"""Generate the parity fixtures the TypeScript port is tested against (brief §7).

The two implementations must produce **identical** region assignments across a matrix of
parameter combinations. If they diverge, the TypeScript port is wrong — this file is the
authority.

Assignments are compared by hash rather than stored in full, because 24 cases x 3,186 UATs
of raw assignment is a fixture nobody will ever read and every diff will be unreadable. The
default case is additionally stored in full, so that when a hash does mismatch there is
something concrete to diff against rather than a bare "they differ".

Usage:
    uv run python -m pipeline.make_parity_fixtures
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict

from pipeline.paths import REPO_ROOT
from pipeline.reference_model import Params, load_data, run

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "parity_cases.json"

# A matrix chosen to exercise every branch, not just to be numerous: each parameter is
# moved to both ends of its range, and the combinations at the end push several at once.
CASES: tuple[Params, ...] = (
    Params(),
    # Absorber threshold across its full range.
    Params(x=5_000),
    Params(x=7_500),
    Params(x=10_000),
    Params(x=25_000),
    Params(x=50_000),
    # Radii, including the degenerate equal-radius case.
    Params(r_cap_m=5_000, r_town_m=5_000),
    Params(r_cap_m=30_000, r_town_m=30_000),
    Params(r_cap_m=30_000, r_town_m=5_000),
    Params(r_cap_m=10_000, r_town_m=20_000),  # town reach exceeding capital reach
    # Minimum seeds per county — drives the greedy promotion loop and its relaxation.
    # The compactness floor, which changes growth, merging and rebalancing at once and would
    # otherwise be the only rule in the model with no parity case behind it.
    Params(min_compactness=0.20),
    Params(min_compactness=0.30),
    Params(n_min=1),
    Params(n_min=10),
    Params(n_min=10, r_sep_m=30_000),  # forces R_sep relaxation
    Params(n_min=10, r_sep_m=0),  # separation constraint disabled
    # Overlap threshold, including the extremes where the seat rule does all the work.
    Params(min_overlap=0.0),
    Params(min_overlap=0.5),
    Params(min_overlap=0.5, r_cap_m=30_000, r_town_m=30_000),
    # Orphan tier off, minimal, and at its ceiling.
    Params(p_orphan=0),
    Params(p_orphan=1_000),
    Params(p_orphan=15_000),
    # Several parameters at once, which is where ordering bugs surface.
    Params(x=50_000, r_cap_m=30_000, r_town_m=30_000, n_min=10, p_orphan=15_000),
    Params(x=5_000, r_cap_m=5_000, r_town_m=5_000, n_min=1, p_orphan=0),
    Params(
        x=10_000,
        r_cap_m=20_000,
        r_town_m=15_000,
        n_min=7,
        r_sep_m=20_000,
        min_overlap=0.25,
        p_orphan=10_000,
    ),
    Params(
        x=30_000,
        r_cap_m=12_500,
        r_town_m=7_500,
        n_min=3,
        r_sep_m=5_000,
        min_overlap=0.05,
        p_orphan=2_500,
    ),
    # Minimum resulting population, which runs after everything else and is the step most
    # able to reshape the map, so it is exercised across its range and in combination.
    Params(p_target=10_000),
    Params(p_target=20_000),
    Params(p_target=50_000),
    Params(p_target=100_000),
    Params(p_target=50_000, p_orphan=0),
    Params(p_target=50_000, r_cap_m=30_000, r_town_m=30_000),
    Params(x=5_000, p_target=25_000, n_min=10),
)


def canonical_assignment(order: list[str], region_of: dict[str, str]) -> list[int]:
    """Assignment as region-absorber indices, in canonical UAT order.

    Indices rather than SIRUTA strings, so the fixture compares the same thing the
    TypeScript model computes natively.
    """
    index_of = {siruta: i for i, siruta in enumerate(order)}
    return [index_of[region_of[siruta]] for siruta in order]


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__).parse_args(argv)

    data = load_data()
    order = sorted(data.population)

    cases = []
    for params in CASES:
        result, summary = run(data, params)
        assignment = canonical_assignment(order, result.region_of)
        digest = hashlib.sha256(",".join(map(str, assignment)).encode()).hexdigest()
        cases.append(
            {
                "params": asdict(params.snapped()),
                "regions": summary["regions"],
                "seeds": summary["seeds"],
                "orphanRegions": summary["orphan_regions"],
                "unassigned": summary["unassigned"],
                "belowTarget": summary["below_target"],
                # Rounded: the two languages will not agree on the last bits of a float
                # sum, and disagreeing about a rounding artefact is not a parity failure.
                "savingsAdminRon": round(summary["savings_admin_ron"], 2),
                "savingsOperatingRon": round(summary["savings_operating_ron"], 2),
                "assignmentSha256": digest,
            }
        )
        print(f"  {digest[:12]}  regions={summary['regions']:5d}  {params}")

    default_result, _ = run(data, Params())
    payload = {
        "generatedBy": "pipeline/make_parity_fixtures.py",
        "uatOrder": order,
        "cases": cases,
        # Full assignment for the default case only, so a hash mismatch has something
        # diffable behind it.
        "defaultAssignment": canonical_assignment(order, default_result.region_of),
    }

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nWrote {FIXTURE} ({FIXTURE.stat().st_size / 1024:.0f} KB, {len(cases)} cases)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
