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
  REGION_LINE_COLOUR,
  ORPHAN_SEAT_COLOUR,
  ROAD_COLOUR,
  SEAT_COLOUR,
  SEAT_KIND,
  UNCHANGED_SEAT_COLOUR,
  UNCHANGED_COLOUR,
  type Overlay,
} from './map/map';
import { PALETTE } from './model/colour';
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
    key: 'maxRoadM', labelKey: 'maxRoad', helpKey: 'maxRoadHelp',
    min: 0, max: 80000, step: 5000,
    format: (v, _l, s) => (v === 0 ? s.pTargetOff : KM(v)),
  },
  {
    key: 'pTarget', labelKey: 'pTarget', helpKey: 'pTargetHelp',
    min: 0, max: 100000, step: 2500,
    format: (v, l, s) => (v === 0 ? s.pTargetOff : formatNumber(v, l)),
  },
  {
    key: 'minCompactness', labelKey: 'minCompactness', helpKey: 'minCompactnessHelp',
    min: 0, max: 0.35, step: 0.05,
    format: (v, _l, s) => (v === 0 ? s.pTargetOff : v.toFixed(2)),
  },
];

const isRadius = (key: keyof Params): boolean =>
  key === 'rCapM' || key === 'rTownM' || key === 'rNationalM';

/**
 * What to call a unit, as opposed to a UAT.
 *
 * The six sectors merge into one city and the lowest-numbered one stands for it, since the
 * UAT set has no "Municipiul Bucuresti" row. Naming the resulting unit "Sectorul 1" would
 * describe the merge as an annexation by one sector, which is not what it is.
 */
/** "Tulcea", not "TL". The payload carries the code; the manifest carries the name. */
function countyName(data: ReadyMessage, index: number): string {
  const code = data.attributes.county[index] ?? '';
  return data.countyNames[code] ?? code;
}

