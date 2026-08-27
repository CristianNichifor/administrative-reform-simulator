/**
 * Give every resulting unit a colour that none of its neighbours share.
 *
 * Without this, two or three separate units that happen to draw the same hue read as one
 * shape — which is worse than useless on a map whose whole subject is which communes ended
 * up together. Adjacency here is *visual* adjacency: every shared border counts, whether or
 * not a road crosses it, and it deliberately crosses county lines. Two units either side of
 * a county boundary touch on screen, and if they match the boundary between them disappears.
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
 * Two families of colour, and every colour far enough from every other to be told apart.
 *
 * Chosen by search rather than by eye. The previous palette had twenty entries picked by
 * hand and several were near-duplicates — two olive-greens 5.0 apart in CIELAB, a green and
 * an emerald 9.0 apart, two indigos 8.1 apart. Adjacent units drawn in those pairs read as
 * one shape, which is the failure this whole module exists to prevent.
 *
 * These twelve are the result of a farthest-point search over a grid of vivid hues, so the
 * closest pair sits 32.8 apart. That is the number the test enforces, and it is why the
 * palette should not be edited by hand: hand-tuning it for taste is exactly how the
 * near-duplicates got in.
 *
 * Twelve is generous. Greedy colouring over the touching graph never needs more than six at
 * any slider setting, so there is room for the family preference below to be honoured
 * almost always.
 *
 * Vivid rather than muted, deliberately. On a dark basemap a low-saturation palette reads
 * as a single grey-blue wash from any distance.
 */
export const UNIT_PALETTE = [
  '#5c9ee0', // blue
  '#4e68d0', // indigo
  '#24bc75', // emerald
  '#4ec3d0', // cyan
  '#a5c133', // lime
  '#c133c1', // magenta
  '#33c133', // green
  '#d06cb6', // orchid
];

/** Clusters of small communes, which follow a different rule and should stay recognisable. */
export const CLUSTER_PALETTE = [
  '#c15733', // burnt orange
  '#c19733', // gold
  '#e05c77', // rose
  '#ca987d', // tan
];

export const PALETTE = [...UNIT_PALETTE, ...CLUSTER_PALETTE];
const UNIT = UNIT_PALETTE.map((_, i) => i);
const CLUSTER = CLUSTER_PALETTE.map((_, i) => UNIT_PALETTE.length + i);

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
    // The touching graph, not the model's. A border with no road across it is still a
    // border on screen: Sulina, Crisan and Chilia Veche are three separate units with no
    // road between them, and colouring from the road graph drew all three in one orange
    // block that read as a single unit.
    for (let e = data.touchStart[i]!; e < data.touchStart[i + 1]!; e += 1) {
      const other = regionOf[data.touching[e]!]!;
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
    const own = isOrphanUnit[unit] === 1 ? CLUSTER : UNIT;
    const other = isOrphanUnit[unit] === 1 ? UNIT : CLUSTER;
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
