"""Property and snapshot tests for the reference model (brief §7).

These run against the real built artefacts, so they are skipped when the pipeline has not
been run. That is deliberate: a property test on synthetic geometry would pass while the
national map was wrong.
"""

from __future__ import annotations

import math

import pytest

from pipeline.constants import ADMIN_RANK_MUNICIPIU
from pipeline.paths import PROCESSED_DIR
from pipeline.reference_model import (
    BUCHAREST_COUNTY_CODE,
    Params,
    _county_capital,
    _county_road_distances,
    _is_connected,
    equalise,
    load_data,
    run,
)

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
# 682 while conflicts were resolved by processing order; 658 once a commune joined the
# centre nearest by road; 749 once the threshold dropped to 7,500 and the minimum-centres
# fallback stopped promoting communes that had a real centre next door.
SNAPSHOT_DEFAULT_REGIONS = 249
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


def counties_allowed(counties: set[str]) -> bool:
    """Bucharest and its Ilfov ring are the only counties a single unit may span.

    Everything else in the model is county-bound; the capital is the one place where the
    line falls inside the built-up area rather than around it.
    """
    return counties == {"B", "IF"} or len(counties) == 1


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
            if not counties_allowed({data.county[m] for m in region})
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


class TestHeldAbsorbers:
    """Centres bordering their county capital are held back, then judged on their merits."""

    def test_held_centres_stand_inside_a_capital_reach(self, data, default_run) -> None:
        """Held used to mean "borders a capital"; it now means "stands inside its reach".

        Cumpana forced the change: it does not touch Constanta, it reaches the city through
        Agigea, so a border test left it a centre and Eforie took it southwards.
        """
        from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA

        result, _ = default_run
        capitals = {s for s in COUNTY_CAPITAL_SIRUTA if s in data.population}
        assert result.held, "no centre was held at all"
        for absorber in result.held:
            capital = result.reserved_for.get(absorber)
            assert capital is not None, f"{absorber} was held but reserved for nobody"
            assert capital in capitals or data.county[capital] == "B", (
                f"{absorber} was reserved for {capital}, which is not a capital"
            )

    def test_a_failed_hold_is_absorbed_unless_the_cap_forbids_it(self, data, default_run) -> None:
        """A held centre that could not reach the target is absorbed by someone.

        Usually its county capital, which is the point of the rule. But not always: a
        neighbouring held centre that *did* reach the target grows in the same pass and can
        take it first — Dumbrăvița, Ghiroda and Moșnița Nouă all border Timișoara and end up
        in Giroc rather than in the capital. That is the road-distance rule working, so the
        assertion is the one that actually holds: it is absorbed, and by something in its
        own county.
        """
        result, summary = default_run
        max_road = summary["params"].max_road_m
        for absorber, survived in result.held.items():
            if survived:
                continue
            region = result.region_of[absorber]
            assert counties_allowed({data.county[region], data.county[absorber]})
            if region == absorber:
                # Two ways a held centre legitimately keeps its own region.
                #
                # One: it is reserved for a capital whose growth never actually arrived —
                # reservation stops anyone *else* taking it, and if the capital cannot reach
                # it over its own territory the centre simply stands.
                capital = result.reserved_for.get(absorber)
                if capital is not None and result.region_of.get(capital) != absorber:
                    continue
                # Two: folding would have breached the distance cap. A held centre gathers up
                # to the cap from itself, so folding it wholesale can put communes twice the
                # cap from the capital.
                capital = _county_capital(data, data.county[absorber])
                assert capital is not None
                reach = _county_road_distances(data, data.county[absorber], [capital])
                assert any(reach.get(m, math.inf) > max_road for m in result.members[absorber]), (
                    f"{absorber} kept its own region for no reason"
                )

    @pytest.mark.parametrize("target", [0, 25_000, 50_000])
    def test_no_commune_is_assigned_twice(self, data, target: int) -> None:
        # The regression this exists for: a held centre absorbed during pass 2 was folded
        # into its capital again in pass 3, putting its communes in two regions at once.
        result, summary = run(data, Params(p_target=target))
        members = [m for region in result.members.values() for m in region]
        assert len(members) == len(set(members)) == len(data.population)
        assert summary["regions"] == len(result.members)


