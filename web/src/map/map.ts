/**
 * The map layer.
 *
 * Geometry is uploaded once and never re-rendered. Every recomputation updates colour via
 * `setFeatureState`, so a slider drag repaints rather than rebuilding 3,186 polygons —
 * which is the difference between a continuous drag and a stutter.
 */

import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import type { ViewMode } from '../model/types';

// MapLibre 6 ships its worker as a separate file instead of inlining it, and a bundled
// app must say where that file ended up. Without this every source fails to load —
// silently, with no error event and no failed request, which is a genuinely difficult
// symptom to read: the map renders its background and simply stays empty.
//
// `?worker&url` rather than `?url`: the worker imports a shared chunk, and plain `?url`
// copies the file verbatim without following its imports, so the dependency is never
// emitted and the worker dies on load in production while working fine in dev.
setWorkerUrl(maplibreWorkerUrl);

export const SOURCE_ID = 'uats';
export const FILL_LAYER = 'uat-fill';
export const REGION_OUTLINE = 'region-outline';
export const UAT_OUTLINE = 'uat-outline';

/** Optional context layers, each toggled independently. */
export const OVERLAYS = ['counties', 'regions', 'seats', 'capitals', 'roads'] as const;
export type Overlay = (typeof OVERLAYS)[number];

export const COUNTY_LINE_COLOUR = '#f2f4f7';
export const REGION_LINE_COLOUR = '#7cc4de';
export const SEAT_COLOUR = '#e6e9ee';
export const CAPITAL_COLOUR = '#ffd166';
export const ROAD_COLOUR = '#8fa3b8';

/**
 * Region colours.
 *
 * Gravitational regions get a spread of hues so neighbouring regions stay distinguishable;
 * orphan-tier clusters get a single muted amber instead. The brief asks for orphan regions
 * to be "visually and rhetorically separable" — they follow a different rule, and a reader
 * should be able to see at a glance how much of the map is absorption and how much is
 * small communes pairing up.
 */
const REGION_HUES = [
  '#2f6f8f', '#3f8f7f', '#5b7fa8', '#417f5c', '#6a6f9c',
  '#2f7f7a', '#4a6f8f', '#557f6a', '#3f6f9c', '#5f8f8a',
  '#46769b', '#3a8a72', '#6d83ab', '#4c8a66', '#7a7fa6',
  '#357f88', '#5a7f9c', '#628a72', '#4a7fa8', '#6b998f',
];

/**
 * Sequential ramp for administration cost per resident, lightest to darkest.
 *
 * Borrowed from reformaadm, which uses the same four steps for fiscal stress. Keeping the
 * ramp identical is deliberate: the two tools sit alongside each other and cover the same
 * communes, so a reader moving between them should not have to relearn what red means.
 */
export const COST_RAMP = ['#f5c0c0', '#cc6060', '#aa2828', '#7b1b1b'];

/** Accent for figures about money, matching reformaadm's revenue bar. */
export const MONEY_ACCENT = '#c9a84c';

export function costColour(perResident: number, breaks: number[]): string {
  if (!(perResident > 0)) return UNCHANGED_COLOUR;
  let step = 0;
  while (step < breaks.length && perResident >= breaks[step]!) step += 1;
  return COST_RAMP[step]!;
}
export const ORPHAN_COLOUR = '#b58547';
export const UNCHANGED_COLOUR = '#8d8f93';
export const ABSORBER_COLOUR = '#123f52';

export function regionColour(regionIndex: number, isOrphan: boolean): string {
  if (isOrphan) return ORPHAN_COLOUR;
  // Deterministic, so a scenario link reproduces the map a reader was looking at rather
  // than just its shape. The prime stride spreads consecutive region indices across the
  // palette instead of walking it in order, which matters because neighbouring regions
  // tend to have neighbouring indices and would otherwise often come out the same colour.
  return REGION_HUES[(regionIndex * 7) % REGION_HUES.length]!;
}

/** A deliberately plain basemap: the choropleth is the content, not the terrain. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0f1216' } }],
  // No `glyphs` key at all: MapLibre validates the style and rejects an explicit
  // `undefined`. Nothing here renders text, so there is no font to point at.
};

export interface MapHandle {
  map: MapLibreMap;
  /** Paint every UAT from a region assignment, in the given view mode. */
  applyAssignment: (
    regionOf: Uint16Array,
    isOrphanRegion: Uint8Array,
    tierOf: Int8Array,
    mode: ViewMode,
    costPerResident: Float32Array,
    costBreaks: number[],
  ) => void;
  setSelected: (index: number | null) => void;
  onSelect: (handler: (index: number | null) => void) => void;
  /** Show or hide a context layer. Roads are fetched the first time they are shown. */
  setOverlay: (overlay: Overlay, visible: boolean) => Promise<void>;
  /** Highlight the seat points that are absorbing centres in the current scenario. */
  setCentres: (isCentre: Uint8Array) => void;
}

