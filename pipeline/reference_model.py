"""The gravitational accretion model — reference implementation of brief §2.

This is the specification in executable form. The TypeScript port in `web/src/model/` is
tested against it, so where the two disagree, this one is right by definition.

Determinism is not a nice-to-have here. Every collection is sorted before iteration and
every tie has an explicit, documented break. A set iteration order leaking into the output
would mean the same sliders produce different maps on different machines, which destroys
the only property that makes this tool arguable.

Two readings of the brief are worth stating, because both are judgement calls:

1. **Promoted seeds are drawn from the potential-absorber pool**, not from all 3,186 UATs.
   Brief §2 step 1 says "argmax over unpromoted UATs", but §4 says the ≥5,000 population
   set is "the floor of the X slider, so nothing outside it can ever be an absorber". The
   second is the binding constraint — the candidacy grid only exists for that pool — so
   promotion picks from it.

2. **A seed that is absorbed before its own turn does not form a region.** Absorbers are
   processed in tier order and mark their members claimed; if a county capital reaches a
   smaller town first, that town joins the capital's region rather than founding its own.
   This follows the brief's `if u.claimed: continue` literally.

Usage:
    uv run python -m pipeline.reference_model
    uv run python -m pipeline.reference_model --x 20000 --r-cap 20000
"""

from __future__ import annotations

import argparse
import heapq
import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field

import geopandas as gpd
import numpy as np
import pandas as pd

from pipeline.constants import (
    ABSORBER_POP_THRESHOLD_DEFAULT,
    ADMIN_RANK_ORAS,
    BUCHAREST_COUNTY_CODE,
    BUCHAREST_RING_COUNTY,
    DELTA_WATER_UATS,
    MAX_ROAD_DEFAULT_M,
    MIN_OVERLAP_DEFAULT,
    N_MIN_DEFAULT,
    P_ORPHAN_DEFAULT,
    P_TARGET_DEFAULT,
    R_CAP_DEFAULT_M,
    R_NATIONAL_DEFAULT_M,
    R_SEP_DEFAULT_M,
    R_SEP_RELAXATION_FACTOR,
    R_SEP_RELAXATION_FLOOR_M,
    R_TOWN_DEFAULT_M,
    RADIUS_GRID_M,
    TIER_COUNTY_CAPITAL,
    TIER_NATIONAL_CAPITAL,
    TIER_POPULATION,
    TIER_PROMOTED,
    admin_rank_of,
)
from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA
from pipeline.paths import PROCESSED_DIR


@dataclass(frozen=True)
class Params:
    x: int = ABSORBER_POP_THRESHOLD_DEFAULT
    r_national_m: int = R_NATIONAL_DEFAULT_M
    r_cap_m: int = R_CAP_DEFAULT_M
    r_town_m: int = R_TOWN_DEFAULT_M
    n_min: int = N_MIN_DEFAULT
    r_sep_m: int = R_SEP_DEFAULT_M
    min_overlap: float = MIN_OVERLAP_DEFAULT
    p_orphan: int = P_ORPHAN_DEFAULT
    p_target: int = P_TARGET_DEFAULT
    max_road_m: int = MAX_ROAD_DEFAULT_M

    def snapped(self) -> Params:
        """Radii must land on the precomputed grid; the UI slider snaps to it too."""
        return Params(
            x=self.x,
            r_national_m=_snap(self.r_national_m),
            r_cap_m=_snap(self.r_cap_m),
            r_town_m=_snap(self.r_town_m),
            n_min=self.n_min,
            r_sep_m=self.r_sep_m,
            min_overlap=self.min_overlap,
            p_orphan=self.p_orphan,
            p_target=self.p_target,
            max_road_m=self.max_road_m,
        )


def _snap(radius: int) -> int:
    return min(RADIUS_GRID_M, key=lambda r: (abs(r - radius), r))


@dataclass
class Data:
    """Everything the model reads, loaded once and never mutated."""

    population: dict[str, int]
    county: dict[str, str]
    name: dict[str, str]
    # Administrative standing, smallest is highest: a municipiu outranks an oras, which
    # outranks a commune. Used to decide which seat survives a merge.
    admin_rank: dict[str, int]
    seat_xy: dict[str, tuple[float, float]]
    operating_ron: dict[str, float]
    administrative_ron: dict[str, float]
    neighbours: dict[str, tuple[str, ...]]
    # Road distance in metres between the seats of two adjacent UATs, both directions.
    road_distance: dict[tuple[str, str], float]
    # (radius, absorber) -> ((uat, overlap_fraction, seat_inside), ...) sorted for determinism
    candidacy: dict[tuple[int, str], tuple[tuple[str, float, bool], ...]]
    absorbers: tuple[str, ...]
    by_county: dict[str, tuple[str, ...]]


@dataclass
class Result:
    region_of: dict[str, str] = field(default_factory=dict)
    members: dict[str, list[str]] = field(default_factory=dict)
    seeds: dict[str, int] = field(default_factory=dict)  # seed -> tier
    orphan_regions: set[str] = field(default_factory=set)
    under_seeded_counties: dict[str, int] = field(default_factory=dict)
    # Centres bordering their county capital, and whether each survived on its own.
    held: dict[str, bool] = field(default_factory=dict)
    # Stood-down centre -> the capital allowed to claim it. Nobody else may.
    reserved_for: dict[str, str] = field(default_factory=dict)
    relaxed_counties: dict[str, float] = field(default_factory=dict)


