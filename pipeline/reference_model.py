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
import pandas as pd

from pipeline.constants import (
    ABSORBER_POP_THRESHOLD_DEFAULT,
    MIN_OVERLAP_DEFAULT,
    N_MIN_DEFAULT,
    P_ORPHAN_DEFAULT,
    P_TARGET_DEFAULT,
    R_CAP_DEFAULT_M,
    R_SEP_DEFAULT_M,
    R_SEP_RELAXATION_FACTOR,
    R_SEP_RELAXATION_FLOOR_M,
    R_TOWN_DEFAULT_M,
    RADIUS_GRID_M,
    TIER_COUNTY_CAPITAL,
    TIER_POPULATION,
    TIER_PROMOTED,
)
from pipeline.county_capitals import COUNTY_CAPITAL_SIRUTA
from pipeline.paths import PROCESSED_DIR


@dataclass(frozen=True)
class Params:
    x: int = ABSORBER_POP_THRESHOLD_DEFAULT
    r_cap_m: int = R_CAP_DEFAULT_M
    r_town_m: int = R_TOWN_DEFAULT_M
    n_min: int = N_MIN_DEFAULT
    r_sep_m: int = R_SEP_DEFAULT_M
    min_overlap: float = MIN_OVERLAP_DEFAULT
    p_orphan: int = P_ORPHAN_DEFAULT
    p_target: int = P_TARGET_DEFAULT

    def snapped(self) -> Params:
        """Radii must land on the precomputed grid; the UI slider snaps to it too."""
        return Params(
            x=self.x,
            r_cap_m=_snap(self.r_cap_m),
            r_town_m=_snap(self.r_town_m),
            n_min=self.n_min,
            r_sep_m=self.r_sep_m,
            min_overlap=self.min_overlap,
            p_orphan=self.p_orphan,
            p_target=self.p_target,
        )


def _snap(radius: int) -> int:
    return min(RADIUS_GRID_M, key=lambda r: (abs(r - radius), r))


@dataclass
class Data:
    """Everything the model reads, loaded once and never mutated."""

    population: dict[str, int]
    county: dict[str, str]
    name: dict[str, str]
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
    seat_xy = {r.siruta: (r.geometry.x, r.geometry.y) for r in seats.itertuples()}
    operating = dict(zip(finance["siruta"], finance["operating_ron"].astype(float), strict=True))
    administrative = dict(
        zip(finance["siruta"], finance["administrative_ron"].astype(float), strict=True)
    )

    # Only traversable edges exist as far as the model is concerned: a road crossing, or
    # the local fallback for a UAT that has no road-connected neighbour at all.
    usable = adjacency[adjacency["traversable"]]
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
    return params.r_cap_m if tier == TIER_COUNTY_CAPITAL else params.r_town_m


def _reach(data: Data, params: Params, seed: str, tier: int) -> set[str]:
    """Every UAT this seed's buffer admits as a candidate, at its tier radius."""
    entries = data.candidacy.get((_tier_radius(params, tier), seed), ())
    return {
        target
        for target, fraction, seat_inside in entries
        if fraction >= params.min_overlap or seat_inside
    }


