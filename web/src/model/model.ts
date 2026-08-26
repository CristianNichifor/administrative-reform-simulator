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
  return tier === TIER_COUNTY_CAPITAL ? params.rCapM : params.rTownM;
}

function sliceFor(data: ModelData, params: Params, tier: number): RadiusSlice | undefined {
  return data.byRadius.get(tierRadius(params, tier));
}

/** Squared distance between two seats. Squared, because only comparisons are ever needed. */
function seatDistanceSq(data: ModelData, a: number, b: number): number {
  const dx = data.seatX[a]! - data.seatX[b]!;
  const dy = data.seatY[a]! - data.seatY[b]!;
  return dx * dx + dy * dy;
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

  for (let k = 0; k < data.absorbers.length; k += 1) {
    const i = data.absorbers[k]!;
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
      let bestIndex = -1;
      let bestGain = -1;
      let bestPop = -1;

      for (const candidate of pool) {
        if (seedsHere.length > 0 && rSep > 0) {
          const limitSq = rSep * rSep;
          let tooClose = false;
          for (const seed of seedsHere) {
            if (seatDistanceSq(data, candidate, seed) < limitSq) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
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

function accrete(
  data: ModelData,
  params: Params,
  tierOf: Int8Array,
  regionOf: Uint16Array,
  reasonOf: Uint8Array,
  overlapOf: Uint8Array,
): void {
  const seeds: number[] = [];
  for (let i = 0; i < data.uatCount; i += 1) if (tierOf[i] !== -1) seeds.push(i);

  // Tier ascending, then population descending, then index ascending. Never iterate an
  // unsorted collection here: the map must not flicker between runs.
  seeds.sort((a, b) => {
    const t = tierOf[a]! - tierOf[b]!;
    if (t !== 0) return t;
    const p = data.population[b]! - data.population[a]!;
    if (p !== 0) return p;
    return a - b;
  });

  const eligible = new Float64Array(data.uatCount);
  const isEligible = new Uint8Array(data.uatCount);

  for (const absorber of seeds) {
    // Claimed by an earlier, higher-priority absorber, so it founds no region of its own.
    if (regionOf[absorber] !== NO_REGION) continue;

    const tier = tierOf[absorber]!;
    const slice = sliceFor(data, params, tier);
    isEligible.fill(0);
    if (slice) {
      const from = slice.rowStart[absorber]!;
      const to = slice.rowStart[absorber + 1]!;
      const threshold = params.minOverlap * data.manifest.overlapScale;
      for (let i = from; i < to; i += 1) {
        if (slice.overlap[i]! >= threshold || slice.seatInside[i] === 1) {
          const t = slice.target[i]!;
          isEligible[t] = 1;
          eligible[t] = slice.overlap[i]! / data.manifest.overlapScale;
        }
      }
    }

    regionOf[absorber] = absorber;
    reasonOf[absorber] =
      tier === TIER_COUNTY_CAPITAL
        ? REASON.CENTRE_CAPITAL
        : tier === TIER_POPULATION
          ? REASON.CENTRE_THRESHOLD
          : REASON.CENTRE_PROMOTED;
    const county = data.countyOf[absorber]!;

    let frontier: number[] = [];
    for (let e = data.neighbourStart[absorber]!; e < data.neighbourStart[absorber + 1]!; e += 1) {
      const nb = data.neighbours[e]!;
      if (regionOf[nb] === NO_REGION) frontier.push(nb);
    }

    while (frontier.length > 0) {
      // Overlap descending, then index (SIRUTA) ascending.
      frontier.sort((a, b) => {
        // `eligible` is reused between absorbers, so it is only ever read through
        // `isEligible`; a leftover value from a previous absorber must not reorder
        // this one's wave.
        const oa = isEligible[a] === 1 ? eligible[a]! : 0;
        const ob = isEligible[b] === 1 ? eligible[b]! : 0;
        if (ob !== oa) return ob - oa;
        return a - b;
      });

      const nextWave = new Set<number>();
      for (const u of frontier) {
        if (regionOf[u] !== NO_REGION) continue;
        // Defence in depth, and currently unreachable: build_candidacy already drops
        // cross-county pairs, so no such UAT can be eligible. Removing this changes no
        // output today — verified by perturbation — but the rule belongs with the model
        // rather than resting solely on how the grid happens to be built.
        if (data.countyOf[u] !== county) continue;
        if (isEligible[u] === 0) continue;

        // Contiguity is a property of the traversal, not a separate check: u is in the
        // frontier only because a member of *this* region borders it, so a region can
        // never leapfrog a UAT it did not absorb.
        regionOf[u] = absorber;
        // Which of the two candidacy tests admitted it. The overlap rule is the ordinary
        // case; the seat rule is what lets a commune whose territory barely grazes the
        // radius still join, because its village is inside.
        const pct = Math.round(eligible[u]! * 100);
        overlapOf[u] = pct;
        reasonOf[u] =
          pct >= Math.round(params.minOverlap * 100)
            ? REASON.ABSORBED_OVERLAP
            : REASON.ABSORBED_SEAT;
        for (let e = data.neighbourStart[u]!; e < data.neighbourStart[u + 1]!; e += 1) {
          const nb = data.neighbours[e]!;
          if (regionOf[nb] === NO_REGION) nextWave.add(nb);
        }
      }
      frontier = [...nextWave].sort((a, b) => a - b);
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

        // Smallest first, so a small unit pairs with another small one rather than being
        // swallowed by the nearest city.
        let partner = -1;
        for (const candidate of [...partners].sort((a, b) => a - b)) {
          if (
            partner === -1 ||
            populationOf(candidate) < populationOf(partner)
          ) {
            partner = candidate;
          }
        }

        const aPop = populationOf(region);
        const bPop = populationOf(partner);
        const keep = aPop > bPop || (aPop === bPop && region > partner) ? region : partner;
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

  accrete(data, params, tierOf, regionOf, reasonOf, overlapOf);

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

  const belowTarget = consolidateToTarget(data, params, regionOf, orphanSeats, reasonOf);

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