class TestConsolidationIsLocal:
    """Merging to reach the target must not drag a unit across the county."""

    @pytest.mark.parametrize("target", [25_000, 50_000])
    def test_no_member_outranks_its_own_seat(self, data, target: int) -> None:
        """A unit's seat should be the most significant town in it.

        The regression: choosing the surviving seat by which side had gathered more
        communes made Măcin (7,248) the capital of a unit containing Babadag (9,213). Seats
        are now decided by standing — county capital, then centre, then the larger town.
        """
        result, _ = run(data, Params(p_target=target))
        for seat, members in result.members.items():
            seat_tier = result.seeds.get(seat, 99)
            for member in members:
                if member == seat:
                    continue
                if member not in result.seeds:
                    # A member that was never a centre makes no claim on the seat. Oras
                    # Racari (6,306) sits under Crevedia (8,811) because Crevedia cleared
                    # the population threshold and Racari did not; that is the threshold
                    # doing its job, not a seat chosen wrongly.
                    continue
                # Among members that *were* centres, the seat must have the best standing —
                # the same ordering consolidation uses to pick a survivor.
                member_tier = result.seeds[member]
                assert (
                    data.admin_rank[seat],
                    seat_tier,
                    -data.population[seat],
                ) <= (data.admin_rank[member], member_tier, -data.population[member]), (
                    f"{member} outranks its seat {seat}"
                )

    def test_merged_partner_is_the_nearest_by_road(self, data) -> None:
        """Units should not span a county because of a chain of smallest-first merges.

        Tulcea is the case this exists for: choosing the smallest combined population put
        Măcin into Babadag 60 km away and collapsed 19 units into three.
        """
        result, _ = run(data, Params(p_target=50_000))
        for seat, members in result.members.items():
            if len(members) < 2:
                continue
            county = data.county[seat]
            assert counties_allowed({data.county[m] for m in members} | {county})
            # Every member must be reachable from the seat without leaving the unit, which
            # a cross-county chain of convenience mergers would break.
            wanted = set(members)
            seen = {seat}
            stack = [seat]
            while stack:
                current = stack.pop()
                for neighbour in data.neighbours.get(current, ()):
                    if neighbour in wanted and neighbour not in seen:
                        seen.add(neighbour)
                        stack.append(neighbour)
            assert seen == wanted, f"unit {seat} is not connected"


class TestBucharest:
    def test_the_sectors_form_one_unit(self, data, default_run) -> None:
        result, _ = default_run
        sectors = [s for s in data.population if data.county[s] == "B"]
        assert len(sectors) == 6
        assert len({result.region_of[s] for s in sectors}) == 1

    def test_no_sector_is_a_separate_centre(self, data, default_run) -> None:
        # Six administrations over one continuous city is the duplication being modelled
        # away, so the sectors never compete as centres.
        result, _ = default_run
        sectors = {s for s in data.population if data.county[s] == "B"}
        assert len(sectors & set(result.seeds)) == 1