def load_data() -> Data:
    uat_path = PROCESSED_DIR / "uat_geometry.gpkg"
    seat_path = PROCESSED_DIR / "uat_seats.gpkg"
    adj_path = PROCESSED_DIR / "adjacency.parquet"
    road_path = PROCESSED_DIR / "road_distance.parquet"
    cand_path = PROCESSED_DIR / "candidacy.parquet"
    fin_path = PROCESSED_DIR / "finance.parquet"
    for path, cmd in (
        (uat_path, "build_geometry"),
        (seat_path, "build_seats"),
        (adj_path, "build_adjacency"),
        (road_path, "build_road_distance"),
        (cand_path, "build_candidacy"),
        (fin_path, "build_finance"),
    ):
        if not path.exists():
            raise SystemExit(f"Missing {path}. Run: uv run python -m pipeline.{cmd}")

    uats = gpd.read_file(uat_path, layer="uat")
    seats = gpd.read_file(seat_path, layer="seat")
    adjacency = pd.read_parquet(adj_path)
    road = pd.read_parquet(road_path)
    candidacy = pd.read_parquet(cand_path)
    finance = pd.read_parquet(fin_path)

    population = dict(zip(uats["siruta"], uats["population"].astype(int), strict=True))
    county = dict(zip(uats["siruta"], uats["county_code"], strict=True))
    name = dict(zip(uats["siruta"], uats["name_uat"], strict=True))

    admin_rank = {
        siruta: admin_rank_of(level)
        for siruta, level in zip(uats["siruta"], uats["natlevname"], strict=True)
    }
    seat_xy = {r.siruta: (r.geometry.x, r.geometry.y) for r in seats.itertuples()}
    operating = dict(zip(finance["siruta"], finance["operating_ron"].astype(float), strict=True))
    administrative = dict(
        zip(finance["siruta"], finance["administrative_ron"].astype(float), strict=True)
    )

    # A border the model may grow over is one you can actually drive across — not one a road
    # happens to cross.
    #
    # `traversable` is a fact about geometry: does a road cross this shared border. That is
    # the wrong question. Oras Faurei and Surdila-Gaiseanca share 2,252 m of border that no
    # road crosses at any tolerance, and their seats are 5.4 km apart by road because the
    # route goes round. Faurei was forbidden from absorbing its own neighbour, which then
    # drained to Ianca through a chain. Nationally 3,213 borders were blocked while a real
    # route existed, 234 of them under 10 km.
    #
    # The routed distance answers it properly and needs no threshold: a border that is a long
    # way round carries a large weight, so growth avoids it and the distance cap bounds it. A
    # river with no bridge and a motorway with no junction are both long detours, which is
    # what they are — the protection those cases need is the distance, not a yes/no test.
    routed_pairs = {
        (a, b)
        for a, b, metres in zip(road["a_siruta"], road["b_siruta"], road["road_m"], strict=True)
        if math.isfinite(metres)
    }
    has_route = [
        (a, b) in routed_pairs
        for a, b in zip(adjacency["a_siruta"], adjacency["b_siruta"], strict=True)
    ]
    usable = adjacency[adjacency["traversable"].to_numpy() | np.array(has_route)]
    adjacent: dict[str, set[str]] = defaultdict(set)
    for a, b in zip(usable["a_siruta"], usable["b_siruta"], strict=True):
        adjacent[a].add(b)
        adjacent[b].add(a)
    neighbours = {k: tuple(sorted(v)) for k, v in adjacent.items()}

    # Both directions, so a lookup never has to order the pair first. Where routing failed
    # the straight line stands in; it is a floor on the true distance rather than a guess.
    road_distance: dict[tuple[str, str], float] = {}
    for a, b, metres, straight in zip(
        road["a_siruta"], road["b_siruta"], road["road_m"], road["straight_m"], strict=True
    ):
        value = float(metres) if math.isfinite(metres) else float(straight)
        road_distance[(a, b)] = value
        road_distance[(b, a)] = value

    grid: dict[tuple[int, str], list[tuple[str, float, bool]]] = defaultdict(list)
    for radius, absorber, target, fraction, seat_in in zip(
        candidacy["radius_m"],
        candidacy["absorber_siruta"],
        candidacy["uat_siruta"],
        candidacy["overlap_fraction"],
        candidacy["seat_inside"],
        strict=True,
    ):
        grid[(int(radius), absorber)].append((target, float(fraction), bool(seat_in)))
    # Sort once, here, so every downstream traversal is order-stable.
    candidacy_map = {
        key: tuple(sorted(values, key=lambda t: (-t[1], t[0]))) for key, values in grid.items()
    }

    absorbers = tuple(sorted({a for _, a in candidacy_map}))
    by_county: dict[str, list[str]] = defaultdict(list)
    for siruta in sorted(uats["siruta"]):
        by_county[county[siruta]].append(siruta)

    return Data(
        population=population,
        county=county,
        name=name,
        admin_rank=admin_rank,
        seat_xy=seat_xy,
        operating_ron=operating,
        administrative_ron=administrative,
        neighbours=neighbours,
        road_distance=road_distance,
        candidacy=candidacy_map,
        absorbers=absorbers,
        by_county={k: tuple(v) for k, v in by_county.items()},
    )


def _distance(data: Data, a: str, b: str) -> float:
    (ax, ay), (bx, by) = data.seat_xy[a], data.seat_xy[b]
    return math.hypot(ax - bx, ay - by)


def _county_road_distances(data: Data, county: str, sources: list[str]) -> dict[str, float]:
    """Road distance from the nearest of `sources` to every UAT in the county.

    Separation between centres is a road distance like everything else in the model, and
    centres are rarely adjacent, so it cannot come from the per-edge table directly. This
    walks the UAT graph inside one county using those per-edge distances as weights — the
    same numbers, and the same notion of distance, that accretion uses.

    Confined to the county because a region may never cross a county line, so a route that
    leaves and comes back is not one this model would ever travel.
    """
    best: dict[str, float] = {s: 0.0 for s in sources}
    heap: list[tuple[float, str]] = [(0.0, s) for s in sorted(sources)]
    heapq.heapify(heap)

    while heap:
        distance, uat = heapq.heappop(heap)
        if distance > best.get(uat, math.inf):
            continue
        for neighbour in data.neighbours.get(uat, ()):
            if data.county[neighbour] != county:
                continue
            step = data.road_distance.get((uat, neighbour), _distance(data, uat, neighbour))
            candidate = distance + step
            if candidate < best.get(neighbour, math.inf):
                best[neighbour] = candidate
                heapq.heappush(heap, (candidate, neighbour))
    return best


def _tier_radius(params: Params, tier: int) -> int:
    if tier == TIER_NATIONAL_CAPITAL:
        return params.r_national_m
    if tier == TIER_COUNTY_CAPITAL:
        return params.r_cap_m
    return params.r_town_m


def _reach(data: Data, params: Params, seed: str, tier: int) -> set[str]:
    """Every UAT this seed's buffer admits as a candidate, at its tier radius."""
    entries = data.candidacy.get((_tier_radius(params, tier), seed), ())
    return {
        target
        for target, fraction, seat_inside in entries
        if fraction >= params.min_overlap or seat_inside
    }


