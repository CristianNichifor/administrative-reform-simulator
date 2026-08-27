/**
 * The gravitational accretion model — TypeScript port of `pipeline/reference_model.py`.
 *
 * The Python implementation is the specification. Where the two disagree, this one is
 * wrong, and `tests/parity.test.ts` asserts they never do across 24 parameter
 * combinations.
 *
 * Two things make the port match exactly rather than approximately:
 *
 *  - UAT indices are assigned in SIRUTA sort order, so every "then SIRUTA ascending"
 *    tie-break in the brief becomes an ascending integer comparison here.
 *  - Nothing iterates a Set or a Map in insertion order. Every loop that can affect the
 *    outcome walks a sorted array, exactly as the Python does.
 */

import {
  R_SEP_RELAXATION_FACTOR,
  R_SEP_RELAXATION_FLOOR_M,
  TIER_COUNTY_CAPITAL,
  TIER_NATIONAL_CAPITAL,
  TIER_POPULATION,
  TIER_PROMOTED,
  REASON,
  type ModelData,
  type ModelResult,
  type Params,
  type Pin,
  type RadiusSlice,
} from './types';

const NO_REGION = 0xffff;

function tierRadius(params: Params, tier: number): number {
  if (tier === TIER_NATIONAL_CAPITAL) return params.rNationalM;
  if (tier === TIER_COUNTY_CAPITAL) return params.rCapM;
  return params.rTownM;
}

const isCapitalTier = (tier: number): boolean =>
  tier === TIER_NATIONAL_CAPITAL || tier === TIER_COUNTY_CAPITAL;

/** Anything at or above `oras` is a town rather than a village-based commune. */
const ADMIN_RANK_ORAS = 3;

/**
 * Whether `absorber` is allowed to take `uat` at all.
 *
 * Units are county-bound with exactly one exception: Bucharest and its Ilfov ring. The
 * county line there runs through continuous built-up area — Otopeni, Voluntari and
 * Pantelimon are the city's suburbs in every practical sense — and it is the only place in
 * the country where that is true.
 */
function mayAbsorb(data: ModelData, absorber: number, uat: number): boolean {
  const from = data.countyOf[absorber]!;
  const to = data.countyOf[uat]!;
  if (from === to) return true;
  return from === data.bucharestCounty && to === data.ilfovCounty;
}

/**
 * UATs close enough to a capital that it takes them over rather than competing with them.
 *
 * Deliberately tighter than `eligibleFor`, which admits a UAT when a tenth of its *area*
 * falls inside the buffer. That is right for growth and wrong for standing a centre down:
 * a quarter of Sighetu Marmatiei's sprawling territory reaches Baia Mare's buffer while the
 * two seats are 38 km apart, and demoting a municipiu of 34,000 on that basis is
 * indefensible. Here the centre's own seat has to be within the radius.
 */
