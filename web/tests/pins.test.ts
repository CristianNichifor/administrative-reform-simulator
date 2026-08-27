/**
 * Manual pin overrides.
 *
 * Pins are the one part of the result the rules did not decide, so they are the one part
 * with no Python reference to check against. These tests carry that weight instead: what a
 * pin may do, what it may not, and what it is allowed to break as long as it says so.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { decode } from '../src/model/load';
import { mergeBlocker, runModel } from '../src/model/model';
import { DEFAULT_PARAMS, type ModelData, type Pin } from '../src/model/types';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../public/data');

function readBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(dataDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as T;
}

let data: ModelData;

/** Index of a UAT by name, optionally constrained to a county. */
function find(name: string, county?: string): number {
  const i = data.attributes.name.findIndex(
    (n, k) =>
      n.toUpperCase().includes(name) && (county === undefined || data.attributes.county[k] === county),
  );
  if (i === -1) throw new Error(`no UAT matching ${name}${county ? ` in ${county}` : ''}`);
  return i;
}

beforeAll(() => {
  data = decode({
    manifest: readJson('manifest.json'),
    attributes: readJson('attributes.json'),
    attributesBin: readBuffer('attributes.bin'),
    adjacencyBin: readBuffer('adjacency.bin'),
    candidacyBin: readBuffer('candidacy.bin'),
  });
});

describe('pins leave the model alone', () => {
  it('changes nothing at all when there are no pins', () => {
    const withoutArg = runModel(data, DEFAULT_PARAMS);
    const withEmpty = runModel(data, DEFAULT_PARAMS, []);
    expect(Array.from(withEmpty.regionOf)).toEqual(Array.from(withoutArg.regionOf));
    expect(withEmpty.pinsApplied).toEqual([]);
    expect(withEmpty.splitUnits).toEqual([]);
  });

  it('moves only the pinned UAT, leaving every other assignment intact', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    // Somewhere the rules already decided: move a commune to a different existing seat in
    // its own county, and check nothing else shifted.
    const uat = find('CIOLPANI', 'IF');
    const seat = base.regionOf[find('SECTORUL 1', 'B')]!;
    expect(base.regionOf[uat]).not.toBe(seat);

    const pinned = runModel(data, DEFAULT_PARAMS, [{ uat, seat }]);
    expect(pinned.regionOf[uat]).toBe(seat);
    expect(pinned.pinsApplied).toEqual([{ uat, seat }]);

    let moved = 0;
    for (let i = 0; i < data.uatCount; i += 1) {
      if (pinned.regionOf[i] !== base.regionOf[i]) moved += 1;
    }
    // The pinned commune, and at most the seat of whatever unit it left.
    expect(moved).toBeLessThanOrEqual(2);
  });
});

describe('what a pin may not do', () => {
  it('refuses to cross a county line', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const uat = find('CIOLPANI', 'IF');
    // A seat in a county that is neither Ilfov nor Bucharest.
    const seat = base.regionOf[find('MUNICIPIUL CONSTANȚA', 'CT')]!;
    const result = runModel(data, DEFAULT_PARAMS, [{ uat, seat }]);
    expect(result.pinsApplied).toEqual([]);
    expect(result.pinsRejected[0]!.why).toBe('county');
    expect(result.regionOf[uat]).toBe(base.regionOf[uat]);
  });

  it('allows the one county line the model does allow', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const bucharest = base.regionOf[find('SECTORUL 1', 'B')]!;
    const uat = find('CIOLPANI', 'IF');
    const result = runModel(data, DEFAULT_PARAMS, [{ uat, seat: bucharest }]);
    expect(result.pinsApplied).toHaveLength(1);
    expect(result.regionOf[uat]).toBe(bucharest);
  });

  it('refuses a target that is not a seat under the current parameters', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    // A UAT that is a member rather than a seat cannot be pinned to.
    const notASeat = data.attributes.name.findIndex(
      (_n, i) => base.regionOf[i] !== i && data.attributes.county[i] === 'IF',
    );
    const uat = find('CIOLPANI', 'IF');
    const result = runModel(data, DEFAULT_PARAMS, [{ uat, seat: notASeat }]);
    expect(result.pinsApplied).toEqual([]);
    expect(result.pinsRejected[0]!.why).toBe('not-a-seat');
  });

  it('reports a pin that asks for where the UAT already is', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const uat = find('CIOLPANI', 'IF');
    const seat = base.regionOf[uat]!;
    const result = runModel(data, DEFAULT_PARAMS, [{ uat, seat }]);
    expect(result.pinsApplied).toEqual([]);
    expect(result.pinsRejected[0]!.why).toBe('already-there');
  });
});