def _eligible(data: Data, params: Params, seed: str, tier: int) -> dict[str, float]:
    """What a centre may absorb, and how much of each commune its buffer covers.

    Three independent routes in, because each catches a case the others miss:

      overlap        the ordinary case — enough of the commune lies inside the radius;
      seat inside    a commune whose territory barely grazes the radius but whose village
                     is inside it;
      road distance  a commune reachable within the radius by road that the other two
                     reject purely because of its shape.

    The third is there because a long, thin commune can sit ten minutes down a direct road
    and still fail an area test — its area is mostly pointing somewhere else. Shape should
    not decide who your administration is. The overlap threshold stays as the guard against
    sliver absorptions it was always meant to be.
    """
    # A county capital takes the ring that borders it, and nothing beyond.
    #
    # The radius does not mean what its name suggests: candidacy is area overlap against a
    # buffer drawn round the whole city polygon, so Timisoara's "10 km" admitted 19 communes,
    # 15 of them past 10 km by road and one at 30 km. A capital bounded that way sprawls
    # while the towns around it stay small. The first ring is unambiguous, it is what
    # "absorbs the nearby neighbours" says, and it does not depend on the shape of the city.
    #
    # Bucharest is deliberately not included. It is the national capital, not a resedinta de
    # judet, and its ring is genuinely two communes deep — Cernica borders Pantelimon rather
    # than a sector, and belongs to the city all the same.
    if tier == TIER_COUNTY_CAPITAL:
        return {
            neighbour: 0.0
            for neighbour in data.neighbours.get(seed, ())
            if _may_absorb(data, seed, neighbour)
        }

    radius = _tier_radius(params, tier)

    # Bucharest is represented by one sector but reaches as the whole city: candidacy is
    # precomputed per UAT, so Sector 1's buffer alone points north-west and would have the
    # capital absorbing Chitila and nothing else. The city's reach is the union of its six
    # sectors' reach.
    sources = [seed]
    if tier == TIER_NATIONAL_CAPITAL:
        sources = sorted(s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE)

    admitted: dict[str, float] = {}
    for source in sources:
        for target, fraction, seat_inside in data.candidacy.get((radius, source), ()):
            if fraction >= params.min_overlap or seat_inside:
                admitted[target] = max(admitted.get(target, 0.0), fraction)
    for source in sources:
        for neighbour in data.neighbours.get(source, ()):
            if neighbour in admitted or not _may_absorb(data, seed, neighbour):
                continue
            step = data.road_distance.get((source, neighbour), _distance(data, source, neighbour))
            if step <= radius:
                admitted[neighbour] = 0.0
    return admitted


def select_seeds(data: Data, params: Params, result: Result) -> None:
    """Brief §2 step 1: tiers 0 and 1, then greedy max-coverage promotion per county."""
    # Bucharest is one centre, not six. Its sectors are not candidates and never compete:
    # six parallel administrations over one continuous city is the duplication this whole
    # exercise is about, so they are merged rather than modelled as rivals. The lowest
    # SIRUTA stands for the city, since no "Municipiul Bucuresti" row exists in the UAT set.
    sectors = sorted(s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE)
    bucharest = sectors[0] if sectors else None
    if bucharest is not None:
        result.seeds[bucharest] = TIER_NATIONAL_CAPITAL

    for siruta in data.absorbers:
        if data.county[siruta] == BUCHAREST_COUNTY_CODE:
            continue
        if siruta in COUNTY_CAPITAL_SIRUTA:
            result.seeds[siruta] = TIER_COUNTY_CAPITAL
        elif data.population[siruta] >= params.x:
            result.seeds[siruta] = TIER_POPULATION

    # A centre bordering its own county capital is stood down, and the capital takes it.
    #
    # This is what builds a metropolitan area rather than a ring of small rivals: Cumpana
    # sits against Constanta and is part of that city in every practical sense, so leaving
    # it as a separate centre describes an administrative fiction. The centre role does not
    # disappear with it — the candidate is removed from the pool before promotion runs, so
    # the county fills its quota from a town further out, which is where a second centre is
    # actually useful.
    absorbed_into_capital = _capital_shadow(data, params, result)
    for siruta in absorbed_into_capital:
        result.seeds.pop(siruta, None)
    result.held = dict.fromkeys(sorted(absorbed_into_capital), False)

    # Nothing inside a capital's reach may be promoted to a centre.
    #
    # Standing centres down runs once, here, before promotion. Without this the promotion
    # loop simply put new ones back inside the same reach: Ganeasa (5,402) and Cornetu
    # (7,389) both sit inside Bucharest's radius and both came out units of a single UAT,
    # because they became centres *after* the rule that would have stood them down had
    # already run. A centre the capital would immediately take is not a centre.
    capital_reach = {
        siruta
        for capital, covered in _capital_cores(data, params, result).items()
        for siruta in covered
        if _may_absorb(data, capital, siruta)
    }

    for county_code in sorted(data.by_county):
        # Bucharest is one city, not a county needing a spread of centres. Promotion here
        # was making four of its six sectors into centres in their own right — exactly the
        # duplication the merge exists to remove.
        if county_code == BUCHAREST_COUNTY_CODE:
            continue
        in_county = [s for s in data.by_county[county_code] if s in result.seeds]
        if len(in_county) >= params.n_min:
            continue

        # Towns join the promotion pool whatever their population. The threshold decides who
        # is *automatically* a centre; promotion exists to fill a county that came up short,
        # and there a town with a town hall is a better answer than a large commune. Oras
        # Budesti (7,126) fell below the threshold and so could not even be considered, which
        # is how Curcani — a commune of 5,301 — came to seat a unit containing it.
        pool = [
            s
            for s in data.by_county[county_code]
            if (s in data.absorbers or data.admin_rank[s] <= ADMIN_RANK_ORAS)
            and s not in result.seeds
            # A stood-down centre is not among "all the other potential absorbers": being
            # removed from `seeds` would otherwise let it be promoted straight back, which
            # is how Oras Babeni came to stand alone inside Ramnicu Valcea's reach.
            and s not in result.held
            and s not in capital_reach
        ]
        covered: set[str] = set()
        for seed in in_county:
            covered |= _reach(data, params, seed, result.seeds[seed])

        seeds_here = list(in_county)
        r_sep = float(params.r_sep_m)

        while len(seeds_here) < params.n_min:
            # Recomputed whenever the seed set changes: separation is measured from the
            # nearest existing centre by road, not in a straight line.
            separation = _county_road_distances(data, county_code, seeds_here) if seeds_here else {}

            best: tuple[int, int, int, str] | None = None
            best_siruta = None
            for candidate in pool:
                if seeds_here and r_sep > 0:
                    # Unreachable by road inside the county counts as far away, not as
                    # zero: an isolated candidate is a good centre, not a disqualified one.
                    nearest = separation.get(candidate, math.inf)
                    if nearest < r_sep:
                        continue
                gain = sum(
                    data.population[u]
                    for u in _reach(data, params, candidate, TIER_PROMOTED)
                    if u not in covered
                )
                # Greedy max-coverage, then population desc, then SIRUTA asc. Coverage
                # rather than raw population is what disperses seeds; ranking by population
                # would cluster them in whichever corner of the county is densest, which is
                # the exact failure this step exists to prevent.
                # Coverage first, then administrative standing, then size. Without the
                # standing term a commune promoted for its coverage outranks a town that
                # was never promoted, which is how Curcani (a commune of 5,301) came to be
                # the seat of a unit containing Oras Budesti.
                key = (
                    -gain,
                    data.admin_rank[candidate],
                    -data.population[candidate],
                    candidate,
                )
                if best is None or key < best:
                    best = key
                    best_siruta = candidate

            if best_siruta is None:
                r_sep *= R_SEP_RELAXATION_FACTOR
                result.relaxed_counties[county_code] = r_sep
                if r_sep < R_SEP_RELAXATION_FLOOR_M:
                    result.under_seeded_counties[county_code] = len(seeds_here)
                    break
                continue

            result.seeds[best_siruta] = TIER_PROMOTED
            seeds_here.append(best_siruta)
            pool.remove(best_siruta)
            covered |= _reach(data, params, best_siruta, TIER_PROMOTED)