function capitalCore(data: ModelData, params: Params, capital: number, tier: number): Set<number> {
  const core = new Set<number>();

  // Matches eligibleFor exactly. A centre stood down for a capital that cannot reach it is
  // stranded: it loses its own centre status and nobody arrives to take it.
  if (tier === TIER_COUNTY_CAPITAL) {
    for (let e = data.neighbourStart[capital]!; e < data.neighbourStart[capital + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (mayAbsorb(data, capital, nb)) core.add(nb);
    }
    return core;
  }

  const slice = sliceFor(data, params, tier);
  const radius = tierRadius(params, tier);
  const sources = tier === TIER_NATIONAL_CAPITAL ? data.bucharestSectors : [capital];
  for (const source of sources) {
    if (slice) {
      for (let i = slice.rowStart[source]!; i < slice.rowStart[source + 1]!; i += 1) {
        const target = slice.target[i]!;
        if (slice.seatInside[i] === 1 && mayAbsorb(data, capital, target)) core.add(target);
      }
    }
    for (let e = data.neighbourStart[source]!; e < data.neighbourStart[source + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (mayAbsorb(data, capital, nb) && data.neighbourRoadM[e]! <= radius) core.add(nb);
    }
  }
  return core;
}

/**
 * Which capital takes `uat` over: the national capital first, then nearest by road.
 *
 * Tier before distance because Chiajna is a Bucharest suburb that borders the city, yet
 * Buftea's seat is marginally closer to it by road. Reserving it for Buftea meant neither
 * capital's growth ever arrived and Chiajna stayed a unit of three on the city's edge.
 */
function shadowingCapital(
  data: ModelData,
  tierOf: Int8Array,
  cores: Map<number, Set<number>>,
  uat: number,
): number | undefined {
  let best: number | undefined;
  let bestTier = 0;
  let bestStep = 0;
  for (const [capital, core] of cores) {
    // A capital that has itself been stood down is no longer one.
    if (tierOf[capital] === -1) continue;
    if (!core.has(uat) || !mayAbsorb(data, capital, uat)) continue;
    const tier = tierOf[capital]!;
    let step = Infinity;
    for (let e = data.neighbourStart[capital]!; e < data.neighbourStart[capital + 1]!; e += 1) {
      if (data.neighbours[e] === uat) { step = data.neighbourRoadM[e]!; break; }
    }
    if (!Number.isFinite(step)) step = Math.hypot(
      data.seatX[capital]! - data.seatX[uat]!,
      data.seatY[capital]! - data.seatY[uat]!,
    );
    if (
      best === undefined ||
      tier < bestTier ||
      (tier === bestTier && step < bestStep) ||
      (tier === bestTier && step === bestStep && capital < best)
    ) {
      best = capital; bestTier = tier; bestStep = step;
    }
  }
  return best;
}

/**
 * What a centre may absorb, and how much of each commune its buffer covers.
 *
 * Three independent routes in: enough overlap, its seat inside the radius, or reachable
 * within the radius by road. The third exists because a long, thin commune can sit ten
 * minutes down a direct road and still fail an area test — its area points elsewhere.
 * Shape should not decide who your administration is.
 */
function eligibleFor(data: ModelData, params: Params, seed: number, tier: number): Map<number, number> {
  const admitted = new Map<number, number>();

  // A county capital takes the ring that borders it, and nothing beyond.
  //
  // The radius does not mean what its name suggests: candidacy is area overlap against a
  // buffer round the whole city polygon, so Timisoara's "10 km" admitted 19 communes, 15 of
  // them past 10 km by road and one at 30 km. Bucharest is deliberately excluded — it is the
  // national capital, not a resedinta de judet, and its ring is two communes deep.
  if (tier === TIER_COUNTY_CAPITAL) {
    for (let e = data.neighbourStart[seed]!; e < data.neighbourStart[seed + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (mayAbsorb(data, seed, nb)) admitted.set(nb, 0);
    }
    return admitted;
  }

  const slice = sliceFor(data, params, tier);
  const radius = tierRadius(params, tier);
  // Candidacy is precomputed per UAT and Bucharest is represented by one sector, whose
  // buffer points north-west; the city's reach is the union of its six sectors'. Without
  // this the capital absorbed Chitila and nothing else.
  const sources = tier === TIER_NATIONAL_CAPITAL ? data.bucharestSectors : [seed];
  const threshold = params.minOverlap * data.manifest.overlapScale;
  for (const source of sources) {
    if (slice) {
      for (let i = slice.rowStart[source]!; i < slice.rowStart[source + 1]!; i += 1) {
        if (slice.overlap[i]! >= threshold || slice.seatInside[i] === 1) {
          const target = slice.target[i]!;
          const prev = admitted.get(target) ?? -1;
          if (slice.overlap[i]! > prev) admitted.set(target, slice.overlap[i]!);
        }
      }
    }
    for (let e = data.neighbourStart[source]!; e < data.neighbourStart[source + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (admitted.has(nb) || !mayAbsorb(data, seed, nb)) continue;
      if (data.neighbourRoadM[e]! <= radius) admitted.set(nb, 0);
    }
  }
  return admitted;
}

function sliceFor(data: ModelData, params: Params, tier: number): RadiusSlice | undefined {
  return data.byRadius.get(tierRadius(params, tier));
}

/**
 * Road distance from the nearest of `sources` to every UAT in one county.
 *
 * Separation between centres is a road distance like everything else here, and centres are
 * rarely adjacent, so it cannot be read from the per-edge table directly. This walks the
 * UAT graph inside the county using those per-edge distances as weights — the same numbers,
 * and the same notion of distance, that accretion uses.
 *
 * Confined to the county because a region may never cross a county line, so a route that
 * leaves and comes back is not one this model would ever travel.
 */
function countyRoadDistances(
  data: ModelData,
  county: number,
  sources: number[],
): Map<number, number> {
  const best = new Map<number, number>();
  // A plain array used as a queue with a linear scan for the minimum. Counties hold a few
  // dozen UATs, where that beats the bookkeeping of a heap.
  const frontier: number[] = [];
  for (const s of [...sources].sort((a, b) => a - b)) {
    best.set(s, 0);
    frontier.push(s);
  }

  while (frontier.length > 0) {
    let pick = 0;
    for (let i = 1; i < frontier.length; i += 1) {
      if (best.get(frontier[i]!)! < best.get(frontier[pick]!)!) pick = i;
    }
    const uat = frontier.splice(pick, 1)[0]!;
    const distance = best.get(uat)!;

    for (let e = data.neighbourStart[uat]!; e < data.neighbourStart[uat + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (data.countyOf[nb] !== county) continue;
      const candidate = distance + data.neighbourRoadM[e]!;
      if (candidate < (best.get(nb) ?? Infinity)) {
        best.set(nb, candidate);
        frontier.push(nb);
      }
    }
  }
  return best;
}

/**
 * Every UAT the seed's buffer admits, at its tier radius.
 *
 * A UAT qualifies on overlap or on its seat point falling inside the buffer — the seat rule
 * has no threshold, which is what lets a commune whose territory barely grazes a town still
 * be absorbed by it when its village is inside the radius.
 */
function reach(data: ModelData, params: Params, seed: number, tier: number): number[] {
  const slice = sliceFor(data, params, tier);
  if (!slice) return [];
  const from = slice.rowStart[seed]!;
  const to = slice.rowStart[seed + 1]!;
  const threshold = params.minOverlap * data.manifest.overlapScale;
  const out: number[] = [];
  for (let i = from; i < to; i += 1) {
    if (slice.overlap[i]! >= threshold || slice.seatInside[i] === 1) {
      out.push(slice.target[i]!);
    }
  }
  return out;
}

function selectSeeds(data: ModelData, params: Params): {
  tierOf: Int8Array;
  underSeeded: string[];
  held: Set<number>;
  reservedFor: Map<number, number>;
} {
  const tierOf = new Int8Array(data.uatCount).fill(-1);

  // Bucharest is one centre, not six. Its sectors never compete: six parallel
  // administrations over one continuous city is the duplication this exercise is about, so
  // they merge rather than being modelled as rivals. The lowest-index sector stands for the
  // city, since no "Municipiul Bucuresti" row exists in the UAT set.
  if (data.bucharestIndex >= 0) tierOf[data.bucharestIndex] = TIER_NATIONAL_CAPITAL;

  for (let k = 0; k < data.absorbers.length; k += 1) {
    const i = data.absorbers[k]!;
    if (data.countyOf[i] === data.bucharestCounty) continue;
    if (data.attributes.isCapital[i]) {
      tierOf[i] = TIER_COUNTY_CAPITAL;
    } else if (data.population[i]! >= params.x) {
      tierOf[i] = TIER_POPULATION;
    }
  }

  // A centre inside its capital's reach is stood down, and the capital takes it.
  //
  // This is what builds a metropolitan area rather than a ring of small rivals: Cumpana is
  // part of Constanta in every practical sense, so leaving it a separate centre describes
  // an administrative fiction. The centre role does not vanish with it — the candidate is
  // removed before promotion runs, so the county fills its quota from a town further out,
  // which is where a second centre is actually useful.
  const cores = new Map<number, Set<number>>();
  for (let i = 0; i < data.uatCount; i += 1) {
    if (tierOf[i] !== -1 && isCapitalTier(tierOf[i]!)) {
      cores.set(i, capitalCore(data, params, i, tierOf[i]!));
    }
  }
  const held = new Set<number>();
  for (let i = 0; i < data.uatCount; i += 1) {
    if (tierOf[i] === -1 || tierOf[i] === TIER_NATIONAL_CAPITAL) continue;
    for (const [capital, core] of cores) {
      if (capital === i || !core.has(i) || !mayAbsorb(data, capital, i)) continue;
      // A county capital is normally untouchable. The exception is Bucharest, which stands
      // down Ilfov's: Buftea sits inside the city's reach and, protected as a capital, came
      // out a unit of one UAT and 20,577 people in the middle of the metropolitan area.
      // Only the national capital may do this, and only across the one county line allowed.
      if (tierOf[i] === TIER_COUNTY_CAPITAL && tierOf[capital] !== TIER_NATIONAL_CAPITAL) {
        continue;
      }
      held.add(i);
      break;
    }
  }

  // Nothing inside a capital's reach may be promoted to a centre.
  //
  // Standing centres down runs once, before promotion. Without this the promotion loop put
  // new ones back inside the same reach: Ganeasa (5,402) and Cornetu (7,389) both sit inside
  // Bucharest's radius and both came out units of a single UAT, because they became centres
  // *after* the rule that would have stood them down had run. A centre the capital would
  // immediately take is not a centre.
  // Demote every stood-down centre *before* working out who reserved it. Done in one pass,
  // a capital demoted earlier in the loop is still a key in `cores` but reads as tier -1,
  // which sorts ahead of the national capital — Buftea, demoted first, captured Otopeni and
  // Chiajna from Bucharest that way.
  for (const uat of held) tierOf[uat] = -1;

  // Built after the demotion, not before: a capital that has itself been stood down is no
  // longer one, and its reach must not go on blocking promotions. Buftea's did, which kept
  // Peris out of the pool in the port while the reference promoted it.
  const capitalReach = new Set<number>();
  for (const [capital, core] of cores) {
    if (tierOf[capital] === -1) continue;
    for (const u of core) if (mayAbsorb(data, capital, u)) capitalReach.add(u);
  }

  const reservedFor = new Map<number, number>();
  for (const uat of [...held].sort((a, b) => a - b)) {
    const capital = shadowingCapital(data, tierOf, cores, uat);
    if (capital !== undefined) reservedFor.set(uat, capital);
  }

  // Group UATs by county, each list ascending by index (i.e. by SIRUTA).
  const byCounty = new Map<number, number[]>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const c = data.countyOf[i]!;
    let list = byCounty.get(c);
    if (!list) {
      list = [];
      byCounty.set(c, list);
    }
    list.push(i);
  }

  const isAbsorber = new Uint8Array(data.uatCount);
  for (let k = 0; k < data.absorbers.length; k += 1) isAbsorber[data.absorbers[k]!] = 1;

  const underSeeded: string[] = [];

  // Counties are visited in code order to mirror the Python, which sorts county codes.
  // Promotion is independent per county, so this cannot change the outcome — but matching
  // the reference exactly is cheaper than arguing about whether it could.
  const countyOrder = [...byCounty.keys()].sort((a, b) =>
    data.countyCodes[a]! < data.countyCodes[b]! ? -1 : 1,
  );

  for (const county of countyOrder) {
    // Bucharest is one city, not a county needing a spread of centres. Promotion here made
    // four of its six sectors centres in their own right — the duplication the merge exists
    // to remove.
    if (county === data.bucharestCounty) continue;
    const uats = byCounty.get(county)!;
    const seedsHere = uats.filter((i) => tierOf[i] !== -1);
    if (seedsHere.length >= params.nMin) continue;

    // Towns join the pool whatever their population. The threshold decides who is
    // *automatically* a centre; promotion exists to fill a county that came up short, and
    // there a town with a town hall is a better answer than a large commune.
    const pool = uats.filter(
      (i) =>
        (isAbsorber[i] === 1 || data.attributes.adminRank[i]! <= ADMIN_RANK_ORAS) &&
        tierOf[i] === -1 &&
        !held.has(i) &&
        !capitalReach.has(i),
    );

    const covered = new Uint8Array(data.uatCount);
    for (const seed of seedsHere) {
      for (const u of reach(data, params, seed, tierOf[seed]!)) covered[u] = 1;
    }

    let rSep = params.rSepM;

    while (seedsHere.length < params.nMin) {
      // Recomputed whenever the seed set changes: separation is measured from the nearest
      // existing centre by road, not in a straight line.
      const separation =
        seedsHere.length > 0 ? countyRoadDistances(data, county, seedsHere) : null;

      let bestIndex = -1;
      let bestGain = -1;
      let bestRank = 99;
      let bestPop = -1;

      for (const candidate of pool) {
        if (separation && rSep > 0) {
          // Unreachable by road inside the county counts as far away, not as zero: an
          // isolated candidate is a good centre, not a disqualified one.
          if ((separation.get(candidate) ?? Infinity) < rSep) continue;
        }

        let gain = 0;
        for (const u of reach(data, params, candidate, TIER_PROMOTED)) {
          if (covered[u] === 0) gain += data.population[u]!;
        }

        // Greedy max-coverage, then population descending, then index (SIRUTA) ascending.
        // Ranking by raw population instead would cluster seeds in whichever corner of the
        // county is densest, which is precisely what this step exists to prevent.
        // Coverage first, then administrative standing, then size. Without the standing
        // term a commune promoted for its coverage outranks a town that was never promoted.
        const pop = data.population[candidate]!;
        const rank = data.attributes.adminRank[candidate]!;
        if (
          bestIndex === -1 ||
          gain > bestGain ||
          (gain === bestGain && rank < bestRank) ||
          (gain === bestGain && rank === bestRank && pop > bestPop) ||
          (gain === bestGain && rank === bestRank && pop === bestPop && candidate < bestIndex)
        ) {
          bestIndex = candidate;
          bestGain = gain;
          bestRank = rank;
          bestPop = pop;
        }
      }

      if (bestIndex === -1) {
        rSep *= R_SEP_RELAXATION_FACTOR;
        if (rSep < R_SEP_RELAXATION_FLOOR_M) {
          underSeeded.push(data.countyCodes[county]!);
          break;
        }
        continue;
      }

      tierOf[bestIndex] = TIER_PROMOTED;
      seedsHere.push(bestIndex);
      pool.splice(pool.indexOf(bestIndex), 1);
      for (const u of reach(data, params, bestIndex, TIER_PROMOTED)) covered[u] = 1;
    }
  }

  return { tierOf, underSeeded, held, reservedFor };
}

/**
 * Grow every centre outward along the road network, in three passes.
 *
 * **Capitals are not capped.** A county capital absorbs whatever its radius admits. The
 * population target governs the smaller centres only: Tulcea alone is 65,624, already past
 * a 50,000 target, so capping it would have it absorb nothing at all.
 *
 * **Smaller centres stop at the target**, which leaves something for their neighbours
 * rather than letting whoever is nearest to the most communes sweep the county.
 *
 * **A centre bordering its county capital is held back.** Otherwise the capital eats it on
 * the first step and a perfectly good town disappears because of where it happens to sit.
 * It is left alone while everyone else grows, then asked whether it can still reach the
 * target from what remains. If it can, it stays. If not, it folds into the capital — the
 * outcome it was protected from, but only once that is shown to be right rather than an
 * accident of ordering.
 */
function accrete(
  data: ModelData,
  params: Params,
  tierOf: Int8Array,
  regionOf: Uint16Array,
  reasonOf: Uint8Array,
  overlapOf: Uint8Array,
  members: Map<number, number[]>,
  held: Set<number>,
  reservedFor: Map<number, number>,
): void {
  const seeds: number[] = [];
  for (let i = 0; i < data.uatCount; i += 1) if (tierOf[i] !== -1) seeds.push(i);

  grow(data, params, tierOf, regionOf, reasonOf, overlapOf, members, seeds, new Set(), reservedFor);

  // The tail of the stand-down rule: a centre whose capital never actually arrived over
  // contiguous territory. It keeps whatever it holds, and folds into the capital only where
  // the distance cap allows — folding wholesale put communes twice the cap from the capital.
  for (const absorber of [...held].sort((a, b) => a - b)) {
    if (regionOf[absorber] !== absorber) continue;
    const capital = data.capitalOfCounty.get(data.countyOf[absorber]!);
    if (capital === undefined || !members.has(capital)) continue;
    if (params.maxRoadM > 0) {
      const reach = countyRoadDistances(data, data.countyOf[capital]!, [capital]);
      const tooFar = (members.get(absorber) ?? [absorber]).some(
        (m) => (reach.get(m) ?? Infinity) > params.maxRoadM,
      );
      if (tooFar) continue;
    }
    for (const m of members.get(absorber) ?? []) {
      regionOf[m] = capital;
      members.get(capital)!.push(m);
    }
    members.delete(absorber);
    tierOf[absorber] = -1;
  }
}

function grow(
  data: ModelData,
  params: Params,
  tierOf: Int8Array,
  regionOf: Uint16Array,
  reasonOf: Uint8Array,
  overlapOf: Uint8Array,
  members: Map<number, number[]>,
  sources: number[],
  blocked: Set<number>,
  reservedFor: Map<number, number>,
): void {
  const eligible = new Map<number, Map<number, number>>();
  const gathered = new Map<number, number>();
  for (const seed of sources) {
    eligible.set(seed, eligibleFor(data, params, seed, tierOf[seed]!));
    gathered.set(seed, 0);
  }

  // Binary heap keyed on the whole tie-break tuple: distance, then tier, then population
  // descending, then index. Sorting an array per push would dominate the frame budget.
  const hd: number[] = [];
  const ha: number[] = [];
  const hu: number[] = [];
  const better = (i: number, j: number): boolean => {
    if (hd[i] !== hd[j]) return hd[i]! < hd[j]!;
    const ai = ha[i]!;
    const aj = ha[j]!;
    if (tierOf[ai] !== tierOf[aj]) return tierOf[ai]! < tierOf[aj]!;
    if (data.population[ai] !== data.population[aj]) return data.population[ai]! > data.population[aj]!;
    if (ai !== aj) return ai < aj;
    return hu[i]! < hu[j]!;
  };
  const swap = (i: number, j: number): void => {
    [hd[i], hd[j]] = [hd[j]!, hd[i]!];
    [ha[i], ha[j]] = [ha[j]!, ha[i]!];
    [hu[i], hu[j]] = [hu[j]!, hu[i]!];
  };
  const push = (d: number, a: number, u: number): void => {
    hd.push(d); ha.push(a); hu.push(u);
    let i = hd.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!better(i, parent)) break;
      swap(i, parent);
      i = parent;
    }
  };
  const pop = (): [number, number, number] => {
    const top: [number, number, number] = [hd[0]!, ha[0]!, hu[0]!];
    swap(0, hd.length - 1);
    hd.pop(); ha.pop(); hu.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = i;
      if (l < hd.length && better(l, best)) best = l;
      if (r < hd.length && better(r, best)) best = r;
      if (best === i) break;
      swap(i, best);
      i = best;
    }
    return top;
  };

  for (const seed of [...sources].sort((a, b) => a - b)) push(0, seed, seed);

  while (hd.length > 0) {
    const [distance, absorber, uat] = pop();
    if (regionOf[uat] !== NO_REGION || blocked.has(uat)) continue;
    const tier = tierOf[absorber]!;

    if (uat !== absorber) {
      if (!mayAbsorb(data, absorber, uat)) continue;
      // A stood-down centre is reserved for the capital that shadows it. Reserved rather
      // than assigned outright: Cumpana does not touch Constanta, so assigning it directly
      // produced a unit in two disconnected pieces. Growth has to arrive over its own
      // territory, which keeps every unit contiguous.
      const reserved = reservedFor.get(uat);
      if (reserved !== undefined && reserved !== absorber) continue;
      // The cap is checked when claiming, not only when expanding. Stopping expansion at
      // the cap still let the last commune inside it push a neighbour one long edge
      // further, and that neighbour was claimed unchecked — Reșița reached 72.9 km against
      // a 35 km cap that way.
      if (params.maxRoadM > 0 && distance > params.maxRoadM) continue;
      const admitted = eligible.get(absorber)!;
      if (!admitted.has(uat)) continue;
      // Capitals take whatever their radius admits; everyone else stops once they have
      // enough people, leaving the rest to their neighbours.
      if (!isCapitalTier(tier) && params.pTarget > 0 && gathered.get(absorber)! >= params.pTarget) {
        continue;
      }
      const pct = admitted.get(uat)!;
      overlapOf[uat] = pct;
      reasonOf[uat] =
        pct >= Math.round(params.minOverlap * 100) ? REASON.ABSORBED_OVERLAP : REASON.ABSORBED_SEAT;
    } else {
      reasonOf[absorber] =
        tier === TIER_NATIONAL_CAPITAL || tier === TIER_COUNTY_CAPITAL
          ? REASON.CENTRE_CAPITAL
          : tier === TIER_POPULATION
            ? REASON.CENTRE_THRESHOLD
            : REASON.CENTRE_PROMOTED;
    }

    regionOf[uat] = absorber;
    let list = members.get(absorber);
    if (!list) { list = []; members.set(absorber, list); }
    list.push(uat);
    gathered.set(absorber, gathered.get(absorber)! + data.population[uat]!);

    if (params.maxRoadM > 0 && distance >= params.maxRoadM) continue;

    for (let e = data.neighbourStart[uat]!; e < data.neighbourStart[uat + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (regionOf[nb] !== NO_REGION || blocked.has(nb)) continue;
      // Growth never routes anywhere the unit could not hold: a path that leaves and comes
      // back is not a path it occupies, and counting it made the distance cap unenforceable.
      if (!mayAbsorb(data, absorber, nb)) continue;
      const next = distance + data.neighbourRoadM[e]!;
      if (params.maxRoadM > 0 && next > params.maxRoadM) continue;
      push(next, absorber, nb);
    }
  }
}

function orphanTier(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  orphanSeats: Set<number>,
  reasonOf: Uint8Array,
): void {
  if (params.pOrphan <= 0) return;

  const clusterOf = new Int32Array(data.uatCount).fill(-1);
  const members = new Map<number, number[]>();
  for (let i = 0; i < data.uatCount; i += 1) {
    if (regionOf[i] === NO_REGION) {
      clusterOf[i] = i;
      members.set(i, [i]);
    }
  }

  const populationOf = (root: number): number => {
    let total = 0;
    for (const m of members.get(root)!) total += data.population[m]!;
    return total;
  };

  let changed = true;
  while (changed) {
    changed = false;

    const candidates = [...members.keys()]
      .filter((r) => populationOf(r) < params.pOrphan)
      .sort((a, b) => {
        const d = populationOf(a) - populationOf(b);
        return d !== 0 ? d : a - b;
      });

    for (const root of candidates) {
      if (!members.has(root)) continue;
      if (populationOf(root) >= params.pOrphan) continue;

      let bestPartner = -1;
      let bestCombined = Infinity;

      for (const member of members.get(root)!) {
        for (let e = data.neighbourStart[member]!; e < data.neighbourStart[member + 1]!; e += 1) {
          const nb = data.neighbours[e]!;
          if (regionOf[nb] !== NO_REGION) continue;
          const partner = clusterOf[nb]!;
          if (partner === -1 || partner === root) continue;
          if (data.countyOf[nb] !== data.countyOf[member]) continue;
          // The floor gates on a cluster's *current* size, not on what the merge would
          // produce. Gating on the result blocks almost every merge — typical communes are
          // 2,000 to 4,000, so any pair clears 5,000 — and leaves the tiny communes
          // untouched, which is the failure this tier exists to prevent.
          if (populationOf(partner) >= params.pOrphan) continue;
          // The cap applies here too. Clusters are small in population, which says nothing
          // about how far apart they are, and an uncapped merge reintroduced the sprawl.
          if (params.maxRoadM > 0) {
            const reach = countyRoadDistances(data, data.countyOf[root]!, [root]);
            const tooFar = members
              .get(partner)!
              .some((m) => (reach.get(m) ?? Infinity) > params.maxRoadM);
            if (tooFar) continue;
          }

          const combined = populationOf(root) + populationOf(partner);
          if (combined < bestCombined || (combined === bestCombined && partner < bestPartner)) {
            bestCombined = combined;
            bestPartner = partner;
          }
        }
      }

      if (bestPartner !== -1) {
        const merged = members.get(bestPartner)!;
        members.delete(bestPartner);
        const target = members.get(root)!;
        for (const m of merged) {
          target.push(m);
          clusterOf[m] = root;
        }
        changed = true;
      }
    }
  }

  for (const group of members.values()) {
    // The cluster's seat is its largest member — the surviving administration.
    let seat = group[0]!;
    for (const m of group) {
      if (data.population[m]! > data.population[seat]! || (data.population[m] === data.population[seat] && m < seat)) {
        seat = m;
      }
    }
    for (const m of group) {
      regionOf[m] = seat;
      reasonOf[m] = m === seat ? REASON.ORPHAN_SEAT : REASON.ORPHAN_MEMBER;
    }
    orphanSeats.add(seat);
  }
}

/**
 * Merge resulting units still below the target population.
 *
 * The gravitational rules answer "who can reach whom". This answers a different question —
 * "is the result large enough to be worth creating" — so it runs as its own step rather
 * than being folded into the radii, where it would quietly change what a radius means.
 *
 * A unit below target absorbs the smallest neighbouring unit it can, repeatedly, until it
 * reaches the target or runs out of neighbours **in its own county**. The larger of the two
 * keeps its seat. Units can legitimately finish below target when every neighbour they have
 * lies across a county line; those are reported, never forced.
 */
function consolidateToTarget(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  orphanSeats: Set<number>,
  reasonOf: Uint8Array,
  tierOf: Int8Array,
): number {
  const members = new Map<number, number[]>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const region = regionOf[i]!;
    let list = members.get(region);
    if (!list) {
      list = [];
      members.set(region, list);
    }
    list.push(i);
  }

  if (params.pTarget > 0) {
    const populationOf = (region: number): number => {
      let total = 0;
      for (const m of members.get(region)!) total += data.population[m]!;
      return total;
    };

    let changed = true;
    while (changed) {
      changed = false;
      const below = [...members.keys()]
        .filter((r) => populationOf(r) < params.pTarget)
        .sort((a, b) => {
          const d = populationOf(a) - populationOf(b);
          return d !== 0 ? d : a - b;
        });

      for (const region of below) {
        if (!members.has(region)) continue;
        if (populationOf(region) >= params.pTarget) continue;

        const partners = new Set<number>();
        for (const member of members.get(region)!) {
          for (let e = data.neighbourStart[member]!; e < data.neighbourStart[member + 1]!; e += 1) {
            const nb = data.neighbours[e]!;
            const other = regionOf[nb]!;
            if (other === region) continue;
            if (data.countyOf[nb] !== data.countyOf[member]) continue;
            partners.add(other);
          }
        }
        if (partners.size === 0) continue;

        // Nearest by road, not smallest. Choosing the smallest combined population — right
        // in the orphan tier, where candidates are tiny neighbours — is badly wrong for
        // whole units: they chain into whatever is adjacent until something clears the
        // target. In Tulcea that put Măcin into Babadag 60 km away and collapsed 19 units
        // into three. A unit already at the target is used only when nothing smaller is
        // adjacent, so satisfied units are not inflated by their neighbours merging in.
        const county = data.countyOf[region]!;
        const distances = countyRoadDistances(data, county, [region]);

        // Administrative rank leads: an oras is the more significant town than a larger
        // commune, and a unit named after the commune shows a town governed from a village.
        const standingOf = (unit: number): [number, number, number, number] => [
          data.attributes.adminRank[unit]!,
          tierOf[unit] === -1 ? TIER_PROMOTED + 1 : tierOf[unit]!,
          -data.population[unit]!,
          unit,
        ];
        const beats = (a: number, b: number): boolean => {
          const sa = standingOf(a);
          const sb = standingOf(b);
          for (let k = 0; k < 3; k += 1) if (sa[k] !== sb[k]) return sa[k]! < sb[k]!;
          return sa[3]! <= sb[3]!;
        };

        // Allowed only if, once merged, every commune in the combined unit is within the
        // cap of the seat that survives. Checking from the initiating seat alone left the
        // cap toothless whenever the partner kept the seat.
        const compact = (other: number): boolean => {
          if (params.maxRoadM <= 0) return true;
          // Inside the Delta the cap does not apply. Pardina is 57.8 km from Sulina by water
          // and there is no shorter route and no other administration to join; enforcing the
          // cap there leaves five unviable units rather than one Delta.
          const everyoneHere = [...members.get(region)!, ...members.get(other)!];
          if (everyoneHere.every((m) => data.attributes.deltaWater[m])) return true;
          const keepSeat = beats(region, other) ? region : other;
          const reach =
            keepSeat === region ? distances : countyRoadDistances(data, county, [other]);
          const everyone = [...members.get(region)!, ...members.get(other)!];
          return everyone.every((m) => (reach.get(m) ?? Infinity) <= params.maxRoadM);
        };

        const reachable = [...partners].filter(compact);
        if (reachable.length === 0) continue;

        // A county capital is finished once it has taken its ring.
        //
        // This is the answer to "why is the resedinta de judet absorbing far more than its
        // neighbours". Its own growth stops at the ring bordering it; what reached 49.6 km
        // was this step. Oras Recas (8,347) and Oras Buzias (6,834) grow but never reach
        // 50,000, they merge with the small units beside them and are still short, and that
        // chain keeps merging outward until it meets the only adjacent unit clearing the
        // target — the capital. So the whole chain drained into it.
        //
        // Only capitals are closed off. Refusing every satisfied unit also works and strands
        // the leftovers instead: widening the radius then produced more units rather than
        // fewer, and a slider labelled "how far a centre reaches" must not do that.
        const stillSmall = reachable.filter((o) => populationOf(o) < params.pTarget);
        const notACapital = reachable.filter((o) => !data.attributes.isCapital[o]);
        const choices = (stillSmall.length > 0 ? stillSmall : notACapital).sort((a, b) => a - b);
        if (choices.length === 0) continue;
        let partner = choices[0]!;
        for (const candidate of choices) {
          const dc = distances.get(candidate) ?? Infinity;
          const dp = distances.get(partner) ?? Infinity;
          if (dc < dp || (dc === dp && populationOf(candidate) < populationOf(partner))) {
            partner = candidate;
          }
        }

        // Which seat survives is about the standing of the town, not the size its unit
        // happens to have reached.
        const keep = beats(region, partner) ? region : partner;
        const drop = keep === region ? partner : region;

        const moved = members.get(drop)!;
        members.delete(drop);
        const target = members.get(keep)!;
        for (const m of moved) {
          target.push(m);
          regionOf[m] = keep;
          reasonOf[m] = REASON.TARGET_MERGED;
        }
        orphanSeats.delete(drop);
        changed = true;
      }
    }
  }

  let belowTarget = 0;
  if (params.pTarget > 0) {
    for (const group of members.values()) {
      let total = 0;
      for (const m of group) total += data.population[m]!;
      if (total < params.pTarget) belowTarget += 1;
    }
  }
  return belowTarget;
}

/**
 * Give each unit the most significant town in it as its seat.
 *
 * Which communes group together is settled by roads and radii and is not touched here; this
 * decides only which member the unit is named after and administered from. Curcani is the
 * case: a commune of 5,301 promoted for its coverage ended up seating a unit containing
 * Oras Budesti (7,126), so the map showed a town governed from a village.
 *
 * A re-election has to keep the distance cap, which growth enforced against the old seat.
 * Oras Murgeni is the case — the better town administratively, but 73.7 km from members the
 * cap allows at 50 km. Where no candidate holds the cap the unit keeps the seat it grew from.
 */
function reseatUnits(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  tierOf: Int8Array,
  orphanSeats: Set<number>,
  only?: Set<number>,
): void {
  const members = new Map<number, number[]>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const seat = regionOf[i]!;
    let list = members.get(seat);
    if (!list) { list = []; members.set(seat, list); }
    list.push(i);
  }

  const standing = (unit: number): [number, number, number, number] => [
    data.attributes.adminRank[unit]!,
    tierOf[unit] === -1 ? TIER_PROMOTED + 1 : tierOf[unit]!,
    -data.population[unit]!,
    unit,
  ];
  const better = (a: number, b: number): boolean => {
    const sa = standing(a);
    const sb = standing(b);
    for (let k = 0; k < 4; k += 1) if (sa[k] !== sb[k]) return sa[k]! < sb[k]!;
    return false;
  };

  for (const oldSeat of [...members.keys()].sort((a, b) => a - b)) {
    const list = members.get(oldSeat)!;
    if (only && !list.some((m) => only.has(m))) continue;
    const county = data.countyOf[oldSeat]!;
    const holdsTheCap = (candidate: number): boolean => {
      if (params.maxRoadM <= 0) return true;
      // Exempt for the same reason as the merge cap: without this the Delta keeps whichever
      // seat it grew from — Crisan, a commune of 1,092 — instead of Oras Sulina, the town it
      // is actually administered from.
      if (list.every((m) => data.attributes.deltaWater[m])) return true;
      const reach = countyRoadDistances(data, county, [candidate]);
      // Members in another county are the Bucharest ring, which this county-scoped measure
      // cannot see; the cap is not enforced across that one line.
      return list.every(
        (m) => data.countyOf[m] !== county || (reach.get(m) ?? Infinity) <= params.maxRoadM,
      );
    };
    const ranked = [...list].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    const newSeat = ranked.find((c) => holdsTheCap(c)) ?? oldSeat;
    if (newSeat === oldSeat) continue;
    for (const m of list) regionOf[m] = newSeat;
    if (orphanSeats.delete(oldSeat)) orphanSeats.add(newSeat);
    if (tierOf[oldSeat] !== -1 && tierOf[newSeat] === -1) {
      tierOf[newSeat] = tierOf[oldSeat]!;
      tierOf[oldSeat] = -1;
    }
  }
}

