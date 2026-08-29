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
  PROMOTION_POPULATION_BAND,
  REASON,
  type ModelData,
  type ModelResult,
  type Params,
  type Pin,
  type RadiusSlice,
} from './types';

const NO_REGION = 0xffff;

/**
 * Polsby-Popper for a unit, from its members' scalars alone: 1.0 is a circle.
 *
 * A unit's area is the sum of its members' areas and its outline the sum of their perimeters
 * less twice every border that falls inside it, so no polygon is needed. Every shared border
 * counts, not only those a road crosses — a border with no road over it is still a border
 * when measuring an outline, and walking the road graph here left 156 of them in the
 * perimeter and put every score slightly wrong.
 */
export function compactness(data: ModelData, members: number[]): number {
  const inside = new Set(members);
  let area = 0;
  let perimeter = 0;
  let internal = 0;
  for (const member of members) {
    area += data.areaKm2[member]!;
    perimeter += data.perimeterKm[member]!;
    for (let e = data.touchStart[member]!; e < data.touchStart[member + 1]!; e += 1) {
      if (inside.has(data.touching[e]!)) internal += data.touchingSharedKm[e]!;
    }
  }
  // Each internal border was counted from both sides, hence half of twice it.
  const outline = perimeter - internal;
  return outline > 0 ? (4 * Math.PI * area) / (outline * outline) : 1;
}

/**
 * Whether a change may go ahead under the compactness floor.
 *
 * Refused only when the result is both below the floor *and* worse than what is there now.
 * Plenty of units are already ragged — the median scores 0.24 — and a floor that refused
 * every change to them would freeze exactly the units that most need rearranging.
 */
function shapeAllows(
  data: ModelData,
  params: Params,
  before: number[],
  after: number[],
): boolean {
  if (params.minCompactness <= 0) return true;
  const then = compactness(data, after);
  return then >= params.minCompactness || then >= compactness(data, before);
}

/** Lexicographic compare over equal-length numeric tuples. */
function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

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
  if (tier === TIER_COUNTY_CAPITAL) return capitalReach(data, params, capital);

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
  // A centre's own neighbours are always its own. This is the floor under everything else,
  // and it was missing: eligibility was decided by area overlap against a buffer, which knows
  // nothing about who borders whom.
  const ring = new Set<number>();
  if (tier === TIER_NATIONAL_CAPITAL) {
    for (const sector of data.bucharestSectors) {
      for (let e = data.neighbourStart[sector]!; e < data.neighbourStart[sector + 1]!; e += 1) {
        const nb = data.neighbours[e]!;
        if (mayAbsorb(data, seed, nb)) ring.add(nb);
      }
    }
  } else {
    for (let e = data.neighbourStart[seed]!; e < data.neighbourStart[seed + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (mayAbsorb(data, seed, nb)) ring.add(nb);
    }
  }

  if (tier === TIER_COUNTY_CAPITAL) {
    for (const nb of capitalReach(data, params, seed)) admitted.set(nb, 0);
    for (const nb of ring) admitted.set(nb, 0);
    return admitted;
  }

  const slice = sliceFor(data, params, tier);
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

  }
  // The ring goes in whatever the radius said.
  for (const nb of ring) if (!admitted.has(nb)) admitted.set(nb, 0);
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
/**
 * Road distance from one seat to every commune in its county, memoised per dataset.
 *
 * The answer depends only on the road graph, never on the current assignment, so it is the
 * same every time it is asked — and it is asked a great deal: consolidation asks per merge
 * candidate, the rebalancing pass asks per unit per sweep, and the settle loop repeats both.
 * Recomputing it took the model to 353 ms against a 150 ms budget. Cached, the same work
 * happens once per seat for the life of the payload.
 *
 * Only the single-source case is cached; multi-source calls are rare and are passed through.
 */
const singleSourceCache = new WeakMap<ModelData, Map<number, Map<number, number>>>();

export function countyRoadDistances(
  data: ModelData,
  county: number,
  sources: number[],
): Map<number, number> {
  if (sources.length === 1) {
    let byCounty = singleSourceCache.get(data);
    if (!byCounty) {
      byCounty = new Map();
      singleSourceCache.set(data, byCounty);
    }
    const hit = byCounty.get(sources[0]!);
    if (hit) return hit;
    const computed = countyRoadDistancesUncached(data, county, sources);
    byCounty.set(sources[0]!, computed);
    return computed;
  }
  return countyRoadDistancesUncached(data, county, sources);
}