def accrete(data: Data, params: Params, result: Result) -> None:
    """Grow every centre outward along the road network, one ring at a time.

    **Every centre takes its first ring before any centre takes a second.** The heap is
    ordered by ring first and by road distance only within a ring, which is the difference
    between "absorb from your neighbours, then look further" and a single race in which
    whoever is nearest to the most communes sweeps the county. Ordered by distance alone, a
    large centre reached past a small one's own doorstep and the small one starved: 56 units
    under 25,000 sat next to units over 55,000, with nothing left beside them to take.

    Within a ring the nearest by road wins, then the higher tier, then the larger centre, so
    a commune between two centres still goes to the one it is actually closest to.

    **Capitals are not capped.** A county capital absorbs whatever its radius admits. The
    population target governs the smaller centres only: Tulcea alone is 65,624, already past
    a 50,000 target, so capping it would have it absorb nothing at all.

    **Smaller centres stop at the target.** Once a centre has gathered enough people it
    stops taking more, which leaves something for its neighbours instead of letting whoever
    is nearest to the most communes sweep the county.

    **A centre inside a capital's reach was stood down before this ran**, in `select_seeds`.
    It is not a rival to be grown and then judged; it is part of that city, and the centre
    role it gives up reappears further out when the county fills its quota by promotion.

    What remains here is the tail of that rule: a stood-down centre whose capital never
    actually arrived over contiguous territory. It keeps whatever it holds and is folded
    into the capital only where the distance cap allows.
    """
    # A stood-down centre is reserved for the capital that shadows it, not handed to
    # whichever absorber happens to be nearest by road — Cumpana was going south to Eforie
    # when the whole point of standing it down is that it becomes part of Constanta.
    #
    # Reserved, not assigned outright: Cumpana does not touch Constanta, it reaches the city
    # through Agigea, so assigning it directly produced a unit in two disconnected pieces.
    # Growth has to arrive over its own territory, which keeps every unit contiguous.
    result.reserved_for = {
        siruta: capital
        for siruta in sorted(result.held)
        if (capital := _shadowing_capital(data, params, result, siruta)) is not None
    }

    _grow(data, params, result, sources=list(result.seeds), blocked=set())

    for absorber, survived in list(result.held.items()):
        if survived:
            continue
        # It may no longer be its own region: another held centre grown earlier in pass 2
        # can have absorbed it. Folding it again would assign its communes twice.
        if result.region_of.get(absorber) != absorber:
            continue
        capital = _county_capital(data, data.county[absorber])
        if capital is None or capital not in result.members:
            continue
        # Folding is subject to the distance cap like every other merge. A held centre
        # gathers up to the cap from itself, so folding it wholesale put communes twice the
        # cap from the capital — Reșița reached 73 km, which is 35 + 35. Where the fold
        # would breach it, the held centre keeps its own unit instead and is reported as
        # below target, which is the honest outcome rather than a silently oversized region.
        if params.max_road_m > 0:
            reach = _county_road_distances(data, data.county[capital], [capital])
            if any(
                reach.get(m, math.inf) > params.max_road_m
                for m in result.members.get(absorber, [absorber])
            ):
                continue
        for member in result.members.pop(absorber):
            result.region_of[member] = capital
            result.members[capital].append(member)
        result.seeds.pop(absorber, None)

    for absorber in result.members:
        result.members[absorber].sort(key=lambda m: (-data.population[m], m))


# Bucharest is ringed by Ilfov and by nothing else, so the county line between them cuts
# through a single continuous city. It is the one place where the no-cross-county rule
# produces a worse answer than breaking it, and it is broken only here: every other county
# boundary stays absolute, and only the capital may cross, never a smaller centre.


def _may_absorb(data: Data, absorber: str, uat: str) -> bool:
    """Whether `absorber` is allowed to take `uat` across whatever boundary lies between."""
    if data.county[uat] == data.county[absorber]:
        return True
    return (
        data.county[absorber] == BUCHAREST_COUNTY_CODE and data.county[uat] == BUCHAREST_RING_COUNTY
    )


def _county_capital(data: Data, county: str) -> str | None:
    for siruta, code in COUNTY_CAPITAL_SIRUTA.items():
        if code == county and siruta in data.population:
            return siruta
    return None


def _capital_core(data: Data, params: Params, capital: str, tier: int) -> set[str]:
    """UATs close enough to a capital that it takes them over rather than competing.

    Deliberately tighter than `_eligible`, which admits a UAT when a tenth of its *area*
    falls inside the buffer. That is right for growth and wrong for standing a centre down:
    a quarter of Sighetu Marmatiei's sprawling territory reaches Baia Mare's buffer while
    the two seats are 38 km apart, and demoting a municipiu of 34,000 on that basis is
    indefensible. Here the centre's own seat has to be within the radius.
    """
    # Matches _eligible exactly. A centre stood down for a capital that cannot reach it is
    # stranded: it loses its own centre status and nobody arrives to take it.
    if tier == TIER_COUNTY_CAPITAL:
        return {
            neighbour
            for neighbour in data.neighbours.get(capital, ())
            if _may_absorb(data, capital, neighbour)
        }

    radius = _tier_radius(params, tier)
    sources = [capital]
    if tier == TIER_NATIONAL_CAPITAL:
        sources = sorted(s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE)

    core: set[str] = set()
    for source in sources:
        for target, _fraction, seat_inside in data.candidacy.get((radius, source), ()):
            if seat_inside and _may_absorb(data, capital, target):
                core.add(target)
        for neighbour in data.neighbours.get(source, ()):
            if not _may_absorb(data, capital, neighbour):
                continue
            step = data.road_distance.get((source, neighbour), _distance(data, source, neighbour))
            if step <= radius:
                core.add(neighbour)
    return core


