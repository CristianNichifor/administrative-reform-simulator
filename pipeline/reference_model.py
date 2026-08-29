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
import functools
import heapq
import math
import sys
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import geopandas as gpd
import numpy as np
import pandas as pd

from pipeline.constants import (
    ABSORBER_POP_THRESHOLD_DEFAULT,
    ADMIN_RANK_ORAS,
    BUCHAREST_COUNTY_CODE,
    BUCHAREST_RING_COUNTY,
    CRS_STEREO70,
    DELTA_WATER_UATS,
    MAX_ROAD_DEFAULT_M,
    MIN_COMPACTNESS_DEFAULT,
    MIN_OVERLAP_DEFAULT,
    N_MIN_DEFAULT,
    P_ORPHAN_DEFAULT,
    P_STRANDED_DEFAULT,
    P_TARGET_DEFAULT,
    PROMOTION_POPULATION_BAND,
    R_CAP_DEFAULT_M,
    R_NATIONAL_DEFAULT_M,
    R_SEP_DEFAULT_M,
    R_SEP_RELAXATION_FACTOR,
    R_SEP_RELAXATION_FLOOR_M,
    R_TIE_DEFAULT_M,
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
    min_compactness: float = MIN_COMPACTNESS_DEFAULT
    r_tie_m: int = R_TIE_DEFAULT_M
    p_stranded: int = P_STRANDED_DEFAULT

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
            min_compactness=self.min_compactness,
            r_tie_m=self.r_tie_m,
            p_stranded=self.p_stranded,
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
    # Shape, per commune and per shared border, in km2 and km. A unit's area is the sum of
    # its members' and its perimeter the sum less twice the borders inside it.
    # Every shared border, including those no road crosses — the model may not grow over
    # them, but they are still borders when measuring a unit's outline.
    touching: dict[str, tuple[str, ...]]
    area_km2: dict[str, float]
    perimeter_km: dict[str, float]
    shared_border_km: dict[tuple[str, str], float]
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
    # How many communes the rebalancing pass moved to a nearer seat.
    rebalanced: int = 0
    relaxed_counties: dict[str, float] = field(default_factory=dict)
    # How many communes the equalising pass handed to a less-loaded neighbour.
    equalised: int = 0
    # Units the cap had stranded, and the unit each was finally merged into.
    last_resort: dict[str, str] = field(default_factory=dict)


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
    geometry = gpd.read_file(PROCESSED_DIR / "uat_geometry.gpkg", layer="uat").to_crs(CRS_STEREO70)
    area_km2 = dict(zip(geometry["siruta"], geometry.geometry.area / 1_000_000, strict=True))
    perimeter_km = dict(zip(geometry["siruta"], geometry.geometry.length / 1_000, strict=True))
    touching_sets: dict[str, set[str]] = defaultdict(set)
    shared_border_km: dict[tuple[str, str], float] = {}
    for a, b, metres in zip(
        adjacency["a_siruta"], adjacency["b_siruta"], adjacency["shared_border_m"], strict=True
    ):
        shared_border_km[(a, b)] = float(metres) / 1_000
        shared_border_km[(b, a)] = float(metres) / 1_000
        touching_sets[a].add(b)
        touching_sets[b].add(a)
    touching = {k: tuple(sorted(v)) for k, v in touching_sets.items()}

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
        touching=touching,
        area_km2=area_km2,
        perimeter_km=perimeter_km,
        shared_border_km=shared_border_km,
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
    # A centre's own neighbours are always its own.
    #
    # This is the floor under everything else here, and it was missing. Eligibility was
    # decided by area overlap against a buffer, which knows nothing about who borders whom:
    # Bucharest held 3 of the 14 communes touching the city and 6 that did not touch it at
    # all. A commune that shares a border with a centre should never be reached past.
    ring = {
        neighbour
        for neighbour in data.neighbours.get(seed, ())
        if _may_absorb(data, seed, neighbour)
    }
    if tier == TIER_NATIONAL_CAPITAL:
        # The city is represented by one sector, so its ring is the ring of all six.
        ring = {
            neighbour
            for sector in data.population
            if data.county[sector] == BUCHAREST_COUNTY_CODE
            for neighbour in data.neighbours.get(sector, ())
            if _may_absorb(data, seed, neighbour)
        }

    # A county capital: its ring, plus everything inside its radius by road.
    if tier == TIER_COUNTY_CAPITAL:
        return dict.fromkeys(ring | capital_reach(data, params, seed), 0.0)

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
    # The ring goes in whatever the radius said.
    for neighbour in ring:
        admitted.setdefault(neighbour, 0.0)
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

    # A capital's own ring, across every capital. Narrower than the stand-down reach: the
    # reach is who a capital displaces, the ring is what it actually holds.
    capital_rings = {
        member
        for capital, tier in result.seeds.items()
        if tier in (TIER_NATIONAL_CAPITAL, TIER_COUNTY_CAPITAL)
        for member in capital_ring(data, params, capital)
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
        def candidates(allow_displaced: bool, county_code: str = county_code) -> list[str]:
            return [
                s
                for s in data.by_county[county_code]
                if (s in data.absorbers or data.admin_rank[s] <= ADMIN_RANK_ORAS)
                and s not in result.seeds
                # A stood-down centre is not among "all the other potential absorbers":
                # being removed from `seeds` would otherwise let it be promoted straight
                # back, which is how Oras Babeni came to stand alone inside Ramnicu Valcea's
                # reach.
                # Never a capital's own ring, however short the county is. Ilfov can only
                # reach five units by promoting communes that border Bucharest, and the city
                # holding everything that touches it is the stronger rule — it was asked for
                # first and asserted directly by a test.
                and s not in capital_rings
                and (allow_displaced or (s not in result.held and s not in capital_reach))
            ]

        # Displaced, but not disqualified — when the county has nobody else at all.
        #
        # Standing a centre down barred it from ever being promoted again, and in Ilfov that
        # left the pool empty: 33 of its 40 communes sit inside Bucharest's or Buftea's
        # reach, so 28 UATs over the threshold produced three units against a minimum of
        # five. Coverage is the point of the minimum, so a commune the capital displaced but
        # does not hold should still be able to lead a unit.
        pool = candidates(False)
        widened = False
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
                # Walk down from the threshold, but prefer the better-placed candidate
                # among towns of comparable size.
                #
                # The question this step answers is "who is the next most plausible town",
                # which is about size — it used to maximise uncovered population reached,
                # which answers "who would sweep up the most", and that picked Curcani, a
                # commune of 5,301, over Oras Budesti at 7,126.
                #
                # But size alone takes the first candidate clearing the separation floor and
                # then stops caring about position, so a town 15.1 km from an existing centre
                # beat one of nearly the same size 30 km away. Populations are compared in
                # bands; within a band the more distant candidate wins, which is what spreads
                # the centres over the county instead of stacking them in its densest corner.
                nearest = separation.get(candidate, math.inf) if separation else math.inf
                key = (
                    -(data.population[candidate] // PROMOTION_POPULATION_BAND),
                    -nearest if math.isfinite(nearest) else -math.inf,
                    data.admin_rank[candidate],
                    candidate,
                )
                if best is None or key < best:
                    best = key
                    best_siruta = candidate

            if best_siruta is None and not widened:
                # Widen before relaxing. `candidates(False) or candidates(True)` was not
                # enough: it falls back only when the restricted pool is *empty*, and
                # Ilfov's was not — it held candidates that all failed the separation test,
                # so the county stayed on three centres against a minimum of five while 30
                # communes stood available.
                widened = True
                pool = candidates(True)
                continue

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
        # A capital cannot fold into itself. Buftea is both Ilfov's seat and, once Bucharest
        # shadows it, a stood-down centre, so this loop popped its member list and then
        # appended to the key it had just removed. Nothing to do: it is already the capital.
        if capital is None or capital == absorber or capital not in result.members:
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


@functools.cache
def _capital_reach_cached(data_id: int, capital: str, radius: int) -> frozenset[str]:
    data = _DATA_BY_ID[data_id]
    reach = _county_road_distances(data, data.county[capital], [capital])
    return frozenset(
        uat
        for uat, metres in reach.items()
        if metres <= radius and uat != capital and _may_absorb(data, capital, uat)
    )


def is_capital_seat(data: Data, unit: str) -> bool:
    """A resedinta de judet, or Bucharest — which is a capital too, and kept being missed.

    Every rule protecting a capital's ring was written against `COUNTY_CAPITAL_SIRUTA`, which
    does not contain the Bucharest sectors. So growth handed the city all 14 communes
    touching it and the rebalancing pass then took 11 of them straight back, because nothing
    stopped it: the city ended up holding 3 of its own neighbours and 6 communes that do not
    touch it.
    """
    return unit in COUNTY_CAPITAL_SIRUTA or data.county[unit] == BUCHAREST_COUNTY_CODE


def capital_ring(data: Data, params: Params, unit: str) -> set[str]:
    """What a capital holds by right, and nothing more.

    The ring that borders it — for Bucharest, the ring around all six sectors — plus, for a
    resedinta de judet, its radius by road, because Calarasi sits on the Danube with three
    land neighbours and would otherwise be unable to take Roseti 9.9 km away.

    Plus the second layer *where it reaches the county border*. Between the capital's ring
    and the edge of the county there is often only one commune deep, and a strip one commune
    deep with a county line on the far side has nowhere to go: it cannot join the next county,
    and what is left of it after the ring is taken is too little to be a unit. Those go to the
    capital, which is what makes the metropolitan area reach the border rather than stop one
    commune short of it and strand the remainder.

    Deliberately *not* the whole second layer, and not the candidacy set. Protecting that
    instead shielded 17 communes around Bucharest that all had another unit adjacent and none
    of which were stranded: the city grew a uniform second ring rather than reaching only
    where it was needed. Anything past what a capital holds by right has to earn its place by
    being nearer to this seat than to any other, which the rebalancing pass decides.
    """
    if data.county[unit] == BUCHAREST_COUNTY_CODE:
        sectors = {s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE}
        ring = {
            neighbour
            for sector in sectors
            for neighbour in data.neighbours.get(sector, ())
            if _may_absorb(data, unit, neighbour)
        }
        return ring | _border_second_layer(data, unit, ring, sectors)

    ring = {
        neighbour
        for neighbour in data.neighbours.get(unit, ())
        if _may_absorb(data, unit, neighbour)
    }
    return ring | capital_reach(data, params, unit) | _border_second_layer(data, unit, ring, {unit})


def _border_second_layer(data: Data, unit: str, ring: set[str], core: set[str]) -> set[str]:
    """Second-layer communes that sit against a county line.

    A commune one step beyond the capital's ring, in the same county, that touches a
    different county. `touching` rather than `neighbours` on purpose: whether a county line
    runs along your edge is a question about the border itself, not about whether a road
    happens to cross it.
    """
    # The counties this capital's own territory spans, ring included — for Bucharest that is
    # B *and* Ilfov, since its whole ring is in Ilfov. Taking only the capital's own county
    # made every Ilfov neighbour read as "across a county line", which admitted the entire
    # second layer: the city went to 37 communes and Ilfov fell to four units, which is the
    # uniform second ring this is supposed not to be.
    home = {data.county[c] for c in core} | {data.county[m] for m in ring} | {data.county[unit]}
    out: set[str] = set()
    for member in ring:
        for candidate in data.neighbours.get(member, ()):
            if candidate in ring or candidate in core:
                continue
            if not _may_absorb(data, unit, candidate):
                continue
            if any(data.county[other] not in home for other in data.touching.get(candidate, ())):
                out.add(candidate)
    return out


def capital_reach(data: Data, params: Params, capital: str) -> set[str]:
    """What a county capital absorbs: everything within its radius by road.

    The radius, measured properly. It first meant area overlap against a buffer drawn round
    the whole city polygon, which is why Timisoara's "10 km" admitted communes 30 km away and
    the capital sprawled. Replacing it with "the communes that share a border with me" fixed
    the sprawl and threw out road distance altogether — so Calarasi, with three land
    neighbours because of the Danube, could not take Roseti 9.9 km away, while Dragalina took
    it from 45.4 km and wrapped around the capital. Nine of Dragalina's fifteen communes were
    nearer to Calarasi than to their own seat.

    Distance from the capital's seat along the road network, which is what the slider says
    and what a resident would measure.
    """
    _DATA_BY_ID[id(data)] = data
    return set(_capital_reach_cached(id(data), capital, _tier_radius(params, TIER_COUNTY_CAPITAL)))


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
        return capital_reach(data, params, capital)

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


# How many times the rebalancing pass may sweep the country. Each sweep only moves communes
# strictly closer to another seat, so it converges quickly; the limit is a guard against a
# pathological cycle, not a tuning knob.
# Identity map so the reach cache can key on the dataset without hashing it.
_DATA_BY_ID: dict[int, Data] = {}

_REBALANCE_SWEEPS = 8
# Rounds of equalising paired with re-seating. Each round is itself convergent; this only
# bounds the settling between the two.
_EQUALISE_ROUNDS = 4

# How many times re-seating and consolidation may take turns before the map is called
# settled. Two or three is normal; the limit is a guard, not a knob.
_SETTLE_ROUNDS = 6


def _shape_of(data: Data, members: Iterable[str]) -> tuple[float, float]:
    """Area and perimeter of a unit, from its members' scalars alone.

    A unit's area is the sum of its members' areas, and its outline is the sum of their
    perimeters less twice every border that falls inside it. Checked against the merged
    polygons on a sample of twelve units: identical to four decimal places. This is what
    lets the browser score a shape without carrying any geometry.
    """
    group = list(members)
    inside = set(group)
    area = 0.0
    perimeter = 0.0
    internal = 0.0
    for member in group:
        area += data.area_km2.get(member, 0.0)
        perimeter += data.perimeter_km.get(member, 0.0)
        # Every shared border, not only the ones a road crosses: a border with no road over
        # it is still a border when measuring an outline. Walking `neighbours` here left the
        # 156 road-less borders in the perimeter and put every score slightly wrong.
        for neighbour in data.touching.get(member, ()):
            if neighbour in inside:
                internal += data.shared_border_km.get((member, neighbour), 0.0)
    # Each internal border was counted from both sides, hence half of twice it.
    return area, perimeter - internal


def compactness(data: Data, members: Iterable[str]) -> float:
    """Polsby-Popper: 1.0 is a circle, a long ragged strip tends to zero."""
    area, perimeter = _shape_of(data, members)
    if perimeter <= 0:
        return 1.0
    return 4 * math.pi * area / (perimeter * perimeter)


def _shape_allows(data: Data, params: Params, before: list[str], after: list[str]) -> bool:
    """Whether a change may go ahead under the compactness floor.

    Refused only when the result is both below the floor *and* worse than what is there
    now. A unit that is already ragged — and plenty are, the median scores 0.24 — must still
    be able to take a commune, or the floor would freeze exactly the units that most need
    rearranging.
    """
    if params.min_compactness <= 0:
        return True
    now = compactness(data, before)
    then = compactness(data, after)
    return then >= params.min_compactness or then >= now


def _grow(
    data: Data,
    params: Params,
    result: Result,
    sources: list[str],
    blocked: set[str],
) -> None:
    """Grow every centre outward, one ring at a time, resolving each ring together.

    **Every centre takes its first ring before any centre takes a second.** Growth used to
    be a single shortest-path race, and a large centre reached past a small one's own
    doorstep: 56 units under 25,000 sat beside units over 55,000 with nothing left to take.

    **A ring is decided as one round, not claim by claim.** Every centre bids for every
    unclaimed commune it borders, all the bids are collected, and then the whole ring is
    settled at once. Populations only change between rounds, so no centre gets an advantage
    from being processed earlier in the alphabet.

    **A contested commune goes to a centre that still needs it.** Where two centres bid, one
    that would pass the target by taking it concedes to one that would not — a centre near
    its target should leave the commune to a neighbour still short of it. Among centres that
    are equal on that, the nearest by road wins, then the higher tier, then the larger.

    Capitals are exempt from the target rules entirely: they take the ring that borders them
    and stop, which is settled by their eligibility rather than by their population.
    """
    eligible = {seed: _eligible(data, params, seed, result.seeds[seed]) for seed in sources}
    gathered = {seed: 0 for seed in sources}
    distance_to: dict[tuple[str, str], float] = {}

    for seed in sorted(sources):
        if seed in result.region_of or seed in blocked:
            continue
        # The city starts whole. Bucharest is represented by its lowest sector, so its first
        # ring used to be *the other five sectors* — it spent two or three rounds absorbing
        # itself while Voluntari and Mihailesti took the communes around it at their own
        # first ring. It held 3 of the 14 communes touching the city and 6 that did not touch
        # it at all. The sectors are Bucharest already; they are claimed at distance zero so
        # that the city's first ring is the city's actual ring.
        opening = [seed]
        if result.seeds[seed] == TIER_NATIONAL_CAPITAL:
            opening = sorted(s for s in data.population if data.county[s] == BUCHAREST_COUNTY_CODE)
        for member in opening:
            if member in result.region_of or member in blocked:
                continue
            result.region_of[member] = seed
            result.members.setdefault(seed, []).append(member)
            gathered[seed] += data.population[member]
            distance_to[(seed, member)] = 0.0

    def is_capped(absorber: str) -> bool:
        return result.seeds[absorber] not in (TIER_NATIONAL_CAPITAL, TIER_COUNTY_CAPITAL)

    while True:
        # Every bid in this ring, collected before any of them is settled.
        bids: dict[str, dict[str, float]] = {}
        for absorber in sorted(sources):
            capped = is_capped(absorber)
            if capped and params.p_target > 0 and gathered[absorber] >= params.p_target:
                continue
            # A centre still short of the target reaches past its radius; the radius says
            # how far it pulls while it has a choice, not what stops it being viable.
            short = capped and params.p_target > 0 and gathered[absorber] < params.p_target
            for held in result.members.get(absorber, ()):
                base = distance_to.get((absorber, held))
                if base is None:
                    continue
                if params.max_road_m > 0 and base >= params.max_road_m:
                    continue
                for neighbour in data.neighbours.get(held, ()):
                    if neighbour in result.region_of or neighbour in blocked:
                        continue
                    if not _may_absorb(data, absorber, neighbour):
                        continue
                    if result.reserved_for.get(neighbour, absorber) != absorber:
                        continue
                    if neighbour not in eligible[absorber] and not short:
                        continue
                    step = data.road_distance.get(
                        (held, neighbour), _distance(data, held, neighbour)
                    )
                    # The cap is checked when claiming, not only when expanding: stopping
                    # expansion at the cap still let the last commune inside it pull a
                    # neighbour one long edge further, which is how Resita reached Teregova
                    # at 72.9 km against a 35 km cap.
                    reach = base + step
                    if params.max_road_m > 0 and reach > params.max_road_m:
                        continue
                    row = bids.setdefault(neighbour, {})
                    if absorber not in row or reach < row[absorber]:
                        row[absorber] = reach

        if not bids:
            return

        # Settle the ring nearest pair first, with running totals.
        #
        # The bids are collected across the whole county before any of them is settled, but
        # they are *awarded* one at a time in ascending distance, and each award updates the
        # winner's population immediately. Awarding a whole ring at once let one centre take
        # five communes in a single round and land 37,000 over the target while the centre
        # beside it stayed at 20,000: no single commune overshot, so the concession rule
        # never fired, and the imbalance was decided by who happened to be nearest to more
        # of them. With running totals a centre stops the moment it reaches the target and
        # the rest of its ring falls to neighbours that still need it.
        def key(bidder: str, uat: str, row: dict[str, float]) -> tuple:
            # A capital wins any contest for a commune on its own border, outright: a
            # resedinta de judet absorbs the ring around it and nothing overrides that.
            own_ring = bidder in COUNTY_CAPITAL_SIRUTA and uat in capital_reach(
                data, params, bidder
            )
            overshoot = (
                is_capped(bidder)
                and params.p_target > 0
                and gathered[bidder] + data.population[uat] > params.p_target
            )
            # Near-ties collapse to one band so that size, not metres, decides them. With
            # the band at zero every distance is its own band and this is the old ordering
            # exactly, which is what keeps the default behaviour unchanged.
            band = row[bidder] // params.r_tie_m if params.r_tie_m > 0 else row[bidder]
            return (
                0 if own_ring else 1,
                1 if overshoot else 0,
                band,
                # Within a band the absorber holding less takes it. This is what stops one
                # centre reaching 60,000 while the one beside it stays at 15,000.
                gathered[bidder] if params.r_tie_m > 0 else 0,
                row[bidder],
                result.seeds[bidder],
                -data.population[bidder],
                bidder,
            )

        order = sorted(bids, key=lambda u: (min(bids[u].values()), u))
        awarded = 0
        for uat in order:
            row = {
                bidder: reach
                for bidder, reach in bids[uat].items()
                if not (
                    is_capped(bidder)
                    and params.p_target > 0
                    and gathered[bidder] >= params.p_target
                )
            }
            if not row:
                continue
            ranked = sorted(row, key=lambda b, u=uat, rw=row: key(b, u, rw))
            absorber = next(
                (
                    b
                    for b in ranked
                    if _shape_allows(data, params, result.members[b], result.members[b] + [uat])
                ),
                None,
            )
            if absorber is None:
                continue
            result.region_of[uat] = absorber
            result.members.setdefault(absorber, []).append(uat)
            distance_to[(absorber, uat)] = row[absorber]
            gathered[absorber] += data.population[uat]
            awarded += 1

        if awarded == 0:
            return


def absorb_leftovers(data: Data, params: Params, result: Result) -> int:
    """Hand every commune no centre reached to a neighbouring unit.

    Leftovers are an artefact of the target, not of geography. A centre stops when it has
    gathered enough people, and once every centre around a commune is satisfied nobody is
    allowed to take it — 300 communes ended up stranded that way, none of them far from
    anywhere. Clustering them together afterwards produced units nobody had asked for.

    So they are handed out instead. A leftover goes to the neighbouring unit that is **still
    short of the target**, nearest by road; if every neighbour is satisfied it goes to the
    nearest of those instead, because a commune attached to a large unit is a better answer
    than a commune left on its own. The distance cap still applies: a commune further from
    every neighbouring seat than anyone should travel is left for the cluster step.

    Repeated until nothing more can be placed, because placing one commune gives its
    neighbours a unit to join.
    """
    placed = 0
    reach_cache: dict[str, dict[str, float]] = {}

    def reach_from(seat: str) -> dict[str, float]:
        cached = reach_cache.get(seat)
        if cached is None:
            cached = _county_road_distances(data, data.county[seat], [seat])
            reach_cache[seat] = cached
        return cached

    def unit_population(seat: str) -> int:
        return sum(data.population[m] for m in result.members[seat])

    # Two phases. The first hands out only what a non-capital unit will take, repeated until
    # it stops; the second allows a capital to take what is left.
    #
    # The order matters. A commune whose only neighbour is the capital's unit would otherwise
    # be handed over on the first pass, before the chain of other leftovers beside it has had
    # a chance to reach it — and once placed it is gone. Deferring them let 28 more communes
    # find a non-capital home.
    for capitals_allowed in (False, True):
        while True:
            moved = _leftover_pass(data, params, result, reach_from, capitals_allowed)
            if moved == 0:
                break
            placed += moved
    return placed


def _leftover_pass(
    data: Data,
    params: Params,
    result: Result,
    reach_from: Callable[[str], dict[str, float]],
    capitals_allowed: bool,
) -> int:
    def unit_population(seat: str) -> int:
        return sum(data.population[m] for m in result.members[seat])

    if True:  # noqa: SIM102 — keeps the diff small; the body is one pass
        moved = 0
        for siruta in sorted(data.population):
            if siruta in result.region_of:
                continue
            options: dict[str, float] = {}
            for neighbour in data.neighbours.get(siruta, ()):
                unit = result.region_of.get(neighbour)
                if unit is None or not _may_absorb(data, unit, siruta):
                    continue
                distance = reach_from(unit).get(siruta, math.inf)
                if params.max_road_m > 0 and distance > params.max_road_m:
                    continue
                if distance < options.get(unit, math.inf):
                    options[unit] = distance
            if not options:
                continue
            # A resedinta de judet takes the ring bordering it and nothing more. It may
            # still take a commune beyond that ring, but only in the second phase — once
            # every other unit has finished reaching outward and the commune still has
            # nowhere to go. Falling back to the capital as soon as nothing else has
            # arrived *yet* handed it over on the first pass, before the chain of leftovers
            # beside it had a chance to get there.
            if not capitals_allowed:
                options = {
                    u: dd
                    for u, dd in options.items()
                    if u not in COUNTY_CAPITAL_SIRUTA or siruta in capital_reach(data, params, u)
                }
                if not options:
                    continue

            # The shape floor applies here too, or it does nothing at all.
            #
            # Growth refuses a claim that would wreck an outline, and this step used to hand
            # the commune straight back a moment later — which is why turning the slider up
            # left Dragalina's horseshoe around Calarasi at 0.17 whatever it was set to.
            # Options that keep the shape are preferred; if none does, the commune still has
            # to go somewhere, and a commune left stranded is worse than a ragged edge.
            tidy = {
                u: dd
                for u, dd in options.items()
                if _shape_allows(data, params, result.members[u], result.members[u] + [siruta])
            }
            options = tidy or options

            short = {u: dd for u, dd in options.items() if unit_population(u) < params.p_target}
            if short:
                # Among units that still need people, the nearest by road.
                winner = min(short, key=lambda u, sh=short: (sh[u], u))
            else:
                # Every neighbour is satisfied, so this commune has to go somewhere it was
                # not needed. It goes to the *smallest* of them, not the nearest: handing
                # each one to the nearest piled them onto whichever unit happened to be
                # adjacent to the most leftovers, and took the worst county from a 219-fold
                # spread between its largest and smallest unit to 548. Distance breaks ties.
                winner = min(options, key=lambda u, op=options: (unit_population(u), op[u], u))
            result.region_of[siruta] = winner
            result.members[winner].append(siruta)
            moved += 1
        return moved


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

            reachable = [
                o
                for o in sorted(partners)
                if merge_is_compact(o)
                and _shape_allows(
                    data,
                    params,
                    result.members[absorber],
                    result.members[absorber] + result.members[o],
                )
            ]
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

            # Near-equal distances are decided by size, not by metres.
            #
            # Pantelimon (CT) is the case: 45.8 km from Oras Harsova and 44.5 km from
            # Municipiul Medgidia, so raw distance sent it to Medgidia — a unit of 109,471
            # over 1,752 km2 — rather than to Harsova, 23,290 over 828 km2. A difference of
            # 1.3 km is inside the error of any road measurement and means nothing to anyone
            # living there, while the difference in what the two units already carry is the
            # whole question. Within the band the emptier unit takes it: population first,
            # since that is what the target is about, then area, because a unit that is
            # already vast is the one that should stop growing.
            def merge_rank(o: str, this_reach: dict[str, float] = here) -> tuple:
                metres = this_reach.get(o, math.inf)
                band = metres // params.r_tie_m if params.r_tie_m > 0 else metres
                return (
                    band,
                    region_population(o),
                    sum(data.area_km2.get(m, 0.0) for m in result.members[o]),
                    metres,
                    o,
                )

            partner = min(choices, key=merge_rank)

            # Which seat survives is about the standing of the town, not the size the unit
            # happens to have reached: a county capital outranks anything, then a centre
            # outranks a cluster seat, then the larger town wins. Judging by unit population
            # made Măcin (7,248) the capital of a unit containing Babadag (9,213).

            # Coverage before size: a county keeps its minimum number of units even when
            # that leaves some of them short of the target. Merging is what collapsed the
            # count. Ilfov ended with two units and six other
            # counties with four, because every unit under the target kept merging until it
            # cleared it — and in a county whose population cannot support N_min units of
            # that size, that means merging all the way down. A county of five units at
            # 30,000 covers its ground; two units at 75,000 do not, whatever the target says.
            # Bucharest is one city, not a county that needs a spread of units.
            floor = 0 if county == BUCHAREST_COUNTY_CODE else params.n_min
            if floor > 0 and _county_unit_count(data, result, county) <= floor:
                continue

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


def absorb_stranded(data: Data, params: Params, result: Result) -> None:
    """Last resort for a unit the distance cap has stranded: join the best-shaped neighbour.

    `consolidate_to_target` refuses any merge that would put a commune beyond the cap,
    measured from the seat that survives. Where every same-county neighbour fails that test
    the unit stays exactly as it is, and on a county border that means a unit of one
    commune: Bulzesti (1,269) sits in the corner of Dolj with four of its five neighbours in
    Olt and Valcea, and the fifth over the cap at 57.9 km. Gradinari (2,448) misses by 500 m
    against a 50 km cap.

    A commune left administering itself for 1,269 people is a worse answer than a unit whose
    furthest village is 58 km from its seat rather than 50. So where there is no legal
    partner at all, the cap yields — and nothing else does. The county line still holds, the
    county minimum still holds, and a unit with a legal partner is left to the normal pass.

    **The partner is chosen by shape, not by distance.** Overriding the cap is exactly the
    move that produces a long ragged unit, so among the candidates this takes the one whose
    merged outline scores best on Polsby-Popper. Where only one neighbour exists the ranking
    changes nothing and the merge happens anyway: a bad shape still beats a leftover.
    """

    def region_population(unit: str) -> int:
        return sum(data.population[m] for m in result.members[unit])

    def standing(unit: str) -> tuple[int, int, int, str]:
        return (
            data.admin_rank[unit],
            result.seeds.get(unit, TIER_PROMOTED + 1),
            -data.population[unit],
            unit,
        )

    distance_cache: dict[str, dict[str, float]] = {}

    def reach_from(seat: str) -> dict[str, float]:
        cached = distance_cache.get(seat)
        if cached is None:
            cached = _county_road_distances(data, data.county[seat], [seat])
            distance_cache[seat] = cached
        return cached

    changed = True
    while changed:
        changed = False
        # Smallest first: the leftovers are what this exists for, and merging one can give
        # the next a partner it did not have.
        for absorber in sorted(result.members, key=lambda a: (region_population(a), a)):
            if absorber not in result.members:
                continue
            # Only leftovers, not every small unit the cap has stranded.
            if region_population(absorber) >= params.p_stranded:
                continue

            county = data.county[absorber]
            if county == BUCHAREST_COUNTY_CODE:
                continue
            # The Delta is exempt from the cap, so it is not stranded by it. Every distance
            # inside it is long and there is no shorter route; treating Oras Sulina as a
            # leftover dissolved the whole Delta into Municipiul Tulcea, which is the outcome
            # the Delta exception exists to prevent.
            if all(m in DELTA_WATER_UATS for m in result.members[absorber]):
                continue
            # Coverage still outranks size here, exactly as in the normal pass.
            if _county_unit_count(data, result, county) <= params.n_min:
                continue

            partners: set[str] = set()
            for member in result.members[absorber]:
                for neighbour in data.neighbours.get(member, ()):
                    other = result.region_of[neighbour]
                    if other == absorber or data.county[neighbour] != county:
                        continue
                    partners.add(other)
            if not partners:
                # Nothing adjacent inside its own county. The county line is not negotiable,
                # so this one is genuinely alone and is reported rather than forced.
                continue

            here = reach_from(absorber)

            def within_cap(other: str, this: str = absorber, this_reach=here) -> bool:
                if params.max_road_m <= 0:
                    return True
                if all(m in DELTA_WATER_UATS for m in result.members[this] + result.members[other]):
                    return True
                keeps_seat = standing(this) <= standing(other)
                reach = this_reach if keeps_seat else reach_from(other)
                everyone = result.members[this] + result.members[other]
                return all(reach.get(m, math.inf) <= params.max_road_m for m in everyone)

            # Only for units the normal pass cannot help. If anything is legally reachable,
            # this pass keeps its hands off and lets the ordinary rules decide.
            if any(within_cap(o) for o in partners):
                continue

            # Same preference order as the normal pass: a partner still short of the target
            # first, then any non-capital, and only then a capital. A capital is a drain of
            # last resort, not a first choice.
            still_small = [o for o in sorted(partners) if region_population(o) < params.p_target]
            not_a_capital = [o for o in sorted(partners) if o not in COUNTY_CAPITAL_SIRUTA]
            choices = still_small or not_a_capital or sorted(partners)

            best = max(
                choices,
                key=lambda o: (
                    compactness(data, result.members[absorber] + result.members[o]),
                    -here.get(o, math.inf),
                    o,
                ),
            )

            keep, drop = (
                (absorber, best) if standing(absorber) <= standing(best) else (best, absorber)
            )
            merged = result.members.pop(drop)
            result.members[keep].extend(merged)
            for m in merged:
                result.region_of[m] = keep
            result.orphan_regions.discard(drop)
            result.last_resort[drop] = keep
            distance_cache.pop(keep, None)
            changed = True


def _county_unit_count(data: Data, result: Result, county_code: str) -> int:
    """How many units currently have their seat in this county."""
    return sum(1 for seat in result.members if data.county[seat] == county_code)


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
    administratively, but 73.7 km from members the cap allows at 50 km.

    **The cap breaks ties within an administrative rank; it never overrides rank.** Filtering
    the whole field by the cap first is what produced the defect this function exists to
    prevent: it prefers a commune that holds the cap to a town that does not, so Zorleni
    seated a unit containing Oras Murgeni, and after the last-resort pass Gropeni (3,022)
    seated a unit containing Municipiul Braila (154,686). A unit is named after the most
    significant town in it; where that town cannot hold the cap, the cap is what gives, and
    the unit is reported as over-cap rather than administered from a village.
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

        if not members:
            continue
        # Only the most significant rank present may seat the unit. Within it the cap
        # decides, and if nothing there holds the cap, standing does.
        best_rank = min(data.admin_rank[m] for m in members)
        ranked = sorted((m for m in members if data.admin_rank[m] == best_rank), key=standing)
        new_seat = next((c for c in ranked if holds_the_cap(c)), ranked[0])
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


def rebalance(data: Data, params: Params, result: Result) -> int:
    """Move a commune to the neighbouring unit whose seat is actually nearer by road.

    Growth settles a commune against the state at the moment it was reached. By the time
    everything has grown, merged and been re-seated, some communes sit in a unit whose seat
    is further away than a neighbouring unit's — which is the thing a resident notices first
    and the thing that produces the ragged edges.

    A move has to satisfy all of this, so every one of them has a one-line reason:

      - the commune borders the unit it is moving to, and may legally join it;
      - that unit's seat is strictly nearer by road, and within the distance cap;
      - the unit it leaves stays in one piece;
      - the unit it leaves does not fall below the target if it was above it — a tidy edge
        is not worth breaking a unit that was already viable;
      - the commune is not a seat itself.

    Deterministic: communes are considered in SIRUTA order and the pass repeats until nothing
    moves, with a hard iteration limit so a pathological cycle cannot spin.
    """
    if not result.members:
        return 0

    moved_total = 0
    for _sweep in range(_REBALANCE_SWEEPS):
        reach_cache: dict[str, dict[str, float]] = {}

        def reach_from(
            seat: str, cache: dict[str, dict[str, float]] = reach_cache
        ) -> dict[str, float]:
            cached = cache.get(seat)
            if cached is None:
                cached = _county_road_distances(data, data.county[seat], [seat])
                cache[seat] = cached
            return cached

        moved = 0
        for siruta in sorted(data.population):
            here = result.region_of[siruta]
            if here == siruta:
                continue
            # A capital gives back anything beyond its ring that someone else will now take.
            #
            # A commune is handed to the capital when nothing else is adjacent at the time,
            # and units keep growing and merging afterwards, so by the end 56 of them touched
            # a unit that would have had them. This hands them over, and unlike an ordinary
            # rebalance it does not require the new seat to be nearer — the rule is that a
            # capital holds its ring, not that it holds whatever is closest to it.
            if is_capital_seat(data, here) and siruta not in capital_ring(data, params, here):
                takers = sorted(
                    {
                        result.region_of[n]
                        for n in data.neighbours.get(siruta, ())
                        if result.region_of[n] != here
                        and result.region_of[n] not in COUNTY_CAPITAL_SIRUTA
                        and _may_absorb(data, result.region_of[n], siruta)
                    }
                )
                # Only give it back to a unit that is actually nearer. The capital holding
                # a commune it is closest to is not sprawl, it is the road-distance rule —
                # Roseti is 9.9 km from Calarasi and 45.4 km from Dragalina, and giving it
                # back on the grounds that it lay outside the ring is how it ended up there.
                here_away = reach_from(here).get(siruta, math.inf)
                takers = [
                    t
                    for t in takers
                    if (
                        params.max_road_m <= 0
                        or reach_from(t).get(siruta, math.inf) <= params.max_road_m
                    )
                    and reach_from(t).get(siruta, math.inf) < here_away
                ]
                if takers:
                    rest = [m for m in result.members[here] if m != siruta]
                    if rest and _is_connected(data, rest):
                        winner = min(takers, key=lambda t: (reach_from(t).get(siruta, math.inf), t))
                        result.members[here] = rest
                        result.members[winner].append(siruta)
                        result.region_of[siruta] = winner
                        moved += 1
                        continue

            # A commune bordering its county capital belongs to the capital and is not
            # moved. Rebalancing asks only "is another seat nearer by road", and for a ring
            # commune the answer is often yes — which quietly undid the rule that a capital
            # absorbs the ring around it. Twenty-four of the forty-one capitals had lost
            # part of their ring to this pass.
            if is_capital_seat(data, here) and siruta in capital_ring(data, params, here):
                continue
            members = result.members[here]
            here_distance = reach_from(here).get(siruta, math.inf)

            best: tuple[float, str] | None = None
            for neighbour in data.neighbours.get(siruta, ()):
                there = result.region_of[neighbour]
                if there == here or not _may_absorb(data, there, siruta):
                    continue
                # Never *into* a capital beyond its ring either. Rebalancing asks only
                # "is another seat nearer by road", and a capital's seat very often is —
                # which grew the capitals past their ring by 172 communes after growth had
                # correctly held them to it.
                there_distance = reach_from(there).get(siruta, math.inf)
                if not there_distance < here_distance:
                    continue
                if params.max_road_m > 0 and there_distance > params.max_road_m:
                    continue
                if best is None or (there_distance, there) < best:
                    best = (there_distance, there)
            if best is None:
                continue
            target_unit = best[1]

            remaining = [m for m in members if m != siruta]
            if not remaining or not _is_connected(data, remaining):
                continue
            if params.p_target > 0:
                before = sum(data.population[m] for m in members)
                after = before - data.population[siruta]
                if before >= params.p_target > after:
                    continue

            if not _shape_allows(data, params, members, remaining):
                continue
            if not _shape_allows(
                data, params, result.members[target_unit], result.members[target_unit] + [siruta]
            ):
                continue

            result.members[here] = remaining
            result.members[target_unit].append(siruta)
            result.region_of[siruta] = target_unit
            moved += 1

        moved_total += moved
        if moved == 0:
            break
    return moved_total


def equalise(data: Data, params: Params, result: Result) -> int:
    """Hand a commune to a near-equally-distant neighbouring unit that is carrying less.

    Pantelimon (CT) is the case this exists for. It is 44.5 km from Municipiul Medgidia and
    45.8 km from Oras Harsova, and `rebalance` asks only whether another seat is *strictly*
    nearer, so 1.3 km kept it in Medgidia — 109,471 people over 1,752 km2 — instead of
    Harsova, 23,290 over 828 km2. Nothing before this point ever compared the two from
    Pantelimon: its own unit merged into Medgidia as a whole, judged from a seat 43 km closer
    to Medgidia than to Harsova. A difference of 1.3 km is inside the error of any road
    measurement and means nothing to a resident; what the two units already carry does not.

    **Separate from `rebalance`, and after it, on purpose.** The two rules converge on
    different quantities — rebalance lowers each commune's distance to its seat, this lowers
    the spread between units — and interleaving them cycles: run together, 650 communes
    ping-ponged on every sweep and the map became whatever the eighth sweep happened to
    leave. Alone, this terminates: moving a commune of `c` from H to T changes the sum of
    squared unit populations by 2c(T - H) + 2c^2, negative exactly when T + c < H, which is
    the condition below. Every permitted move strictly lowers a quantity bounded below.

    Every other rule still holds — the county line, the distance cap, contiguity, a capital's
    ring, and never breaking a unit that was already above the target.
    """
    if params.r_tie_m <= 0 or not result.members:
        return 0

    def unit_population(unit: str) -> int:
        return sum(data.population[m] for m in result.members[unit])

    def unit_area(unit: str) -> float:
        return sum(data.area_km2.get(m, 0.0) for m in result.members[unit])

    moved_total = 0
    for _sweep in range(_REBALANCE_SWEEPS):
        reach_cache: dict[str, dict[str, float]] = {}

        def reach_from(
            seat: str, cache: dict[str, dict[str, float]] = reach_cache
        ) -> dict[str, float]:
            cached = cache.get(seat)
            if cached is None:
                cached = _county_road_distances(data, data.county[seat], [seat])
                cache[seat] = cached
            return cached

        moved = 0
        for siruta in sorted(data.population):
            here = result.region_of[siruta]
            if here == siruta:
                continue
            # A capital holds the ring around it; that is not up for rebalancing.
            if is_capital_seat(data, here) and siruta in capital_ring(data, params, here):
                continue
            # And no centre gives up a commune on its own border. Balance is worth moving a
            # commune that happens to sit in one unit rather than another; it is not worth
            # taking a village off the town it adjoins. Without this, Oras Viseu de Sus lost
            # Sacel — which it borders — to Oras Borsa, purely because Borsa was carrying
            # less. The rule that a centre keeps its own neighbours outranks the spread.
            if siruta in data.neighbours.get(here, ()):
                continue
            here_distance = reach_from(here).get(siruta, math.inf)
            if not math.isfinite(here_distance):
                continue

            best: tuple | None = None
            for neighbour in data.neighbours.get(siruta, ()):
                there = result.region_of[neighbour]
                if there == here or not _may_absorb(data, there, siruta):
                    continue
                # Never grow a capital past its ring by this route either.
                if is_capital_seat(data, there) and siruta not in capital_ring(data, params, there):
                    continue
                there_distance = reach_from(there).get(siruta, math.inf)
                if not math.isfinite(there_distance):
                    continue
                if there_distance > here_distance + params.r_tie_m:
                    continue
                if params.max_road_m > 0 and there_distance > params.max_road_m:
                    continue
                # The move must strictly close the gap. This is both the point of the pass
                # and the reason it terminates.
                if unit_population(there) + data.population[siruta] >= unit_population(here):
                    continue
                # Population first, since that is what the target is about, then area,
                # because a unit that is already vast is the one that should stop growing.
                key = (unit_population(there), unit_area(there), there_distance, there)
                if best is None or key < best:
                    best = key
            if best is None:
                continue
            target_unit = best[-1]

            members = result.members[here]
            remaining = [m for m in members if m != siruta]
            if not remaining or not _is_connected(data, remaining):
                continue
            if params.p_target > 0:
                before = sum(data.population[m] for m in members)
                after = before - data.population[siruta]
                if before >= params.p_target > after:
                    continue
            if not _shape_allows(data, params, members, remaining):
                continue
            if not _shape_allows(
                data, params, result.members[target_unit], result.members[target_unit] + [siruta]
            ):
                continue

            result.members[here] = remaining
            result.members[target_unit].append(siruta)
            result.region_of[siruta] = target_unit
            moved += 1

        moved_total += moved
        if moved == 0:
            break
    return moved_total


def _is_connected(data: Data, members: list[str]) -> bool:
    """Whether a set of communes forms one piece over the road-connected graph."""
    inside = set(members)
    seen = {members[0]}
    stack = [members[0]]
    while stack:
        current = stack.pop()
        for neighbour in data.neighbours.get(current, ()):
            if neighbour in inside and neighbour not in seen:
                seen.add(neighbour)
                stack.append(neighbour)
    return len(seen) == len(inside)


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
        # Counted from the finished map against the centres originally selected, not from a
        # set carried along and edited by every later step. A tier moves with the seat when a
        # unit is re-seated, so "does this seat hold a tier" drifts between two runs that
        # produce the same map by different routes — which is exactly how the reference and
        # the port came to disagree by one on Oras Targu Bujor, a commune of 5,946 that was
        # never a centre in either.
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
    # Before the cluster step: a commune nobody reached should join a neighbouring unit, not
    # start a unit of its own with the other communes nobody reached.
    absorb_leftovers(data, params, result)
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
    # Last: by now everything has grown, merged and been re-seated, so this is the first
    # point at which "is this commune actually in the nearest unit" can be asked of the
    # finished map rather than of a half-built one.
    result.rebalanced = rebalance(data, params, result)

    # Re-seat and consolidate until they agree.
    #
    # They interact: consolidation judges a merge by road distance from the seat that would
    # survive, and re-seating then moves that seat, which can make a refused merge feasible.
    # Running each once left units reported as short that in fact had somewhere to go. The
    # loop ends when a consolidation pass merges nothing, so the seats the last pass judged
    # from are the seats the map ends with.
    for _ in range(_SETTLE_ROUNDS):
        reseat_units(data, params, result)
        before = len(result.members)
        consolidate_to_target(data, params, result)
        # Rebalancing belongs inside the loop, not before it: merging changes which units
        # are adjacent, so a commune the capital had to keep for want of a neighbour can
        # acquire one only after a merge two counties over has happened.
        result.rebalanced += rebalance(data, params, result)
        if len(result.members) == before:
            break

    # Last of all, and only on what the ordinary rules could not place. Running it earlier
    # would let a cap-breaking merge stand where a later re-seating would have made a legal
    # one possible.
    absorb_stranded(data, params, result)
    reseat_units(data, params, result)
    # A last-resort merge changes membership like any other, so the map is rebalanced against
    # it. Skipping this left Vernesti in Oras Pogoanele 48.7 km away while Municipiul Buzau
    # sat 10.6 km off: it had always been misplaced, and was excused only because removing it
    # would have dropped Pogoanele below the target. Giving Pogoanele slack made the
    # misplacement live, and this is what corrects it.
    result.rebalanced += rebalance(data, params, result)
    # Last, and on its own: see `equalise` for why it cannot share a loop with `rebalance`.
    # It has to run *after* rebalance and never before, because rebalance asks only whether a
    # seat is strictly nearer and would hand Pantelimon straight back to Medgidia.
    #
    # Paired with re-seating rather than run once: moving communes can give a unit a more
    # significant town than its seat, and moving the seat changes the distances this pass
    # measured, which opens a few more moves. Two or three rounds settle it.
    for _ in range(_EQUALISE_ROUNDS):
        moved = equalise(data, params, result)
        result.equalised += moved
        if moved == 0:
            break
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