class TestMinimumTargetPopulation:
    def test_on_by_default(self, default_run) -> None:
        # The target is central to how centres are grown now, not an optional extra: the
        # smaller ones stop absorbing once they reach it.
        _, summary = default_run
        assert summary["params"].p_target == 50_000

    def test_raising_the_target_never_increases_regions(self, data) -> None:
        # Positive targets only. Zero does not mean "a very low target", it means the step is
        # off — and it switches off two things at once, the growth stop as well as the
        # merging. With no growth stop the smaller centres run on and produce *fewer*, larger
        # units than a 10,000 target does, so comparing "off" against "on" is comparing two
        # modes rather than two values.
        counts = [run(data, Params(p_target=t))[1]["regions"] for t in (10_000, 50_000, 100_000)]
        assert counts == sorted(counts, reverse=True), counts

    def test_units_below_target_are_blocked_by_distance_or_isolation(self, data) -> None:
        """A unit may finish under the target, but only for a reason.

        Four reasons are legitimate: it has no same-county neighbour at all, merging with
        every one of them would put some commune beyond the distance cap, every neighbour
        that could take it is a county capital — a capital is finished once it has taken the
        ring that borders it — or its county is already down to the minimum number of units,
        where coverage outranks size and no further merge is allowed at any population.
        Anything else means the consolidation loop stopped early and left a unit smaller
        than it needed to be.

        The county-floor branch covers 31 of the 99 under-target units, so the other 68 must
        still earn their size through distance or isolation. An exemption wide enough to
        absorb every case would leave nothing being tested.
        """
        from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA

        params = Params(p_target=50_000)
        result, _ = run(data, params)

        units_in_county: dict[str, int] = {}
        for unit in result.members:
            county = data.county[unit]
            units_in_county[county] = units_in_county.get(county, 0) + 1

        def standing(unit: str) -> tuple[int, int, str]:
            # Must mirror the model's own ordering, which now leads on administrative rank.
            return (
                data.admin_rank[unit],
                result.seeds.get(unit, 99),
                -data.population[unit],
                unit,
            )

        for absorber, members in result.members.items():
            if sum(data.population[m] for m in members) >= params.p_target:
                continue
            county = data.county[absorber]
            # Bucharest is one city and carries no minimum, so it is not exempt here.
            if county != BUCHAREST_COUNTY_CODE and units_in_county[county] <= params.n_min:
                continue
            neighbours = {
                result.region_of[n]
                for m in members
                for n in data.neighbours.get(m, ())
                if data.county[n] == data.county[m]
            } - {absorber}

            for other in neighbours:
                # Measured from whichever seat survives the merge, which is what the model
                # itself checks — not from whichever unit happens to be initiating.
                keeps = absorber if standing(absorber) <= standing(other) else other
                reach = _county_road_distances(data, data.county[keeps], [keeps])
                everyone = result.members[absorber] + result.members[other]
                if other in COUNTY_CAPITAL_SIRUTA:
                    # A capital takes its ring and stops. This is the whole reason the
                    # capitals were not swallowing half their counties.
                    continue
                assert any(reach.get(m, math.inf) > params.max_road_m for m in everyone), (
                    f"{absorber} could still have merged with {other}"
                )

    @pytest.mark.parametrize("target", [10_000, 50_000, 100_000])
    def test_consolidation_never_crosses_a_county(self, data, target: int) -> None:
        # The step most likely to leak across county lines, because it merges whole units
        # rather than individual communes.
        result, _ = run(data, Params(p_target=target))
        for members in result.members.values():
            assert counties_allowed({data.county[m] for m in members})


class TestParameterResponse:
    def test_raising_the_threshold_never_increases_seeds(self, data) -> None:
        # A higher population bar can only remove tier-1 seeds, though promotion may add
        # some back, so seeds must not grow faster than the bar falls.
        low = run(data, Params(x=10_000))[1]
        high = run(data, Params(x=30_000))[1]
        assert high["seeds"] <= low["seeds"]

    def test_disabling_the_orphan_tier_leaves_uats_unmerged(self, data) -> None:
        # Measured with the population target off, so the orphan tier is the only thing
        # picking up leftovers. With the target on, consolidation mops up the same communes
        # afterwards and both settings land on the same count.
        with_orphans = run(data, Params(p_target=0))[1]
        without = run(data, Params(p_target=0, p_orphan=0))[1]
        assert without["regions"] > with_orphans["regions"]
        assert without["orphan_regions"] == 0

    def test_larger_radii_never_produce_more_regions(self, data) -> None:
        # A bigger buffer strictly contains a smaller one, so centres reach further. Held
        # with the distance cap off, since the cap — not the radius — then decides how far
        # a unit extends, and the two no longer move together.
        tight = run(data, Params(r_cap_m=10_000, r_town_m=5_000, max_road_m=0))[1]
        wide = run(data, Params(r_cap_m=30_000, r_town_m=30_000, max_road_m=0))[1]
        assert wide["regions"] <= tight["regions"]

    def test_savings_are_never_negative(self, data) -> None:
        for params in (Params(), Params(x=5_000), Params(x=50_000)):
            summary = run(data, params)[1]
            assert summary["savings_admin_ron"] >= 0
            assert summary["savings_operating_ron"] >= summary["savings_admin_ron"]