def _capital_cores(data: Data, params: Params, result: Result) -> dict[str, set[str]]:
    """Each capital's reach, keyed by the capital."""
    return {
        capital: _capital_core(data, params, capital, tier)
        for capital, tier in result.seeds.items()
        if tier in (TIER_NATIONAL_CAPITAL, TIER_COUNTY_CAPITAL)
    }


def _capital_shadow(data: Data, params: Params, result: Result) -> set[str]:
    """Centres standing inside a capital's reach, which the capital takes over.

    Keyed on the capital's radius rather than on its border. Cumpana is the case that forced
    it: the commune does not touch Constanta at all — it reaches the city through Agigea —
    so a border test leaves it a centre in its own right and it ends up absorbed southwards
    by Eforie. A capital that absorbs "all around it, concentrically" absorbs what is within
    reach of it, and adjacency is a poor proxy for that.

    Bucharest counts as the capital of the Ilfov communes it reaches. Ilfov's own capital is
    Buftea, out on the north-west edge, so without this Otopeni, Voluntari and Pantelimon
    stay centres and claim themselves before the city ever arrives.
    """
    reach = _capital_cores(data, params, result)

    shadowed: set[str] = set()
    for absorber, tier in result.seeds.items():
        if tier == TIER_NATIONAL_CAPITAL:
            continue
        for capital, covered in reach.items():
            if capital == absorber or absorber not in covered:
                continue
            if not _may_absorb(data, capital, absorber):
                continue
            # A county capital is normally untouchable. The exception is Bucharest, which
            # stands down Ilfov's: Buftea sits inside the city's reach and, protected as a
            # capital, came out a unit of one UAT and 20,577 people in the middle of the
            # metropolitan area. Only the national capital may do this, and only across the
            # one county line the model allows.
            if tier == TIER_COUNTY_CAPITAL and reach_tier(result, capital) != (
                TIER_NATIONAL_CAPITAL
            ):
                continue
            shadowed.add(absorber)
            break
    return shadowed


def reach_tier(result: Result, capital: str) -> int:
    return result.seeds.get(capital, TIER_PROMOTED + 1)


def _shadowing_capital(data: Data, params: Params, result: Result, siruta: str) -> str | None:
    """Which capital took `siruta` over: the national capital first, then nearest by road.

    Tier before distance because Chiajna is a Bucharest suburb that borders the city, yet
    Buftea's seat is marginally closer to it by road. Reserving it for Buftea meant neither
    capital's growth ever arrived and Chiajna stayed a unit of three on the city's edge.
    """
    best: tuple[int, float, str] | None = None
    for capital, tier in result.seeds.items():
        if tier not in (TIER_NATIONAL_CAPITAL, TIER_COUNTY_CAPITAL):
            continue
        if not _may_absorb(data, capital, siruta):
            continue
        if siruta not in _capital_core(data, params, capital, tier):
            continue
        step = data.road_distance.get((capital, siruta), _distance(data, capital, siruta))
        if best is None or (tier, step, capital) < best:
            best = (tier, step, capital)
    return None if best is None else best[2]


def _grow(
    data: Data,
    params: Params,
    result: Result,
    sources: list[str],
    blocked: set[str],
) -> None:
    """Multi-source shortest-path growth along roads, from `sources`.

    Communes are claimed in order of road distance from whichever centre reaches them
    first, so the assignment answers "which centre is actually nearest" rather than "which
    centre was processed first". Ties break on tier, then population, then SIRUTA.
    """
    heap: list[tuple[float, int, int, str, str]] = []
    for seed in sorted(sources):
        heapq.heappush(heap, (0, 0.0, result.seeds[seed], -data.population[seed], seed, seed))

    eligible = {seed: _eligible(data, params, seed, result.seeds[seed]) for seed in sources}
    gathered = {seed: 0 for seed in sources}

    while heap:
        ring, distance, tier, neg_population, absorber, uat = heapq.heappop(heap)
        if uat in result.region_of or uat in blocked:
            continue

        if uat != absorber:
            if not _may_absorb(data, absorber, uat):
                continue
            if result.reserved_for.get(uat, absorber) != absorber:
                continue
            # The cap must be checked when claiming, not only when expanding. Stopping
            # expansion at the cap still let the last commune inside it push a neighbour one
            # long edge further, and that neighbour was claimed unchecked — which is how
            # Reșița reached Teregova at 72.9 km against a 35 km cap.
            if params.max_road_m > 0 and distance > params.max_road_m:
                continue
            capped = tier not in (TIER_NATIONAL_CAPITAL, TIER_COUNTY_CAPITAL)
            # A centre still short of the target keeps going past its radius.
            #
            # The radius says how far a centre *pulls* — how far it reaches while it still
            # has a choice. It should not be what stops a centre that has not yet gathered
            # enough people to be worth creating: that is the target's job. With the radius
            # binding, small centres ran out of eligible neighbours at 10 km and stopped at
            # 9,000 while a neighbour reached 141,000, and there was nothing left beside them
            # to take. The road cap still bounds it, so "keeps going" is never unbounded.
            short = capped and params.p_target > 0 and gathered[absorber] < params.p_target
            if uat not in eligible[absorber] and not short:
                continue
            if capped and params.p_target > 0 and gathered[absorber] >= params.p_target:
                continue

        result.region_of[uat] = absorber
        result.members.setdefault(absorber, []).append(uat)
        gathered[absorber] += data.population[uat]

        # Stop expanding once the frontier is further from the centre than anyone should
        # have to travel to reach their own town hall.
        if params.max_road_m > 0 and distance >= params.max_road_m:
            continue

        for neighbour in data.neighbours.get(uat, ()):
            if neighbour in result.region_of or neighbour in blocked:
                continue
            step = data.road_distance.get((uat, neighbour), _distance(data, uat, neighbour))
            heapq.heappush(
                heap, (ring + 1, distance + step, tier, neg_population, absorber, neighbour)
            )


def _keep_unclaimed_as_themselves(data: Data, result: Result) -> None:
    """Any UAT still unassigned survives unchanged, as a region of one.

    Every UAT must end up in exactly one region. A UAT that no absorber reached and no
    orphan cluster took is not an error and must not silently drop out — it is a commune
    the model left alone, which is a legitimate and reportable outcome.
    """
    for siruta in sorted(data.population):
        if siruta not in result.region_of:
            result.region_of[siruta] = siruta
            result.members[siruta] = [siruta]


