/**
 * Application wiring.
 *
 * Slider input is debounced to animation frames rather than timers, so the recompute rate
 * follows the display instead of an arbitrary interval, and a stale result from an earlier
 * drag position is discarded rather than painted.
 */

import './style.css';

import { decode as decodeScenario, writeHash, type Scenario } from './app/scenario';
import { STRINGS, detectLang, formatMoney, formatNumber, type Lang, type Strings } from './i18n';
import {
  createMap,
  CAPITAL_COLOUR,
  COST_RAMP,
  COUNTY_LINE_COLOUR,
  ORPHAN_COLOUR,
  REGION_LINE_COLOUR,
  ORPHAN_SEAT_COLOUR,
  ROAD_COLOUR,
  SEAT_COLOUR,
  SEAT_KIND,
  UNCHANGED_SEAT_COLOUR,
  UNCHANGED_COLOUR,
  regionColour,
  type Overlay,
} from './map/map';
import { DEFAULT_PARAMS, REASON, type Params, type ViewMode } from './model/types';
import type { Outgoing, ReadyMessage, ResultMessage } from './model/worker';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

const RADIUS_GRID = [5000, 7500, 10000, 12500, 15000, 17500, 20000, 22500, 25000, 27500, 30000];

interface SliderSpec {
  key: keyof Params;
  labelKey: keyof Strings;
  helpKey: keyof Strings;
  min: number;
  max: number;
  step: number;
  format: (value: number, lang: Lang, s: Strings) => string;
}

const KM = (v: number): string => `${(v / 1000).toFixed(1).replace(/\.0$/, '')} km`;

const SLIDERS: SliderSpec[] = [
  {
    key: 'x', labelKey: 'x', helpKey: 'xHelp',
    min: 5000, max: 50000, step: 500,
    format: (v, l) => formatNumber(v, l),
  },
  {
    key: 'rNationalM', labelKey: 'rNational', helpKey: 'rNationalHelp',
    min: 0, max: RADIUS_GRID.length - 1, step: 1,
    format: (v) => KM(v),
  },
  {
    key: 'rCapM', labelKey: 'rCap', helpKey: 'rCapHelp',
    min: 0, max: RADIUS_GRID.length - 1, step: 1,
    format: (v) => KM(v),
  },
  {
    key: 'rTownM', labelKey: 'rTown', helpKey: 'rTownHelp',
    min: 0, max: RADIUS_GRID.length - 1, step: 1,
    format: (v) => KM(v),
  },
  {
    key: 'nMin', labelKey: 'nMin', helpKey: 'nMinHelp',
    min: 1, max: 10, step: 1,
    format: (v) => String(v),
  },
  {
    key: 'rSepM', labelKey: 'rSep', helpKey: 'rSepHelp',
    min: 0, max: 30000, step: 1000,
    format: (v) => KM(v),
  },
  {
    key: 'minOverlap', labelKey: 'minOverlap', helpKey: 'minOverlapHelp',
    min: 0, max: 0.5, step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'pOrphan', labelKey: 'pOrphan', helpKey: 'pOrphanHelp',
    min: 0, max: 15000, step: 500,
    format: (v, l, s) => (v === 0 ? s.pOrphanOff : formatNumber(v, l)),
  },
  {
    key: 'pTarget', labelKey: 'pTarget', helpKey: 'pTargetHelp',
    min: 0, max: 100000, step: 2500,
    format: (v, l, s) => (v === 0 ? s.pTargetOff : formatNumber(v, l)),
  },
];

const isRadius = (key: keyof Params): boolean =>
  key === 'rCapM' || key === 'rTownM' || key === 'rNationalM';

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  return node;
}

