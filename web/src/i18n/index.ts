/**
 * Romanian and English, both from day one.
 *
 * This is a Romanian civic tool with an international audience. Retrofitting i18n once the
 * strings are scattered through the DOM is miserable, so every user-visible string lives
 * here from the start. Romanian is the default because the primary audience is Romanian.
 */

export type Lang = 'ro' | 'en';

export interface Strings {
  title: string;
  subtitle: string;
  disclaimer: string;

  parameters: string;
  reset: string;
  methodology: string;
  sources: string;
  close: string;

  x: string;
  xHelp: string;
  rCap: string;
  rCapHelp: string;
  rTown: string;
  rTownHelp: string;
  nMin: string;
  nMinHelp: string;
  rSep: string;
  rSepHelp: string;
  minOverlap: string;
  minOverlapHelp: string;
  pOrphan: string;
  pOrphanHelp: string;
  pOrphanOff: string;

  regions: string;
  reduction: string;
  savings: string;
  savingsHelp: string;
  upperBound: string;
  seeds: string;
  orphanRegions: string;
  underSeeded: string;

  viewRegions: string;
  viewCost: string;
  costPerResident: string;
  costLegendLow: string;
  costLegendHigh: string;
  legend: string;
  legendAbsorber: string;
  legendAbsorbed: string;
  legendOrphan: string;
  legendUnchanged: string;

  selectPrompt: string;
  region: string;
  centre: string;
  members: string;
  population: string;
  adminCost: string;
  operatingCost: string;
  county: string;
  copyLink: string;
  linkCopied: string;

  computing: string;
  loading: string;
  recomputeTime: string;
}

const ro: Strings = {
  title: 'Reformă administrativă — România',
  subtitle: 'Simulator de consolidare a UAT-urilor',
  disclaimer:
    'Instrument de analiză pentru dezbatere publică. Nu este o propunere oficială și niciun scenariu nu reprezintă o recomandare.',

  parameters: 'Parametri',
  reset: 'Resetează',
  methodology: 'Metodologie',
  sources: 'Surse',
  close: 'Închide',

  x: 'Prag populație absorbant',
  xHelp: 'Localitățile peste acest prag devin centre de absorbție.',
  rCap: 'Rază reședință de județ',
  rCapHelp: 'Cât de departe ajunge o reședință de județ.',
  rTown: 'Rază alte centre',
  rTownHelp: 'Cât de departe ajung celelalte centre.',
  nMin: 'Minim centre per județ',
  nMinHelp: 'Dacă un județ are mai puține, se promovează centre suplimentare.',
  rSep: 'Distanță minimă între centre',
  rSepHelp: 'Împiedică gruparea centrelor promovate într-un singur colț.',
  minOverlap: 'Suprapunere minimă',
  minOverlapHelp:
    'Cât din suprafața unei comune trebuie să intre în rază. Împiedică absorbțiile pe baza unei atingeri de câțiva metri.',
  pOrphan: 'Prag comune rămase',
  pOrphanHelp:
    'Comunele neatinse de niciun centru se pot uni între ele până la acest prag. Regulă diferită de absorbție.',
  pOrphanOff: 'dezactivat',

  regions: 'Unități rezultate',
  reduction: 'Reducere',
  savings: 'Economie administrativă',
  savingsHelp:
    'Cheltuielile de administrație (primărie, consiliu, personal administrativ) ale comunelor absorbite. Nu include școli, asistență socială sau utilități, care nu dispar prin fuziune.',
  upperBound: 'Limită superioară (toate cheltuielile de funcționare)',
  seeds: 'Centre',
  orphanRegions: 'Grupări de comune mici',
  underSeeded: 'Județe sub prag',

  viewRegions: 'Unități rezultate',
  viewCost: 'Cost administrativ / locuitor',
  costPerResident: 'Cost administrativ / locuitor',
  costLegendLow: 'mai ieftin',
  costLegendHigh: 'mai scump',
  legend: 'Legendă',
  legendAbsorber: 'Centru (primăria supraviețuiește)',
  legendAbsorbed: 'Absorbit de un centru',
  legendOrphan: 'Grupare de comune mici',
  legendUnchanged: 'Neschimbat',

  selectPrompt: 'Selectează o unitate pe hartă.',
  region: 'Unitate rezultată',
  centre: 'Centru',
  members: 'Comune componente',
  population: 'Populație',
  adminCost: 'Cheltuieli de administrație',
  operatingCost: 'Cheltuieli de funcționare',
  county: 'Județ',
  copyLink: 'Copiază link scenariu',
  linkCopied: 'Link copiat',

  computing: 'Se recalculează…',
  loading: 'Se încarcă datele…',
  recomputeTime: 'recalculat în',
};