class TestCapitalRing:
    """A capital holds what it is nearest to, and gives up what it is not.

    The rule has been rewritten twice. It began as an area-overlap radius, which let
    Timisoara reach 30 km and sprawl; that was replaced by "the communes sharing a border
    with me", which threw road distance out entirely and left Calarasi — three land
    neighbours because of the Danube — unable to take Roseti 9.9 km away while Dragalina took
    it from 45.4 km. It is now the radius measured along roads, with nearest-by-road settling
    anything beyond it.
    """

    def test_a_capital_keeps_what_it_is_nearest_to(self, data, default_run) -> None:
        from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA

        result, summary = default_run
        target = summary["params"].p_target
        wrong: list[str] = []
        for capital in sorted(COUNTY_CAPITAL_SIRUTA):
            if capital not in data.population or result.region_of.get(capital) != capital:
                continue
            from_capital = _county_road_distances(data, data.county[capital], [capital])
            for neighbour in data.neighbours.get(capital, ()):
                if data.county[neighbour] != data.county[capital]:
                    continue
                holder = result.region_of[neighbour]
                if holder == capital:
                    continue
                # The national capital's first layer outranks a county capital's proximity.
                # Chitila borders Bucharest and is 9.1 km from Buftea; the city takes it,
                # because "Bucharest absorbs all its first-layer neighbours" is the stronger
                # rule and Buftea is 9 km from a commune that touches the city itself.
                if data.county[holder] == "B":
                    continue
                here = _county_road_distances(data, data.county[holder], [holder])
                if here.get(neighbour, math.inf) <= from_capital.get(neighbour, math.inf):
                    continue  # its own seat is nearer, which is the rule
                # The capital is nearer, so the only reasons to stay are the ones the model
                # states: the unit it would leave falls below the target, or comes apart.
                members = result.members[holder]
                rest = [m for m in members if m != neighbour]
                if not rest or not _is_connected(data, rest):
                    continue
                if target > 0:
                    before = sum(data.population[m] for m in members)
                    if before >= target > before - data.population[neighbour]:
                        continue
                wrong.append(
                    f"{data.name[capital]} should hold {data.name[neighbour]} "
                    f"({from_capital.get(neighbour, math.inf) / 1000:.1f} km vs "
                    f"{here.get(neighbour, math.inf) / 1000:.1f} km)"
                )
        assert wrong == []


class TestCompactness:
    """The shape floor, and the arithmetic it rests on."""

    def test_incremental_shape_matches_the_merged_polygons(self, data, default_run) -> None:
        """The formula must agree with the geometry it replaces.

        A unit's outline is computed from its members' perimeters less twice the borders
        inside it, so the browser never has to carry a polygon. If that arithmetic drifts
        from the real shape, every compactness figure in the tool is wrong and nothing else
        would notice.
        """
        import geopandas as gpd

        from pipeline.constants import CRS_STEREO70
        from pipeline.paths import PROCESSED_DIR
        from pipeline.reference_model import compactness

        result, _ = default_run
        shapes = (
            gpd.read_file(PROCESSED_DIR / "uat_geometry.gpkg", layer="uat")
            .to_crs(CRS_STEREO70)
            .set_index("siruta")
        )
        checked = 0
        for seat in sorted(result.members)[:40]:
            members = result.members[seat]
            if len(members) < 2:
                continue
            merged = shapes.loc[members, "geometry"].union_all()
            expected = 4 * math.pi * merged.area / (merged.length**2)
            assert compactness(data, members) == pytest.approx(expected, abs=1e-6)
            checked += 1
        assert checked >= 10, "too few multi-commune units sampled to prove anything"

    def test_the_floor_reduces_ragged_units(self, data) -> None:
        from pipeline.reference_model import compactness

        loose, _ = run(data, Params(min_compactness=0.0))
        tight, _ = run(data, Params(min_compactness=0.20))
        ragged = lambda r: sum(  # noqa: E731
            1 for members in r.members.values() if compactness(data, members) < 0.20
        )
        assert ragged(tight) < ragged(loose)

    def test_off_by_default_changes_nothing(self, data, default_run) -> None:
        # The floor is opt-in: with it at zero the map must be exactly what it was before
        # the feature existed, or every existing figure in the documentation is stale.
        result, _ = default_run
        explicit, _ = run(data, Params(min_compactness=0.0))
        assert result.region_of == explicit.region_of