function countyRoadDistancesUncached(
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

  // A capital's own ring, across every capital that is still one. Narrower than the reach:
  // the reach is who a capital displaces, the ring is what it holds by right, and promotion
  // may never reach into it however short a county is.
  const capitalRings = new Set<number>();
  for (const capital of cores.keys()) {
    if (tierOf[capital] === -1 || !isCapitalSeat(data, capital)) continue;
    for (const u of capitalRing(data, params, capital)) capitalRings.add(u);
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
    // Ilfov is the county this exists for: a ring around Bucharest, so the centres it could
    // promote are largely communes the city borders. Barred from those it needs the wider
    // pool to reach five, and the widening below gives it one without touching the ring.
    const candidates = (allowDisplaced: boolean): number[] =>
      uats.filter(
        (i) =>
          (isAbsorber[i] === 1 || data.attributes.adminRank[i]! <= ADMIN_RANK_ORAS) &&
          tierOf[i] === -1 &&
          // Never a capital's ring, however short the county is. Promotion took
          // Popesti-Leordeni and Voluntari off Bucharest to bring Ilfov to five; the ring is
          // the stronger rule, so the county finds its centres elsewhere.
          !capitalRings.has(i) &&
          (allowDisplaced || (!held.has(i) && !capitalReach.has(i))),
      );

    let pool = candidates(false);
    let widened = false;

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
      let bestKey: number[] | null = null;

      for (const candidate of pool) {
        if (separation && rSep > 0) {
          // Unreachable by road inside the county counts as far away, not as zero: an
          // isolated candidate is a good centre, not a disqualified one.
          if ((separation.get(candidate) ?? Infinity) < rSep) continue;
        }

        // Walk down from the threshold, but prefer the better-placed candidate among towns
        // of comparable size.
        //
        // The question this step answers is "who is the next most plausible town", which is
        // about size — maximising uncovered population reached answers "who would sweep up
        // the most", and that picked Curcani, a commune of 5,301, over Oras Budesti at
        // 7,126. But size alone takes the first candidate clearing the separation floor and
        // then stops caring about position, so a town 15.1 km from an existing centre beat
        // one of nearly the same size 30 km away, and 15 of the 41 counties ended with their
        // centres clustered. Populations are compared in bands; within a band the more
        // distant candidate wins.
        const band = Math.floor(data.population[candidate]! / PROMOTION_POPULATION_BAND);
        const nearest = separation ? (separation.get(candidate) ?? Infinity) : Infinity;
        const rank = data.attributes.adminRank[candidate]!;
        const key = [-band, Number.isFinite(nearest) ? -nearest : -Infinity, rank, candidate];
        if (bestKey === null || lessThan(key, bestKey)) {
          bestKey = key;
          bestIndex = candidate;
        }
      }

      if (bestIndex === -1 && !widened) {
        // Widen before relaxing separation. Falling back only when the restricted pool is
        // *empty* was not enough: Ilfov's was non-empty and every entry failed the
        // separation test, so the county sat on three centres against a minimum of five.
        widened = true;
        pool = candidates(true);
        continue;
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
    // A capital cannot fold into itself. Buftea is both Ilfov's seat and, once Bucharest
    // shadows it, a stood-down centre, so this pushed its own members onto the array it was
    // iterating and grew it until the length was invalid. Nothing to do: it is the capital.
    if (capital === undefined || capital === absorber || !members.has(capital)) continue;
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
  // Accumulated road distance from each absorber to each commune it holds.
  const reached = new Map<number, Map<number, number>>();

  for (const seed of [...sources].sort((a, b) => a - b)) {
    eligible.set(seed, eligibleFor(data, params, seed, tierOf[seed]!));
    gathered.set(seed, 0);
    reached.set(seed, new Map());
    // The city starts whole. Bucharest is represented by its lowest sector, so its first
    // ring used to be the other five sectors: it spent rounds absorbing itself while
    // Voluntari and Mihailesti took the communes around it at their own first ring.
    const opening =
      tierOf[seed] === TIER_NATIONAL_CAPITAL ? data.bucharestSectors : [seed];
    let claimedAny = false;
    for (const member of opening) {
      if (regionOf[member] !== NO_REGION || blocked.has(member)) continue;
      regionOf[member] = seed;
      members.set(seed, [...(members.get(seed) ?? []), member]);
      gathered.set(seed, gathered.get(seed)! + data.population[member]!);
      reached.get(seed)!.set(member, 0);
      claimedAny = true;
    }
    if (!claimedAny) continue;
    const tier = tierOf[seed]!;
    reasonOf[seed] =
      tier === TIER_NATIONAL_CAPITAL || tier === TIER_COUNTY_CAPITAL
        ? REASON.CENTRE_CAPITAL
        : tier === TIER_POPULATION
          ? REASON.CENTRE_THRESHOLD
          : REASON.CENTRE_PROMOTED;
  }

  const isCapped = (absorber: number): boolean => !isCapitalTier(tierOf[absorber]!);

  for (;;) {
    // Every bid in this ring, collected before any of them is settled, so no centre gains
    // an advantage from being processed earlier.
    const bids = new Map<number, Map<number, number>>();
    for (const absorber of [...sources].sort((a, b) => a - b)) {
      const capped = isCapped(absorber);
      const have = gathered.get(absorber)!;
      if (capped && params.pTarget > 0 && have >= params.pTarget) continue;
      // A centre still short of the target reaches past its radius: the radius says how far
      // it pulls while it has a choice, not what stops it being viable.
      const short = capped && params.pTarget > 0 && have < params.pTarget;
      const admitted = eligible.get(absorber)!;
      const mine = reached.get(absorber)!;
      for (const held of members.get(absorber) ?? []) {
        const base = mine.get(held);
        if (base === undefined) continue;
        if (params.maxRoadM > 0 && base >= params.maxRoadM) continue;
        for (let e = data.neighbourStart[held]!; e < data.neighbourStart[held + 1]!; e += 1) {
          const nb = data.neighbours[e]!;
          if (regionOf[nb] !== NO_REGION || blocked.has(nb)) continue;
          if (!mayAbsorb(data, absorber, nb)) continue;
          const reserved = reservedFor.get(nb);
          if (reserved !== undefined && reserved !== absorber) continue;
          if (!admitted.has(nb) && !short) continue;
          const reach = base + data.neighbourRoadM[e]!;
          if (params.maxRoadM > 0 && reach > params.maxRoadM) continue;
          let row = bids.get(nb);
          if (!row) {
            row = new Map();
            bids.set(nb, row);
          }
          const prev = row.get(absorber);
          if (prev === undefined || reach < prev) row.set(absorber, reach);
        }
      }
    }

    if (bids.size === 0) return;

    // Settle the ring nearest pair first, with running totals.
    //
    // Bids are collected across the whole county before any is settled, but they are
    // *awarded* one at a time in ascending distance, and each award updates the winner's
    // population immediately. Awarding a whole ring at once let one centre take five
    // communes in a round and land 37,000 over the target while the centre beside it stayed
    // at 20,000: no single commune overshot, so the concession rule never fired. With
    // running totals a centre stops the moment it reaches the target and the rest of its
    // ring falls to neighbours that still need it.
    const keyOf = (bidder: number, uat: number, row: Map<number, number>): number[] => {
      // Resedinte de judet only: a capital wins any contest on its own border outright.
      // `isCapital` is also true for the Bucharest sectors, and the national capital
      // already has its radius.
      const ownRing =
        isCountyCapital(data, bidder) && capitalReach(data, params, bidder).has(uat) ? 1 : 0;
      const overshoot =
        isCapped(bidder) &&
        params.pTarget > 0 &&
        gathered.get(bidder)! + data.population[uat]! > params.pTarget;
      // Near-ties collapse into one band so that size, not metres, decides them. With the
      // band at zero every distance is its own band and this is the old ordering exactly,
      // which is what keeps the default unchanged.
      const distance = row.get(bidder)!;
      const band = params.rTieM > 0 ? Math.floor(distance / params.rTieM) : distance;
      return [
        ownRing ? 0 : 1,
        overshoot ? 1 : 0,
        band,
        // Within a band the absorber holding less takes it: this is what stops one centre
        // reaching 60,000 while the one beside it stays at 15,000.
        params.rTieM > 0 ? gathered.get(bidder)! : 0,
        distance,
        tierOf[bidder]!,
        -data.population[bidder]!,
        bidder,
      ];
    };

    const order = [...bids.keys()].sort((a, b) => {
      const da = Math.min(...bids.get(a)!.values());
      const db = Math.min(...bids.get(b)!.values());
      return da !== db ? da - db : a - b;
    });

    let awarded = 0;
    for (const uat of order) {
      const row = new Map<number, number>();
      for (const [bidder, reach] of bids.get(uat)!) {
        if (isCapped(bidder) && params.pTarget > 0 && gathered.get(bidder)! >= params.pTarget) {
          continue;
        }
        row.set(bidder, reach);
      }
      if (row.size === 0) continue;

      const ranked = [...row.keys()].sort((a, b) => a - b);
      ranked.sort((a, b) => (lessThan(keyOf(a, uat, row), keyOf(b, uat, row)) ? -1 : 1));
      const absorber = ranked.find((b) =>
        shapeAllows(data, params, members.get(b) ?? [], [...(members.get(b) ?? []), uat]),
      );
      if (absorber === undefined) continue;

      regionOf[uat] = absorber;
      members.set(absorber, [...(members.get(absorber) ?? []), uat]);
      reached.get(absorber)!.set(uat, row.get(absorber)!);
      gathered.set(absorber, gathered.get(absorber)! + data.population[uat]!);
      const pct = eligible.get(absorber)!.get(uat) ?? 0;
      overlapOf[uat] = pct;
      reasonOf[uat] =
        pct >= Math.round(params.minOverlap * 100) ? REASON.ABSORBED_OVERLAP : REASON.ABSORBED_SEAT;
      awarded += 1;
    }

    if (awarded === 0) return;
  }
}

/**
 * Hand every commune no centre reached to a neighbouring unit.
 *
 * Leftovers are an artefact of the target, not of geography. A centre stops once it has
 * enough people, and when every centre around a commune is satisfied nobody is allowed to
 * take it — 300 communes were stranded that way, none of them far from anywhere. Clustering
 * them together afterwards produced units nobody asked for.
 *
 * A leftover goes to the neighbouring unit still short of the target, nearest by road. If
 * every neighbour is satisfied it goes to the smallest of them rather than the nearest:
 * handing each to the nearest piled them onto whichever unit was adjacent to the most
 * leftovers and took the worst county from a 219-fold spread to 548. The cap still applies.
 *
 * Repeated until nothing more can be placed, because placing one commune gives its
 * neighbours a unit to join.
 */
function absorbLeftovers(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  members: Map<number, number[]>,
  reasonOf: Uint8Array,
): void {
  const populationOf = (seat: number): number => {
    let total = 0;
    for (const m of members.get(seat) ?? []) total += data.population[m]!;
    return total;
  };

  // Two phases. The first hands out only what a non-capital unit will take, repeated until
  // it stops; the second lets a capital take what is left. A resedinta de judet holds the
  // ring bordering it and, beyond that, only what nothing else will have — falling back to
  // the capital as soon as nothing else had arrived *yet* handed it 130 communes on the
  // first pass, before the chain of leftovers beside them had a chance to get there.
  for (const capitalsAllowed of [false, true]) {
  for (;;) {
    let moved = 0;
    for (let siruta = 0; siruta < data.uatCount; siruta += 1) {
      if (regionOf[siruta] !== NO_REGION) continue;
      const options = new Map<number, number>();
      for (let e = data.neighbourStart[siruta]!; e < data.neighbourStart[siruta + 1]!; e += 1) {
        const unit = regionOf[data.neighbours[e]!]!;
        if (unit === NO_REGION || !mayAbsorb(data, unit, siruta)) continue;
        const distance =
          countyRoadDistances(data, data.countyOf[unit]!, [unit]).get(siruta) ?? Infinity;
        if (params.maxRoadM > 0 && distance > params.maxRoadM) continue;
        if (distance < (options.get(unit) ?? Infinity)) options.set(unit, distance);
      }
      if (!capitalsAllowed) {
        for (const unit of [...options.keys()]) {
          if (!isCountyCapital(data, unit)) continue;
          if (!capitalReach(data, params, unit).has(siruta)) options.delete(unit);
        }
      }
      if (options.size === 0) continue;

      // The shape floor applies here too, or it does nothing at all. Growth refuses a claim
      // that would wreck an outline and this step used to hand the commune straight back a
      // moment later. Options that keep the shape are preferred; if none does, the commune
      // still has to go somewhere — stranded is worse than ragged.
      if (params.minCompactness > 0) {
        const tidy = [...options.keys()].filter((u) =>
          shapeAllows(data, params, members.get(u)!, [...members.get(u)!, siruta]),
        );
        if (tidy.length > 0) {
          for (const u of [...options.keys()]) if (!tidy.includes(u)) options.delete(u);
        }
      }

      const short = [...options.keys()].filter((u) => populationOf(u) < params.pTarget);
      let winner = -1;
      if (short.length > 0) {
        let best: [number, number] | null = null;
        for (const u of short.sort((a, b) => a - b)) {
          const key: [number, number] = [options.get(u)!, u];
          if (best === null || lessThan(key, best)) { best = key; winner = u; }
        }
      } else {
        let best: [number, number, number] | null = null;
        for (const u of [...options.keys()].sort((a, b) => a - b)) {
          const key: [number, number, number] = [populationOf(u), options.get(u)!, u];
          if (best === null || lessThan(key, best)) { best = key; winner = u; }
        }
      }

      regionOf[siruta] = winner;
      members.get(winner)!.push(siruta);
      reasonOf[siruta] = REASON.ABSORBED_SEAT;
      moved += 1;
    }
    if (moved === 0) break;
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
/**
 * Last resort for a unit the distance cap has stranded: join the best-shaped neighbour.
 *
 * `consolidateToTarget` refuses any merge that would put a commune beyond the cap, measured
 * from the seat that survives. Where every same-county neighbour fails that test the unit
 * stays as it is, and on a county border that means a unit of one commune: Bulzesti (1,269)
 * sits in the corner of Dolj with four of its five neighbours in Olt and Valcea, and the
 * fifth over the cap at 57.9 km. Gradinari (2,448) misses by 500 m against a 50 km cap.
 *
 * A commune left administering itself for 1,269 people is a worse answer than a unit whose
 * furthest village is 58 km from its seat rather than 50. So where no legal partner exists
 * the cap yields — and nothing else does. The county line holds, the county minimum holds,
 * and a unit with any legal partner is left to the ordinary rules.
 *
 * **The partner is chosen by shape.** Overriding the cap is exactly the move that produces a
 * long ragged unit, so this takes the candidate whose merged outline scores best on
 * Polsby-Popper. Where only one exists the ranking changes nothing and the merge happens
 * anyway: a bad shape still beats a leftover.
 */
function absorbStranded(
  data: ModelData,
  params: Params,
  regionOf: Uint16Array,
  orphanSeats: Set<number>,
  reasonOf: Uint8Array,
  tierOf: Int8Array,
): void {
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

  const populationOf = (unit: number): number => {
    let total = 0;
    for (const m of members.get(unit)!) total += data.population[m]!;
    return total;
  };

  const standingOf = (unit: number): [number, number, number, number] => [
    data.attributes.adminRank[unit]!,
    tierOf[unit] === -1 ? TIER_PROMOTED + 1 : tierOf[unit]!,
    -data.population[unit]!,
    unit,
  ];
  const beats = (a: number, c: number): boolean => {
    const sa = standingOf(a);
    const sc = standingOf(c);
    for (let k = 0; k < 4; k += 1) if (sa[k] !== sc[k]) return sa[k]! < sc[k]!;
    return false;
  };

  let changed = true;
  while (changed) {
    changed = false;
    // Smallest first: the leftovers are what this exists for, and merging one can give the
    // next a partner it did not have.
    const order = [...members.keys()].sort((a, c) => populationOf(a) - populationOf(c) || a - c);
    for (const absorber of order) {
      if (!members.has(absorber)) continue;
      // Only leftovers, not every small unit the cap has stranded.
      if (populationOf(absorber) >= params.pStranded) continue;

      const county = data.countyOf[absorber]!;
      if (county === data.bucharestCounty) continue;
      // The Delta is exempt from the cap, so it is not stranded by it. Every distance inside
      // it is long and there is no shorter route; treating Oras Sulina as a leftover
      // dissolved the whole Delta into Municipiul Tulcea, which is what the exception exists
      // to prevent.
      if (members.get(absorber)!.every((m) => data.attributes.deltaWater[m])) continue;
      // Coverage still outranks size here, exactly as in the ordinary pass.
      if (countyUnitCount(data, members, county) <= params.nMin) continue;

      const partners = new Set<number>();
      for (const member of members.get(absorber)!) {
        for (let e = data.neighbourStart[member]!; e < data.neighbourStart[member + 1]!; e += 1) {
          const nb = data.neighbours[e]!;
          const other = regionOf[nb]!;
          if (other === absorber || data.countyOf[nb] !== county) continue;
          partners.add(other);
        }
      }
      // Nothing adjacent inside its own county. The county line is not negotiable, so this
      // one is genuinely alone and is reported rather than forced.
      if (partners.size === 0) continue;

      const here = countyRoadDistances(data, county, [absorber]);
      const withinCap = (other: number): boolean => {
        if (params.maxRoadM <= 0) return true;
        const everyone = members.get(absorber)!.concat(members.get(other)!);
        if (everyone.every((m) => data.attributes.deltaWater[m])) return true;
        const keepsSeat = !beats(other, absorber);
        const reach = keepsSeat ? here : countyRoadDistances(data, county, [other]);
        return everyone.every((m) => (reach.get(m) ?? Infinity) <= params.maxRoadM);
      };
      // Only for units the ordinary pass cannot help. If anything is legally reachable this
      // keeps its hands off — otherwise Oras Seini is dissolved into Municipiul Baia Mare,
      // the capital-as-drain failure the consolidation rules exist to prevent.
      if ([...partners].some((o) => withinCap(o))) continue;

      // Same preference order as the ordinary pass: a partner still short of the target
      // first, then any non-capital, and only then a capital.
      const sorted = [...partners].sort((a, c) => a - c);
      const stillSmall = sorted.filter((o) => populationOf(o) < params.pTarget);
      const notACapital = sorted.filter((o) => !data.attributes.isCapital[o]);
      const choices = stillSmall.length > 0 ? stillSmall : notACapital.length > 0 ? notACapital : sorted;

      let best = choices[0]!;
      let bestShape = compactness(data, members.get(absorber)!.concat(members.get(best)!));
      for (const candidate of choices.slice(1)) {
        const shape = compactness(data, members.get(absorber)!.concat(members.get(candidate)!));
        const dc = -(here.get(candidate) ?? Infinity);
        const db = -(here.get(best) ?? Infinity);
        if (shape > bestShape || (shape === bestShape && (dc > db || (dc === db && candidate > best)))) {
          best = candidate;
          bestShape = shape;
        }
      }

      const keep = beats(absorber, best) ? absorber : best;
      const drop = keep === absorber ? best : absorber;
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

/**
 * Hand a commune to a near-equally-distant neighbouring unit that is carrying less.
 *
 * Pantelimon (CT) is the case. It is 44.5 km from Municipiul Medgidia and 45.8 km from Oras
 * Harsova, and `rebalance` asks only whether another seat is *strictly* nearer, so 1.3 km
 * kept it in Medgidia — 109,471 people over 1,752 km2 — instead of Harsova, 23,290 over 828.
 * Nothing before this point ever compared the two from Pantelimon: its own unit merged into
 * Medgidia as a whole, judged from a seat 43 km closer to Medgidia than to Harsova.
 *
 * **Separate from `rebalance`, and after it.** The two converge on different quantities —
 * rebalance lowers each commune's distance to its seat, this lowers the spread between
 * units — and interleaved they cycle: run together, 650 communes ping-ponged every sweep and
 * the map became whatever the eighth sweep left. Alone this terminates, because moving a
 * commune of `c` from H to T changes the sum of squared unit populations by 2c(T - H) + 2c^2,
 * negative exactly when T + c < H, which is the condition below.
 */
function equalise(data: ModelData, params: Params, regionOf: Uint16Array): number {
  if (params.rTieM <= 0) return 0;

  let movedTotal = 0;
  for (let sweep = 0; sweep < REBALANCE_SWEEPS; sweep += 1) {
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
    const populationOf = (unit: number): number => {
      let total = 0;
      for (const m of members.get(unit)!) total += data.population[m]!;
      return total;
    };
    const areaOf = (unit: number): number => {
      let total = 0;
      for (const m of members.get(unit)!) total += data.areaKm2[m]!;
      return total;
    };

    let moved = 0;
    for (let siruta = 0; siruta < data.uatCount; siruta += 1) {
      const here = regionOf[siruta]!;
      if (here === siruta) continue;
      // A capital holds the ring around it; that is not up for rebalancing.
      if (isCapitalSeat(data, here) && capitalRing(data, params, here).has(siruta)) continue;
      // And no centre gives up a commune on its own border. Balance is worth moving a
      // commune that happens to sit in one unit rather than another; it is not worth taking
      // a village off the town it adjoins — Oras Viseu de Sus lost Sacel, which it borders,
      // to Oras Borsa purely because Borsa was carrying less.
      let touchesOwnSeat = false;
      for (let e = data.neighbourStart[here]!; e < data.neighbourStart[here + 1]!; e += 1) {
        if (data.neighbours[e] === siruta) {
          touchesOwnSeat = true;
          break;
        }
      }
      if (touchesOwnSeat) continue;

      const hereDistance = countyRoadDistances(data, data.countyOf[here]!, [here]).get(siruta);
      if (hereDistance === undefined || !Number.isFinite(hereDistance)) continue;

      let best: number[] | null = null;
      for (let e = data.neighbourStart[siruta]!; e < data.neighbourStart[siruta + 1]!; e += 1) {
        const there = regionOf[data.neighbours[e]!]!;
        if (there === here || !mayAbsorb(data, there, siruta)) continue;
        // Never grow a capital past its ring by this route either.
        if (isCapitalSeat(data, there) && !capitalRing(data, params, there).has(siruta)) continue;
        const thereDistance = countyRoadDistances(data, data.countyOf[there]!, [there]).get(siruta);
        if (thereDistance === undefined || !Number.isFinite(thereDistance)) continue;
        if (thereDistance > hereDistance + params.rTieM) continue;
        if (params.maxRoadM > 0 && thereDistance > params.maxRoadM) continue;
        // The move must strictly close the gap. This is both the point of the pass and the
        // reason it terminates.
        if (populationOf(there) + data.population[siruta]! >= populationOf(here)) continue;
        const key = [populationOf(there), areaOf(there), thereDistance, there];
        if (best === null || lessThan(key, best)) best = key;
      }
      if (best === null) continue;
      const targetUnit = best[best.length - 1]!;

      const list = members.get(here)!;
      const remaining = list.filter((m) => m !== siruta);
      if (remaining.length === 0 || !isConnected(data, remaining)) continue;
      if (params.pTarget > 0) {
        const before = populationOf(here);
        if (before >= params.pTarget && before - data.population[siruta]! < params.pTarget) {
          continue;
        }
      }
      if (!shapeAllows(data, params, list, remaining)) continue;
      const targetList = members.get(targetUnit)!;
      if (!shapeAllows(data, params, targetList, targetList.concat([siruta]))) continue;

      members.set(here, remaining);
      targetList.push(siruta);
      regionOf[siruta] = targetUnit;
      moved += 1;
    }
    movedTotal += moved;
    if (moved === 0) break;
  }
  return movedTotal;
}

/** How many units currently have their seat in this county. */
function countyUnitCount(data: ModelData, members: Map<number, number[]>, county: number): number {
  let n = 0;
  for (const seat of members.keys()) if (data.countyOf[seat] === county) n += 1;
  return n;
}

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

        const reachable = [...partners].filter(
          (other) =>
            compact(other) &&
            shapeAllows(
              data,
              params,
              members.get(region)!,
              [...members.get(region)!, ...members.get(other)!],
            ),
        );
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
        // Near-equal distances are decided by size, not by metres: within the band the
        // emptier unit takes it, population first because that is what the target is about,
        // then area, because a unit that is already vast should stop growing.
        const areaOf = (unit: number): number => {
          let total = 0;
          for (const m of members.get(unit)!) total += data.areaKm2[m]!;
          return total;
        };
        const mergeRank = (unit: number): number[] => {
          const metres = distances.get(unit) ?? Infinity;
          const band = params.rTieM > 0 ? Math.floor(metres / params.rTieM) : metres;
          return [band, populationOf(unit), areaOf(unit), metres, unit];
        };
        let partner = choices[0]!;
        let partnerKey = mergeRank(partner);
        for (const candidate of choices.slice(1)) {
          const key = mergeRank(candidate);
          if (lessThan(key, partnerKey)) {
            partner = candidate;
            partnerKey = key;
          }
        }

        // Coverage before size: a county keeps its minimum number of units even when that
        // leaves some of them short of the target. Merging is what collapsed the count —
        // Ilfov ended with two units and six other counties with four, because every unit
        // under the target kept merging until it cleared it, and in a county whose
        // population cannot support nMin units of that size that means merging all the way
        // down. Five units at 30,000 cover their ground; two at 75,000 do not.
        // Bucharest is one city, not a county that needs a spread of units.
        if (county !== data.bucharestCounty && countyUnitCount(data, members, county) <= params.nMin) {
          continue;
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
    // Only the most significant rank present may seat the unit; within it the cap decides,
    // and if nothing there holds the cap, standing does. Filtering the whole field by the
    // cap first preferred a commune that held it to a town that did not, so Gropeni (3,022)
    // seated a unit containing Municipiul Braila (154,686).
    const bestRank = Math.min(...ranked.map((m) => data.attributes.adminRank[m]!));
    const eligible = ranked.filter((m) => data.attributes.adminRank[m] === bestRank);
    const newSeat = eligible.find((c) => holdsTheCap(c)) ?? eligible[0] ?? oldSeat;
    if (newSeat === oldSeat) continue;
    for (const m of list) regionOf[m] = newSeat;
    if (orphanSeats.delete(oldSeat)) orphanSeats.add(newSeat);
    // Mirrors the reference: the tier moves with the seat.
    if (tierOf[oldSeat] !== -1) {
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
  | { kind: 'county-minimum'; units: number }
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

  // Coverage outranks size: a county already down to its minimum may not merge at all,
  // whatever the distances are. Snagov is the case — Ilfov holds exactly five units once
  // Bucharest has taken its ring and the border strip beyond it, so Snagov stays a unit of
  // one commune and no distance explains it. Checked *after* the two reasons above, which
  // are more fundamental: a unit with no neighbour at all is not being held back by a floor.
  const county = data.countyOf[seat]!;
  if (county !== data.bucharestCounty) {
    const seats = new Set<number>();
    for (let i = 0; i < data.uatCount; i += 1) {
      const unit = regionOf[i]!;
      if (data.countyOf[unit] === county) seats.add(unit);
    }
    if (seats.size <= params.nMin) return { kind: 'county-minimum', units: seats.size };
  }
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

const REBALANCE_SWEEPS = 8;
const SETTLE_ROUNDS = 6;
// Rounds of equalising paired with re-seating. Each round is convergent on its own; this
// only bounds the settling between the two.
const EQUALISE_ROUNDS = 4;

/** Whether a set of communes forms one piece over the road-connected graph. */
/**
 * What a county capital absorbs: everything within its radius by road.
 *
 * The radius, measured properly. It first meant area overlap against a buffer round the whole
 * city polygon, which is why Timisoara's "10 km" admitted communes 30 km away. Replacing it
 * with "the communes sharing a border with me" fixed the sprawl and threw out road distance
 * altogether — so Calarasi, with three land neighbours because of the Danube, could not take
 * Roseti 9.9 km away while Dragalina took it from 45.4 km.
 */
const capitalReachCache = new WeakMap<ModelData, Map<string, Set<number>>>();

function capitalReach(data: ModelData, params: Params, capital: number): Set<number> {
  let byKey = capitalReachCache.get(data);
  if (!byKey) {
    byKey = new Map();
    capitalReachCache.set(data, byKey);
  }
  const key = `${capital}:${params.rCapM}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const radius = params.rCapM;
  const reach = countyRoadDistances(data, data.countyOf[capital]!, [capital]);
  const out = new Set<number>();
  for (const [uat, metres] of reach) {
    if (uat !== capital && metres <= radius && mayAbsorb(data, capital, uat)) out.add(uat);
  }
  byKey.set(key, out);
  return out;
}

/** A resedinta de judet. `isCapital` also covers the Bucharest sectors, which this is not. */
function isCountyCapital(data: ModelData, unit: number): boolean {
  return data.attributes.isCapital[unit] === true && data.countyOf[unit] !== data.bucharestCounty;
}

/**
 * A capital of either kind — and Bucharest kept being missed.
 *
 * Every rule protecting a capital's ring was written against county capitals, so growth
 * handed the city all 14 communes touching it and the rebalancing pass took 11 straight back:
 * it ended up holding 3 of its own neighbours and 6 communes that do not touch it at all.
 */
function isCapitalSeat(data: ModelData, unit: number): boolean {
  return isCountyCapital(data, unit) || data.countyOf[unit] === data.bucharestCounty;
}

/**
 * What a capital holds by right: the ring bordering it — for Bucharest, the ring around all
 * six sectors — plus, for a resedinta de judet, its radius by road.
 *
 * Deliberately not the candidacy set: protecting that shielded 17 communes around Bucharest
 * that all had another unit adjacent and none of which were stranded, so the city grew a
 * uniform second ring instead of reaching only where it was needed.
 */
/**
 * Second-layer communes that sit against a county line.
 *
 * A commune one step beyond the capital's ring that touches a county the capital's own
 * territory does not span. `touching` rather than `neighbours` on purpose: whether a county
 * line runs along your edge is a question about the border, not about whether a road crosses
 * it. `home` must include the ring's counties — for Bucharest that is Ilfov as well as B, and
 * taking only the capital's own county made every Ilfov neighbour read as "across a county
 * line", which admitted the whole second layer: the city went to 37 communes and Ilfov fell
 * to four units, the uniform second ring this is meant not to be.
 */
function borderSecondLayer(
  data: ModelData,
  unit: number,
  ring: Set<number>,
  core: Set<number>,
): Set<number> {
  const home = new Set<number>([data.countyOf[unit]!]);
  for (const c of core) home.add(data.countyOf[c]!);
  for (const m of ring) home.add(data.countyOf[m]!);

  const out = new Set<number>();
  for (const member of ring) {
    for (let e = data.neighbourStart[member]!; e < data.neighbourStart[member + 1]!; e += 1) {
      const candidate = data.neighbours[e]!;
      if (ring.has(candidate) || core.has(candidate)) continue;
      if (!mayAbsorb(data, unit, candidate)) continue;
      for (let t = data.touchStart[candidate]!; t < data.touchStart[candidate + 1]!; t += 1) {
        if (!home.has(data.countyOf[data.touching[t]!]!)) {
          out.add(candidate);
          break;
        }
      }
    }
  }
  return out;
}

const capitalRingCache = new WeakMap<ModelData, Map<string, Set<number>>>();

/**
 * Memoised: `equalise` asks this for every commune on every sweep, and rebuilding the ring
 * each time — which walks the second layer and its shared borders — cost enough to put the
 * recompute over its 150 ms budget on its own.
 */
function capitalRing(data: ModelData, params: Params, unit: number): Set<number> {
  let byKey = capitalRingCache.get(data);
  if (!byKey) {
    byKey = new Map();
    capitalRingCache.set(data, byKey);
  }
  const key = `${unit}:${params.rCapM}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const out = capitalRingUncached(data, params, unit);
  byKey.set(key, out);
  return out;
}

function capitalRingUncached(data: ModelData, params: Params, unit: number): Set<number> {
  const out = new Set<number>();
  if (data.countyOf[unit] === data.bucharestCounty) {
    const core = new Set<number>(data.bucharestSectors);
    for (const sector of data.bucharestSectors) {
      for (let e = data.neighbourStart[sector]!; e < data.neighbourStart[sector + 1]!; e += 1) {
        const nb = data.neighbours[e]!;
        if (mayAbsorb(data, unit, nb)) out.add(nb);
      }
    }
    for (const nb of borderSecondLayer(data, unit, out, core)) out.add(nb);
    return out;
  }
  for (let e = data.neighbourStart[unit]!; e < data.neighbourStart[unit + 1]!; e += 1) {
    const nb = data.neighbours[e]!;
    if (mayAbsorb(data, unit, nb)) out.add(nb);
  }
  const border = borderSecondLayer(data, unit, out, new Set([unit]));
  for (const nb of capitalReach(data, params, unit)) out.add(nb);
  for (const nb of border) out.add(nb);
  return out;
}

function isConnected(data: ModelData, group: number[]): boolean {
  const inside = new Set(group);
  const seen = new Set([group[0]!]);
  const stack = [group[0]!];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (let e = data.neighbourStart[current]!; e < data.neighbourStart[current + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (inside.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen.size === inside.size;
}

/**
 * Move a commune to the neighbouring unit whose seat is actually nearer by road.
 *
 * Growth settles a commune against the state at the moment it was reached. By the time
 * everything has grown, merged and been re-seated, some communes sit in a unit whose seat is
 * further away than a neighbouring unit's — the thing a resident notices first, and the thing
 * that produces ragged edges.
 *
 * Every move satisfies all of: the commune borders the unit it joins and may legally join it;
 * that seat is strictly nearer by road and within the cap; the unit it leaves stays in one
 * piece; and the unit it leaves does not drop below the target if it was above it. A tidier
 * edge is not worth breaking a unit that was already viable.
 */
function rebalance(data: ModelData, params: Params, regionOf: Uint16Array): number {
  let movedTotal = 0;
  for (let sweep = 0; sweep < REBALANCE_SWEEPS; sweep += 1) {
    const members = new Map<number, number[]>();
    for (let i = 0; i < data.uatCount; i += 1) {
      const seat = regionOf[i]!;
      const list = members.get(seat);
      if (list) list.push(i);
      else members.set(seat, [i]);
    }
    const reachCache = new Map<number, Map<number, number>>();
    const reachFrom = (seat: number): Map<number, number> => {
      let cached = reachCache.get(seat);
      if (!cached) {
        cached = countyRoadDistances(data, data.countyOf[seat]!, [seat]);
        reachCache.set(seat, cached);
      }
      return cached;
    };

    let moved = 0;
    for (let siruta = 0; siruta < data.uatCount; siruta += 1) {
      const here = regionOf[siruta]!;
      if (here === siruta) continue;
      // A capital gives back anything beyond its ring that someone else will now take.
      // A commune is handed to the capital when nothing else is adjacent at the time, and
      // units keep growing and merging afterwards. Unlike an ordinary rebalance this does
      // not require the new seat to be nearer: the rule is that a capital holds its ring,
      // not that it holds whatever is closest to it.
      if (isCapitalSeat(data, here)) {
        const onRing = capitalRing(data, params, here).has(siruta);
        if (!onRing) {
          const hereAway = reachFrom(here).get(siruta) ?? Infinity;
          const takers: number[] = [];
          for (let e = data.neighbourStart[siruta]!; e < data.neighbourStart[siruta + 1]!; e += 1) {
            const other = regionOf[data.neighbours[e]!]!;
            if (other === here || isCountyCapital(data, other)) continue;
            if (!mayAbsorb(data, other, siruta)) continue;
            const away = reachFrom(other).get(siruta) ?? Infinity;
            if (params.maxRoadM > 0 && away > params.maxRoadM) continue;
            // Only to a unit that is actually nearer. A capital holding a commune it is
            // closest to is the road-distance rule, not sprawl: Roseti is 9.9 km from
            // Calarasi and 45.4 km from Dragalina, and giving it back for being outside the
            // ring is how it ended up there.
            if (!(away < hereAway)) continue;
            if (!takers.includes(other)) takers.push(other);
          }
          if (takers.length > 0) {
            const current = members.get(here)!;
            const rest = current.filter((mm) => mm !== siruta);
            if (rest.length > 0 && isConnected(data, rest)) {
              takers.sort((a, b) => {
                const da = reachFrom(a).get(siruta) ?? Infinity;
                const db = reachFrom(b).get(siruta) ?? Infinity;
                return da !== db ? da - db : a - b;
              });
              members.set(here, rest);
              members.get(takers[0]!)!.push(siruta);
              regionOf[siruta] = takers[0]!;
              moved += 1;
              continue;
            }
          }
        }
      }

      // A commune bordering its county capital belongs to the capital and is not moved.
      // Rebalancing asks only "is another seat nearer by road", and for a ring commune the
      // answer is often yes — which quietly undid the rule. Twenty-four of the forty-one
      // capitals had lost part of their ring to this pass.
      if (isCapitalSeat(data, here) && capitalRing(data, params, here).has(siruta)) continue;
      const hereDistance = reachFrom(here).get(siruta) ?? Infinity;

      let target = -1;
      let targetDistance = Infinity;
      for (let e = data.neighbourStart[siruta]!; e < data.neighbourStart[siruta + 1]!; e += 1) {
        const there = regionOf[data.neighbours[e]!]!;
        if (there === here || !mayAbsorb(data, there, siruta)) continue;
        const thereDistance = reachFrom(there).get(siruta) ?? Infinity;
        if (!(thereDistance < hereDistance)) continue;
        if (params.maxRoadM > 0 && thereDistance > params.maxRoadM) continue;
        if (thereDistance < targetDistance || (thereDistance === targetDistance && there < target)) {
          target = there;
          targetDistance = thereDistance;
        }
      }
      if (target === -1) continue;

      const current = members.get(here)!;
      const remaining = current.filter((m) => m !== siruta);
      if (remaining.length === 0 || !isConnected(data, remaining)) continue;
      if (params.pTarget > 0) {
        let before = 0;
        for (const m of current) before += data.population[m]!;
        const after = before - data.population[siruta]!;
        if (before >= params.pTarget && after < params.pTarget) continue;
      }

      if (!shapeAllows(data, params, current, remaining)) continue;
      if (!shapeAllows(data, params, members.get(target)!, [...members.get(target)!, siruta])) {
        continue;
      }

      members.set(here, remaining);
      members.get(target)!.push(siruta);
      regionOf[siruta] = target;
      moved += 1;
    }

    movedTotal += moved;
    if (moved === 0) break;
  }
  return movedTotal;
}

export function runModel(data: ModelData, params: Params, pins: Pin[] = []): ModelResult {
  const regionOf = new Uint16Array(data.uatCount).fill(NO_REGION);
  const reasonOf = new Uint8Array(data.uatCount).fill(REASON.UNCHANGED);
  const overlapOf = new Uint8Array(data.uatCount);
  const { tierOf, underSeeded, held, reservedFor } = selectSeeds(data, params);

  const members = new Map<number, number[]>();
  accrete(data, params, tierOf, regionOf, reasonOf, overlapOf, members, held, reservedFor);

  // Before the cluster step: a commune nobody reached should join a neighbouring unit, not
  // start a unit of its own with the other communes nobody reached.
  absorbLeftovers(data, params, regionOf, members, reasonOf);

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

  // Consolidation judges a merge by road distance from the seat that survives, so it has to
  // see the real seats first.
  reseatUnits(data, params, regionOf, tierOf, orphanSeats);
  let belowTarget = consolidateToTarget(data, params, regionOf, orphanSeats, reasonOf, tierOf);

  // Then ask, of the finished map, whether any commune is in the wrong unit.
  rebalance(data, params, regionOf);

  // Re-seat and consolidate until they agree: re-seating moves the seat a merge was judged
  // from, which can make a refused merge feasible. The loop ends when a pass merges nothing.
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    reseatUnits(data, params, regionOf, tierOf, orphanSeats);
    const before = new Set<number>();
    for (let i = 0; i < data.uatCount; i += 1) before.add(regionOf[i]!);
    belowTarget = consolidateToTarget(data, params, regionOf, orphanSeats, reasonOf, tierOf);
    // Rebalancing belongs inside the loop: merging changes which units are adjacent, so a
    // commune the capital had to keep for want of a neighbour can acquire one only after a
    // merge elsewhere has happened.
    rebalance(data, params, regionOf);
    const after = new Set<number>();
    for (let i = 0; i < data.uatCount; i += 1) after.add(regionOf[i]!);
    if (after.size === before.size) break;
  }

  // Last of all, and only on what the ordinary rules could not place. Running it earlier
  // would let a cap-breaking merge stand where a later re-seating made a legal one possible.
  absorbStranded(data, params, regionOf, orphanSeats, reasonOf, tierOf);
  reseatUnits(data, params, regionOf, tierOf, orphanSeats);
  // A last-resort merge changes membership like any other, so the map is rebalanced against
  // it. Skipping this left Vernesti in Oras Pogoanele 48.7 km away while Municipiul Buzau sat
  // 10.6 km off: it had always been misplaced, and was excused only because removing it would
  // have dropped Pogoanele below the target.
  rebalance(data, params, regionOf);

  // Last, and never before rebalance, which asks only whether a seat is strictly nearer and
  // would hand Pantelimon straight back to Medgidia. Paired with re-seating because moving
  // communes can give a unit a more significant town than its seat, and moving the seat
  // changes the distances this pass measured.
  for (let round = 0; round < EQUALISE_ROUNDS; round += 1) {
    if (equalise(data, params, regionOf) === 0) break;
    reseatUnits(data, params, regionOf, tierOf, orphanSeats);
  }

  // Counted from the finished map, not taken from the last consolidation pass. Rebalancing
  // runs after that pass and moves communes between units, so the figure it returned is
  // stale by the time the loop ends — off by one against the reference, which counts at the
  // end.
  if (params.pTarget > 0) {
    const totals = new Map<number, number>();
    for (let i = 0; i < data.uatCount; i += 1) {
      const seat = regionOf[i]!;
      totals.set(seat, (totals.get(seat) ?? 0) + data.population[i]!);
    }
    belowTarget = 0;
    for (const total of totals.values()) if (total < params.pTarget) belowTarget += 1;
  }

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