export async function createMap(container: HTMLElement, dataBase: string): Promise<MapHandle> {
  const map = new MapLibreMap({
    container,
    style: BLANK_STYLE,
    center: [25.0, 45.9],
    zoom: 6.1,
    attributionControl: false,
    // The model is deterministic and the geometry is flat; nothing here needs a tilted
    // camera, and locking it keeps the map readable as a data display.
    pitchWithRotate: false,
    dragRotate: false,
  });

  // MapLibre reports failures as events rather than exceptions, so without this a broken
  // style or an unreachable source fails completely silently.
  map.on('error', (event) => {
    const err = (event as unknown as { error?: Error }).error;
    console.error('[map]', err?.message ?? String(event));
    (window as unknown as { __mapErrors?: string[] }).__mapErrors ??= [];
    (window as unknown as { __mapErrors: string[] }).__mapErrors.push(
      err?.message ?? String(event),
    );
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

  await new Promise<void>((resolve) => map.on('load', () => resolve()));

  // Hand MapLibre the URL rather than a parsed object: it fetches and parses in its own
  // worker, which keeps a 4.3 MB JSON.parse off the main thread entirely.
  map.addSource(SOURCE_ID, { type: 'geojson', data: `${dataBase}uats.geojson` });

  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'colour'], UNCHANGED_COLOUR],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        0.95,
        ['boolean', ['feature-state', 'absorber'], false],
        0.9,
        0.72,
      ],
    },
  });

  // Hairline between communes, so the composition of a region stays legible.
  map.addLayer({
    id: UAT_OUTLINE,
    type: 'line',
    source: SOURCE_ID,
    paint: { 'line-color': '#0f1216', 'line-width': 0.3, 'line-opacity': 0.5 },
  });

  // Heavier stroke on the selected unit only. Drawing every region boundary would need a
  // dissolve on each recompute, which is exactly the per-frame geometry work the
  // feature-state approach exists to avoid.
  map.addLayer({
    id: REGION_OUTLINE,
    type: 'line',
    source: SOURCE_ID,
    // Driven by paint rather than `filter`: MapLibre rejects feature-state expressions in
    // a filter, so the layer covers every feature and draws only the selected one.
    paint: {
      'line-color': '#f2f4f7',
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 1.8, 0],
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0],
    },
  });

  // Wait for the source only *after* the layers exist. MapLibre does not begin loading a
  // GeoJSON source until a layer references it, so awaiting the load before adding layers
  // deadlocks: the fetch is never even issued.
  //
  // Listening on the specific sourceId avoids resolving on another source's chatter, and
  // the timeout means a stalled fetch degrades to an uncoloured map rather than hanging
  // the app behind an await that never settles.
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      map.off('sourcedata', onData);
      resolve();
    };
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }): void => {
      if (event.sourceId === SOURCE_ID && event.isSourceLoaded) done();
    };
    const timer = setTimeout(done, 15_000);
    if (map.getSource(SOURCE_ID) && map.isSourceLoaded(SOURCE_ID)) {
      done();
      return;
    }
    map.on('sourcedata', onData);
  });

  // --- context layers ----------------------------------------------------------------
  // County lines matter most: no region may ever cross one, so seeing them explains the
  // shape of the result more than any other overlay.
  map.addSource('counties', { type: 'geojson', data: `${dataBase}counties.geojson` });
  map.addLayer({
    id: 'counties-line',
    type: 'line',
    source: 'counties',
    layout: { visibility: 'none' },
    paint: { 'line-color': COUNTY_LINE_COLOUR, 'line-width': 1.2, 'line-opacity': 0.75 },
  });

  map.addSource('regions', { type: 'geojson', data: `${dataBase}regions.geojson` });
  map.addLayer({
    id: 'regions-line',
    type: 'line',
    source: 'regions',
    layout: { visibility: 'none' },
    paint: {
      'line-color': REGION_LINE_COLOUR,
      'line-width': 2.2,
      'line-opacity': 0.8,
      'line-dasharray': [3, 2],
    },
  });

  map.addSource('seats', { type: 'geojson', data: `${dataBase}seats.geojson` });
  map.addLayer({
    id: 'seats-point',
    type: 'circle',
    source: 'seats',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 3.5],
      'circle-color': SEAT_COLOUR,
      'circle-opacity': 0.75,
    },
  });

  // Absorbing centres, drawn from the same source but filtered by feature state, so the
  // set updates with the scenario without re-uploading any geometry.
  map.addLayer({
    id: 'centres-point',
    type: 'circle',
    source: 'seats',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.2, 10, 7],
      'circle-color': ['case', ['get', 'capital'], CAPITAL_COLOUR, SEAT_COLOUR],
      'circle-stroke-color': '#0f1216',
      'circle-stroke-width': 1.2,
      'circle-opacity': ['case', ['boolean', ['feature-state', 'centre'], false], 1, 0],
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'centre'], false], 1, 0],
    },
  });

  const loadedOverlays = new Set<Overlay>();

  const setOverlay = async (overlay: Overlay, visible: boolean): Promise<void> => {
    if (overlay === 'roads') {
      // Fetched on first use only: at 4.5 MB it is by far the largest artefact, and most
      // visits never turn it on.
      if (visible && !loadedOverlays.has('roads')) {
        map.addSource('roads', { type: 'geojson', data: `${dataBase}roads.geojson` });
        map.addLayer(
          {
            id: 'roads-line',
            type: 'line',
            source: 'roads',
            paint: {
              'line-color': ROAD_COLOUR,
              'line-opacity': 0.55,
              'line-width': [
                'match',
                ['get', 'highway'],
                'motorway', 1.8,
                'trunk', 1.3,
                0.7,
              ],
            },
          },
          UAT_OUTLINE,
        );
        loadedOverlays.add('roads');
        return;
      }
      if (loadedOverlays.has('roads')) {
        map.setLayoutProperty('roads-line', 'visibility', visible ? 'visible' : 'none');
      }
      return;
    }

    const layerId = {
      counties: 'counties-line',
      regions: 'regions-line',
      seats: 'seats-point',
      capitals: 'centres-point',
    }[overlay];
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  };

  const setCentres = (isCentre: Uint8Array): void => {
    for (let i = 0; i < isCentre.length; i += 1) {
      map.setFeatureState({ source: 'seats', id: i }, { centre: isCentre[i] === 1 });
    }
  };

  let selected: number | null = null;
  const selectHandlers: ((index: number | null) => void)[] = [];

  map.on('click', FILL_LAYER, (event: MapMouseEvent & { features?: { id?: string | number }[] }) => {
    const feature = event.features?.[0];
    const id = typeof feature?.id === 'number' ? feature.id : null;
    for (const handler of selectHandlers) handler(id);
  });
  map.on('click', (event: MapMouseEvent) => {
    const hits = map.queryRenderedFeatures(event.point, { layers: [FILL_LAYER] });
    if (hits.length === 0) for (const handler of selectHandlers) handler(null);
  });
  map.on('mouseenter', FILL_LAYER, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', FILL_LAYER, () => {
    map.getCanvas().style.cursor = '';
  });

  const setSelected = (index: number | null): void => {
    if (selected !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: selected }, { selected: false });
    }
    selected = index;
    if (index !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: index }, { selected: true });
    }
  };

  const applyAssignment = (
    regionOf: Uint16Array,
    isOrphanRegion: Uint8Array,
    tierOf: Int8Array,
    mode: ViewMode,
    costPerResident: Float32Array,
    costBreaks: number[],
  ): void => {
    for (let i = 0; i < regionOf.length; i += 1) {
      const region = regionOf[i]!;
      const orphan = isOrphanRegion[region] === 1;
      const isAbsorber = region === i && tierOf[i] !== -1;
      // In cost mode the absorber is not highlighted: the point of that view is the
      // spending gradient, and a dark centre in every region would read as part of it.
      const colour =
        mode === 'cost'
          ? costColour(costPerResident[i]!, costBreaks)
          : isAbsorber
            ? ABSORBER_COLOUR
            : regionColour(region, orphan);
      map.setFeatureState(
        { source: SOURCE_ID, id: i },
        { colour, absorber: mode === 'regions' && isAbsorber },
      );
    }
    if (selected !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: selected }, { selected: true });
    }
  };

  return {
    map,
    applyAssignment,
    setSelected,
    onSelect: (handler) => selectHandlers.push(handler),
    setOverlay,
    setCentres,
  };
}