const en: Strings = {
  title: 'Administrative Reform — Romania',
  subtitle: 'A consolidation simulator for Romania’s UATs',
  disclaimer:
    'An analysis instrument for public debate. Not an official proposal, and no scenario here is a recommendation.',

  parameters: 'Parameters',
  reset: 'Reset',
  methodology: 'Methodology',
  sources: 'Sources',
  close: 'Close',

  x: 'Absorber population threshold',
  xHelp: 'Localities above this become absorbing centres.',
  rCap: 'County-capital radius',
  rCapHelp: 'How far a county capital reaches.',
  rTown: 'Other-absorber radius',
  rTownHelp: 'How far every other centre reaches.',
  nMin: 'Minimum centres per county',
  nMinHelp: 'Where a county has fewer, additional centres are promoted.',
  rSep: 'Minimum separation between centres',
  rSepHelp: 'Stops promoted centres bunching into one corner of a county.',
  minOverlap: 'Minimum overlap',
  minOverlapHelp:
    'How much of a commune must fall inside the radius. Prevents absorptions based on a few metres of contact.',
  pOrphan: 'Leftover-commune threshold',
  pOrphanHelp:
    'Communes no centre reached may pair up with each other to this size. A different rule from absorption.',
  pOrphanOff: 'off',

  regions: 'Resulting units',
  reduction: 'Reduction',
  savings: 'Administrative saving',
  savingsHelp:
    'The administration costs — town hall, council, administrative staff — of absorbed communes. Excludes schools, social assistance and utilities, which a merger does not remove.',
  upperBound: 'Upper bound (all operating spending)',
  seeds: 'Centres',
  orphanRegions: 'Small-commune clusters',
  underSeeded: 'Under-seeded counties',

  viewRegions: 'Resulting units',
  viewCost: 'Admin cost per resident',
  costPerResident: 'Admin cost per resident',
  costLegendLow: 'cheaper',
  costLegendHigh: 'dearer',
  legend: 'Legend',
  legendAbsorber: 'Centre (its administration survives)',
  legendAbsorbed: 'Absorbed by a centre',
  legendOrphan: 'Small-commune cluster',
  legendUnchanged: 'Unchanged',

  selectPrompt: 'Select a unit on the map.',
  region: 'Resulting unit',
  centre: 'Centre',
  members: 'Component communes',
  population: 'Population',
  adminCost: 'Administration spending',
  operatingCost: 'Operating spending',
  county: 'County',
  copyLink: 'Copy scenario link',
  linkCopied: 'Link copied',

  computing: 'Recomputing…',
  loading: 'Loading data…',
  recomputeTime: 'recomputed in',
};

export const STRINGS: Record<Lang, Strings> = { ro, en };

export function detectLang(): Lang {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('lang');
  if (fromHash === 'ro' || fromHash === 'en') return fromHash;
  return navigator.language.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'ro' ? 'ro-RO' : 'en-GB').format(Math.round(value));
}

export function formatMoney(ron: number, lang: Lang): string {
  const locale = lang === 'ro' ? 'ro-RO' : 'en-GB';
  if (Math.abs(ron) >= 1e9) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(ron / 1e9)} mld RON`;
  }
  if (Math.abs(ron) >= 1e6) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ron / 1e6)} mil RON`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ron)} RON`;
}