async function boot(): Promise<void> {
  const initialLang = detectLang();
  const scenario: Scenario = decodeScenario(location.hash, initialLang);
  let strings = STRINGS[scenario.lang];

  let ready: ReadyMessage | null = null;
  let latest: ResultMessage | null = null;
  let isOrphanRegion = new Uint8Array(0);
  let costPerResident = new Float32Array(0);
  let costBreaks: number[] = [];
  let token = 0;
  let pending = false;

  const worker = new Worker(new URL('./model/worker.ts', import.meta.url), { type: 'module' });
  const mapHandle = await createMap(el('#map'), DATA_BASE);

  // --- rendering ---------------------------------------------------------------------

  const applyStaticText = (): void => {
    strings = STRINGS[scenario.lang];
    document.documentElement.lang = scenario.lang;
    document.title = strings.title;
    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = node.dataset.i18n as keyof Strings;
      node.textContent = strings[key];
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('.lang button')) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === scenario.lang));
    }
    el('#sources').innerHTML =
      'ANCPI · INS (Recensământ 2021) · Ministerul Finanțelor · OpenStreetMap · ' +
      '<a href="https://www.transparenta.eu" target="_blank" rel="noopener">Transparenta.eu</a> · ' +
      '<a href="https://geo-spatial.org" target="_blank" rel="noopener">geo-spatial.org</a>';
    renderModes();
    renderLegend();
    renderSliders();
    renderLayers();
    renderSummary();
    renderDetail();
  };

  const overlayState: Record<Overlay, boolean> = {
    counties: true,
    regions: false,
    seats: false,
    capitals: true,
    roads: false,
  };

  const renderLayers = (): void => {
    const rows: [Overlay, string, string, boolean, string][] = [
      ['counties', strings.layerCounties, COUNTY_LINE_COLOUR, false, ''],
      ['regions', strings.layerRegions, REGION_LINE_COLOUR, false, ''],
      ['capitals', strings.layerCapitals, CAPITAL_COLOUR, true, ''],
      ['seats', strings.layerSeats, SEAT_COLOUR, true, ''],
      ['roads', strings.layerRoads, ROAD_COLOUR, false, strings.layersRoadsNote],
    ];
    el('#layers').innerHTML = rows
      .map(
        ([key, label, colour, dot, note]) => `
        <label class="layer-row">
          <input type="checkbox" data-overlay="${key}" ${overlayState[key] ? 'checked' : ''} />
          <span class="swatch${dot ? ' dot' : ''}" style="background:${colour}"></span>
          <span>${label}${note ? ` <span class="note">— ${note}</span>` : ''}</span>
        </label>`,
      )
      .join('');
    for (const input of document.querySelectorAll<HTMLInputElement>('#layers input')) {
      input.addEventListener('change', () => {
        const key = input.dataset.overlay as Overlay;
        overlayState[key] = input.checked;
        void mapHandle.setOverlay(key, input.checked);
      });
    }
  };

  const renderModes = (): void => {
    const modes: [ViewMode, string][] = [
      ['regions', strings.viewRegions],
      ['cost', strings.viewCost],
    ];
    el('#modes').innerHTML = modes
      .map(
        ([mode, label]) =>
          `<button data-mode="${mode}" aria-pressed="${mode === scenario.mode}">${label}</button>`,
      )
      .join('');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      button.addEventListener('click', () => {
        scenario.mode = button.dataset.mode as ViewMode;
        writeHash(scenario);
        renderModes();
        renderLegend();
        if (latest) {
          mapHandle.applyAssignment(
            latest.regionOf,
            isOrphanRegion,
            latest.tierOf,
            scenario.mode,
            costPerResident,
            costBreaks,
          );
        }
      });
    }
  };

  const renderLegend = (): void => {
    if (scenario.mode === 'cost') {
      const breaks = costBreaks
        .map((b) => formatNumber(b, scenario.lang))
        .join(' · ');
      el('#legend').innerHTML =
        `<h4>${strings.costPerResident}</h4>` +
        `<div class="ramp">${COST_RAMP.map((c) => `<span style="background:${c}"></span>`).join('')}</div>` +
        `<div class="ramp-labels"><span>${strings.costLegendLow}</span><span>${strings.costLegendHigh}</span></div>` +
        `<div class="ramp-labels" style="margin-top:4px"><span>RON: ${breaks}</span></div>`;
      return;
    }
    const rows: [string, string, boolean?][] = [
      [CAPITAL_COLOUR, strings.legendCapital, true],
      [SEAT_COLOUR, strings.legendAbsorber, true],
      [ORPHAN_SEAT_COLOUR, strings.legendOrphanSeat, true],
      [UNCHANGED_SEAT_COLOUR, strings.legendUnchangedSeat, true],
      [regionColour(0, false), strings.legendAbsorbed],
      [ORPHAN_COLOUR, strings.legendOrphan],
      [UNCHANGED_COLOUR, strings.legendUnchanged],
    ];
    el('#legend').innerHTML =
      `<h4>${strings.legend}</h4>` +
      rows
        .map(
          ([colour, label, isDot]) =>
            `<div class="row"><span class="swatch${isDot ? ' dot' : ''}" style="background:${colour}"></span>${label}</div>`,
        )
        .join('');
  };

  const renderSliders = (): void => {
    const host = el('#sliders');
    host.innerHTML = SLIDERS.map((spec) => {
      const raw = scenario.params[spec.key];
      const value = isRadius(spec.key) ? RADIUS_GRID.indexOf(raw) : raw;
      return `
        <div class="slider" data-key="${spec.key}">
          <div class="slider-head">
            <label for="s-${spec.key}">${strings[spec.labelKey]}</label>
            <span class="readout" data-readout>${spec.format(raw, scenario.lang, strings)}</span>
          </div>
          <input id="s-${spec.key}" type="range" min="${spec.min}" max="${spec.max}"
                 step="${spec.step}" value="${value}" />
          <p class="help">${strings[spec.helpKey]}</p>
        </div>`;
    }).join('');

    for (const spec of SLIDERS) {
      const input = host.querySelector<HTMLInputElement>(`#s-${spec.key}`)!;
      input.addEventListener('input', () => {
        const n = Number(input.value);
        // Radius sliders move over grid positions, not metres, so the handle always lands
        // on a precomputed radius instead of snapping visibly after the fact.
        const next = isRadius(spec.key) ? RADIUS_GRID[n]! : n;
        scenario.params = { ...scenario.params, [spec.key]: next };
        host
          .querySelector<HTMLElement>(`.slider[data-key="${spec.key}"] [data-readout]`)!
          .textContent = spec.format(next, scenario.lang, strings);
        schedule();
      });
    }
  };

  const renderSummary = (): void => {
    if (!latest || !ready) {
      el('#summary').innerHTML = `<div class="stat"><span class="value">—</span></div>`;
      return;
    }
    const reduction = 100 * (1 - latest.regions / ready.uatCount);
    const stat = (value: string, label: string, accent = false, title = ''): string =>
      `<div class="stat" ${title ? `title="${title}"` : ''}>
         <span class="value${accent ? ' accent' : ''}">${value}</span>
         <span class="label">${label}</span>
       </div>`;

    el('#summary').innerHTML = [
      stat(
        `${formatNumber(latest.regions, scenario.lang)}`,
        `${strings.regions} / ${formatNumber(ready.uatCount, scenario.lang)}`,
      ),
      stat(`${reduction.toFixed(1)}%`, strings.reduction, true),
      stat(
        formatMoney(latest.savingsAdminRon, scenario.lang),
        strings.savings,
        true,
        strings.savingsHelp,
      ),
      stat(formatNumber(latest.seeds, scenario.lang), strings.seeds),
      stat(formatNumber(latest.orphanRegions, scenario.lang), strings.orphanRegions),
      ...(scenario.params.pTarget > 0
        ? [
            stat(
              formatNumber(latest.belowTarget, scenario.lang),
              strings.belowTarget,
              false,
              strings.belowTargetHelp,
            ),
          ]
        : []),
      `<div class="stat"><span class="recompute">${strings.recomputeTime} ${latest.elapsedMs.toFixed(0)} ms</span>
       <span class="label">${strings.upperBound}: ${formatMoney(latest.savingsOperatingRon, scenario.lang)}</span></div>`,
    ].join('');
  };

  /** Plain-language reason a commune ended up where it did. */
  const explain = (index: number): string => {
    if (!latest || !ready) return '';
    const reason = latest.reasonOf[index]!;
    const region = latest.regionOf[index]!;
    const centre = ready.attributes.name[region]!;
    const radius =
      latest.tierOf[region] === 0
        ? `${scenario.params.rCapM / 1000} km`
        : `${scenario.params.rTownM / 1000} km`;

    switch (reason) {
      case REASON.CENTRE_CAPITAL:
        return strings.whyCapital;
      case REASON.CENTRE_THRESHOLD:
        return strings.whyThreshold
          .replace('{pop}', formatNumber(ready.population[index]!, scenario.lang))
          .replace('{x}', formatNumber(scenario.params.x, scenario.lang));
      case REASON.CENTRE_PROMOTED:
        return strings.whyPromoted.replace('{n}', String(scenario.params.nMin));
      case REASON.ABSORBED_OVERLAP:
        return strings.whyAbsorbedOverlap
          .replace('{centre}', centre)
          .replace('{pct}', `${latest.overlapOf[index]}%`)
          .replace('{radius}', radius);
      case REASON.ABSORBED_SEAT:
        return strings.whyAbsorbedSeat.replace('{centre}', centre).replace('{radius}', radius);
      case REASON.ORPHAN_SEAT:
        return strings.whyOrphanSeat;
      case REASON.ORPHAN_MEMBER:
        return strings.whyOrphanMember;
      case REASON.TARGET_MERGED:
        return strings.whyTargetMerge.replace(
          '{target}',
          formatNumber(scenario.params.pTarget, scenario.lang),
        );
      default:
        return '';
    }
  };

  const renderDetail = (): void => {
    const panel = el<HTMLElement>('#detail');
    const index = scenario.selected;
    if (index === null || !ready || !latest) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const region = latest.regionOf[index]!;
    const members: number[] = [];
    for (let i = 0; i < latest.regionOf.length; i += 1) {
      if (latest.regionOf[i] === region) members.push(i);
    }
    members.sort((a, b) => ready!.population[b]! - ready!.population[a]!);

    const orphan = isOrphanRegion[region] === 1;
    const totalPop = members.reduce((sum, i) => sum + ready!.population[i]!, 0);
    const totalAdmin = members.reduce((sum, i) => sum + ready!.administrativeRon[i]!, 0);
    const totalOperating = members.reduce((sum, i) => sum + ready!.operatingRon[i]!, 0);

    panel.innerHTML = `
      <p class="kicker">${strings.region}${orphan ? ` · <span class="badge orphan">${strings.legendOrphan}</span>` : ''}</p>
      <h3>${ready.attributes.name[region]}</h3>
      <dl>
        <dt>${strings.county}</dt><dd>${ready.attributes.county[region]}</dd>
        <dt>${strings.members}</dt><dd>${formatNumber(members.length, scenario.lang)}</dd>
        <dt>${strings.population}</dt><dd>${formatNumber(totalPop, scenario.lang)}</dd>
        <dt>${strings.adminCost}</dt><dd>${formatMoney(totalAdmin, scenario.lang)}</dd>
        <dt>${strings.operatingCost}</dt><dd>${formatMoney(totalOperating, scenario.lang)}</dd>
        <dt>${strings.costPerResident}</dt><dd>${
          totalPop > 0 ? formatNumber(totalAdmin / totalPop, scenario.lang) : '—'
        } RON</dd>
      </dl>
      <div class="why">
        <h4>${strings.whyTitle}</h4>
        <p>${explain(region)}</p>
        ${
          index !== region
            ? `<p><strong>${ready.attributes.name[index]}:</strong> ${explain(index)}</p>`
            : ''
        }
        <p class="county-rule">${strings.whyCountyRule.replace('{county}', ready.attributes.county[region]!)}</p>
      </div>
      <ul class="members">
        ${members
          .map(
            (i) =>
              `<li class="${i === region ? 'is-centre' : ''}">
                 <span>${ready!.attributes.name[i]}</span>
                 <span>${formatNumber(ready!.population[i]!, scenario.lang)}</span>
               </li>`,
          )
          .join('')}
      </ul>`;
  };

  // --- recompute loop ----------------------------------------------------------------

  const schedule = (): void => {
    writeHash(scenario);
    if (pending) return;
    pending = true;
    // Animation frames, not timers: the recompute rate follows the display, and a drag
    // never queues more work than the screen can show.
    requestAnimationFrame(() => {
      pending = false;
      token += 1;
      worker.postMessage({ type: 'compute', params: scenario.params, token });
    });
  };

  worker.onmessage = (event: MessageEvent<Outgoing>) => {
    const message = event.data;

    if (message.type === 'error') {
      el('#loading').innerHTML = `<span>${message.message}</span>`;
      return;
    }

    if (message.type === 'ready') {
      ready = message;
      costBreaks = message.adminCostBreaks;
      costPerResident = new Float32Array(message.uatCount);
      for (let i = 0; i < message.uatCount; i += 1) {
        const pop = message.population[i]!;
        costPerResident[i] = pop > 0 ? message.administrativeRon[i]! / pop : 0;
      }
      renderModes();
      schedule();
      return;
    }

    // Discard anything a later drag has already superseded.
    if (message.token !== token) return;

    latest = message;
    isOrphanRegion = new Uint8Array(message.regionOf.length);
    // A region is orphan-tier when its centre is not a seed: gravitational regions are
    // always centred on a seed, clusters never are.
    for (let i = 0; i < message.regionOf.length; i += 1) {
      const region = message.regionOf[i]!;
      if (message.tierOf[region] === -1) isOrphanRegion[region] = 1;
    }

    mapHandle.applyAssignment(
      message.regionOf,
      isOrphanRegion,
      message.tierOf,
      scenario.mode,
      costPerResident,
      costBreaks,
    );
    // Every resulting unit gets a seat marker, not only the gravitational ones. An orphan
    // cluster keeps its largest member and a commune nothing reached is its own seat;
    // marking only the centres left whole stretches of the map with no indication of where
    // the administration would sit.
    const kindOf = new Int8Array(message.regionOf.length).fill(-1);
    for (let i = 0; i < message.regionOf.length; i += 1) {
      if (message.regionOf[i] !== i) continue;
      kindOf[i] =
        message.tierOf[i] !== -1
          ? ready!.attributes.isCapital[i]
            ? SEAT_KIND.CAPITAL
            : SEAT_KIND.CENTRE
          : isOrphanRegion[i] === 1
            ? SEAT_KIND.ORPHAN
            : SEAT_KIND.UNCHANGED;
    }
    mapHandle.setCentres(kindOf);
    renderSummary();
    renderDetail();
    el<HTMLElement>('#loading').hidden = true;
  };

  // --- interaction -------------------------------------------------------------------

  mapHandle.onSelect((index) => {
    scenario.selected = index;
    mapHandle.setSelected(index);
    writeHash(scenario);
    renderDetail();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.lang button')) {
    button.addEventListener('click', () => {
      scenario.lang = button.dataset.lang as Lang;
      writeHash(scenario);
      applyStaticText();
    });
  }

  el('#reset-btn').addEventListener('click', () => {
    scenario.params = { ...DEFAULT_PARAMS };
    renderSliders();
    schedule();
  });

  el('#copy-link').addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.href);
    const button = el<HTMLButtonElement>('#copy-link');
    button.textContent = strings.linkCopied;
    setTimeout(() => (button.textContent = strings.copyLink), 1500);
  });

  const modal = el<HTMLDialogElement>('#methodology');
  el('#methodology-btn').addEventListener('click', () => {
    modal.innerHTML = methodologyHtml(strings);
    modal.querySelector('button')!.addEventListener('click', () => modal.close());
    modal.showModal();
  });

  applyStaticText();
  for (const [key, visible] of Object.entries(overlayState) as [Overlay, boolean][]) {
    if (visible) void mapHandle.setOverlay(key, true);
  }
  mapHandle.setSelected(scenario.selected);
  worker.postMessage({ type: 'init', baseUrl: DATA_BASE });
}