describe('what a pin is allowed to break', () => {
  it('re-elects a seat for the unit a pinned-away seat leaves behind', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const bucharest = base.regionOf[find('SECTORUL 1', 'B')]!;
    // Snagov seats a unit of several communes; pin the seat itself into Bucharest.
    const snagov = find('SNAGOV', 'IF');
    expect(base.regionOf[snagov]).toBe(snagov);
    const others = [];
    for (let i = 0; i < data.uatCount; i += 1) {
      if (i !== snagov && base.regionOf[i] === snagov) others.push(i);
    }
    expect(others.length).toBeGreaterThan(0);

    const result = runModel(data, DEFAULT_PARAMS, [{ uat: snagov, seat: bucharest }]);
    expect(result.regionOf[snagov]).toBe(bucharest);
    // The others did not ask to move: they are still one unit, seated on one of themselves.
    const newSeat = result.regionOf[others[0]!]!;
    expect(newSeat).not.toBe(snagov);
    expect(others.every((i) => result.regionOf[i] === newSeat)).toBe(true);
    expect(result.regionOf[newSeat]).toBe(newSeat);
  });

  it('reports a unit left in two pieces rather than refusing the pin', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const bucharest = base.regionOf[find('SECTORUL 1', 'B')]!;

    // Find a commune whose removal disconnects its own unit: one that every path between
    // two other members has to pass through.
    let culprit = -1;
    for (let i = 0; i < data.uatCount && culprit === -1; i += 1) {
      const seat = base.regionOf[i]!;
      if (seat === i || seat !== bucharest) continue;
      const rest = [];
      for (let k = 0; k < data.uatCount; k += 1) {
        if (base.regionOf[k] === bucharest && k !== i) rest.push(k);
      }
      const inUnit = new Set(rest);
      const seen = new Set([rest[0]!]);
      const stack = [rest[0]!];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (let e = data.neighbourStart[cur]!; e < data.neighbourStart[cur + 1]!; e += 1) {
          const nb = data.neighbours[e]!;
          if (inUnit.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
      }
      if (seen.size !== inUnit.size) culprit = i;
    }

    // Afumati is the one under the current data. If the map ever changes so that no member
    // of this unit is a cut vertex, this test can no longer test anything — fail rather than
    // pass quietly, so it gets rewritten instead of rotting into a green tick.
    if (culprit === -1) {
      throw new Error('no cut vertex in the Bucharest unit: this test proves nothing as written');
    }

    // Pin it somewhere else in the same county, which must split the unit it left.
    const elsewhere = base.regionOf[find('SNAGOV', 'IF')]!;
    const result = runModel(data, DEFAULT_PARAMS, [{ uat: culprit, seat: elsewhere }]);
    expect(result.pinsApplied).toHaveLength(1);
    expect(result.splitUnits).toContain(bucharest);
  });

  it('finds no split unit when nothing is pinned', () => {
    expect(runModel(data, DEFAULT_PARAMS).splitUnits).toEqual([]);
  });
});