def orphan_tier(data: Data, params: Params, result: Result) -> None:
    """Brief §2 step 5: merge whatever the absorbers never reached, small-with-small.

    Without this, at the default settings large parts of the Bărăgan, the Apuseni and
    northern Moldova stay untouched, and the model leaves over a thousand tiny communes
    exactly as they were — which defeats the point of running it.
    """
    if params.p_orphan <= 0:
        # The orphan step is off, so whatever the absorbers did not reach "stays as-is"
        # (brief §2 step 5) — which means it survives as its own single-UAT region, not
        # that it disappears from the map.
        _keep_unclaimed_as_themselves(data, result)
        return

    unclaimed = sorted(s for s in data.population if s not in result.region_of)
    cluster_of = {s: s for s in unclaimed}
    cluster_members = {s: [s] for s in unclaimed}

    def cluster_population(root: str) -> int:
        return sum(data.population[m] for m in cluster_members[root])

    changed = True
    while changed:
        changed = False
        candidates = sorted(
            (r for r in cluster_members if cluster_population(r) < params.p_orphan),
            key=lambda r: (cluster_population(r), r),
        )
        for root in candidates:
            if root not in cluster_members:
                continue
            if cluster_population(root) >= params.p_orphan:
                continue

            best_partner = None
            best_key: tuple[int, str] | None = None
            for member in cluster_members[root]:
                for neighbour in data.neighbours.get(member, ()):
                    if neighbour in result.region_of:
                        continue
                    partner_root = cluster_of.get(neighbour)
                    if partner_root is None or partner_root == root:
                        continue
                    if data.county[neighbour] != data.county[member]:
                        continue
                    # "Stop clusters from growing once they exceed P_orphan" gates on a
                    # cluster's *current* size, not on the size the merge would produce.
                    # Gating on the result instead blocks almost every merge — typical
                    # communes are 2,000-4,000, so any pair clears 5,000 — and leaves the
                    # tiny communes untouched, which is the failure this step exists to
                    # prevent. Both sides must still be under the floor, so a cluster that
                    # has crossed it is frozen rather than repeatedly extended.
                    if cluster_population(partner_root) >= params.p_orphan:
                        continue
                    # The distance cap applies here too. Clusters are small in population
                    # but that says nothing about how far apart they are, and an uncapped
                    # merge here reintroduced exactly the sprawl the cap exists to stop.
                    if params.max_road_m > 0:
                        seat_reach = _county_road_distances(data, data.county[root], [root])
                        if any(
                            seat_reach.get(m, math.inf) > params.max_road_m
                            for m in cluster_members[partner_root]
                        ):
                            continue
                    combined = cluster_population(root) + cluster_population(partner_root)
                    # Prefer small+small merges, then SIRUTA ascending.
                    key = (combined, partner_root)
                    if best_key is None or key < best_key:
                        best_key = key
                        best_partner = partner_root

            if best_partner is not None:
                merged = cluster_members.pop(best_partner)
                cluster_members[root].extend(merged)
                for m in merged:
                    cluster_of[m] = root
                changed = True

    for members in cluster_members.values():
        # The cluster's seat is its largest member, which is the surviving administration.
        seat = min(members, key=lambda m: (-data.population[m], m))
        for m in sorted(members):
            result.region_of[m] = seat
        result.members[seat] = sorted(members, key=lambda m: (-data.population[m], m))
        # Every region the orphan tier produces is an orphan region, including a commune
        # that found no partner and survives alone. These follow a different rule from
        # gravitational absorption and must stay visually and rhetorically separable.
        result.orphan_regions.add(seat)


def consolidate_to_target(data: Data, params: Params, result: Result) -> None:
    """Merge resulting units still below the target population, into their nearest by road.

    The gravitational rules answer "who can reach whom". This answers a different question:
    "is the result large enough to be worth creating". A unit of 4,000 people still needs a
    mayor, a secretary and a budget, so a scenario can otherwise leave a smaller map that
    has not actually fixed anything.

    **The partner is the nearest by road, not the smallest.** Choosing the smallest combined
    population — which is right in the orphan tier, where the candidates are tiny
    neighbours — is badly wrong applied to whole units: small units chain into whatever
    happens to be adjacent until something clears the target. In Tulcea that put Măcin into
    Babadag 60 km away at the other end of the county, and collapsed 19 sensible units into
    three. Distance is what everything else in this model uses, and it is what a resident
    would ask about first.

    A unit that has reached the target is never a partner. Satisfied units are finished, and
    a short neighbour with nowhere to go stays short and is reported rather than being poured
    into whatever large unit happens to be nearest.

    Units can end below the target legitimately: an isolated commune whose every neighbour
    is already large has nowhere to go. They are reported rather than forced.
    """
    if params.p_target <= 0:
        return

    def region_population(absorber: str) -> int:
        return sum(data.population[m] for m in result.members[absorber])

    distance_cache: dict[str, dict[str, float]] = {}

    changed = True
    while changed:
        changed = False
        below = sorted(
            (a for a in result.members if region_population(a) < params.p_target),
            key=lambda a: (region_population(a), a),
        )
        for absorber in below:
            if absorber not in result.members:
                continue
            if region_population(absorber) >= params.p_target:
                continue

            county = data.county[absorber]
            partners: set[str] = set()
            for member in result.members[absorber]:
                for neighbour in data.neighbours.get(member, ()):
                    other = result.region_of[neighbour]
                    if other == absorber or data.county[neighbour] != county:
                        continue
                    partners.add(other)
            if not partners:
                continue

            # Road distance from a seat to every commune in its county, cached: the loop
            # asks for the same seats repeatedly as units merge.
            def reach_from(seat: str) -> dict[str, float]:
                cached = distance_cache.get(seat)
                if cached is None:
                    cached = _county_road_distances(data, data.county[seat], [seat])
                    distance_cache[seat] = cached
                return cached

            def standing(unit: str) -> tuple[int, int, int, str]:
                # Administrative status first. A commune promoted to a centre used to
                # outrank a town that was never one, which made Curcani — a commune of
                # 5,301 — the seat of a unit containing Oras Budesti. What a place *is*
                # should outrank what this run happened to make it.
                return (
                    data.admin_rank[unit],
                    result.seeds.get(unit, TIER_PROMOTED + 1),
                    -data.population[unit],
                    unit,
                )

            here = reach_from(absorber)

            # A partner is allowed only if, once merged, *every* commune in the combined
            # unit is within the cap of the seat that survives. Checking from the initiating
            # seat alone left the cap toothless whenever the partner kept the seat — Măcin
            # still reached 48 km and Hunedoara 78.
            def merge_is_compact(
                other: str,
                this: str = absorber,
                this_reach: dict[str, float] = here,
            ) -> bool:
                if params.max_road_m <= 0:
                    return True
                # Inside the Delta the cap does not apply. Pardina is 57.8 km from Sulina by
                # water and there is no shorter route and no other administration to join;
                # enforcing the cap there leaves five unviable units rather than one Delta.
                if all(m in DELTA_WATER_UATS for m in result.members[this] + result.members[other]):
                    return True
                keeps_seat = standing(this) <= standing(other)
                reach = this_reach if keeps_seat else reach_from(other)
                everyone = result.members[this] + result.members[other]
                return all(reach.get(m, math.inf) <= params.max_road_m for m in everyone)

            reachable = [o for o in sorted(partners) if merge_is_compact(o)]
            if not reachable:
                continue

            # A unit that has reached the target never takes more.
            #
            # This is the whole answer to "why is the county capital absorbing far more than
            # its neighbours". It was not: its own growth stops at the ring that borders it.
            # What reached 49.6 km was this step. Oras Recas (8,347) and Oras Buzias (6,834)
            # grow but never reach 50,000; they merge with the small units beside them and
            # are still short; that chain keeps merging outward, and the only adjacent unit
            # that clears 50,000 is Timisoara. So the whole chain drained into the capital,
            # every link legal because it stayed inside the cap measured from Timisoara.
            #
            # Falling back to a satisfied partner is what opened that door. Without it a unit
            # that cannot reach the target stays short and is reported, which is the honest
            # outcome: it costs about 118 units and 0.44 bn RON nationally, and it is the
            # difference between a capital that takes its neighbours and one that takes half
            # the county.
            # A county capital is finished once it has taken its ring.
            #
            # This is the answer to "why is the resedinta de judet absorbing far more than
            # its neighbours". Its own growth stops at the ring bordering it; what reached
            # 49.6 km was this step. Oras Recas (8,347) and Oras Buzias (6,834) grow but
            # never reach 50,000, they merge with the small units beside them and are still
            # short, and that chain keeps merging outward until it meets the only adjacent
            # unit that clears the target — the capital. So the whole chain drained into it.
            #
            # Only capitals are closed off. Refusing *every* satisfied unit as a partner also
            # works, and it strands the leftovers instead: widening the radius then produced
            # more units rather than fewer, because a wider radius satisfies more units and
            # each one it satisfies stops accepting neighbours. A slider labelled "how far a
            # centre reaches" must not increase the number of units when you turn it up.
            still_small = [o for o in reachable if region_population(o) < params.p_target]
            not_a_capital = [o for o in reachable if o not in COUNTY_CAPITAL_SIRUTA]

            choices = still_small or not_a_capital
            if not choices:
                continue
            partner = min(
                choices,
                key=lambda o: (here.get(o, math.inf), region_population(o), o),
            )

            # Which seat survives is about the standing of the town, not the size the unit
            # happens to have reached: a county capital outranks anything, then a centre
            # outranks a cluster seat, then the larger town wins. Judging by unit population
            # made Măcin (7,248) the capital of a unit containing Babadag (9,213).
            keep, drop = (
                (absorber, partner)
                if standing(absorber) <= standing(partner)
                else (partner, absorber)
            )

            merged = result.members.pop(drop)
            result.members[keep].extend(merged)
            for m in merged:
                result.region_of[m] = keep
            result.orphan_regions.discard(drop)
            changed = True


