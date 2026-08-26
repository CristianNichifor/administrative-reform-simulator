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
];
export const ORPHAN_COLOUR = '#b58547';
export const UNCHANGED_COLOUR = '#8d8f93';
export const ABSORBER_COLOUR = '#123f52';

export function regionColour(regionIndex: number, isOrphan: boolean): string {
  if (isOrphan) return ORPHAN_COLOUR;
  // Deterministic: the same region gets the same colour on every run, so a scenario link
  // reproduces the map a reader was looking at, not just its shape.
  return REGION_HUES[regionIndex % REGION_HUES.length]!;
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
  /** Paint every UAT from a region assignment. */
  applyAssignment: (
    regionOf: Uint16Array,
    isOrphanRegion: Uint8Array,
    tierOf: Int8Array,
  ) => void;
  setSelected: (index: number | null) => void;
  onSelect: (handler: (index: number | null) => void) => void;
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
  ): void => {
    for (let i = 0; i < regionOf.length; i += 1) {
      const region = regionOf[i]!;
      const orphan = isOrphanRegion[region] === 1;
      const isAbsorber = region === i && tierOf[i] !== -1;
      map.setFeatureState(
        { source: SOURCE_ID, id: i },
        {
          colour: isAbsorber ? ABSORBER_COLOUR : regionColour(region, orphan),
          absorber: isAbsorber,
        },
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
  };
}
