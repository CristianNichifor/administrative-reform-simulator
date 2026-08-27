/**
 * Give every resulting unit a colour that none of its neighbours share.
 *
 * Without this, two or three separate units that happen to draw the same hue read as one
 * shape — which is worse than useless on a map whose whole subject is which communes ended
 * up together. Adjacency here is *visual* adjacency, so it deliberately crosses county
 * lines: two units either side of a county boundary touch on screen, and if they match the
 * boundary between them disappears.
 *
 * Plain greedy colouring over units in index order. Units are few (a couple of hundred at
 * the default settings) and the map is close to planar, so a handful of colours suffices;
 * the palette is far larger than the greedy bound needs.
 *
 * Deterministic by construction: units are visited in ascending index and always take the
 * lowest free slot, so the same scenario always produces the same map.
 */

import type { ModelData } from './types';

/**
 * Cool hues for units built by absorption, warm for small-commune clusters.
 *
 * The two families are kept apart so the brief's requirement still holds — a cluster
 * follows a different rule and should stay recognisable — while the no-two-neighbours-alike
 * constraint applies across both. A unit takes a colour from its own family where one is
 * free, and borrows from the other only when every one of its own is taken by a neighbour,
 * which is rare and always preferable to two adjacent units matching.
 */
export const COOL_PALETTE = [
  '#2f6f8f', '#3f8f7f', '#5b7fa8', '#417f5c', '#6a6f9c', '#2f7f7a',
  '#4a6f8f', '#557f6a', '#3f6f9c', '#5f8f8a', '#46769b', '#6d83ab',
];

export const WARM_PALETTE = [
  '#b58547', '#c2924f', '#a87a3e', '#cc9e5c', '#9d7038', '#d3a96a',
];

export const PALETTE = [...COOL_PALETTE, ...WARM_PALETTE];
const COOL = COOL_PALETTE.map((_, i) => i);
const WARM = WARM_PALETTE.map((_, i) => COOL_PALETTE.length + i);

/**
 * Palette index for every UAT, taken from the unit it belongs to.
 *
 * @param isOrphanUnit indexed by unit seat, 1 where the unit came from the orphan tier.
 */
export function assignUnitColours(
  data: ModelData,
  regionOf: Uint16Array,
  isOrphanUnit: Uint8Array,
): Uint8Array {
  // Which units touch which, following commune borders regardless of county.
  const neighbours = new Map<number, Set<number>>();
  const units: number[] = [];
  for (let i = 0; i < data.uatCount; i += 1) {
    const unit = regionOf[i]!;
    if (!neighbours.has(unit)) {
      neighbours.set(unit, new Set());
      units.push(unit);
    }
  }
  for (let i = 0; i < data.uatCount; i += 1) {
    const unit = regionOf[i]!;
    for (let e = data.neighbourStart[i]!; e < data.neighbourStart[i + 1]!; e += 1) {
      const other = regionOf[data.neighbours[e]!]!;
      if (other !== unit) neighbours.get(unit)!.add(other);
    }
  }

  units.sort((a, b) => a - b);
  const chosen = new Map<number, number>();

  for (const unit of units) {
    const taken = new Set<number>();
    for (const other of neighbours.get(unit)!) {
      const already = chosen.get(other);
      if (already !== undefined) taken.add(already);
    }
    const own = isOrphanUnit[unit] === 1 ? WARM : COOL;
    const other = isOrphanUnit[unit] === 1 ? COOL : WARM;
    // Own family first, then the other; never leave a neighbour matching just to keep the
    // family tidy.
    const pick =
      own.find((c) => !taken.has(c)) ??
      other.find((c) => !taken.has(c)) ??
      own[0]!;
    chosen.set(unit, pick);
  }

  const colourOf = new Uint8Array(data.uatCount);
  for (let i = 0; i < data.uatCount; i += 1) colourOf[i] = chosen.get(regionOf[i]!)!;
  return colourOf;
}
