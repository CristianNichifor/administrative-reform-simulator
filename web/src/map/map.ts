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
  type ExpressionSpecification,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { PALETTE } from '../model/colour';
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
export const OVERLAYS = ['counties', 'regions', 'seats', 'capitals', 'roads', 'countyRoads'] as const;
export type Overlay = (typeof OVERLAYS)[number];

/**
 * What kind of seat a marker represents.
 *
 * Every resulting unit has a seat, not only the gravitational ones: an orphan cluster keeps
 * its largest member, and a commune nothing reached is its own seat. Marking only the
 * gravitational centres left whole regions of the map with no indication of where their
 * administration would sit.
 */
export const SEAT_KIND = { CAPITAL: 0, CENTRE: 1, ORPHAN: 2, UNCHANGED: 3 } as const;

export const COUNTY_LINE_COLOUR = '#f2f4f7';
/** Brighter than the plain county line, so the focused border reads over any unit colour. */
export const COUNTY_FOCUS_COLOUR = '#ffd166';
export const REGION_LINE_COLOUR = '#7cc4de';
export const SEAT_COLOUR = '#e6e9ee';
export const CAPITAL_COLOUR = '#ffd166';
/**
 * Roads are drawn to be seen, over eleven saturated fills and a near-black basemap.
 *
 * They used to be one muted blue-grey at half opacity, which disappeared the moment the unit
 * colours became vivid — switching the layer on changed almost nothing on screen. Every hue
 * is spoken for by the palette, so roads separate by brightness instead: a bright core over a
 * dark casing, which reads against a pale green fill at lightness 82 and against the basemap
 * alike. Major and county roads differ in brightness and width so the hierarchy is obvious
 * with both switched on.
 */
export const ROAD_COLOUR = '#ffffff';
export const ROAD_COUNTY_COLOUR = '#9fc6ef';
export const ROAD_CASING_COLOUR = '#0a0d11';

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
/** Seat markers for the two kinds of unit that no centre created. */
export const ORPHAN_SEAT_COLOUR = '#f0cf9a';
export const UNCHANGED_SEAT_COLOUR = '#c2c6cc';
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

export interface LabelPoint {
  index: number;
  x: number;
  y: number;
}

