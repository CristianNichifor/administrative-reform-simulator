/**
 * Scenario state, encoded in the URL hash.
 *
 * Every parameter lives in the hash so a specific map can be shared, cited and argued with.
 * A scenario nobody can link to is a scenario nobody can dispute, which would defeat the
 * point of a tool built for public debate.
 */

import { DEFAULT_PARAMS, type Params, type ViewMode } from '../model/types';
import type { Lang } from '../i18n';

export interface Scenario {
  params: Params;
  lang: Lang;
  mode: ViewMode;
  selected: number | null;
}

const KEYS: Record<keyof Params, string> = {
  x: 'x',
  rCapM: 'rc',
  rTownM: 'rt',
  nMin: 'n',
  rSepM: 'rs',
  minOverlap: 'ov',
  pOrphan: 'po',
  pTarget: 'pt',
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
  return q.toString();
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
      rCapM: num(q.get(KEYS.rCapM), DEFAULT_PARAMS.rCapM),
      rTownM: num(q.get(KEYS.rTownM), DEFAULT_PARAMS.rTownM),
      nMin: num(q.get(KEYS.nMin), DEFAULT_PARAMS.nMin),
      rSepM: num(q.get(KEYS.rSepM), DEFAULT_PARAMS.rSepM),
      minOverlap: num(q.get(KEYS.minOverlap), DEFAULT_PARAMS.minOverlap),
      pOrphan: num(q.get(KEYS.pOrphan), DEFAULT_PARAMS.pOrphan),
      pTarget: num(q.get(KEYS.pTarget), DEFAULT_PARAMS.pTarget),
    },
    lang: (q.get('lang') as Lang) ?? lang,
    mode: q.get('mode') === 'cost' ? 'cost' : 'regions',
    selected: sel !== null && Number.isFinite(sel) ? sel : null,
  };
}

/** Replace rather than push: dragging a slider must not fill the back button with noise. */
export function writeHash(scenario: Scenario): void {
  history.replaceState(null, '', `#${encode(scenario)}`);
}
