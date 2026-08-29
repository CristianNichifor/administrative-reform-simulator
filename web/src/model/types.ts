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
export const TIER_NATIONAL_CAPITAL = 0;
export const TIER_COUNTY_CAPITAL = 1;
export const TIER_POPULATION = 2;
export const TIER_PROMOTED = 3;

export type Tier =
  | typeof TIER_NATIONAL_CAPITAL
  | typeof TIER_COUNTY_CAPITAL
  | typeof TIER_POPULATION
  | typeof TIER_PROMOTED;

export interface Params {
  /** Absorber population threshold. */
  x: number;
  /** National-capital radius, metres. Bucharest only. */
  rNationalM: number;
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
  /** Minimum population a resulting unit should reach. Zero disables the step. */
  pTarget: number;
  /** How far a commune may be from its centre by road. Zero disables the cap. */
  maxRoadM: number;
  /** Polsby-Popper floor for a unit's shape; 0 switches the rule off. */
  minCompactness: number;
  /** Contest distances within this band count as equal; the smaller unit then wins. */
  rTieM: number;
  /** A stranded unit below this may break the distance cap rather than stay a leftover. */
  pStranded: number;
}

export const DEFAULT_PARAMS: Params = {
  x: 7_500,
  rNationalM: 15_000,
  rCapM: 10_000,
  rTownM: 10_000,
  nMin: 5,
  rSepM: 15_000,
  minOverlap: 0.1,
  pOrphan: 5_000,
  pTarget: 50_000,
  maxRoadM: 50_000,
  minCompactness: 0,
  rTieM: 3_000,
  pStranded: 15_000,
};

/** Seed-promotion relaxation, mirroring `pipeline/constants.py`. */
/** Mirrors pipeline/constants.py; parity fails if the two drift. */
export const PROMOTION_POPULATION_BAND = 3_000;
export const R_SEP_RELAXATION_FACTOR = 0.75;
export const R_SEP_RELAXATION_FLOOR_M = 2_000;

/** How the map is coloured. Encoded in the URL hash alongside the parameters. */
export type ViewMode = 'current' | 'regions' | 'cost';

export interface Manifest {
  uatCount: number;
  /** Quartile breaks for administration cost per resident, in RON. */
  adminCostBreaks: number[];
  financeSeries: string[];
  overlapScale: number;
  overlapDecimals: number;
  radiusGrid: number[];
  edgeCount: number;
  candidacyCount: number;
  /** County code to full name, so the panel can say "Tulcea" rather than "TL". */
  countyNames: Record<string, string>;
  candidacyByRadius: Record<string, { start: number; count: number }>;
}

export interface Attributes {
  siruta: string[];
  name: string[];
  county: string[];
  isCapital: boolean[];
  /** Administrative standing, smaller is more significant: sector 0 … comuna 4. */
  adminRank: number[];
  /** Danube Delta communes, where borders are water and the distance cap does not apply. */
  deltaWater: boolean[];
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
  developmentRon: Float32Array;
  personnelRon: Float32Array;
  adminPersonnelRon: Float32Array;
  incomeRon: Float32Array;
  /** County index per UAT; interned so comparisons are integer, not string. */
  countyOf: Uint8Array;
  countyCodes: string[];
  /** UAT index of each county's capital, keyed by county index. */
  capitalOfCounty: Map<number, number>;
  /** Index of the Bucharest sector that stands for the city, or -1. */
  bucharestIndex: number;
  /** County index for Bucharest, or -1. */
  bucharestCounty: number;
  /** Every Bucharest sector. The city's reach is the union of theirs, not Sector 1's. */
  bucharestSectors: number[];
  /** Ilfov: the one county a unit may reach into, and only from Bucharest. */
  ilfovCounty: number;
  /** Neighbours in compressed-row form, ascending within each row. */
  neighbours: Uint16Array;
  /** Road distance in metres to each neighbour, aligned with `neighbours`. */
  neighbourRoadM: Float32Array;
  neighbourStart: Uint32Array;
  /**
   * Every shared border, including those no road crosses. Colouring only.
   *
   * The model must not use this: a border with no road is not one a unit may grow over.
   */
  touching: Uint16Array;
  touchStart: Uint32Array;
  /** Shared border length in km, aligned with `touching`. */
  touchingSharedKm: Float32Array;
  /** Per-commune shape, in square kilometres and kilometres. */
  areaKm2: Float32Array;
  perimeterKm: Float32Array;
  /** Radius (metres) to its candidacy slice. */
  byRadius: Map<number, RadiusSlice>;
  /** Indices that appear as an absorber at any radius, ascending. */
  absorbers: Uint16Array;
}

/**
 * Why each UAT ended up where it did.
 *
 * Recorded by the model as it runs, because that is the only place the information exists:
 * once the assignment is flattened to "this commune is in that region", the rule that put
 * it there is gone. A map that cannot explain itself is not disputable, which is the whole
 * premise of the tool.
 */
export const REASON = {
  CENTRE_CAPITAL: 0,
  CENTRE_THRESHOLD: 1,
  CENTRE_PROMOTED: 2,
  ABSORBED_OVERLAP: 3,
  ABSORBED_SEAT: 4,
  ORPHAN_SEAT: 5,
  ORPHAN_MEMBER: 6,
  UNCHANGED: 7,
  TARGET_MERGED: 8,
  /** Placed by hand, overriding whatever the rules decided. */
  MANUAL_PIN: 9,
} as const;

/**
 * A manual override: put `uat` in the unit seated at `seat`, whatever the rules say.
 *
 * Pins are applied *after* the model has run and are not part of it. With no pins the
 * result is exactly what the Python reference produces, which is what keeps the parity
 * fixtures meaningful — an override is a stated disagreement with the rules, not a change
 * to them, and the panel labels it as one.
 */
export interface Pin {
  uat: number;
  seat: number;
}

export interface ModelResult {
  /** One `REASON` code per UAT. */
  reasonOf: Uint8Array;
  /** Overlap percentage with the absorbing centre's radius, where that is the reason. */
  overlapOf: Uint8Array;
  /** Region absorber index for each UAT index. */
  regionOf: Uint16Array;
  /** Tier per seed index, or -1 where the UAT is not a seed. */
  tierOf: Int8Array;
  regions: number;
  seeds: number;
  orphanRegions: number;
  unassigned: number;
  /** Units still under the target because they have no same-county neighbour left. */
  belowTarget: number;
  savingsAdminRon: number;
  savingsOperatingRon: number;
  underSeededCounties: string[];
  /** Pins that were applied, in the order given. */
  pinsApplied: Pin[];
  /** Pins refused, with why — a stale target, or a county line the model forbids. */
  pinsRejected: { pin: Pin; why: 'not-a-seat' | 'county' | 'already-there' }[];
  /** Units left in more than one piece. Only pins can cause this; the rules cannot. */
  splitUnits: number[];
}