export interface MapHandle {
  map: MapLibreMap;
  /** Paint every UAT from a region assignment, in the given view mode. */
  applyAssignment: (
    regionOf: Uint16Array,
    colourOf: Uint8Array,
    tierOf: Int8Array,
    mode: ViewMode,
    costPerResident: Float32Array,
    costBreaks: number[],
  ) => void;
  setSelected: (index: number | null) => void;
  /** Outline one county's border, by two-letter code, or clear it with null. */
  setCountyFocus: (code: string | null) => void;
  /** Centre the map on a UAT's seat, wherever it is. */
  flyTo: (index: number) => void;
  onSelect: (handler: (index: number | null) => void) => void;
  /** Fires as the pointer moves over the map; index is null when it leaves. */
  onHover: (handler: (index: number | null, x: number, y: number) => void) => void;
  /** Fires after any pan or zoom settles. */
  onViewChange: (handler: () => void) => void;
  /** Current zoom level. */
  zoom: () => number;
  /**
   * Seat points currently on screen, with their pixel positions.
   *
   * Used for labelling. Labels are HTML rather than a MapLibre symbol layer because a
   * symbol layer needs glyph fonts, which would mean either depending on an external font
   * server at runtime or shipping font atlases — a lot of weight for a few dozen names.
   */
  visibleSeats: (accept: (index: number) => boolean, limit: number) => LabelPoint[];
  /** Show or hide a context layer. Roads are fetched the first time they are shown. */
  setOverlay: (overlay: Overlay, visible: boolean) => Promise<void>;
  /**
   * Mark the seat of every resulting unit.
   *
   * `kindOf` carries -1 for a commune that is not a seat, otherwise SEAT_KIND.
   */
  setCentres: (kindOf: Int8Array) => void;
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
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0.78],
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

  // The border of whichever county the pointer or the selection is in, always drawn.
  //
  // The county boundary is the hardest constraint in the model — nothing but Bucharest may
  // cross one — so knowing which county you are looking at explains more of the shape on
  // screen than any other single line. Independent of the counties overlay: this answers
  // "which county is this", not "where are all the counties".
  map.addLayer({
    id: 'county-focus-line',
    type: 'line',
    source: 'counties',
    filter: ['==', ['literal', ''], ''],
    paint: {
      'line-color': COUNTY_FOCUS_COLOUR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.2, 10, 3.4],
      'line-opacity': 0.95,
      'line-blur': 0.4,
    },
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
      // Capitals gold, other centres white, and anything that is not a centre hollow.
      //
      // A leftover is not an absorber and must not look like one. Casimcea is 2,555 people
      // that nothing could take — its neighbours are all in Constanta county and merging
      // with Babadag would breach the distance cap — so it ends up seating a unit of two and
      // getting a dot. Drawn in pale sand at 2.2 px against a centre's white at 3.4 px, that
      // dot was indistinguishable from a real centre and read as one. Hollow says "this is
      // where a unit is administered from", solid says "this town pulled its neighbours in",
      // and those are different claims.
      'circle-color': [
        'match',
        ['coalesce', ['feature-state', 'kind'], -1],
        SEAT_KIND.CAPITAL, CAPITAL_COLOUR,
        SEAT_KIND.CENTRE, SEAT_COLOUR,
        SEAT_KIND.ORPHAN, '#12161c',
        SEAT_KIND.UNCHANGED, '#12161c',
        'rgba(0,0,0,0)',
      ],
      // Orphan and unchanged seats are drawn smaller: they are the administration that
      // happens to survive, not a centre that pulled anything in, and at national zoom a
      // full-size marker on every one of them buries the centres that did.
      //
      // The zoom interpolation has to be the outermost expression — MapLibre rejects a
      // zoom curve nested inside `match`, and rejecting it invalidates the entire layer,
      // which is why every marker vanished rather than just resizing.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        6,
        [
          'match',
          ['coalesce', ['feature-state', 'kind'], -1],
          SEAT_KIND.CAPITAL, 4.2,
          SEAT_KIND.CENTRE, 3.4,
          2.2,
        ],
        10,
        [
          'match',
          ['coalesce', ['feature-state', 'kind'], -1],
          SEAT_KIND.CAPITAL, 9,
          SEAT_KIND.CENTRE, 7.5,
          5,
        ],
      ],
      'circle-stroke-color': [
        'match',
        ['coalesce', ['feature-state', 'kind'], -1],
        SEAT_KIND.ORPHAN, ORPHAN_SEAT_COLOUR,
        SEAT_KIND.UNCHANGED, UNCHANGED_SEAT_COLOUR,
        '#0f1216',
      ],
      'circle-stroke-width': [
        'match',
        ['coalesce', ['feature-state', 'kind'], -1],
        SEAT_KIND.ORPHAN, 1.8,
        SEAT_KIND.UNCHANGED, 1.8,
        1.4,
      ],
      'circle-opacity': ['case', ['>=', ['coalesce', ['feature-state', 'kind'], -1], 0], 1, 0],
      'circle-stroke-opacity': [
        'case', ['>=', ['coalesce', ['feature-state', 'kind'], -1], 0], 1, 0,
      ],
    },
  });

  const loadedOverlays = new Set<Overlay>();

  const setOverlay = async (overlay: Overlay, visible: boolean): Promise<void> => {
    // County and communal roads: the network the model routes most of its distances over.
    // Drawn thinner than the national roads and only once zoomed in, because at national
    // zoom 136,000 ways is a smear rather than information.
    if (overlay === 'countyRoads') {
      if (visible && !loadedOverlays.has('countyRoads')) {
        map.addSource('county-roads', {
          type: 'geojson',
          data: `${dataBase}roads-county.geojson`,
        });
        const countyWidth: ExpressionSpecification = [
          'interpolate',
          ['linear'],
          ['zoom'],
          6,
          0.7,
          9,
          1.5,
          12,
          2.6,
        ];
        map.addLayer(
          {
            id: 'county-roads-casing',
            type: 'line',
            source: 'county-roads',
            paint: {
              'line-color': ROAD_CASING_COLOUR,
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 9, 0.6],
              'line-width': ['+', countyWidth, 1.6],
            },
          },
          UAT_OUTLINE,
        );
        map.addLayer(
          {
            id: 'county-roads-line',
            type: 'line',
            source: 'county-roads',
            paint: {
              'line-color': ROAD_COUNTY_COLOUR,
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 9, 0.85, 12, 0.95],
              'line-width': countyWidth,
            },
          },
          UAT_OUTLINE,
        );
        loadedOverlays.add('countyRoads');
        return;
      }
      if (loadedOverlays.has('countyRoads')) {
        for (const id of ['county-roads-casing', 'county-roads-line']) {
          map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
      }
      return;
    }

    if (overlay === 'roads') {
      // Fetched on first use only: at 4.5 MB it is by far the largest artefact, and most
      // visits never turn it on.
      if (visible && !loadedOverlays.has('roads')) {
        map.addSource('roads', { type: 'geojson', data: `${dataBase}roads.geojson` });
        const majorWidth: ExpressionSpecification = [
          'interpolate',
          ['linear'],
          ['zoom'],
          6,
          ['match', ['get', 'highway'], 'motorway', 2.2, 'trunk', 1.7, 1.1],
          11,
          ['match', ['get', 'highway'], 'motorway', 4.6, 'trunk', 3.6, 2.4],
        ];
        map.addLayer(
          {
            id: 'roads-casing',
            type: 'line',
            source: 'roads',
            paint: {
              'line-color': ROAD_CASING_COLOUR,
              'line-opacity': 0.75,
              'line-width': ['+', majorWidth, 2],
            },
          },
          UAT_OUTLINE,
        );
        map.addLayer(
          {
            id: 'roads-line',
            type: 'line',
            source: 'roads',
            paint: {
              'line-color': ROAD_COLOUR,
              'line-opacity': 0.95,
              'line-width': majorWidth,
            },
          },
          UAT_OUTLINE,
        );
        loadedOverlays.add('roads');
        return;
      }
      if (loadedOverlays.has('roads')) {
        for (const id of ['roads-casing', 'roads-line']) {
          map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
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

  /** Outline one county, or none when `code` is null. */
  const setCountyFocus = (code: string | null): void => {
    map.setFilter(
      'county-focus-line',
      code === null
        ? ['==', ['literal', ''], 'x']
        : ['any', ['==', ['get', 'leftcode'], code], ['==', ['get', 'rightcode'], code]],
    );
  };

  const setCentres = (kindOf: Int8Array): void => {
    for (let i = 0; i < kindOf.length; i += 1) {
      map.setFeatureState({ source: 'seats', id: i }, { kind: kindOf[i] });
    }
  };

  let selected: number | null = null;
  const selectHandlers: ((index: number | null) => void)[] = [];
  const hoverHandlers: ((index: number | null, x: number, y: number) => void)[] = [];

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
    for (const handler of hoverHandlers) handler(null, 0, 0);
  });
  map.on('mousemove', FILL_LAYER, (event: MapMouseEvent & { features?: { id?: string | number }[] }) => {
    const id = typeof event.features?.[0]?.id === 'number' ? event.features[0].id : null;
    for (const handler of hoverHandlers) handler(id, event.point.x, event.point.y);
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
    colourOf: Uint8Array,
    tierOf: Int8Array,
    mode: ViewMode,
    costPerResident: Float32Array,
    costBreaks: number[],
  ): void => {
    for (let i = 0; i < regionOf.length; i += 1) {
      const region = regionOf[i]!;
      const isAbsorber = region === i && tierOf[i] !== -1;
      // The centre takes the same fill as everything it absorbed, so a resulting unit
      // reads as one shape rather than a ring around a differently-coloured hole. Which
      // commune is the centre is shown by the marker on top instead — that is what the
      // marker is for, and it does not cost the shape its legibility.
      const colour =
        mode === 'cost' ? costColour(costPerResident[i]!, costBreaks) : PALETTE[colourOf[i]!]!;
      // In "today" the map shows the 3,186 communes as they are, so nothing is a centre.
      map.setFeatureState(
        { source: SOURCE_ID, id: i },
        { colour, absorber: mode === 'regions' && isAbsorber },
      );
    }
    if (selected !== null) {
      map.setFeatureState({ source: SOURCE_ID, id: selected }, { selected: true });
    }
  };

  const viewHandlers: (() => void)[] = [];
  map.on('moveend', () => {
    for (const handler of viewHandlers) handler();
  });
  map.on('zoomend', () => {
    for (const handler of viewHandlers) handler();
  });

  /**
   * Seat coordinates by UAT index, fetched once on first use.
   *
   * `querySourceFeatures` cannot answer this: it only sees tiles currently loaded, so a
   * unit the user has never scrolled to is invisible to it — which is exactly the case
   * jumping from a list needs to handle.
   */
  let seatLngLat: Map<number, [number, number]> | null = null;
  let seatLoad: Promise<void> | null = null;
  const loadSeats = (): Promise<void> => {
    seatLoad ??= fetch(`${dataBase}seats.geojson`)
      .then((response) => response.json())
      .then((collection: { features: { id?: unknown; geometry: { type: string; coordinates: unknown } }[] }) => {
        seatLngLat = new Map();
        for (const feature of collection.features) {
          if (typeof feature.id !== 'number' || feature.geometry.type !== 'Point') continue;
          const [lng, lat] = feature.geometry.coordinates as [number, number];
          seatLngLat.set(feature.id as number, [lng, lat]);
        }
      })
      .catch(() => {
        // A failed jump is a non-event: the panel already changed, the map just does not move.
        seatLngLat = new Map();
      });
    return seatLoad;
  };

  const flyTo = (index: number): void => {
    void loadSeats().then(() => {
      const target = seatLngLat?.get(index);
      if (!target) return;
      map.flyTo({ center: target, zoom: Math.max(map.getZoom(), 8.5), duration: 800 });
    });
  };

  const visibleSeats = (accept: (index: number) => boolean, limit: number): LabelPoint[] => {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const out: LabelPoint[] = [];
    for (const feature of map.querySourceFeatures('seats')) {
      const id = typeof feature.id === 'number' ? feature.id : -1;
      if (id < 0 || !accept(id)) continue;
      const geometry = feature.geometry;
      if (geometry.type !== 'Point') continue;
      const [lng, lat] = geometry.coordinates as [number, number];
      const point = map.project([lng, lat]);
      // Margin so a label whose anchor is just off screen still appears, rather than
      // popping in only once its dot crosses the edge.
      if (point.x < -60 || point.y < -20 || point.x > width + 60 || point.y > height + 20) {
        continue;
      }
      out.push({ index: id, x: point.x, y: point.y });
      if (out.length >= limit) break;
    }
    return out;
  };

  return {
    map,
    applyAssignment,
    setSelected,
    setCountyFocus,
    flyTo,
    onSelect: (handler) => selectHandlers.push(handler),
    onHover: (handler) => hoverHandlers.push(handler),
    onViewChange: (handler) => viewHandlers.push(handler),
    zoom: () => map.getZoom(),
    visibleSeats,
    setOverlay,
    setCentres,
  };
}