function methodologyHtml(s: Strings): string {
  const ro = document.documentElement.lang === 'ro';
  return `
    <h2>${s.methodology}</h2>
    <p>${
      ro
        ? 'Modelul este determinist: aceleași setări produc întotdeauna exact aceeași hartă. Nu folosește optimizare și nici aleatoriu.'
        : 'The model is deterministic: the same settings always produce exactly the same map. It uses no optimization and no randomness.'
    }</p>
    <h3>${ro ? 'Cum funcționează' : 'How it works'}</h3>
    <p>${
      ro
        ? 'Reședințele de județ și localitățile peste pragul de populație devin centre. Suprafața fiecărui centru este extinsă cu o rază care depinde de tipul lui. Comunele vecine care intră suficient în această rază — și care sunt legate printr-un drum ce traversează granița comună — sunt absorbite, în valuri concentrice. Regiunile nu traversează niciodată limitele de județ.'
        : 'County capitals and localities above the population threshold become centres. Each centre’s territory is buffered outward by a radius that depends on its tier. Neighbouring communes that fall far enough inside that radius — and that are linked by a road crossing the shared border — are absorbed, in concentric waves. Regions never cross county lines.'
    }</p>
    <h3>${ro ? 'Despre economie' : 'About the saving'}</h3>
    <p>${s.savingsHelp}</p>
    <h3>${ro ? 'Limitări' : 'Limitations'}</h3>
    <p>${
      ro
        ? 'Raza este o distanță în linie dreaptă, nu pe drum. Drumurile sunt folosite doar pentru a verifica dacă o graniță este traversată. Datele despre drumuri provin din OpenStreetMap și clasificarea lor nu este întotdeauna exactă — în Delta Dunării, de exemplu, unele drumuri de pământ apar ca drumuri obișnuite.'
        : 'The radius is a straight-line distance, not a road distance. Roads are used only to test whether a border is crossed. Road data comes from OpenStreetMap and its classification is not always exact — in the Danube Delta, for instance, some sand tracks are tagged as ordinary roads.'
    }</p>
    <p><a href="${import.meta.env.BASE_URL}METHODOLOGY.md" target="_blank" rel="noopener">${
      ro ? 'Metodologia completă, inclusiv sursele și deciziile contestabile' : 'Full methodology, including sources and disputable decisions'
    }</a></p>
    <button class="ghost">${s.close}</button>`;
}

void boot();
