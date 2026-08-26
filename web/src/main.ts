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
import { createMap, ABSORBER_COLOUR, ORPHAN_COLOUR, UNCHANGED_COLOUR, regionColour } from './map/map';
import { DEFAULT_PARAMS, type Params } from './model/types';
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
];

const isRadius = (key: keyof Params): boolean => key === 'rCapM' || key === 'rTownM';

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
    renderLegend();
    renderSliders();
    renderSummary();
    renderDetail();
  };

  const renderLegend = (): void => {
    const rows: [string, string][] = [
      [ABSORBER_COLOUR, strings.legendAbsorber],
      [regionColour(0, false), strings.legendAbsorbed],
      [ORPHAN_COLOUR, strings.legendOrphan],
      [UNCHANGED_COLOUR, strings.legendUnchanged],
    ];
    el('#legend').innerHTML =
      `<h4>${strings.legend}</h4>` +
      rows
        .map(
          ([colour, label]) =>
            `<div class="row"><span class="swatch" style="background:${colour}"></span>${label}</div>`,
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
      `<div class="stat"><span class="recompute">${strings.recomputeTime} ${latest.elapsedMs.toFixed(0)} ms</span>
       <span class="label">${strings.upperBound}: ${formatMoney(latest.savingsOperatingRon, scenario.lang)}</span></div>`,
    ].join('');
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
      </dl>
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

    mapHandle.applyAssignment(message.regionOf, isOrphanRegion, message.tierOf);
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
    <button class="ghost">${s.close}</button>`;
}

void boot();