/**
 * Apply manual overrides on top of a finished result.
 *
 * Deliberately the last thing that happens, and deliberately outside the rules. A pin is a
 * stated disagreement with the model, not a change to it: the rules run untouched, then the
 * named UATs are moved, and the panel shows them as placed by hand. With no pins nothing
 * here executes and the result is exactly the reference model's.
 *
 * A pin can do what the rules never do — leave a unit in two disconnected pieces, by taking
 * a commune out of the middle of one. That is reported rather than prevented: refusing the
 * override would hide the consequence, and the point of the override is that the person
 * making it has a reason the model does not know about.
 */
function applyPins(
  data: ModelData,
  regionOf: Uint16Array,
  reasonOf: Uint8Array,
  tierOf: Int8Array,
  orphanSeats: Set<number>,
  params: Params,
  pins: Pin[],
): Pick<ModelResult, 'pinsApplied' | 'pinsRejected' | 'splitUnits'> {
  const pinsApplied: Pin[] = [];
  const pinsRejected: ModelResult['pinsRejected'] = [];
  if (pins.length === 0) return { pinsApplied, pinsRejected, splitUnits: [] };

  for (const pin of pins) {
    if (pin.uat < 0 || pin.uat >= data.uatCount || pin.seat < 0 || pin.seat >= data.uatCount) {
      pinsRejected.push({ pin, why: 'not-a-seat' });
      continue;
    }
    // The target has to be a unit that currently exists. Sliders move, and a pin written
    // against a seat that a different parameter set never produces is stale, not wrong.
    let targetIsSeat = false;
    for (let i = 0; i < data.uatCount; i += 1) {
      if (regionOf[i] === pin.seat) { targetIsSeat = true; break; }
    }
    if (!targetIsSeat) { pinsRejected.push({ pin, why: 'not-a-seat' }); continue; }
    if (!mayAbsorb(data, pin.seat, pin.uat)) { pinsRejected.push({ pin, why: 'county' }); continue; }
    if (regionOf[pin.uat] === pin.seat) {
      pinsRejected.push({ pin, why: 'already-there' });
      continue;
    }
    regionOf[pin.uat] = pin.seat;
    reasonOf[pin.uat] = REASON.MANUAL_PIN;
    pinsApplied.push(pin);
  }

  if (pinsApplied.length === 0) return { pinsApplied, pinsRejected, splitUnits: [] };

  // A pinned-away seat leaves its former unit headless. Re-elect from what is left rather
  // than dissolving it — the other members did not ask to move.
  for (const pin of pinsApplied) {
    if (regionOf[pin.uat] === pin.uat) continue;
    tierOf[pin.uat] = -1;
    orphanSeats.delete(pin.uat);
    const stranded: number[] = [];
    for (let i = 0; i < data.uatCount; i += 1) if (regionOf[i] === pin.uat) stranded.push(i);
    if (stranded.length === 0) continue;
    reseatUnits(data, params, regionOf, tierOf, orphanSeats, new Set(stranded));
  }

  // Contiguity, checked only because a pin can break it.
  const members = new Map<number, number[]>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const seat = regionOf[i]!;
    let list = members.get(seat);
    if (!list) { list = []; members.set(seat, list); }
    list.push(i);
  }
  const splitUnits: number[] = [];
  for (const [seat, list] of members) {
    if (list.length < 2) continue;
    const inUnit = new Set(list);
    const seen = new Set([list[0]!]);
    const stack = [list[0]!];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (let e = data.neighbourStart[current]!; e < data.neighbourStart[current + 1]!; e += 1) {
        const nb = data.neighbours[e]!;
        if (inUnit.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }
    if (seen.size !== inUnit.size) splitUnits.push(seat);
  }
  splitUnits.sort((a, b) => a - b);
  return { pinsApplied, pinsRejected, splitUnits };
}