class TestLastResort:
    """The pass that places units the distance cap has stranded.

    `consolidate_to_target` refuses a merge that would put any commune beyond the cap. On a
    county border that leaves units of a single commune — Bulzesti, 1,269 people, four of
    its five neighbours in other counties and the fifth over the cap. This pass lets the cap
    yield where nothing legal exists, and nothing else yield at all.
    """

    def test_no_unit_is_left_a_tiny_leftover(self, data) -> None:
        params = Params()
        result, _ = run(data, params)
        tiny = {
            data.name[seat]: sum(data.population[m] for m in members)
            for seat, members in result.members.items()
            if sum(data.population[m] for m in members) < 5_000
        }
        assert tiny == {}, tiny

    def test_it_stays_a_last_resort(self, data) -> None:
        """It must not become a second consolidation pass.

        Applied to every stranded unit rather than only the leftovers it merged 41 units
        instead of 13, chaining Lipova into Podu Turcului into Nicolae Balcescu and
        dissolving Municipiul Vatra Dornei. The two guards that hold it back are the
        population threshold and the requirement that nothing legal was available, so this
        pins the scale that both of them produce.
        """
        result, _ = run(data, Params())
        assert result.last_resort, "the pass did nothing, so the rest proves nothing"
        assert len(result.last_resort) <= 20, {
            data.name[k]: data.name[v] for k, v in result.last_resort.items()
        }
        # Nothing it merged may still be a unit.
        assert not (set(result.last_resort) & set(result.members))

    def test_a_unit_with_a_legal_partner_is_left_to_the_ordinary_rules(self, data) -> None:
        """Having *any* partner inside the cap disqualifies a unit from the last resort.

        Oras Seini (11,949) is the case. Without this check it is dissolved into Municipiul
        Baia Mare — the capital-as-drain failure the consolidation rules exist to prevent.
        With it, Seini stays its own unit and is reported as below target, which is the
        honest outcome: it is small because its options are, not because nothing was tried.
        """
        result, _ = run(data, Params())
        seini = next(s for s in data.population if data.name[s] == "ORAȘ SEINI")
        assert seini not in result.last_resort
        assert result.region_of[seini] == seini, data.name[result.region_of[seini]]

    def test_it_never_crosses_a_county_line(self, data) -> None:
        params = Params()
        result, _ = run(data, params)
        for dropped, keeper in result.last_resort.items():
            assert data.county[dropped] == data.county[keeper], (
                f"{data.name[dropped]} ({data.county[dropped]}) went to "
                f"{data.name[keeper]} ({data.county[keeper]})"
            )

    def test_it_respects_the_county_minimum(self, data) -> None:
        params = Params()
        result, _ = run(data, params)
        counts: dict[str, int] = {}
        for unit in result.members:
            counts[data.county[unit]] = counts.get(data.county[unit], 0) + 1
        short = {c: n for c, n in counts.items() if n < params.n_min and c != BUCHAREST_COUNTY_CODE}
        assert short == {}, short

    def test_it_leaves_units_above_the_threshold_alone(self, data) -> None:
        # A unit the cap has stranded but which is a viable administration is not a leftover.
        # Rescuing those too collapsed Municipiul Vatra Dornei into its neighbour.
        params = Params()
        result, _ = run(data, params)
        for dropped in result.last_resort:
            assert data.admin_rank[dropped] > ADMIN_RANK_MUNICIPIU, (
                f"{data.name[dropped]} is a municipiu and should not be dissolved"
            )

    def test_the_partner_is_chosen_by_shape_not_by_distance(self, data) -> None:
        """Where there is a choice, the better-shaped merge wins.

        At the default threshold every stranded unit has effectively one candidate, so this
        uses a wider one where the choice is real: Oras Baile Herculane's nearest partner is
        Oras Oravita, but merging into Oras Moldova Noua gives the more compact unit.
        """
        params = Params(p_stranded=25_000)
        result, _ = run(data, params)
        herculane = next(s for s in data.population if data.name[s] == "ORAȘ BĂILE HERCULANE")
        keeper = result.last_resort.get(herculane)
        assert keeper is not None, "Baile Herculane was expected to be stranded here"
        assert data.name[keeper] == "ORAȘ MOLDOVA NOUĂ", data.name[keeper]


