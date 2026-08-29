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
  rNational: string;
  rNationalHelp: string;
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
  maxRoad: string;
  maxRoadHelp: string;
  pTarget: string;
  pTargetHelp: string;
  pTargetOff: string;
  minCompactness: string;
  minCompactnessHelp: string;
  belowTarget: string;
  belowTargetHelp: string;

  regions: string;
  reduction: string;
  savings: string;
  savingsHelp: string;
  upperBound: string;
  seeds: string;
  orphanRegions: string;
  underSeeded: string;

  viewCurrent: string;
  viewRegions: string;
  viewCost: string;
  costPerResident: string;
  costLegendLow: string;
  costLegendHigh: string;
  layers: string;
  layerCounties: string;
  layerRegions: string;
  layerSeats: string;
  layerCapitals: string;
  layerRoads: string;
  layersRoadsNote: string;
  layerCountyRoads: string;
  layersCountyRoadsNote: string;

  whyTitle: string;
  whyCapital: string;
  whyThreshold: string;
  whyPromoted: string;
  whyOrphanSeat: string;
  whyAbsorbedOverlap: string;
  whyAbsorbedSeat: string;
  whyOrphanMember: string;
  whyTargetMerge: string;
  whyCountyRule: string;
  legend: string;
  legendCapital: string;
  legendAbsorber: string;
  legendOrphanSeat: string;
  legendUnchangedSeat: string;
  legendAbsorbed: string;
  legendOrphan: string;
  legendUnchanged: string;

  hoverProposed: string;
  hoverCommunes: string;
  hoverSeatDistances: string;
  selectPrompt: string;
  region: string;
  centre: string;
  members: string;
  population: string;
  area: string;
  fiscalHeading: string;
  savingsHeading: string;
  ownIncome: string;
  adminPersonnel: string;
  totalPersonnel: string;
  developmentCost: string;
  totalOperatingOfMembers: string;
  centreKeeps: string;
  savedPerYear: string;
  pinHeading: string;
  pinMoveTo: string;
  pinKeepRules: string;
  pinNone: string;
  pinRemove: string;
  pinClearAll: string;
  pinBadge: string;
  pinWhy: string;
  pinSplit: string;
  pinStale: string;
  auditHeading: string;
  auditIntro: string;
  auditSingle: string;
  auditBelowTarget: string;
  auditOutranked: string;
  auditSplit: string;
  auditClean: string;
  auditShow: string;
  auditWhyCounty: string;
  auditWhyCap: string;
  auditWhyCapitalOnly: string;
  auditWhyCountyMinimum: string;
  balanceSurplus: string;
  balanceDeficit: string;
  perResident: string;
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
  rNational: 'Rază capitală de țară',
  rNationalHelp: 'Cât de departe ajunge Bucureștiul. Nu poate traversa limita de județ, deci în practică acoperă doar sectoarele.',
  rCap: 'Rază reședință de județ',
  rCapHelp: 'Cât de departe ajunge o reședință de județ.',
  rTown: 'Rază alte centre',
  rTownHelp: 'Cât de departe ajung celelalte centre.',
  nMin: 'Minim centre per județ',
  nMinHelp: 'Dacă un județ are mai puține, se promovează centre suplimentare.',
  rSep: 'Distanță minimă între centre',
  rSepHelp: 'Distanță pe drum. Împiedică gruparea centrelor promovate într-un singur colț.',
  minOverlap: 'Suprapunere minimă',
  minOverlapHelp:
    'Cât din suprafața unei comune trebuie să intre în rază. Împiedică absorbțiile pe baza unei atingeri de câțiva metri.',
  pOrphan: 'Prag comune rămase',
  pOrphanHelp:
    'Comunele neatinse de niciun centru se pot uni între ele până la acest prag. Regulă diferită de absorbție.',
  pOrphanOff: 'dezactivat',
  minCompactness: 'Compactitate minimă',
  minCompactnessHelp:
    'Cât de adunată trebuie să fie forma unei unități, pe raportul Polsby-Popper: 1,00 este un cerc, iar o fâșie lungă și zdrențuită tinde spre zero. La 0 regula este oprită. Unitatea mediană are 0,24, iar la 0,20 numărul celor sub acest prag se înjumătățește, cu prețul câtorva unități în plus. Forma este singurul obiectiv care intră direct în conflict cu drumul până la primărie.',
  maxRoad: 'Distanță maximă pe drum',
  maxRoadHelp: 'Cât de departe poate fi o comună de centrul ei, pe drum. Împiedică unități late cât județul.',
  pTarget: 'Populație minimă rezultată',
  pTargetHelp:
    'După toate celelalte reguli, unitățile sub acest prag se unesc cu cea mai mică unitate vecină din același județ, până ating pragul.',
  pTargetOff: 'dezactivat',
  belowTarget: 'Sub prag',
  belowTargetHelp:
    'Unități care rămân sub pragul de populație pentru că toți vecinii lor se află în alt județ. Nu sunt forțate.',

  regions: 'Unități rezultate',
  reduction: 'Reducere',
  savings: 'Economie administrativă',
  savingsHelp:
    'Cheltuielile de administrație (primărie, consiliu, personal administrativ) ale comunelor absorbite. Nu include școli, asistență socială sau utilități, care nu dispar prin fuziune.',
  upperBound: 'Limită superioară (toate cheltuielile de funcționare)',
  seeds: 'Centre',
  orphanRegions: 'Grupări de comune mici',
  underSeeded: 'Județe sub prag',

  viewCurrent: 'Situație actuală',
  viewRegions: 'Unități rezultate',
  viewCost: 'Cost administrativ / locuitor',
  costPerResident: 'Cost administrativ / locuitor',
  costLegendLow: 'mai ieftin',
  costLegendHigh: 'mai scump',
  layers: 'Straturi',
  layerCounties: 'Limite de județ',
  layerRegions: 'Regiuni de dezvoltare',
  layerSeats: 'Reședințe UAT',
  layerCapitals: 'Centre absorbante',
  layerRoads: 'Drumuri principale',
  layersRoadsNote: 'se descarcă la prima activare (4,5 MB)',
  layerCountyRoads: 'Drumuri județene și comunale',
  layersCountyRoadsNote: 'rețeaua pe care modelul calculează majoritatea distanțelor · 7,4 MB la prima activare',

  whyTitle: 'De ce',
  whyCapital: 'Reședință de județ — este centru prin regulă, indiferent de mărime.',
  whyThreshold: 'Centru pentru că are {pop} locuitori, peste pragul de {x}.',
  whyPromoted:
    'Promovat centru pentru ca județul să atingă minimul de {n} centre. A fost ales pentru că acoperea cea mai multă populație neacoperită.',
  whyOrphanSeat:
    'Reședința unei grupări de comune mici — nu a fost absorbit de niciun centru, dar este cel mai mare din grupare.',
  whyAbsorbedOverlap:
    'Absorbit de {centre}: {pct} din suprafață intră în raza de {radius}, iar un drum traversează granița comună.',
  whyAbsorbedSeat:
    'Absorbit de {centre}: satul de reședință se află în raza de {radius}, iar un drum traversează granița comună.',
  whyOrphanMember: 'Unit cu comunele vecine pentru că niciun centru nu a ajuns până aici.',
  whyTargetMerge:
    'Unit după aplicarea pragului de populație minimă rezultată ({target} locuitori).',
  whyCountyRule: 'Toate comunele sunt din județul {county} — regiunile nu traversează limitele de județ.',
  legend: 'Legendă',
  legendCapital: 'Reședință de județ (centru)',
  legendAbsorber: 'Centru — primăria supraviețuiește',
  legendOrphanSeat: 'Rest — grupare de comune mici, nu un absorbant (cerc gol)',
  legendUnchangedSeat: 'Rest — comună rămasă singură, nu un absorbant (cerc gol)',
  legendAbsorbed: 'Comună absorbită (aceeași culoare ca centrul ei)',
  legendOrphan: 'Grupare de comune mici',
  legendUnchanged: 'Neschimbat',

  hoverProposed: 'Unitate propusă',
  hoverCommunes: 'comune',
  hoverSeatDistances: 'Distanța pe drum până la reședințele din jur',
  selectPrompt: 'Selectează o unitate pe hartă.',
  region: 'Unitate rezultată',
  centre: 'Centru',
  members: 'Comune componente',
  population: 'Populație',
  area: 'Suprafață',
  fiscalHeading: 'Situație fiscală',
  savingsHeading: 'Economii estimate',
  ownIncome: 'Venituri totale',
  adminPersonnel: 'Personal administrativ',
  totalPersonnel: 'Personal total',
  developmentCost: 'Cheltuieli de dezvoltare',
  totalOperatingOfMembers: 'Administrație, toate comunele',
  centreKeeps: 'Centrul păstrează',
  savedPerYear: 'economii estimate / an prin fuziune',
  pinHeading: 'Modificări manuale',
  pinMoveTo: 'Mută această UAT la…',
  pinKeepRules: 'lăsată pe seama regulilor',
  pinNone: 'Nicio modificare manuală. Harta este în întregime rezultatul regulilor.',
  pinRemove: 'Elimină',
  pinClearAll: 'Șterge toate modificările',
  pinBadge: 'manual',
  pinWhy: 'Plasată manual, peste ceea ce au decis regulile.',
  pinSplit: 'Atenție: această unitate a rămas din două bucăți neconectate.',
  pinStale: 'Modificare ignorată: ținta nu mai este centrul unei unități la acești parametri.',
  auditHeading: 'De verificat',
  auditIntro: 'Unități pe care regulile le lasă arătând ciudat. Nu sunt erori, sunt locurile unde merită să vă uitați.',
  auditSingle: 'unități dintr-o singură UAT',
  auditBelowTarget: 'sub populația-țintă',
  auditOutranked: 'sediu depășit în rang de un membru',
  auditSplit: 'rupte de o modificare manuală',
  auditClean: 'Nimic de semnalat.',
  auditShow: 'Arată',
  auditWhyCounty: 'niciun vecin pe drum în propriul județ — regula județului îi interzice orice fuziune',
  auditWhyCap: 'cea mai apropiată fuziune ar fi la {km} km, peste plafonul de {cap} km',
  auditWhyCapitalOnly: 'singurii vecini sunt reședințe de județ, iar o reședință se oprește după primul inel',
  auditWhyCountyMinimum: 'județul are deja minimul de {units} unități, iar acoperirea are prioritate față de mărime',
  balanceSurplus: 'Excedent',
  balanceDeficit: 'Deficit',
  perResident: '/ locuitor',
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
  rNational: 'National-capital radius',
  rNationalHelp: 'How far Bucharest reaches. It cannot cross a county line, so in practice this covers its own sectors.',
  rCap: 'County-capital radius',
  rCapHelp: 'How far a county capital reaches.',
  rTown: 'Other-absorber radius',
  rTownHelp: 'How far every other centre reaches.',
  nMin: 'Minimum centres per county',
  nMinHelp: 'Where a county has fewer, additional centres are promoted.',
  rSep: 'Minimum separation between centres',
  rSepHelp: 'Measured by road. Stops promoted centres bunching into one corner of a county.',
  minOverlap: 'Minimum overlap',
  minOverlapHelp:
    'How much of a commune must fall inside the radius. Prevents absorptions based on a few metres of contact.',
  pOrphan: 'Leftover-commune threshold',
  pOrphanHelp:
    'Communes no centre reached may pair up with each other to this size. A different rule from absorption.',
  pOrphanOff: 'off',
  minCompactness: 'Minimum compactness',
  minCompactnessHelp:
    "How gathered a unit's shape must be, on the Polsby-Popper ratio: 1.00 is a circle and a long ragged strip tends to zero. At 0 the rule is off. The median unit scores 0.24, and at 0.20 the number below that halves, at the cost of a few more units. Shape is the one goal that trades directly against the trip to the town hall.",
  maxRoad: 'Maximum road distance',
  maxRoadHelp: 'How far a commune may be from its centre, by road. Stops units as wide as the county.',
  pTarget: 'Minimum resulting population',
  pTargetHelp:
    'After every other rule, units below this merge with the smallest neighbouring unit in the same county until they reach it.',
  pTargetOff: 'off',
  belowTarget: 'Below target',
  belowTargetHelp:
    'Units that stay under the target because every neighbour they have is in another county. They are never forced.',

  regions: 'Resulting units',
  reduction: 'Reduction',
  savings: 'Administrative saving',
  savingsHelp:
    'The administration costs — town hall, council, administrative staff — of absorbed communes. Excludes schools, social assistance and utilities, which a merger does not remove.',
  upperBound: 'Upper bound (all operating spending)',
  seeds: 'Centres',
  orphanRegions: 'Small-commune clusters',
  underSeeded: 'Under-seeded counties',

  viewCurrent: 'Today',
  viewRegions: 'Resulting units',
  viewCost: 'Admin cost per resident',
  costPerResident: 'Admin cost per resident',
  costLegendLow: 'cheaper',
  costLegendHigh: 'dearer',
  layers: 'Layers',
  layerCounties: 'County boundaries',
  layerRegions: 'Development regions',
  layerSeats: 'UAT seats',
  layerCapitals: 'Absorbing centres',
  layerRoads: 'Major roads',
  layersRoadsNote: 'downloaded on first use (4.5 MB)',
  layerCountyRoads: 'County and communal roads',
  layersCountyRoadsNote: 'the network the model measures most distances over · 7.4 MB on first use',

  whyTitle: 'Why',
  whyCapital: 'County capital — a centre by rule, whatever its size.',
  whyThreshold: 'A centre because it has {pop} residents, above the {x} threshold.',
  whyPromoted:
    'Promoted to a centre so the county reaches its minimum of {n}. It was chosen because it covered the most otherwise-uncovered population.',
  whyOrphanSeat:
    'Seat of a small-commune cluster — no centre reached it, but it is the largest in its cluster.',
  whyAbsorbedOverlap:
    'Absorbed by {centre}: {pct} of its territory falls within the {radius} radius, and a road crosses their shared border.',
  whyAbsorbedSeat:
    'Absorbed by {centre}: its seat village lies inside the {radius} radius, and a road crosses their shared border.',
  whyOrphanMember: 'Merged with neighbouring communes because no centre reached this far.',
  whyTargetMerge:
    'Merged after applying the minimum resulting population ({target} residents).',
  whyCountyRule: 'Every commune here is in {county} — regions never cross county boundaries.',
  legend: 'Legend',
  legendCapital: 'County capital (a centre)',
  legendAbsorber: 'Centre — its administration survives',
  legendOrphanSeat: 'Leftover — a small-commune cluster, not an absorber (hollow)',
  legendUnchangedSeat: 'Leftover — a commune left on its own, not an absorber (hollow)',
  legendAbsorbed: 'Absorbed commune (same colour as its centre)',
  legendOrphan: 'Small-commune cluster',
  legendUnchanged: 'Unchanged',

  hoverProposed: 'Proposed unit',
  hoverCommunes: 'communes',
  hoverSeatDistances: 'Road distance to the seats around it',
  selectPrompt: 'Select a unit on the map.',
  region: 'Resulting unit',
  centre: 'Centre',
  members: 'Component communes',
  population: 'Population',
  area: 'Area',
  fiscalHeading: 'Fiscal position',
  savingsHeading: 'Estimated saving',
  ownIncome: 'Total income',
  adminPersonnel: 'Administrative staff',
  totalPersonnel: 'Total staff',
  developmentCost: 'Development spending',
  totalOperatingOfMembers: 'Administration, all communes',
  centreKeeps: 'The centre keeps',
  savedPerYear: 'estimated saving / year from merging',
  pinHeading: 'Manual overrides',
  pinMoveTo: 'Move this UAT to…',
  pinKeepRules: 'left to the rules',
  pinNone: 'No manual overrides. The map is entirely what the rules produced.',
  pinRemove: 'Remove',
  pinClearAll: 'Clear all overrides',
  pinBadge: 'manual',
  pinWhy: 'Placed by hand, overriding what the rules decided.',
  pinSplit: 'Warning: this unit has been left in two disconnected pieces.',
  pinStale: 'Override ignored: the target is no longer a unit seat at these parameters.',
  auditHeading: 'Worth a look',
  auditIntro: 'Units the rules leave looking odd. Not errors — the places worth checking.',
  auditSingle: 'single-UAT units',
  auditBelowTarget: 'below the population target',
  auditOutranked: 'seat outranked by a member',
  auditSplit: 'split by a manual override',
  auditClean: 'Nothing flagged.',
  auditShow: 'Show',
  auditWhyCounty: 'no road neighbour in its own county — the county rule forbids every merge',
  auditWhyCap: 'nearest merge would be {km} km, past the {cap} km cap',
  auditWhyCapitalOnly: 'its only neighbours are county capitals, and a capital stops after its first ring',
  auditWhyCountyMinimum: 'the county is already down to its minimum of {units} units, and coverage outranks size',
  balanceSurplus: 'Surplus',
  balanceDeficit: 'Deficit',
  perResident: '/ resident',
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