def clark_evans(data: Data, seeds: list[str], county_uats: list[str]) -> float | None:
    """Mean nearest-neighbour distance over what random placement would give.

    Above 1 means the seeds are dispersed, below 1 that they cluster. This is the metric
    that catches "all five seeds sit in the south-east corner of the county".
    """
    if len(seeds) < 2:
        return None
    observed = sum(
        min(_distance(data, s, other) for other in seeds if other != s) for s in seeds
    ) / len(seeds)
    xs = [data.seat_xy[u][0] for u in county_uats]
    ys = [data.seat_xy[u][1] for u in county_uats]
    area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    if area <= 0:
        return None
    expected = 0.5 / math.sqrt(len(seeds) / area)
    return observed / expected if expected else None


def reseat_units(data: Data, params: Params, result: Result) -> None:
    """Give each unit the most significant town in it as its seat.

    Which communes group together is settled by roads and radii and is not touched here;
    this decides only which member the unit is named after and administered from. Curcani is
    the case: a commune of 5,301 promoted for its coverage ended up seating a unit that
    contains Oras Budesti (7,126), so the map showed a town governed from a village.

    Standing is the same ordering consolidation uses to pick a survivor — administrative
    rank, then how the centre was seeded, then population.

    A re-election has to keep the distance cap: growth enforced it against the old seat, and
    moving the seat can put members beyond it. Oras Murgeni is the case — the better town
    administratively, but 73.7 km from members the cap allows at 50 km. Where no candidate
    holds the cap the unit keeps the seat it grew from.
    """

    def standing(unit: str) -> tuple[int, int, int, str]:
        return (
            data.admin_rank[unit],
            result.seeds.get(unit, TIER_PROMOTED + 1),
            -data.population[unit],
            unit,
        )

    for old_seat in sorted(result.members):
        members = result.members[old_seat]
        county = data.county[old_seat]

        def holds_the_cap(
            candidate: str, members: list[str] = members, county: str = county
        ) -> bool:
            if params.max_road_m <= 0:
                return True
            # The Delta is exempt here for the same reason it is exempt from the merge cap:
            # every distance inside it is long and there is no shorter alternative. Without
            # this the unit keeps whichever seat it grew from — Crisan, a commune of 1,092 —
            # instead of Oras Sulina, the town the Delta is actually administered from.
            if all(m in DELTA_WATER_UATS for m in members):
                return True
            reach = _county_road_distances(data, county, [candidate])
            # Members in another county are the Bucharest ring, which this county-scoped
            # measure cannot see; the cap is not enforced across that one line.
            return all(
                reach.get(m, math.inf) <= params.max_road_m
                for m in members
                if data.county[m] == county
            )

        ranked = sorted(members, key=standing)
        new_seat = next((c for c in ranked if holds_the_cap(c)), old_seat)
        if new_seat == old_seat:
            continue
        result.members[new_seat] = result.members.pop(old_seat)
        for member in members:
            result.region_of[member] = new_seat
        if old_seat in result.orphan_regions:
            result.orphan_regions.discard(old_seat)
            result.orphan_regions.add(new_seat)
        if old_seat in result.seeds:
            result.seeds[new_seat] = result.seeds.pop(old_seat)


