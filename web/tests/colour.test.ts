/**
 * Unit colouring: no two touching units may share a colour.
 *
 * Eyeballing a map of two hundred units cannot catch a single bad pair, and a single bad
 * pair is exactly the failure that matters — two separate units drawing the same hue read
 * as one shape, which is the opposite of what the map is for.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { assignUnitColours, COOL_PALETTE, PALETTE, WARM_PALETTE } from '../src/model/colour';
import { decode } from '../src/model/load';
import { runModel } from '../src/model/model';
import { DEFAULT_PARAMS, type ModelData, type Params } from '../src/model/types';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../public/data');

function readBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(dataDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
const readJson = <T,>(name: string): T =>
  JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as T;

let data: ModelData;

beforeAll(() => {
  data = decode({
    manifest: readJson('manifest.json'),
    attributes: readJson('attributes.json'),
    attributesBin: readBuffer('attributes.bin'),
    adjacencyBin: readBuffer('adjacency.bin'),
    candidacyBin: readBuffer('candidacy.bin'),
  });
});

function colourFor(params: Params) {
  const result = runModel(data, params);
  const isOrphanUnit = new Uint8Array(data.uatCount);
  for (let i = 0; i < data.uatCount; i += 1) {
    const unit = result.regionOf[i]!;
    if (result.tierOf[unit] === -1) isOrphanUnit[unit] = 1;
  }
  return { result, colourOf: assignUnitColours(data, result.regionOf, isOrphanUnit) };
}

/** Every pair of units that touch, following commune borders across county lines too. */
function touchingUnits(regionOf: Uint16Array): [number, number][] {
  const pairs = new Set<string>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const a = regionOf[i]!;
    for (let e = data.neighbourStart[i]!; e < data.neighbourStart[i + 1]!; e += 1) {
      const b = regionOf[data.neighbours[e]!]!;
      if (a !== b) pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  return [...pairs].map((k) => k.split(':').map(Number) as [number, number]);
}

describe('unit colouring', () => {
  const scenarios: [string, Params][] = [
    ['default', DEFAULT_PARAMS],
    ['no target', { ...DEFAULT_PARAMS, pTarget: 0 }],
    ['orphan tier off', { ...DEFAULT_PARAMS, pOrphan: 0, pTarget: 0 }],
    ['tight radii', { ...DEFAULT_PARAMS, rCapM: 5_000, rTownM: 5_000, pTarget: 0 }],
  ];

  it.each(scenarios)('%s: no two touching units share a colour', (_name, params) => {
    const { result, colourOf } = colourFor(params);
    // Colour is stored per UAT, so read it from any member of the unit — the seat.
    const clashes: string[] = [];
    for (const [a, b] of touchingUnits(result.regionOf)) {
      if (colourOf[a] === colourOf[b]) {
        clashes.push(`${data.attributes.name[a]} / ${data.attributes.name[b]}`);
      }
    }
    expect(clashes.slice(0, 10)).toEqual([]);
  });

  it.each(scenarios)('%s: clashes are checked across county lines too', (_name, params) => {
    // The constraint that matters visually: two units either side of a county boundary
    // still touch on screen, so matching there erases the boundary between them.
    const { result, colourOf } = colourFor(params);
    let crossCounty = 0;
    for (const [a, b] of touchingUnits(result.regionOf)) {
      if (data.countyOf[a] !== data.countyOf[b]) {
        crossCounty += 1;
        expect(colourOf[a]).not.toBe(colourOf[b]);
      }
    }
    expect(crossCounty).toBeGreaterThan(0);
  });

  it('every UAT in a unit carries that unit’s colour', () => {
    const { result, colourOf } = colourFor(DEFAULT_PARAMS);
    for (let i = 0; i < data.uatCount; i += 1) {
      expect(colourOf[i]).toBe(colourOf[result.regionOf[i]!]);
    }
  });

  it('clusters keep the warm family unless a neighbour forces otherwise', () => {
    const { result, colourOf } = colourFor(DEFAULT_PARAMS);
    const warmStart = COOL_PALETTE.length;
    let clusters = 0;
    let warm = 0;
    for (let i = 0; i < data.uatCount; i += 1) {
      if (result.regionOf[i] !== i) continue;
      if (result.tierOf[i] !== -1) continue;
      clusters += 1;
      if (colourOf[i]! >= warmStart) warm += 1;
    }
    expect(clusters).toBeGreaterThan(0);
    // Borrowing from the cool family is allowed but should stay rare: a matching pair of
    // neighbours is always worse than a cluster drawn in the wrong family.
    expect(warm / clusters).toBeGreaterThan(0.8);
  });

  it('is deterministic', () => {
    const a = colourFor(DEFAULT_PARAMS).colourOf;
    const b = colourFor(DEFAULT_PARAMS).colourOf;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('uses only palette entries that exist', () => {
    const { colourOf } = colourFor(DEFAULT_PARAMS);
    for (const c of colourOf) expect(PALETTE[c]).toBeTypeOf('string');
    expect(PALETTE.length).toBe(COOL_PALETTE.length + WARM_PALETTE.length);
  });
});