/**
 * Why a unit could not merge with anything, or null if nothing is stopping it.
 *
 * The audit list is only useful if it says what to do about an entry. "Single-UAT unit" is
 * an observation; "its only road neighbour is in another county" and "the nearest merge is
 * 74 km against a 50 km cap" are the two different answers, and only one of them has a
 * slider.
 */
export function mergeBlocker(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  seat: number,
):
  | { kind: 'no-county-neighbour' }
  | { kind: 'capital-only' }
  | { kind: 'cap'; metres: number }
  | null {
  const unitSeat = seat;
  const membersOf = (unit: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < data.uatCount; i += 1) if (regionOf[i] === unit) out.push(i);
    return out;
  };
  const members = membersOf(seat);

  // Units this one touches, that it would be allowed to join.
  const partners = new Set<number>();
  for (const member of members) {
    for (let e = data.neighbourStart[member]!; e < data.neighbourStart[member + 1]!; e += 1) {
      const other = regionOf[data.neighbours[e]!]!;
      if (other !== seat && mayAbsorb(data, other, member)) partners.add(other);
    }
  }
  if (partners.size === 0) return { kind: 'no-county-neighbour' };
  // A capital is finished once it has taken its ring, so it is not a partner. A unit whose
  // only neighbours are capitals has nowhere to go regardless of distance.
  if ([...partners].every((p) => data.attributes.isCapital[p])) return { kind: 'capital-only' };
  if (params.maxRoadM <= 0) return null;

  // The cheapest merge available, measured the way consolidation measures it: every member
  // of the combined unit within the cap of whichever seat would survive.
  // Measured from the seat that would survive the merge, exactly as consolidation does.
  // Measuring from the partner instead reported merges as possible that the model refuses:
  // Lumina and Mihail Kogalniceanu are both under the target and adjacent, but the cap is
  // judged from Lumina, which keeps the seat, not from Mihail Kogalniceanu.
  const standing = (unit: number): [number, number, number] => [
    data.attributes.adminRank[unit]!,
    -data.population[unit]!,
    unit,
  ];
  const survives = (a: number, b: number): number => {
    const sa = standing(a);
    const sb = standing(b);
    for (let k = 0; k < 3; k += 1) if (sa[k] !== sb[k]) return sa[k]! < sb[k]! ? a : b;
    return a;
  };

  let best = Infinity;
  for (const partner of partners) {
    if (data.attributes.isCapital[partner]) continue;
    const seat = survives(unitSeat, partner);
    const county = data.countyOf[seat]!;
    const reach = countyRoadDistances(data, county, [seat]);
    let worst = 0;
    for (const member of [...members, ...membersOf(partner)]) {
      if (data.countyOf[member] !== county) continue;
      worst = Math.max(worst, reach.get(member) ?? Infinity);
    }
    best = Math.min(best, worst);
  }
  if (!Number.isFinite(best)) return { kind: 'no-county-neighbour' };
  return best > params.maxRoadM ? { kind: 'cap', metres: best } : null;
}