describe('pins accumulate', () => {
  it('applies several pins in order', () => {
    const base = runModel(data, DEFAULT_PARAMS);
    const bucharest = base.regionOf[find('SECTORUL 1', 'B')]!;
    const pins: Pin[] = [
      { uat: find('CIOLPANI', 'IF'), seat: bucharest },
      { uat: find('GRĂDIȘTEA', 'IF'), seat: bucharest },
    ];
    const result = runModel(data, DEFAULT_PARAMS, pins);
    expect(result.pinsApplied).toHaveLength(2);
    for (const pin of pins) expect(result.regionOf[pin.uat]).toBe(bucharest);
  });
});

describe('why a unit could not merge', () => {
  it('separates the county-stranded from the merely distant', () => {
    const result = runModel(data, DEFAULT_PARAMS);
    const singles: number[] = [];
    const count = new Map<number, number>();
    for (let i = 0; i < data.uatCount; i += 1) {
      const seat = result.regionOf[i]!;
      count.set(seat, (count.get(seat) ?? 0) + 1);
    }
    for (const [seat, n] of count) if (n === 1) singles.push(seat);
    expect(singles.length).toBeGreaterThan(0);

    // Every single-UAT unit has a reason, and it is one of exactly two.
    const byKind = { 'no-county-neighbour': [] as string[], cap: [] as string[] };
    for (const seat of singles) {
      const blocker = mergeBlocker(data, DEFAULT_PARAMS, result.regionOf, seat);
      expect(blocker, `${data.attributes.name[seat]} is alone for no stated reason`).not.toBeNull();
      byKind[blocker!.kind].push(data.attributes.name[seat]!);
      if (blocker!.kind === 'cap') {
        // A cap answer has to be actionable: past the cap, and a real distance.
        expect(blocker!.metres).toBeGreaterThan(DEFAULT_PARAMS.maxRoadM);
        expect(Number.isFinite(blocker!.metres)).toBe(true);
      }
    }

    // Pietrosani's only road neighbour is in Giurgiu and Namoloasa's is in Vrancea, so no
    // cap setting can ever reach them. That is a consequence of the county rule, not a bug,
    // and it is the one thing in this list a slider cannot fix.
    expect(byKind['no-county-neighbour'].sort()).toEqual(['NĂMOLOASA', 'PIETROȘANI']);
    expect(byKind.cap.length).toBeGreaterThan(0);
  });

  it('never blames the cap when the cap is switched off', () => {
    // With no cap the only thing that can block a merge is having nobody legal to merge
    // with. Anything still reporting a distance would be reporting a limit that is not
    // being applied, which is worse than saying nothing.
    const params = { ...DEFAULT_PARAMS, maxRoadM: 0 };
    const result = runModel(data, params);
    const seats = new Set<number>();
    for (let i = 0; i < data.uatCount; i += 1) seats.add(result.regionOf[i]!);

    const blamed: string[] = [];
    for (const seat of seats) {
      if (mergeBlocker(data, params, result.regionOf, seat)?.kind === 'cap') {
        blamed.push(data.attributes.name[seat]!);
      }
    }
    expect(blamed).toEqual([]);

    // And the county answer still comes through, because it has nothing to do with distance.
    expect(mergeBlocker(data, params, result.regionOf, find('PIETROȘANI', 'TR'))?.kind).toBe(
      'no-county-neighbour',
    );
  });

  it('stops blocking once the cap is raised past the distance it reported', () => {
    const result = runModel(data, DEFAULT_PARAMS);
    const chilia = find('CHILIA VECHE', 'TL');
    const blocker = mergeBlocker(data, DEFAULT_PARAMS, result.regionOf, chilia);
    expect(blocker?.kind).toBe('cap');
    const needed = (blocker as { metres: number }).metres;

    // The number it reports is the answer to "what would I have to set the cap to", so at
    // that cap the unit must no longer be alone.
    const raised = runModel(data, { ...DEFAULT_PARAMS, maxRoadM: Math.ceil(needed) + 1000 });
    let members = 0;
    for (let i = 0; i < data.uatCount; i += 1) if (raised.regionOf[i] === raised.regionOf[chilia]!) members += 1;
    expect(members).toBeGreaterThan(1);
  });
});
