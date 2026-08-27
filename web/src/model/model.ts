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
  const slice = sliceFor(data, params, tier);
  if (slice) {
    const threshold = params.minOverlap * data.manifest.overlapScale;
    for (let i = slice.rowStart[seed]!; i < slice.rowStart[seed + 1]!; i += 1) {
      if (slice.overlap[i]! >= threshold || slice.seatInside[i] === 1) {
        admitted.set(slice.target[i]!, slice.overlap[i]!);
      }
    }
  }
  const radius = tierRadius(params, tier);
  for (let e = data.neighbourStart[seed]!; e < data.neighbourStart[seed + 1]!; e += 1) {
    const nb = data.neighbours[e]!;
    if (admitted.has(nb)) continue;
    if (data.countyOf[nb] !== data.countyOf[seed]) continue;
    if (data.neighbourRoadM[e]! <= radius) admitted.set(nb, 0);
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

    const pool = uats.filter((i) => isAbsorber[i] === 1 && tierOf[i] === -1);

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
        const pop = data.population[candidate]!;
        if (
          bestIndex === -1 ||
          gain > bestGain ||
          (gain === bestGain && pop > bestPop) ||
          (gain === bestGain && pop === bestPop && candidate < bestIndex)
        ) {
          bestIndex = candidate;
          bestGain = gain;
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

  return { tierOf, underSeeded };
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
): Map<number, boolean> {
  const seeds: number[] = [];
  for (let i = 0; i < data.uatCount; i += 1) if (tierOf[i] !== -1) seeds.push(i);

  // Centres that share a border with their own county capital.
  const held = new Set<number>();
  for (const seed of seeds) {
    if (isCapitalTier(tierOf[seed]!)) continue;
    const capital = data.capitalOfCounty.get(data.countyOf[seed]!);
    if (capital === undefined) continue;
    for (let e = data.neighbourStart[seed]!; e < data.neighbourStart[seed + 1]!; e += 1) {
      if (data.neighbours[e] === capital) {
        held.add(seed);
        break;
      }
    }
  }

  grow(
    data, params, tierOf, regionOf, reasonOf, overlapOf, members,
    seeds.filter((s) => !held.has(s)),
    held,
  );

  const survived = new Map<number, boolean>();
  const heldOrder = [...held].sort((a, b) => {
    const p = data.population[b]! - data.population[a]!;
    return p !== 0 ? p : a - b;
  });
  for (const absorber of heldOrder) {
    if (regionOf[absorber] !== NO_REGION) continue;
    grow(data, params, tierOf, regionOf, reasonOf, overlapOf, members, [absorber], new Set());
    let reached = 0;
    for (const m of members.get(absorber) ?? [absorber]) reached += data.population[m]!;
    survived.set(absorber, reached >= params.pTarget);
  }

  for (const [absorber, ok] of survived) {
    if (ok) continue;
    // It may no longer be its own region: another held centre grown earlier can have
    // absorbed it. Folding it again would assign its communes twice.
    if (regionOf[absorber] !== absorber) continue;
    const capital = data.capitalOfCounty.get(data.countyOf[absorber]!);
    if (capital === undefined || !members.has(capital)) continue;
    // Folding respects the cap like every other merge. A held centre gathers up to the cap
    // from itself, so folding it wholesale put communes twice the cap from the capital.
    // Where that would happen it keeps its own unit and is reported as below target, which
    // is honest rather than a silently oversized region.
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

  return survived;
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
      if (data.countyOf[uat] !== data.countyOf[absorber]) continue;
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
      // Growth never routes through another county: a region cannot occupy one, so a path
      // that leaves and comes back is not a path the unit holds — and counting it made the
      // distance cap unenforceable.
      if (data.countyOf[nb] !== data.countyOf[absorber]) continue;
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

        const standingOf = (unit: number): [number, number, number] => [
          tierOf[unit] === -1 ? TIER_PROMOTED + 1 : tierOf[unit]!,
          -data.population[unit]!,
          unit,
        ];
        const beats = (a: number, b: number): boolean => {
          const sa = standingOf(a);
          const sb = standingOf(b);
          return sa[0] !== sb[0] ? sa[0] < sb[0] : sa[1] !== sb[1] ? sa[1] < sb[1] : sa[2] <= sb[2];
        };

        // Allowed only if, once merged, every commune in the combined unit is within the
        // cap of the seat that survives. Checking from the initiating seat alone left the
        // cap toothless whenever the partner kept the seat.
        const compact = (other: number): boolean => {
          if (params.maxRoadM <= 0) return true;
          const keepSeat = beats(region, other) ? region : other;
          const reach =
            keepSeat === region ? distances : countyRoadDistances(data, county, [other]);
          const everyone = [...members.get(region)!, ...members.get(other)!];
          return everyone.every((m) => (reach.get(m) ?? Infinity) <= params.maxRoadM);
        };

        const reachable = [...partners].filter(compact);
        if (reachable.length === 0) continue;

        const stillSmall = reachable.filter((o) => populationOf(o) < params.pTarget);
        const choices = (stillSmall.length > 0 ? stillSmall : reachable).sort((a, b) => a - b);
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

export function runModel(data: ModelData, params: Params): ModelResult {
  const regionOf = new Uint16Array(data.uatCount).fill(NO_REGION);
  const reasonOf = new Uint8Array(data.uatCount).fill(REASON.UNCHANGED);
  const overlapOf = new Uint8Array(data.uatCount);
  const { tierOf, underSeeded } = selectSeeds(data, params);

  const members = new Map<number, number[]>();
  const held = accrete(data, params, tierOf, regionOf, reasonOf, overlapOf, members);
  void held;

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

  const belowTarget = consolidateToTarget(data, params, regionOf, orphanSeats, reasonOf, tierOf);

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
  };
}
