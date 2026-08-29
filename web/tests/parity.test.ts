/**
 * Parity between the TypeScript model and the Python reference (brief §7).
 *
 * The two implementations must produce **identical** region assignments across a matrix of
 * parameter combinations. If they diverge, the TypeScript port is wrong — the fixtures in
 * `tests/fixtures/parity_cases.json` are generated from the Python and are the authority.
 *
 * Assignments are compared by SHA-256 of the canonical assignment, so a single misplaced
 * commune out of 3,186 fails the test just as loudly as a wholesale difference.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { decode } from '../src/model/load';
import { runModel } from '../src/model/model';
import { DEFAULT_PARAMS, type ModelData, type Params } from '../src/model/types';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../public/data');
const fixturePath = resolve(here, '../../tests/fixtures/parity_cases.json');

interface FixtureCase {
  params: {
    x: number;
    r_national_m: number;
    r_cap_m: number;
    r_town_m: number;
    n_min: number;
    r_sep_m: number;
    min_overlap: number;
    p_orphan: number;
    p_target: number;
    max_road_m: number;
    min_compactness: number;
    r_tie_m?: number;
    p_stranded?: number;
  };
  regions: number;
  seeds: number;
  orphanRegions: number;
  unassigned: number;
  belowTarget: number;
  savingsAdminRon: number;
  savingsOperatingRon: number;
  assignmentSha256: string;
}

interface Fixture {
  uatOrder: string[];
  cases: FixtureCase[];
  defaultAssignment: number[];
}

/** Read as a fresh ArrayBuffer: Node pools small Buffers, and a pooled view would alias. */
function readBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(dataDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function toParams(p: FixtureCase['params']): Params {
  return {
    x: p.x,
    rNationalM: p.r_national_m,
    rCapM: p.r_cap_m,
    rTownM: p.r_town_m,
    nMin: p.n_min,
    rSepM: p.r_sep_m,
    minOverlap: p.min_overlap,
    pOrphan: p.p_orphan,
    pTarget: p.p_target,
    maxRoadM: p.max_road_m,
    minCompactness: p.min_compactness ?? 0,
    rTieM: p.r_tie_m ?? DEFAULT_PARAMS.rTieM,
    pStranded: p.p_stranded ?? DEFAULT_PARAMS.pStranded,
  };
}

function assignmentHash(regionOf: Uint16Array): string {
  return createHash('sha256').update(Array.from(regionOf).join(',')).digest('hex');
}

let data: ModelData;
let fixture: Fixture;

beforeAll(() => {
  fixture = readJson<Fixture>(fixturePath);
  data = decode({
    manifest: readJson(resolve(dataDir, 'manifest.json')),
    attributes: readJson(resolve(dataDir, 'attributes.json')),
    attributesBin: readBuffer('attributes.bin'),
    adjacencyBin: readBuffer('adjacency.bin'),
    candidacyBin: readBuffer('candidacy.bin'),
  });
});

describe('exported payload', () => {
  it('indexes the same UATs in the same order as the reference', () => {
    expect(data.attributes.siruta).toEqual(fixture.uatOrder);
  });

  it('has one attribute entry per UAT', () => {
    expect(data.population.length).toBe(data.uatCount);
    expect(data.attributes.name.length).toBe(data.uatCount);
    expect(data.seatX.length).toBe(data.uatCount);
  });

  it('has a candidacy slice for every radius on the grid', () => {
    for (const radius of data.manifest.radiusGrid) {
      expect(data.byRadius.has(radius)).toBe(true);
    }
  });

  it('builds a symmetric neighbour index', () => {
    for (let a = 0; a < data.uatCount; a += 1) {
      for (let e = data.neighbourStart[a]!; e < data.neighbourStart[a + 1]!; e += 1) {
        const b = data.neighbours[e]!;
        const back = data.neighbours.subarray(
          data.neighbourStart[b]!,
          data.neighbourStart[b + 1]!,
        );
        expect(back).toContain(a);
      }
    }
  });
});

describe('parity with the Python reference', () => {
  it('reproduces the default assignment UAT by UAT', () => {
    // Checked element-wise rather than by hash so a divergence names the commune.
    const result = runModel(data, toParams(fixture.cases[0]!.params));
    const expected = fixture.defaultAssignment;
    const mismatches: string[] = [];
    for (let i = 0; i < expected.length; i += 1) {
      if (result.regionOf[i] !== expected[i]) {
        mismatches.push(
          `${data.attributes.name[i]} (${data.attributes.siruta[i]}): ` +
            `expected region ${data.attributes.name[expected[i]!]}, ` +
            `got ${data.attributes.name[result.regionOf[i]!]}`,
        );
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });

  it.each(
    // Built lazily inside the test body would re-read the fixture; read it here instead.
    readJson<Fixture>(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/parity_cases.json'),
    ).cases.map((c, i) => [i, c] as const),
  )('case %i produces an identical assignment', (_index, expected) => {
    const result = runModel(data, toParams(expected.params));

    expect(result.regions).toBe(expected.regions);
    expect(result.seeds).toBe(expected.seeds);
    expect(result.orphanRegions).toBe(expected.orphanRegions);
    expect(result.unassigned).toBe(expected.unassigned);
    expect(result.belowTarget).toBe(expected.belowTarget);
    expect(assignmentHash(result.regionOf)).toBe(expected.assignmentSha256);

    // Float sums differ in their last bits between languages; a rounding artefact is not
    // a parity failure, but a real divergence is far larger than this tolerance.
    expect(result.savingsAdminRon).toBeCloseTo(expected.savingsAdminRon, -3);
    expect(result.savingsOperatingRon).toBeCloseTo(expected.savingsOperatingRon, -3);
  });
});

describe('model invariants', () => {
  it('assigns every UAT to exactly one region', () => {
    const result = runModel(data, toParams(fixture.cases[0]!.params));
    expect(result.regionOf.length).toBe(data.uatCount);
    for (let i = 0; i < data.uatCount; i += 1) {
      expect(result.regionOf[i]).toBeLessThan(data.uatCount);
    }
  });

  it('never lets a region span two counties, bar the Bucharest ring', () => {
    // Bucharest and Ilfov are the one permitted exception: the county line there runs
    // through continuous built-up area rather than around it.
    const result = runModel(data, toParams(fixture.cases[0]!.params));
    for (let i = 0; i < data.uatCount; i += 1) {
      const from = data.attributes.county[result.regionOf[i]!];
      const to = data.attributes.county[i];
      if (from === to) continue;
      expect([from, to]).toEqual(['B', 'IF']);
    }
  });

  it('produces byte-identical output on a second run', () => {
    const params = toParams(fixture.cases[0]!.params);
    const a = runModel(data, params);
    const b = runModel(data, params);
    expect(assignmentHash(a.regionOf)).toBe(assignmentHash(b.regionOf));
  });
});