def select_seeds(data: Data, params: Params, result: Result) -> None:
    """Brief §2 step 1: tiers 0 and 1, then greedy max-coverage promotion per county."""
    for siruta in data.absorbers:
        if siruta in COUNTY_CAPITAL_SIRUTA or data.county[siruta] == "B":
            result.seeds[siruta] = TIER_COUNTY_CAPITAL
        elif data.population[siruta] >= params.x:
            result.seeds[siruta] = TIER_POPULATION

    for county_code in sorted(data.by_county):
        in_county = [s for s in data.by_county[county_code] if s in result.seeds]
        if len(in_county) >= params.n_min:
            continue

        pool = [
            s for s in data.by_county[county_code] if s in data.absorbers and s not in result.seeds
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

            best: tuple[int, int, str] | None = None
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
                key = (-gain, -data.population[candidate], candidate)
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
    """Assign every reachable UAT to the centre nearest to it **by road**.

    This departs from brief §2 step 4, which resolves conflicts by processing order: county
    capitals first, then by population. Measured on the real map that rule produces results
    nobody can defend. Sarichioi shares a road-connected border with Babadag 12 km away and
    does not border Tulcea at all, yet Tulcea took it — purely because county capitals are
    processed first and Tulcea's large polygon buffers far enough to reach.

    So the region grows as a shortest-path tree instead: a commune joins whichever centre
    reaches it along the shortest road, measured seat to seat and accumulated along the
    path actually travelled. That keeps every property the wave version had — a region is
    connected, never leapfrogs, never crosses a county line — while making "why this centre
    and not that one" answerable with a number rather than with a processing order.

    Ties break on centre tier, then population descending, then SIRUTA, so the result stays
    identical between runs.
    """
    # (distance, tier, -population, siruta, uat) — the tuple *is* the tie-break rule.
    heap: list[tuple[float, int, int, str, str]] = []
    for seed in sorted(result.seeds):
        tier = result.seeds[seed]
        heapq.heappush(heap, (0.0, tier, -data.population[seed], seed, seed))

    # Candidacy per centre, resolved once: which UATs its radius admits at all.
    eligible: dict[str, dict[str, float]] = {}
    for seed, tier in result.seeds.items():
        entries = data.candidacy.get((_tier_radius(params, tier), seed), ())
        eligible[seed] = {
            target: fraction
            for target, fraction, seat_inside in entries
            if fraction >= params.min_overlap or seat_inside
        }

    while heap:
        distance, tier, neg_population, absorber, uat = heapq.heappop(heap)
        if uat in result.region_of:
            continue
        if uat != absorber:
            if data.county[uat] != data.county[absorber]:
                continue
            if uat not in eligible[absorber]:
                continue

        result.region_of[uat] = absorber
        result.members.setdefault(absorber, []).append(uat)

        for neighbour in data.neighbours.get(uat, ()):
            if neighbour in result.region_of:
                continue
            step = data.road_distance.get(
                (uat, neighbour),
                # No routed distance: the border is road-crossing but the router could not
                # find a path. Straight line is a floor on the real distance, so it never
                # makes a centre look closer than it is by more than the detour.
                _distance(data, uat, neighbour),
            )
            heapq.heappush(heap, (distance + step, tier, neg_population, absorber, neighbour))

    for absorber in result.members:
        result.members[absorber].sort(key=lambda m: (-data.population[m], m))


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
    """Merge resulting units that are still below the target population.

    The gravitational rules answer "who can reach whom". This answers a different question:
    "is the result large enough to be worth creating". A unit of 4,000 people still needs a
    mayor, a secretary and a budget, so a scenario can leave you with a smaller map that has
    not actually fixed anything.

    A unit below the target absorbs the smallest neighbouring unit it can, repeatedly, until
    it reaches the target or runs out of neighbours **in its own county**. The larger of the
    two keeps its seat, because that is the administration more likely to have the capacity.

    Units can end below the target legitimately: an isolated commune whose every neighbour
    is already large has nowhere to go. They are reported rather than forced.
    """
    if params.p_target <= 0:
        return

    def region_population(absorber: str) -> int:
        return sum(data.population[m] for m in result.members[absorber])

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

            # Neighbouring units reachable from any member, in the same county.
            partners: set[str] = set()
            for member in result.members[absorber]:
                for neighbour in data.neighbours.get(member, ()):
                    other = result.region_of[neighbour]
                    if other == absorber:
                        continue
                    if data.county[neighbour] != data.county[member]:
                        continue
                    partners.add(other)

            if not partners:
                continue

            # Smallest first, so a small unit pairs with another small one rather than
            # being swallowed by the nearest city.
            partner = min(partners, key=lambda o: (region_population(o), o))

            a_pop, b_pop = region_population(absorber), region_population(partner)
            keep, drop = (
                (absorber, partner)
                if (a_pop, absorber) >= (b_pop, partner)
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
    consolidate_to_target(data, params, result)
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