export function runModel(data: ModelData, params: Params, pins: Pin[] = []): ModelResult {
  const regionOf = new Uint16Array(data.uatCount).fill(NO_REGION);
  const reasonOf = new Uint8Array(data.uatCount).fill(REASON.UNCHANGED);
  const overlapOf = new Uint8Array(data.uatCount);
  const { tierOf, underSeeded, held, reservedFor } = selectSeeds(data, params);

  const members = new Map<number, number[]>();
  accrete(data, params, tierOf, regionOf, reasonOf, overlapOf, members, held, reservedFor);

  const orphanSeats = new Set<number>();
  orphanTier(data, params, regionOf, orphanSeats, reasonOf);

  // Whatever no absorber reached and no cluster took "stays as-is" — a region of one, not
  // a hole in the map.
  for (let i = 0; i < data.uatCount; i += 1) {
    if (regionOf[i] === NO_REGION) regionOf[i] = i;
  }
  // Counted after the sweep, matching the reference: a non-zero value here means a UAT
  // escaped every rule, which is a bug rather than an outcome.
  let unassigned = 0;
  for (let i = 0; i < data.uatCount; i += 1) {
    if (regionOf[i] === NO_REGION) unassigned += 1;
  }

  // Twice, and the order matters. Consolidation decides which units merge by measuring
  // road distance from the seat that survives, so it has to see the real seats. Merging
  // changes the membership, so the seats are settled again on the result.
  reseatUnits(data, params, regionOf, tierOf, orphanSeats);
  const belowTarget = consolidateToTarget(data, params, regionOf, orphanSeats, reasonOf, tierOf);
  reseatUnits(data, params, regionOf, tierOf, orphanSeats);

  const { pinsApplied, pinsRejected, splitUnits } = applyPins(
    data, regionOf, reasonOf, tierOf, orphanSeats, params, pins,
  );

  const regionSeats = new Set<number>();
  for (let i = 0; i < data.uatCount; i += 1) regionSeats.add(regionOf[i]!);

  // Two savings figures. The administrative one is the headline: it is what merging town
  // halls removes. The operating one applies the same formula to all running costs and is
  // an explicit upper bound — nationally about seven times larger, because it assumes the
  // absorbed commune's schools and social assistance vanish too.
  let savingsAdminRon = 0;
  let savingsOperatingRon = 0;
  for (let i = 0; i < data.uatCount; i += 1) {
    if (regionOf[i] === i) continue;
    savingsAdminRon += data.administrativeRon[i]!;
    savingsOperatingRon += data.operatingRon[i]!;
  }

  let seeds = 0;
  for (let i = 0; i < data.uatCount; i += 1) if (tierOf[i] !== -1) seeds += 1;

  return {
    regionOf,
    reasonOf,
    overlapOf,
    tierOf,
    regions: regionSeats.size,
    seeds,
    orphanRegions: orphanSeats.size,
    unassigned,
    belowTarget,
    savingsAdminRon,
    savingsOperatingRon,
    underSeededCounties: underSeeded,
    pinsApplied,
    pinsRejected,
    splitUnits,
  };
}