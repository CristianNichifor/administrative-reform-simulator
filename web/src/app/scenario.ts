/**
 * Scenario state, encoded in the URL hash.
 *
 * Every parameter lives in the hash so a specific map can be shared, cited and argued with.
 * A scenario nobody can link to is a scenario nobody can dispute, which would defeat the
 * point of a tool built for public debate.
 */

import { DEFAULT_PARAMS, type Params, type Pin, type ViewMode } from '../model/types';
import type { Lang } from '../i18n';

export interface Scenario {
  params: Params;
  lang: Lang;
  mode: ViewMode;
  selected: number | null;
  /** Manual overrides, in the order they were made. */
  pins: Pin[];
}

const KEYS: Record<keyof Params, string> = {
  x: 'x',
  rNationalM: 'rn',
  rCapM: 'rc',
  rTownM: 'rt',
  nMin: 'n',
  rSepM: 'rs',
  minOverlap: 'ov',
  pOrphan: 'po',
  pTarget: 'pt',
  maxRoadM: 'mr',
  minCompactness: 'mc',
  rTieM: 'rte',
  pStranded: 'ps',
};

export function encode(scenario: Scenario): string {
  const q = new URLSearchParams();
  for (const [key, short] of Object.entries(KEYS) as [keyof Params, string][]) {
    const value = scenario.params[key];
    // Only non-default values are written, so a shared link stays short and reads as a
    // diff from the default scenario rather than an opaque blob.
    if (value !== DEFAULT_PARAMS[key]) q.set(short, String(value));
  }
  q.set('lang', scenario.lang);
  if (scenario.mode !== 'regions') q.set('mode', scenario.mode);
  if (scenario.selected !== null) q.set('sel', String(scenario.selected));
  // "uat.seat" pairs, comma separated. Indices rather than SIRUTA codes because the index
  // is the SIRUTA sort order and is stable across builds, and a link with fifty six-digit
  // codes in it is a link nobody pastes.
  if (scenario.pins.length > 0) {
    q.set('pin', scenario.pins.map((p) => `${p.uat}.${p.seat}`).join(','));
  }
  return q.toString();
}

/** Anything malformed is dropped rather than throwing: a hand-edited link should degrade. */
function decodePins(raw: string | null): Pin[] {
  if (!raw) return [];
  const pins: Pin[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(',')) {
    const [a, b] = part.split('.');
    // Both halves must actually be there. `Number('')` is 0, so "8." would otherwise decode
    // as a pin onto whatever UAT sits at index 0 — a silently wrong map rather than a
    // dropped fragment.
    if (!a || !b) continue;
    const uat = Number(a);
    const seat = Number(b);
    if (!Number.isInteger(uat) || !Number.isInteger(seat) || uat < 0 || seat < 0) continue;
    // One pin per UAT: a later one for the same commune replaces the earlier.
    if (seen.has(uat)) pins.splice(pins.findIndex((p) => p.uat === uat), 1);
    seen.add(uat);
    pins.push({ uat, seat });
  }
  return pins;
}

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decode(hash: string, lang: Lang): Scenario {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const selRaw = q.get('sel');
  const sel = selRaw === null ? null : Number(selRaw);
  return {
    params: {
      x: num(q.get(KEYS.x), DEFAULT_PARAMS.x),
      rNationalM: num(q.get(KEYS.rNationalM), DEFAULT_PARAMS.rNationalM),
      rCapM: num(q.get(KEYS.rCapM), DEFAULT_PARAMS.rCapM),
      rTownM: num(q.get(KEYS.rTownM), DEFAULT_PARAMS.rTownM),
      nMin: num(q.get(KEYS.nMin), DEFAULT_PARAMS.nMin),
      rSepM: num(q.get(KEYS.rSepM), DEFAULT_PARAMS.rSepM),
      minOverlap: num(q.get(KEYS.minOverlap), DEFAULT_PARAMS.minOverlap),
      rTieM: num(q.get(KEYS.rTieM), DEFAULT_PARAMS.rTieM),
      pStranded: num(q.get(KEYS.pStranded), DEFAULT_PARAMS.pStranded),
      pOrphan: num(q.get(KEYS.pOrphan), DEFAULT_PARAMS.pOrphan),
      pTarget: num(q.get(KEYS.pTarget), DEFAULT_PARAMS.pTarget),
      maxRoadM: num(q.get(KEYS.maxRoadM), DEFAULT_PARAMS.maxRoadM),
      minCompactness: num(q.get(KEYS.minCompactness), DEFAULT_PARAMS.minCompactness),
    },
    lang: (q.get('lang') as Lang) ?? lang,
    mode: q.get('mode') === 'cost' ? 'cost' : 'regions',
    selected: sel !== null && Number.isFinite(sel) ? sel : null,
    pins: decodePins(q.get('pin')),
  };
}

/** Replace rather than push: dragging a slider must not fill the back button with noise. */
export function writeHash(scenario: Scenario): void {
  history.replaceState(null, '', `#${encode(scenario)}`);
}
