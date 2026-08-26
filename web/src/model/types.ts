/**
 * Shared types for the accretion model.
 *
 * UATs are addressed by **index** throughout, never by SIRUTA string. The index is the
 * SIRUTA sort order produced by `pipeline/export.py`, which gives a property the model
 * relies on everywhere:
 *
 *   comparing two indices numerically is identical to comparing their SIRUTA codes
 *   lexicographically.
 *
 * Every tie-break in the brief is "then SIRUTA ascending", so this turns each of them into
 * an integer comparison — and, more importantly, it is why the TypeScript port can match
 * the Python reference exactly without carrying strings into the hot path.
 */

/** Tier order is also sort order: capitals are processed before every other seed. */
export const TIER_COUNTY_CAPITAL = 0;
export const TIER_POPULATION = 1;
export const TIER_PROMOTED = 2;

export type Tier =
  | typeof TIER_COUNTY_CAPITAL
  | typeof TIER_POPULATION
  | typeof TIER_PROMOTED;

export interface Params {
  /** Absorber population threshold. */
  x: number;
  /** County-capital radius, metres. Must be on the precomputed grid. */
  rCapM: number;
  /** Other-absorber radius, metres. Must be on the precomputed grid. */
  rTownM: number;
  /** Minimum absorbers per county. */
  nMin: number;
  /** Minimum seed separation, metres. */
  rSepM: number;
  /** Minimum overlap fraction, 0..1. */
  minOverlap: number;
  /** Orphan-tier population floor. Zero disables the tier. */
  pOrphan: number;
}

export const DEFAULT_PARAMS: Params = {
  x: 15_000,
  rCapM: 15_000,
  rTownM: 10_000,
  nMin: 5,
  rSepM: 15_000,
  minOverlap: 0.1,
  pOrphan: 5_000,
};

/** Seed-promotion relaxation, mirroring `pipeline/constants.py`. */
export const R_SEP_RELAXATION_FACTOR = 0.75;
export const R_SEP_RELAXATION_FLOOR_M = 2_000;

/** How the map is coloured. Encoded in the URL hash alongside the parameters. */
export type ViewMode = 'regions' | 'cost';

export interface Manifest {
  uatCount: number;
  /** Quartile breaks for administration cost per resident, in RON. */
  adminCostBreaks: number[];
  overlapScale: number;
  overlapDecimals: number;
  radiusGrid: number[];
  edgeCount: number;
  candidacyCount: number;
  candidacyByRadius: Record<string, { start: number; count: number }>;
}

export interface Attributes {
  siruta: string[];
  name: string[];
  county: string[];
  isCapital: boolean[];
}

/**
 * Candidacy for one radius, in compressed-row form.
 *
 * Rows are grouped by absorber, so `rowStart[a] .. rowStart[a + 1]` is the slice belonging
 * to absorber index `a`. That turns "which UATs can this absorber reach" into a bounds
 * lookup rather than a scan of 200k rows on every slider frame.
 */
export interface RadiusSlice {
  target: Uint16Array;
  overlap: Uint8Array;
  seatInside: Uint8Array;
  /** Length uatCount + 1. */
  rowStart: Uint32Array;
}

export interface ModelData {
  manifest: Manifest;
  attributes: Attributes;
  uatCount: number;
  population: Uint32Array;
  seatX: Float32Array;
  seatY: Float32Array;
  administrativeRon: Float32Array;
  operatingRon: Float32Array;
  /** County index per UAT; interned so comparisons are integer, not string. */
  countyOf: Uint8Array;
  countyCodes: string[];
  /** Neighbours in compressed-row form, ascending within each row. */
  neighbours: Uint16Array;
  neighbourStart: Uint32Array;
  /** Radius (metres) to its candidacy slice. */
  byRadius: Map<number, RadiusSlice>;
  /** Indices that appear as an absorber at any radius, ascending. */
  absorbers: Uint16Array;
}

export interface ModelResult {
  /** Region absorber index for each UAT index. */
  regionOf: Uint16Array;
  /** Tier per seed index, or -1 where the UAT is not a seed. */
  tierOf: Int8Array;
  regions: number;
  seeds: number;
  orphanRegions: number;
  unassigned: number;
  savingsAdminRon: number;
  savingsOperatingRon: number;
  underSeededCounties: string[];
}
