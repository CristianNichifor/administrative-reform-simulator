"""Property and snapshot tests for the reference model (brief §7).

These run against the real built artefacts, so they are skipped when the pipeline has not
been run. That is deliberate: a property test on synthetic geometry would pass while the
national map was wrong.
"""

from __future__ import annotations

import pytest

from pipeline.paths import PROCESSED_DIR
from pipeline.reference_model import Params, load_data, run

REQUIRED = [
    PROCESSED_DIR / "uat_geometry.gpkg",
    PROCESSED_DIR / "uat_seats.gpkg",
    PROCESSED_DIR / "adjacency.parquet",
    PROCESSED_DIR / "candidacy.parquet",
    PROCESSED_DIR / "finance.parquet",
]

pytestmark = pytest.mark.skipif(
    not all(p.exists() for p in REQUIRED),
    reason="pipeline artefacts not built; run the pipeline first",
)

# The default scenario, pinned. Brief §7: any change to the region count is a deliberate
# decision, never an accident. If this fails, work out which rule changed before updating it.
#
# Was 682 while conflicts were resolved by processing order. Now 658, because a commune
# joins the centre nearest to it by road rather than whichever centre happened to be
# processed first.
SNAPSHOT_DEFAULT_REGIONS = 658
SNAPSHOT_DEFAULT_UATS = 3186


@pytest.fixture(scope="module")
def data():
    return load_data()


@pytest.fixture(scope="module")
def default_run(data):
    return run(data, Params())


class TestSnapshot:
    def test_default_scenario_region_count(self, default_run) -> None:
        _, summary = default_run
        assert summary["uats"] == SNAPSHOT_DEFAULT_UATS
        assert summary["regions"] == SNAPSHOT_DEFAULT_REGIONS

    def test_default_scenario_leaves_nothing_unassigned(self, default_run) -> None:
        _, summary = default_run
        assert summary["unassigned"] == 0


class TestProperties:
    def test_every_uat_belongs_to_exactly_one_region(self, data, default_run) -> None:
        result, _ = default_run
        members = [m for region in result.members.values() for m in region]
        assert len(members) == len(data.population)
        assert len(set(members)) == len(members), "a UAT appears in two regions"

    def test_no_region_spans_two_counties(self, data, default_run) -> None:
        result, _ = default_run
        offenders = {
            absorber: {data.county[m] for m in region}
            for absorber, region in result.members.items()
            if len({data.county[m] for m in region}) > 1
        }
        assert not offenders

    def test_every_region_is_connected(self, data, default_run) -> None:
        """A region must be walkable end to end without leaving it.

        This is what makes the map defensible: a region that is two disconnected blobs
        sharing a name is not a plausible administrative unit, however good its score.
        """
        result, _ = default_run
        for absorber, region in result.members.items():
            wanted = set(region)
            seen = {region[0]}
            stack = [region[0]]
            while stack:
                current = stack.pop()
                for neighbour in data.neighbours.get(current, ()):
                    if neighbour in wanted and neighbour not in seen:
                        seen.add(neighbour)
                        stack.append(neighbour)
            assert seen == wanted, f"region {absorber} is disconnected"

    def test_absorber_is_a_member_of_its_own_region(self, default_run) -> None:
        result, _ = default_run
        for absorber, region in result.members.items():
            assert absorber in region

    def test_running_twice_gives_identical_output(self, data) -> None:
        first, first_summary = run(data, Params())
        second, second_summary = run(data, Params())
        assert first.region_of == second.region_of
        assert first_summary["regions"] == second_summary["regions"]
        assert first_summary["savings_admin_ron"] == second_summary["savings_admin_ron"]


class TestMinimumTargetPopulation:
    def test_off_by_default(self, default_run) -> None:
        _, summary = default_run
        assert summary["params"].p_target == 0
        assert summary["below_target"] == 0

    def test_raising_the_target_never_increases_regions(self, data) -> None:
        counts = [run(data, Params(p_target=t))[1]["regions"] for t in (0, 10_000, 50_000)]
        assert counts == sorted(counts, reverse=True)

    def test_units_below_target_have_no_same_county_neighbour(self, data) -> None:
        # A unit may finish under the target, but only because every neighbour it has lies
        # across a county line. If one had a same-county neighbour and still finished short,
        # the consolidation loop stopped early.
        result, _ = run(data, Params(p_target=50_000))
        for absorber, members in result.members.items():
            population = sum(data.population[m] for m in members)
            if population >= 50_000:
                continue
            neighbours = {
                result.region_of[n]
                for m in members
                for n in data.neighbours.get(m, ())
                if data.county[n] == data.county[m]
            }
            assert neighbours <= {absorber}, f"{absorber} could still have merged"

    @pytest.mark.parametrize("target", [10_000, 50_000, 100_000])
    def test_consolidation_never_crosses_a_county(self, data, target: int) -> None:
        # The step most likely to leak across county lines, because it merges whole units
        # rather than individual communes.
        result, _ = run(data, Params(p_target=target))
        for members in result.members.values():
            assert len({data.county[m] for m in members}) == 1


class TestParameterResponse:
    def test_raising_the_threshold_never_increases_seeds(self, data) -> None:
        # A higher population bar can only remove tier-1 seeds, though promotion may add
        # some back, so seeds must not grow faster than the bar falls.
        low = run(data, Params(x=10_000))[1]
        high = run(data, Params(x=30_000))[1]
        assert high["seeds"] <= low["seeds"]

    def test_disabling_the_orphan_tier_leaves_uats_unmerged(self, data) -> None:
        # With P_orphan at 0 the orphan step is off entirely, so everything the absorbers
        # did not reach survives as its own region and the region count rises.
        with_orphans = run(data, Params())[1]
        without = run(data, Params(p_orphan=0))[1]
        assert without["regions"] > with_orphans["regions"]
        assert without["orphan_regions"] == 0

    def test_larger_radii_never_produce_more_regions(self, data) -> None:
        # A bigger buffer strictly contains a smaller one, so absorbers can only reach
        # further. More reach cannot mean more regions.
        tight = run(data, Params(r_cap_m=10_000, r_town_m=5_000))[1]
        wide = run(data, Params(r_cap_m=30_000, r_town_m=30_000))[1]
        assert wide["regions"] <= tight["regions"]

    def test_savings_are_never_negative(self, data) -> None:
        for params in (Params(), Params(x=5_000), Params(x=50_000)):
            summary = run(data, params)[1]
            assert summary["savings_admin_ron"] >= 0
            assert summary["savings_operating_ron"] >= summary["savings_admin_ron"]