class TestEqualise:
    """Near-equal distances are decided by what each unit already carries.

    `rebalance` asks only whether another seat is *strictly* nearer, so a metre decides a
    commune that is effectively equidistant from two units. That is a precision the road
    data does not have and a distinction nobody living there could act on, while the
    difference in what the two units carry is the whole question.
    """

    def test_pantelimon_goes_to_the_emptier_of_two_equally_distant_units(self, data) -> None:
        params = Params()
        result, _ = run(data, params)
        pantelimon = next(
            s for s in data.population if data.name[s] == "PANTELIMON" and data.county[s] == "CT"
        )
        seat = result.region_of[pantelimon]
        # 44.5 km to Municipiul Medgidia, 45.8 km to Oras Harsova — 1.3 km apart, and
        # Medgidia carries 109,471 over 1,752 km2 against Harsova's 23,290 over 828.
        assert data.name[seat] == "ORAȘ HÂRȘOVA", data.name[seat]

    def test_it_settles(self, data) -> None:
        """No cycles: running it again on its own output must move nothing.

        Merged into `rebalance` it did cycle. The two converge on different quantities —
        rebalance lowers each commune's distance to its seat, this lowers the spread between
        units — and interleaved they undid each other, 650 communes moving on every sweep
        with the map decided by wherever the sweep cap fell.
        """
        params = Params()
        result, _ = run(data, params)
        assert result.equalised > 0, "the pass did nothing, so this proves nothing"
        assert equalise(data, params, result) == 0

    def test_the_band_off_leaves_the_map_alone(self, data) -> None:
        result, _ = run(data, Params(r_tie_m=0))
        assert result.equalised == 0


class TestSeating:
    def test_a_unit_is_never_seated_below_a_member_in_rank(self, data) -> None:
        """A unit is named after the most significant town in it, always.

        Filtering seat candidates by the distance cap before comparing rank preferred a
        commune that held the cap to a town that did not: Gropeni (3,022) seated a unit
        containing Municipiul Braila (154,686), and Zorleni one containing Oras Murgeni.
        """
        result, _ = run(data, Params())
        wrong = [
            f"{data.name[seat]} (rank {data.admin_rank[seat]}) seats "
            f"{data.name[min(members, key=lambda m: data.admin_rank[m])]}"
            for seat, members in result.members.items()
            if any(data.admin_rank[m] < data.admin_rank[seat] for m in members)
        ]
        assert wrong == [], wrong


class TestCountyMinimum:
    """Every county keeps at least `n_min` units, even where that leaves them under target.

    Coverage outranks size. A county reduced to two units has no administrative geography
    left worth the name however large those two are, so the floor binds first and the
    under-target count is allowed to rise to pay for it.
    """

    def test_every_county_meets_the_minimum(self, data) -> None:
        params = Params()
        result, _ = run(data, params)
        counts: dict[str, int] = {}
        for unit in result.members:
            county = data.county[unit]
            counts[county] = counts.get(county, 0) + 1
        # Bucharest is a single city, not a county that needs a spread of centres.
        short = {c: n for c, n in counts.items() if n < params.n_min and c != BUCHAREST_COUNTY_CODE}
        assert short == {}, f"counties below the minimum of {params.n_min}: {short}"

    def test_the_floor_holds_at_a_target_high_enough_to_flatten_the_country(self, data) -> None:
        # At 200,000 nearly every county would collapse to one or two units on population
        # alone, so this is where a floor that only worked at the default would show itself.
        params = Params(p_target=200_000)
        result, _ = run(data, params)
        counts: dict[str, int] = {}
        for unit in result.members:
            counts[data.county[unit]] = counts.get(data.county[unit], 0) + 1
        short = {c: n for c, n in counts.items() if n < params.n_min and c != BUCHAREST_COUNTY_CODE}
        assert short == {}, f"counties below the minimum at a 200k target: {short}"

    def test_ilfov_reaches_the_minimum_without_taking_bucharests_ring(self, data) -> None:
        """The one county where the floor and the capital ring genuinely compete.

        Ilfov is a doughnut around Bucharest, so the only centres it has to promote are
        communes the city borders. Promotion reached for two of them — Popesti-Leordeni and
        Voluntari — and Ilfov hit five by taking them off Bucharest. The ring is the older
        and stronger rule, so promotion is barred from it and Ilfov finds its five elsewhere.
        """
        params = Params()
        result, _ = run(data, params)
        ilfov = [unit for unit in result.members if data.county[unit] == "IF"]
        assert len(ilfov) >= params.n_min, [data.name[u] for u in ilfov]

        sectors = {s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE}
        bucharest = result.region_of[sorted(sectors)[0]]
        ring = {n for s in sectors for n in data.neighbours.get(s, ())} - sectors
        held_by_the_city = set(result.members[bucharest])
        assert ring <= held_by_the_city, [data.name[s] for s in sorted(ring - held_by_the_city)]
        # And none of Ilfov's centres is a commune the city borders.
        assert not (set(ilfov) & ring), [data.name[u] for u in set(ilfov) & ring]