function unitName(data: ReadyMessage, seat: number): string {
  if (data.attributes.county[seat] === 'B') return 'MUNICIPIUL BUCUREȘTI';
  return data.attributes.name[seat]!;
}

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
    renderPins();
    renderAudit();
  };

  const overlayState: Record<Overlay, boolean> = {
    counties: true,
    regions: false,
    seats: false,
    capitals: true,
    roads: false,
    countyRoads: false,
  };

  const renderLayers = (): void => {
    const rows: [Overlay, string, string, boolean, string][] = [
      ['counties', strings.layerCounties, COUNTY_LINE_COLOUR, false, ''],
      ['regions', strings.layerRegions, REGION_LINE_COLOUR, false, ''],
      ['capitals', strings.layerCapitals, CAPITAL_COLOUR, true, ''],
      ['seats', strings.layerSeats, SEAT_COLOUR, true, ''],
      ['roads', strings.layerRoads, ROAD_COLOUR, false, strings.layersRoadsNote],
      [
        'countyRoads',
        strings.layerCountyRoads,
        ROAD_COLOUR,
        false,
        strings.layersCountyRoadsNote,
      ],
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

  /**
   * Repaint from the latest result, in whatever mode is selected.
   *
   * "Today" is not a different computation, only a different thing to draw: the 3,186
   * communes as they are, each its own unit and its own seat. Keeping it here rather than in
   * the worker means switching between before and after is instant.
   */
  const paint = (): void => {
    if (!latest || !ready) return;
    const showingToday = scenario.mode === 'current';
    const identity = new Uint16Array(latest.regionOf.length);
    for (let i = 0; i < identity.length; i += 1) identity[i] = i;

    mapHandle.applyAssignment(
      showingToday ? identity : latest.regionOf,
      showingToday ? ready.currentColourOf : latest.colourOf,
      latest.tierOf,
      scenario.mode,
      costPerResident,
      costBreaks,
    );

    const kindOf = new Int8Array(latest.regionOf.length).fill(-1);
    if (!showingToday) {
      for (let i = 0; i < latest.regionOf.length; i += 1) {
        if (latest.regionOf[i] !== i) continue;
        kindOf[i] =
          latest.tierOf[i] !== -1
            ? ready.attributes.isCapital[i]
              ? SEAT_KIND.CAPITAL
              : SEAT_KIND.CENTRE
            : isOrphanRegion[i] === 1
              ? SEAT_KIND.ORPHAN
              : SEAT_KIND.UNCHANGED;
      }
    }
    mapHandle.setCentres(kindOf);
    renderLabels();
  };

  const renderModes = (): void => {
    const modes: [ViewMode, string][] = [
      ['current', strings.viewCurrent],
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
        renderSummary();
        renderDetail();
        paint();
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
      [PALETTE[6]!, strings.legendAbsorbed],
      [PALETTE[0]!, strings.legendOrphan],
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
    if (scenario.mode === 'current') {
      el('#summary').innerHTML =
        `<div class="stat"><span class="value">${formatNumber(ready.uatCount, scenario.lang)}</span>` +
        `<span class="label">${strings.viewCurrent}</span></div>` +
        `<div class="stat"><span class="value accent">${formatNumber(latest.regions, scenario.lang)}</span>` +
        `<span class="label">${strings.viewRegions}</span></div>`;
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
    const centre = unitName(ready, region);
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
      case REASON.MANUAL_PIN:
        return strings.pinWhy;
      case REASON.TARGET_MERGED:
        return strings.whyTargetMerge.replace(
          '{target}',
          formatNumber(scenario.params.pTarget, scenario.lang),
        );
      default:
        return '';
    }
  };

  /** Units a given UAT could legally be pinned to: existing seats it may join. */
  const pinTargets = (index: number): number[] => {
    const info = ready;
    const result = latest;
    if (!info || !result) return [];
    const here = result.regionOf[index]!;
    const seats = new Set<number>();
    for (let i = 0; i < result.regionOf.length; i += 1) seats.add(result.regionOf[i]!);
    const county = info.attributes.county[index];
    return [...seats]
      .filter((seat) => {
        if (seat === here) return false;
        const seatCounty = info.attributes.county[seat];
        if (seatCounty === county) return true;
        // The one county line the model allows, in the one direction it allows it.
        return seatCounty === 'B' && county === 'IF';
      })
      .sort((a, b) => unitName(info, a).localeCompare(unitName(info, b), scenario.lang));
  };

  const setPin = (uat: number, seat: number | null): void => {
    scenario.pins = scenario.pins.filter((p) => p.uat !== uat);
    if (seat !== null) scenario.pins.push({ uat, seat });
    schedule();
  };

  const renderPins = (): void => {
    const box = el<HTMLElement>('#pins');
    if (!ready || !latest) { box.hidden = true; return; }
    box.hidden = false;
    if (scenario.pins.length === 0) {
      box.innerHTML = `<h4>${strings.pinHeading}</h4><p class="muted">${strings.pinNone}</p>`;
      return;
    }
    const stale = new Set(latest.pinsRejected.map((r) => r.pin.uat));
    box.innerHTML = `
      <h4>${strings.pinHeading} <span class="count">${scenario.pins.length}</span></h4>
      <ul class="pin-list">
        ${scenario.pins
          .map(
            (pin) => `<li${stale.has(pin.uat) ? ' class="stale"' : ''}>
              <span class="pin-uat">${ready!.attributes.name[pin.uat]}</span>
              <span class="pin-arrow">→</span>
              <span class="pin-seat">${unitName(ready!, pin.seat)}</span>
              ${stale.has(pin.uat) ? `<em class="pin-note">${strings.pinStale}</em>` : ''}
              <button data-unpin="${pin.uat}" title="${strings.pinRemove}">×</button>
            </li>`,
          )
          .join('')}
      </ul>
      <button class="link" data-clear-pins>${strings.pinClearAll}</button>`;

    box.querySelectorAll<HTMLButtonElement>('[data-unpin]').forEach((button) => {
      button.addEventListener('click', () => setPin(Number(button.dataset.unpin), null));
    });
    box.querySelector<HTMLButtonElement>('[data-clear-pins]')?.addEventListener('click', () => {
      scenario.pins = [];
      schedule();
    });
  };

  /**
   * Units worth a second look.
   *
   * Not a list of errors — the rules are deterministic and these are all legal outcomes.
   * It exists so the odd cases can be found deliberately instead of stumbled on while
   * panning the map, which is how every one of them has been found so far.
   */
  const renderAudit = (): void => {
    const box = el<HTMLElement>('#audit');
    if (!ready || !latest) { box.hidden = true; return; }
    box.hidden = false;

    const members = new Map<number, number[]>();
    for (let i = 0; i < latest.regionOf.length; i += 1) {
      const seat = latest.regionOf[i]!;
      let list = members.get(seat);
      if (!list) { list = []; members.set(seat, list); }
      list.push(i);
    }

    const single: number[] = [];
    const below: number[] = [];
    const outranked: number[] = [];
    for (const [seat, list] of members) {
      if (list.length === 1) single.push(seat);
      const pop = list.reduce((total, i) => total + ready!.population[i]!, 0);
      if (scenario.params.pTarget > 0 && pop < scenario.params.pTarget) below.push(seat);
      if (list.some((i) => ready!.attributes.adminRank[i]! < ready!.attributes.adminRank[seat]!)) {
        outranked.push(seat);
      }
    }

    const groups: [string, number[]][] = [
      [strings.auditSingle, single],
      [strings.auditBelowTarget, below],
      [strings.auditOutranked, outranked],
      [strings.auditSplit, latest.splitUnits],
    ];
    const shown = groups.filter(([, list]) => list.length > 0);

    box.innerHTML = `
      <h4>${strings.auditHeading}</h4>
      <p class="muted">${strings.auditIntro}</p>
      ${
        shown.length === 0
          ? `<p class="muted">${strings.auditClean}</p>`
          : shown
              .map(
                ([label, list]) => `
        <details>
          <summary>${label} <span class="count">${formatNumber(list.length, scenario.lang)}</span></summary>
          <ul class="audit-list">
            ${list
              .slice()
              .sort((a, b) => unitName(ready!, a).localeCompare(unitName(ready!, b), scenario.lang))
              .map(
                (seat) =>
                  `<li data-seat="${seat}">
                     <div class="audit-row">
                       <button data-goto="${seat}">${unitName(ready!, seat)}</button>
                       <span>${ready!.attributes.county[seat]}</span>
                     </div>
                     <em class="audit-why"></em>
                   </li>`,
              )
              .join('')}
          </ul>
        </details>`,
              )
              .join('')
      }`;

    // Filled in when a group is opened, not on every repaint: each answer is a Dijkstra
    // inside one county, which is cheap once and wasteful 137 times a second during a drag.
    box.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        const seats = [...details.querySelectorAll<HTMLElement>('li[data-seat]')]
          .filter((row) => row.querySelector('.audit-why')?.textContent === '')
          .map((row) => Number(row.dataset.seat));
        if (seats.length > 0) worker.postMessage({ type: 'explain', seats });
      });
    });

    box.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((button) => {
      button.addEventListener('click', () => {
        const seat = Number(button.dataset.goto);
        scenario.selected = seat;
        writeHash(scenario);
        mapHandle.setSelected(seat);
        mapHandle.flyTo(seat);
        renderDetail();
      });
    });
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

    const currentPin = scenario.pins.find((p) => p.uat === index)?.seat ?? null;
    const orphan = isOrphanRegion[region] === 1;
    const sum = (series: Float32Array): number =>
      members.reduce((total, i) => total + series[i]!, 0);
    const totalPop = members.reduce((total, i) => total + ready!.population[i]!, 0);
    const totalAdmin = sum(ready.administrativeRon);
    const totalOperating = sum(ready.operatingRon);
    const totalDevelopment = sum(ready.developmentRon);
    const totalPersonnel = sum(ready.personnelRon);
    const totalAdminPersonnel = sum(ready.adminPersonnelRon);
    const totalIncome = sum(ready.incomeRon);

    // The saving is the administration of everyone except the centre: the centre keeps its
    // own town hall, and the rest is what a merger removes.
    const centreAdmin = ready.administrativeRon[region]!;
    const saved = Math.max(0, totalAdmin - centreAdmin);
    const balance = totalIncome - (totalOperating + totalDevelopment);

    const scale = Math.max(totalIncome, totalOperating + totalDevelopment, 1);
    const bar = (label: string, value: number, colour: string): string => `
      <div class="row">
        <div class="top"><span>${label}</span><span>${formatMoney(value, scenario.lang)}</span></div>
        <div class="bar"><i style="width:${Math.min(100, (value / scale) * 100).toFixed(1)}%;background:${colour}"></i></div>
      </div>`;

    panel.innerHTML = `
      <p class="kicker">${strings.region}${orphan ? ` · <span class="badge orphan">${strings.legendOrphan}</span>` : ''}</p>
      <h3>${unitName(ready, region)}</h3>
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
      <div class="fiscal">
        <h4>${strings.fiscalHeading}</h4>
        ${bar(strings.ownIncome, totalIncome, '#43b07a')}
        ${bar(strings.adminPersonnel, totalAdminPersonnel, '#e0b13a')}
        ${bar(strings.totalPersonnel, totalPersonnel, '#e08a34')}
        ${bar(strings.operatingCost, totalOperating, '#d4544c')}
        ${bar(strings.developmentCost, totalDevelopment, '#3f8fd4')}
        <div class="balance ${balance >= 0 ? 'surplus' : 'deficit'}">
          <span>${balance >= 0 ? strings.balanceSurplus : strings.balanceDeficit}</span>
          <span>${formatMoney(Math.abs(balance), scenario.lang)}</span>
        </div>
      </div>

      <div class="savings">
        <h4>${strings.savingsHeading}</h4>
        <dl>
          <dt>${strings.totalOperatingOfMembers}</dt><dd>${formatMoney(totalAdmin, scenario.lang)}</dd>
          <dt>${strings.centreKeeps}</dt><dd>${formatMoney(centreAdmin, scenario.lang)}</dd>
        </dl>
        <div class="headline">
          <div class="value">${formatMoney(saved, scenario.lang)}</div>
          <div class="label">${strings.savedPerYear}</div>
        </div>
      </div>

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
      ${latest.splitUnits.includes(region) ? `<p class="pin-warning">${strings.pinSplit}</p>` : ''}
      <div class="pin-control">
        <label for="pin-select">${strings.pinMoveTo}</label>
        <select id="pin-select">
          <option value="">${strings.pinKeepRules}</option>
          ${pinTargets(index)
            .map(
              (seat) =>
                `<option value="${seat}"${
                  currentPin === seat ? ' selected' : ''
                }>${unitName(ready!, seat)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <ul class="members">
        ${members
          .map(
            (i) =>
              `<li class="${i === region ? 'is-centre' : ''}${
                 scenario.pins.some((p) => p.uat === i) ? ' is-pinned' : ''
               }">
                 <span>${ready!.attributes.name[i]}${
                   scenario.pins.some((p) => p.uat === i)
                     ? ` <em class="pin-badge">${strings.pinBadge}</em>`
                     : ''
                 }</span>
                 <span>${formatNumber(ready!.population[i]!, scenario.lang)}</span>
               </li>`,
          )
          .join('')}
      </ul>`;

    panel.querySelector<HTMLSelectElement>('#pin-select')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      setPin(index, value === '' ? null : Number(value));
    });
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
      worker.postMessage({ type: 'compute', params: scenario.params, pins: scenario.pins, token });
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

    if (message.type === 'seat-distances') {
      const slot = hovercard.querySelector<HTMLElement>('.seat-distances');
      if (!slot || !ready || slot.dataset.uat !== String(message.uat)) return;
      slot.innerHTML =
        `<div class="sd-title">${strings.hoverSeatDistances}</div>` +
        message.seats
          .map(
            (row) =>
              `<div class="line${row.own ? ' own' : ''}">` +
              `<span>${unitName(ready!, row.seat)}</span>` +
              `<span>${(row.metres / 1000).toFixed(1)} km</span></div>`,
          )
          .join('');
      return;
    }

    if (message.type === 'explain-result') {
      for (const blocker of message.blockers) {
        const note = el<HTMLElement>('#audit').querySelector<HTMLElement>(
          `li[data-seat="${blocker.seat}"] .audit-why`,
        );
        if (!note) continue;
        note.textContent =
          blocker.kind === 'no-county-neighbour'
            ? strings.auditWhyCounty
            : blocker.kind === 'capital-only'
              ? strings.auditWhyCapitalOnly
              : blocker.kind === 'county-minimum'
                ? strings.auditWhyCountyMinimum.replace('{units}', String(blocker.units))
                : strings.auditWhyCap
                  .replace('{km}', (blocker.metres / 1000).toFixed(1))
                  .replace('{cap}', String(Math.round(scenario.params.maxRoadM / 1000)));
      }
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

    paint();
    renderSummary();
    renderDetail();
    renderPins();
    renderAudit();
    el<HTMLElement>('#loading').hidden = true;
  };

  // --- interaction -------------------------------------------------------------------

  /**
   * Names on the map, once zoomed in far enough to have room for them.
   *
   * Below the threshold there are 3,186 communes across the country and any labelling is an
   * unreadable pile; above it there are a few dozen on screen. In "today" every commune is
   * named, otherwise only the seats — the name of a unit belongs at its centre, and naming
   * every absorbed commune would say nothing about which unit it joined.
   */
  const LABEL_ZOOM = 8.2;
  const LABEL_LIMIT = 90;
  const labels = el<HTMLElement>('#labels');

  const renderLabels = (): void => {
    if (!ready || !latest || mapHandle.zoom() < LABEL_ZOOM) {
      labels.replaceChildren();
      return;
    }
    const showingToday = scenario.mode === 'current';
    const accept = (index: number): boolean =>
      showingToday || latest!.regionOf[index] === index;

    const fragment = document.createDocumentFragment();
    for (const point of mapHandle.visibleSeats(accept, LABEL_LIMIT)) {
      const node = document.createElement('span');
      node.textContent = showingToday
        ? ready.attributes.name[point.index]!
        : unitName(ready, point.index);
      if (!showingToday) node.className = 'centre';
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      fragment.append(node);
    }
    labels.replaceChildren(fragment);
  };

  mapHandle.onViewChange(renderLabels);

  // Hover: the commune as it is today, and the unit it would belong to. Both at once,
  // because "what happens to my commune" is the question the map is actually asked, and
  // answering it should not require a click.
  const hovercard = el<HTMLElement>('#hovercard');
  mapHandle.onHover((index, x, y) => {
    if (index === null || !ready || !latest) {
      hovercard.hidden = true;
      // Fall back to the selected commune's county, so the outline does not flicker off
      // every time the pointer crosses a gap.
      mapHandle.setCountyFocus(
        scenario.selected !== null && ready
          ? (ready.attributes.county[scenario.selected] ?? null)
          : null,
      );
      return;
    }
    mapHandle.setCountyFocus(ready.attributes.county[index] ?? null);
    const unit = latest.regionOf[index]!;
    let unitPop = 0;
    let unitMembers = 0;
    let unitArea = 0;
    for (let i = 0; i < latest.regionOf.length; i += 1) {
      if (latest.regionOf[i] === unit) {
        unitPop += ready.population[i]!;
        unitArea += ready.areaKm2[i]!;
        unitMembers += 1;
      }
    }
    const unchanged = unitMembers === 1;
    hovercard.innerHTML = `
      <div class="name">${ready.attributes.name[index]}</div>
      <div class="county">${countyName(ready, index)}</div>
      <div class="line"><span>${strings.population}</span><span>${formatNumber(
        ready.population[index]!,
        scenario.lang,
      )}</span></div>
      <div class="line"><span>${strings.area}</span><span>${formatNumber(
        Math.round(ready.areaKm2[index]!),
        scenario.lang,
      )} km²</span></div>
      <div class="after">
        <div class="line">
          <span>${unchanged ? strings.legendUnchanged : strings.hoverProposed}</span>
          <span>${formatNumber(unitPop, scenario.lang)}</span>
        </div>
        <div class="line">
          <span>${strings.area}</span>
          <span>${formatNumber(Math.round(unitArea), scenario.lang)} km²</span>
        </div>
        ${
          unchanged
            ? ''
            : `<div class="unit">${unitName(ready, unit)} · ${formatNumber(
                unitMembers,
                scenario.lang,
              )} ${strings.hoverCommunes}</div>`
        }
      </div>
      <div class="seat-distances" data-uat="${index}"></div>`;
    // Filled in when the worker answers. This is the question the map itself cannot show:
    // why is this commune under Topolog rather than Isaccea?
    worker.postMessage({ type: 'seatDistances', uat: index });
    hovercard.hidden = false;
    // Kept inside the viewport: near the right or bottom edge the card flips to the other
    // side of the cursor rather than being clipped.
    const box = hovercard.getBoundingClientRect();
    const left = x + 16 + box.width > window.innerWidth ? x - box.width - 16 : x + 16;
    const top = y + 16 + box.height > window.innerHeight ? y - box.height - 16 : y + 16;
    hovercard.style.left = `${Math.max(8, left)}px`;
    hovercard.style.top = `${Math.max(8, top)}px`;
  });

  mapHandle.onSelect((index) => {
    scenario.selected = index;
    mapHandle.setCountyFocus(index === null ? null : (ready?.attributes.county[index] ?? null));
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
    // Reset means the default scenario, and a scenario with overrides in it is not that.
    scenario.pins = [];
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
