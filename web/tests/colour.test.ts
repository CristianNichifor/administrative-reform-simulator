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

import { assignUnitColours, PALETTE } from '../src/model/colour';
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
  return { result, colourOf: assignUnitColours(data, result.regionOf) };
}

/**
 * Every pair of units that touch, following commune borders across county lines too.
 *
 * Walks the *touching* graph, not the model's. This test used to walk `neighbours`, which
 * holds only borders a road crosses — the same graph the colouring itself was using — so it
 * passed while Sulina, Crisan and Chilia Veche were drawn as one block of orange. A test
 * that shares its subject's blind spot cannot see the bug.
 */
function touchingUnits(regionOf: Uint16Array): [number, number][] {
  const pairs = new Set<string>();
  for (let i = 0; i < data.uatCount; i += 1) {
    const a = regionOf[i]!;
    for (let e = data.touchStart[i]!; e < data.touchStart[i + 1]!; e += 1) {
      const b = regionOf[data.touching[e]!]!;
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

  it('is deterministic', () => {
    const a = colourFor(DEFAULT_PARAMS).colourOf;
    const b = colourFor(DEFAULT_PARAMS).colourOf;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('uses only palette entries that exist', () => {
    const { colourOf } = colourFor(DEFAULT_PARAMS);
    for (const c of colourOf) expect(PALETTE[c]).toBeTypeOf('string');
    expect(PALETTE.length).toBe(11);
  });
});

describe('the touching graph', () => {
  it('carries every shared border, not only the ones a road crosses', () => {
    let touchEdges = 0;
    let roadEdges = 0;
    for (let i = 0; i < data.uatCount; i += 1) {
      touchEdges += data.touchStart[i + 1]! - data.touchStart[i]!;
      roadEdges += data.neighbourStart[i + 1]! - data.neighbourStart[i]!;
    }
    // Counts come from the manifest, not from literals: the traversable total moves whenever
    // the road test or the Delta exception changes, and a hardcoded number turns that into a
    // test failure rather than information.
    const manifest = readJson<{ edgeCount: number; traversableEdgeCount: number }>(
      'manifest.json',
    );
    expect(touchEdges).toBe(manifest.edgeCount * 2);
    expect(roadEdges).toBe(manifest.traversableEdgeCount * 2);
    expect(touchEdges).toBeGreaterThan(roadEdges);
  });

  it('is symmetric', () => {
    for (let a = 0; a < data.uatCount; a += 1) {
      for (let e = data.touchStart[a]!; e < data.touchStart[a + 1]!; e += 1) {
        const b = data.touching[e]!;
        const back = data.touching.subarray(data.touchStart[b]!, data.touchStart[b + 1]!);
        expect(back).toContain(a);
      }
    }
  });

  it('makes the Delta one unit seated on Sulina', () => {
    // These were three separate units drawn in one block of orange, because the road graph
    // said they were not neighbours — there is no road between them, only water. The water
    // routes now count, so they are one unit, and the colouring question is moot for them.
    const { result } = colourFor(DEFAULT_PARAMS);
    const find = (name: string): number => {
      const i = data.attributes.name.findIndex(
        (n, k) => n.toUpperCase().includes(name) && data.attributes.county[k] === 'TL',
      );
      if (i === -1) throw new Error(`missing ${name}`);
      return i;
    };
    const three = ['SULINA', 'CRIȘAN', 'CHILIA VECHE'].map(find);
    const units = new Set(three.map((i) => result.regionOf[i]!));
    expect(units.size).toBe(1);
    // Seated on the town, not on whichever commune the growth happened to start from.
    expect(data.attributes.name[[...units][0]!]).toContain('SULINA');
  });
});

describe('the palette', () => {
  it('has no two colours a reader cannot tell apart', () => {
    // Perceptual distance in CIELAB. The palette this replaced had two olive-greens 5.0
    // apart, a green and an emerald at 9.0, and two indigos at 8.1 — all of which look
    // identical in adjacent polygons. Below about 25 readers start guessing.
    const lab = (hex: string): [number, number, number] => {
      const to = (v: number): number => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
      const r = to(parseInt(hex.slice(1, 3), 16) / 255);
      const g = to(parseInt(hex.slice(3, 5), 16) / 255);
      const b = to(parseInt(hex.slice(5, 7), 16) / 255);
      const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
      const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
      const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    };
    const tooClose: string[] = [];
    for (let i = 0; i < PALETTE.length; i += 1) {
      for (let j = i + 1; j < PALETTE.length; j += 1) {
        const [l1, a1, b1] = lab(PALETTE[i]!);
        const [l2, a2, b2] = lab(PALETTE[j]!);
        const d = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
        if (d < 25) tooClose.push(`${PALETTE[i]} / ${PALETTE[j]} ΔE ${d.toFixed(1)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });
});

describe('no colour appears twice inside a county', () => {
  it.each([
    ['default', DEFAULT_PARAMS],
    ['large target', { ...DEFAULT_PARAMS, pTarget: 100_000 }],
    ['wide radii', { ...DEFAULT_PARAMS, rCapM: 25_000, rTownM: 25_000 }],
  ])('holds at %s', (_label, params) => {
    const { result, colourOf } = colourFor(params as Params);
    const byCounty = new Map<number, Map<number, number[]>>();
    for (let i = 0; i < data.uatCount; i += 1) {
      const unit = result.regionOf[i]!;
      const county = data.countyOf[unit]!;
      let seen = byCounty.get(county);
      if (!seen) {
        seen = new Map();
        byCounty.set(county, seen);
      }
      const colour = colourOf[i]!;
      const units = seen.get(colour) ?? [];
      if (!units.includes(unit)) units.push(unit);
      seen.set(colour, units);
    }
    const repeats: string[] = [];
    for (const [county, seen] of byCounty) {
      for (const [, units] of seen) {
        if (units.length > 1) {
          repeats.push(
            `${data.attributes.county[units[0]!]}: ${units.map((u) => data.attributes.name[u]).join(' / ')}`,
          );
        }
      }
      void county;
    }
    expect(repeats.slice(0, 6)).toEqual([]);
  });

  it('gives up the county rule only when the palette cannot cover it', () => {
    // With the target off a single county holds thirty units and thirty distinguishable
    // colours do not exist, so duplicates inside a county are unavoidable. What must still
    // hold is the rule that always can: nothing matches anything it touches.
    const params = { ...DEFAULT_PARAMS, pTarget: 0 };
    const { result, colourOf } = colourFor(params);
    for (let i = 0; i < data.uatCount; i += 1) {
      for (let e = data.touchStart[i]!; e < data.touchStart[i + 1]!; e += 1) {
        const j = data.touching[e]!;
        if (result.regionOf[i] === result.regionOf[j]) continue;
        expect(colourOf[i]).not.toBe(colourOf[j]);
      }
    }
  });
});