class TestFirstRing:
    """A centre's own neighbours are its own, and Bucharest is the strictest case.

    Bucharest is represented by its lowest sector, so its first ring used to be *the other
    five sectors*: it spent rounds absorbing itself while Voluntari and Mihailesti took the
    communes around it, and it ended up holding 3 of the 14 communes touching the city and 6
    that did not touch it at all. The rule has to be asserted on the finished map, because
    growth got it right and the rebalancing pass then took 11 of them back.
    """

    def test_bucharest_holds_every_commune_touching_it(self, data, default_run) -> None:
        result, _ = default_run
        sectors = {s for s in data.population if data.county[s] == "B"}
        city = result.region_of[min(sectors)]
        ring = {
            neighbour for sector in sectors for neighbour in data.neighbours.get(sector, ())
        } - sectors
        assert len(ring) >= 10, "the city should border a good many communes"
        missing = sorted(data.name[x] for x in ring - set(result.members[city]))
        assert missing == []

    def test_bucharest_reaches_past_its_ring_to_the_county_line(self, data, default_run) -> None:
        """Extension is the second layer where it meets the county border, and no further.

        The city takes its whole first ring, and then the communes one step beyond it that
        touch another county — the strip between the ring and the edge of Ilfov, which has
        nowhere else to go once the ring is taken. What it must *not* become is a uniform
        second ring: a commune two steps out with no county line on its edge stays outside.
        """
        result, _ = default_run
        sectors = {s for s in data.population if data.county[s] == "B"}
        city = result.region_of[min(sectors)]
        ring = {
            neighbour for sector in sectors for neighbour in data.neighbours.get(sector, ())
        } - sectors
        held = set(result.members[city])
        assert ring <= held, [data.name[s] for s in sorted(ring - held)]

        # Every second-layer commune touching a third county must be held. Derived here
        # rather than read back from the model, so the test states the rule instead of
        # echoing the implementation.
        second_layer = {
            candidate
            for member in ring
            for candidate in data.neighbours.get(member, ())
            # Ilfov only: the second layer also reaches into Giurgiu and Dambovita, and the
            # county rule forbids the city taking those however close they are.
            if candidate not in ring and candidate not in sectors and data.county[candidate] == "IF"
        }
        on_the_border = {
            candidate
            for candidate in second_layer
            if any(
                data.county[other] not in ("IF", "B") for other in data.touching.get(candidate, ())
            )
        }
        assert on_the_border, "no second-layer commune reaches the county line here"
        missing = sorted(on_the_border - held)
        assert missing == [], [data.name[s] for s in missing]

        # And it stops there: nothing two steps out with no county line on its edge.
        strays = [
            data.name[member]
            for member in sorted(held - ring - sectors)
            if member not in on_the_border
            and not any(
                data.county[other] not in ("IF", "B") for other in data.touching.get(member, ())
            )
        ]
        assert strays == [], strays

    def test_every_centre_keeps_its_own_neighbours(self, data, default_run) -> None:
        """Or loses them for one of four stated reasons, never for none."""
        from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA
        from pipeline.reference_model import capital_ring, is_capital_seat

        result, summary = default_run
        params = summary["params"]
        seats = {c for c in result.seeds if result.region_of.get(c) == c}
        unexplained: list[str] = []
        for centre in sorted(seats):
            here = _county_road_distances(data, data.county[centre], [centre])
            for x in data.neighbours.get(centre, ()):
                if data.county[x] != data.county[centre] or result.region_of[x] == centre:
                    continue
                if x in seats:
                    continue  # a centre cannot absorb another centre
                holder = result.region_of[x]
                there = _county_road_distances(data, data.county[holder], [holder])
                if there.get(x, math.inf) <= here.get(x, math.inf):
                    continue  # its holder is nearer, which is the rule
                if is_capital_seat(data, holder) and x in capital_ring(data, params, holder):
                    continue  # a capital's ring outranks a nearer town
                members = result.members[holder]
                rest = [m for m in members if m != x]
                if not rest or not _is_connected(data, rest):
                    continue
                before = sum(data.population[m] for m in members)
                if params.p_target > 0 and before >= params.p_target > before - data.population[x]:
                    continue  # taking it would leave the holder short
                unexplained.append(
                    f"{data.name[centre]} lost {data.name[x]} to {data.name[holder]}"
                )
        assert unexplained == []
        assert COUNTY_CAPITAL_SIRUTA  # the import is load-bearing above