def summarise(data: Data, params: Params, result: Result) -> dict:
    regions = sorted(set(result.region_of.values()))
    total_uats = len(data.population)

    # Two savings figures, deliberately.
    #
    # `savings_admin_ron` is the headline: the town-hall administration of every absorbed
    # UAT, which is what a merger actually removes.
    #
    # `savings_operating_ron` applies the brief's formula to all operating spending. It is
    # kept as an explicit upper bound, not as a claim: it assumes merging also eliminates
    # the absorbed commune's schools, social assistance and utilities, which it does not.
    # Nationally it is roughly seven times larger, so publishing it unqualified would be
    # the single easiest way to discredit the whole tool.
    savings_admin = 0.0
    savings_operating = 0.0
    for absorber, members in result.members.items():
        savings_admin += sum(data.administrative_ron.get(m, 0.0) for m in members)
        savings_admin -= data.administrative_ron.get(absorber, 0.0)
        savings_operating += sum(data.operating_ron.get(m, 0.0) for m in members)
        savings_operating -= data.operating_ron.get(absorber, 0.0)

    per_county = []
    for county_code in sorted(data.by_county):
        uats = list(data.by_county[county_code])
        seeds = sorted(s for s in uats if s in result.seeds)
        county_pop = sum(data.population[u] for u in uats)

        covered: set[str] = set()
        for seed in seeds:
            covered |= _reach(data, params, seed, result.seeds[seed])
            covered.add(seed)
        covered_pop = sum(data.population[u] for u in uats if u in covered)

        uncovered = [u for u in uats if u not in covered]
        max_uncovered_m = (
            max(min(_distance(data, u, s) for s in seeds) for u in uncovered)
            if uncovered and seeds
            else 0.0
        )

        per_county.append(
            {
                "county": county_code,
                "uats": len(uats),
                "regions": len({result.region_of[u] for u in uats if u in result.region_of}),
                "seeds": len(seeds),
                "coverage_pct": 100 * covered_pop / county_pop if county_pop else 0.0,
                "max_uncovered_km": max_uncovered_m / 1000,
                "clark_evans": clark_evans(data, seeds, uats),
                "under_seeded": county_code in result.under_seeded_counties,
            }
        )

    below_target = (
        sum(
            1
            for members in result.members.values()
            if sum(data.population[m] for m in members) < params.p_target
        )
        if params.p_target > 0
        else 0
    )

    return {
        "params": params,
        "regions": len(regions),
        "below_target": below_target,
        "uats": total_uats,
        "reduction_pct": 100 * (1 - len(regions) / total_uats),
        "seeds": len(result.seeds),
        "orphan_regions": len(result.orphan_regions),
        "unassigned": total_uats - len(result.region_of),
        "savings_admin_ron": savings_admin,
        "savings_operating_ron": savings_operating,
        "per_county": per_county,
    }


def run(data: Data, params: Params) -> tuple[Result, dict]:
    params = params.snapped()
    result = Result()
    select_seeds(data, params, result)
    accrete(data, params, result)
    orphan_tier(data, params, result)
    # Belt and braces: whatever route the UAT took, it ends up in exactly one region.
    _keep_unclaimed_as_themselves(data, result)
    # Twice, and the order matters. Consolidation decides which units merge by measuring
    # road distance from the seat that survives, so it has to see the real seats: run only
    # afterwards, it left Fundeni short of the target next to a unit it could have joined,
    # because the merge was judged from Curcani and the seat then became Oras Budesti.
    # Merging changes the membership, so the seats are settled again on the result.
    reseat_units(data, params, result)
    consolidate_to_target(data, params, result)
    reseat_units(data, params, result)
    return result, summarise(data, params, result)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--x", type=int, default=ABSORBER_POP_THRESHOLD_DEFAULT)
    ap.add_argument("--r-cap", type=int, default=R_CAP_DEFAULT_M)
    ap.add_argument("--r-town", type=int, default=R_TOWN_DEFAULT_M)
    ap.add_argument("--n-min", type=int, default=N_MIN_DEFAULT)
    ap.add_argument("--r-sep", type=int, default=R_SEP_DEFAULT_M)
    ap.add_argument("--min-overlap", type=float, default=MIN_OVERLAP_DEFAULT)
    ap.add_argument("--p-orphan", type=int, default=P_ORPHAN_DEFAULT)
    ap.add_argument("--p-target", type=int, default=P_TARGET_DEFAULT)
    ap.add_argument("--max-road", type=int, default=MAX_ROAD_DEFAULT_M)
    args = ap.parse_args(argv)

    print("Loading precomputed layers...")
    data = load_data()

    params = Params(
        x=args.x,
        r_cap_m=args.r_cap,
        r_town_m=args.r_town,
        n_min=args.n_min,
        r_sep_m=args.r_sep,
        min_overlap=args.min_overlap,
        p_orphan=args.p_orphan,
        p_target=args.p_target,
        max_road_m=args.max_road,
    ).snapped()

    print(
        f"\nScenario: X={params.x:,}  R_cap={params.r_cap_m / 1000:.1f}km  "
        f"R_town={params.r_town_m / 1000:.1f}km  N_min={params.n_min}  "
        f"R_sep={params.r_sep_m / 1000:.1f}km  min_overlap={params.min_overlap}  "
        f"P_orphan={params.p_orphan:,}"
    )

    _, summary = run(data, params)

    print(f"\n  UATs today         {summary['uats']:,}")
    print(f"  Regions after      {summary['regions']:,}")
    print(f"  Reduction          {summary['reduction_pct']:.1f}%")
    print(f"  Seeds              {summary['seeds']:,}")
    print(f"  Orphan-tier        {summary['orphan_regions']:,}")
    print(f"  Unassigned         {summary['unassigned']:,}")
    if params.p_target > 0:
        print(
            f"  Below target       {summary['below_target']:,} of {summary['regions']:,}"
            f" (target {params.p_target:,})"
        )
    print(
        f"  Savings (admin)    {summary['savings_admin_ron'] / 1e9:.2f} bn RON/year   <- headline"
    )
    print(
        f"  Upper bound        {summary['savings_operating_ron'] / 1e9:.2f} bn RON/year"
        "   (all operating; assumes schools close too)"
    )

    under = [c["county"] for c in summary["per_county"] if c["under_seeded"]]
    print(f"  Under-seeded       {len(under)} counties" + (f": {under}" if under else ""))

    counties = sorted(summary["per_county"], key=lambda c: c["coverage_pct"])
    print("\n  Lowest coverage:")
    for c in counties[:5]:
        ce = f"{c['clark_evans']:.2f}" if c["clark_evans"] else "n/a"
        print(
            f"    {c['county']}  coverage={c['coverage_pct']:5.1f}%  "
            f"max_uncovered={c['max_uncovered_km']:5.1f}km  CE={ce}  "
            f"{c['uats']}->{c['regions']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
