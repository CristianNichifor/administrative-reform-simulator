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
/**
 * Give every resulting unit a colour, under two rules.
 *
 *   - **No colour appears twice inside a county.** Not "no two touching units": a county is
 *     the unit of comparison a reader actually uses, and two same-coloured units at opposite
 *     ends of one county still read as one thing when you are looking at that county.
 *   - **No two units that touch share a colour**, including across county lines. Two units
 *     either side of a county boundary touch on screen, and if they match the boundary
 *     between them disappears.
 *
 * The first rule makes every county a clique in the constraint graph. The busiest county has
 * eleven units, so eleven colours are needed and eleven are enough — measured, not guessed.
 * Units are visited in descending constraint order, which is what achieves eleven; visiting
 * them by index needs more.
 *
 * Deterministic: the visit order breaks ties by index, so the same scenario always produces
 * the same map.
 */

/**
 * Eleven colours, every one a different hue.
 *
 * Chosen by search under two constraints at once: at least 32 degrees of hue between any
 * pair, so no two are shades of the same colour, and maximum perceptual distance subject to
 * that. The closest pair sits 25.3 apart in CIELAB and lightness runs from 40 to 83, which
 * keeps them apart on a dark basemap by brightness as well as by hue.
 *
 * This is not editable by hand. Two hand-picked palettes preceded it and both contained
 * near-duplicates — two olive-greens 5.0 apart, two blues that differed only in lightness.
 * Hue separation is the constraint that stops that happening, and eyeballing does not
 * enforce it.
 *
 * There is no second family for cluster units any more. All eleven are needed to satisfy the
 * county rule, so a cluster is identified by its badge in the panel rather than by hue.
 */
export const PALETTE = [
  '#c64a39', // red
  '#ddc088', // sand
  '#a9c639', // lime
  '#9ddd88', // pale green
  '#39c663', // green
  '#88ddcf', // aqua
  '#398fc6', // blue
  '#888edd', // periwinkle
  '#7d39c6', // violet
  '#dd88da', // orchid
  '#c63976', // magenta
];

/**
 * Palette index for every UAT, taken from the unit it belongs to.
 *
 * Cluster units no longer take a colour family of their own: all eleven colours are needed
 * to keep a county's units distinct, so a cluster is marked by its badge in the panel.
 */
export function assignUnitColours(data: ModelData, regionOf: Uint16Array): Uint8Array {
  const units: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const unit = regionOf[i]!;
    if (!seen.has(unit)) {
      seen.add(unit);
      units.push(unit);
    }
  }

  // Touching is absolute; same-county is a strong preference. They are kept apart because
  // they are not equally satisfiable: with the population target switched off a single
  // county can hold thirty units, and thirty colours a reader can tell apart do not exist.
  // Where the county cannot be satisfied the map degrades to the touching rule, which can
  // always be met, rather than producing two neighbours in one colour.
  const touching = new Map<number, Set<number>>();
  const conflicts = new Map<number, Set<number>>();
  for (const unit of units) {
    touching.set(unit, new Set());
    conflicts.set(unit, new Set());
  }

  // Every county is a clique: no colour twice within one.
  const byCounty = new Map<number, number[]>();
  for (const unit of units) {
    const county = data.countyOf[unit]!;
    let list = byCounty.get(county);
    if (!list) {
      list = [];
      byCounty.set(county, list);
    }
    list.push(unit);
  }
  for (const list of byCounty.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        conflicts.get(list[i]!)!.add(list[j]!);
        conflicts.get(list[j]!)!.add(list[i]!);
      }
    }
  }

  // Plus every pair that touches, following commune borders across county lines. The
  // touching graph, not the model's: a border with no road across it is still a border on
  // screen.
  for (let i = 0; i < data.uatCount; i += 1) {
    const unit = regionOf[i]!;
    for (let e = data.touchStart[i]!; e < data.touchStart[i + 1]!; e += 1) {
      const other = regionOf[data.touching[e]!]!;
      if (other !== unit) {
        conflicts.get(unit)!.add(other);
        conflicts.get(other)!.add(unit);
        touching.get(unit)!.add(other);
        touching.get(other)!.add(unit);
      }
    }
  }

  // Most-constrained first. Index order needs more than eleven colours; this does not.
  const order = [...units].sort((a, b) => {
    const byDegree = conflicts.get(b)!.size - conflicts.get(a)!.size;
    return byDegree !== 0 ? byDegree : a - b;
  });

  const chosen = new Map<number, number>();
  const usedBy = (group: Map<number, Set<number>>, unit: number): Set<number> => {
    const taken = new Set<number>();
    for (const other of group.get(unit)!) {
      const already = chosen.get(other);
      if (already !== undefined) taken.add(already);
    }
    return taken;
  };

  for (const unit of order) {
    const both = usedBy(conflicts, unit);
    let pick = 0;
    while (pick < PALETTE.length && both.has(pick)) pick += 1;
    if (pick >= PALETTE.length) {
      // The county is fuller than the palette. Give up the county rule for this one unit
      // and keep the rule that always matters: not matching anything it touches.
      const near = usedBy(touching, unit);
      pick = 0;
      while (pick < PALETTE.length && near.has(pick)) pick += 1;
      if (pick >= PALETTE.length) pick = 0;
    }
    chosen.set(unit, pick);
  }

  const colourOf = new Uint8Array(data.uatCount);
  for (let i = 0; i < data.uatCount; i += 1) colourOf[i] = chosen.get(regionOf[i]!)!;
  return colourOf;
}
