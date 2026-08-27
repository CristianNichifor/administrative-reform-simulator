/**
 * Scenario round-trips through the URL hash.
 *
 * A shared link is the unit of argument here: if a scenario does not survive encode →
 * decode exactly, two people looking at "the same" map are looking at different ones.
 */

import { describe, expect, it } from 'vitest';

import { decode, encode } from '../src/app/scenario';
import { DEFAULT_PARAMS } from '../src/model/types';

const base = {
  params: { ...DEFAULT_PARAMS },
  lang: 'ro' as const,
  mode: 'regions' as const,
  selected: null,
  pins: [],
};

describe('pins in the URL', () => {
  it('survives a round trip', () => {
    const scenario = { ...base, pins: [{ uat: 12, seat: 340 }, { uat: 7, seat: 340 }] };
    expect(decode(`#${encode(scenario)}`, 'ro').pins).toEqual(scenario.pins);
  });

  it('writes nothing when there are no pins', () => {
    expect(encode(base)).not.toContain('pin=');
    expect(decode(`#${encode(base)}`, 'ro').pins).toEqual([]);
  });

  it('keeps only the last pin for a given UAT', () => {
    // Two pins for the same commune is a contradiction; the later one is the intent.
    expect(decode('#pin=12.340,12.99', 'ro').pins).toEqual([{ uat: 12, seat: 99 }]);
  });

  it('drops malformed entries instead of throwing', () => {
    // A hand-edited or truncated link should degrade to a usable map, not a blank page.
    expect(decode('#pin=12.340,rubbish,8.,-1.4,,9.10', 'ro').pins).toEqual([
      { uat: 12, seat: 340 },
      { uat: 9, seat: 10 },
    ]);
  });

  it('carries pins alongside parameters and selection', () => {
    const scenario = {
      ...base,
      params: { ...DEFAULT_PARAMS, pTarget: 25_000 },
      mode: 'cost' as const,
      selected: 42,
      pins: [{ uat: 1, seat: 2 }],
    };
    const back = decode(`#${encode(scenario)}`, 'en');
    expect(back.params.pTarget).toBe(25_000);
    expect(back.mode).toBe('cost');
    expect(back.selected).toBe(42);
    expect(back.pins).toEqual([{ uat: 1, seat: 2 }]);
  });
});
