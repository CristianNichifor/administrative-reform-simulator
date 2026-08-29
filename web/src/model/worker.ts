/**
 * The model, off the main thread.
 *
 * Recomputation has a 150 ms budget so slider drags feel continuous, and the main thread
 * has to stay free to paint. The worker owns the data and posts back a `Uint16Array` of
 * uat index → region index, transferred rather than copied.
 */

import { decode } from './load';
import { assignUnitColours } from './colour';
import { countyRoadDistances, mergeBlocker, runModel } from './model';
import type { Attributes, Manifest, ModelData, Params, Pin } from './types';

export interface InitMessage {
  type: 'init';
  baseUrl: string;
}

export interface ComputeMessage {
  type: 'compute';
  /** Manual overrides applied after the rules run. Absent or empty means none. */
  pins?: Pin[];
  params: Params;
  /** Echoed back so the UI can discard results that a later drag has superseded. */
  token: number;
}

/**
 * Ask why a set of units could not merge.
 *
 * Answered on demand rather than shipped with every result: each answer is a Dijkstra
 * inside one county, and the audit list is opened occasionally while the sliders move
 * continuously.
 */
export interface ExplainMessage {
  type: 'explain';
  seats: number[];
}

/**
 * Road distance from a commune to the seats of the units around it.
 *
 * Answers the question the map cannot: why is Hamcearca under Topolog rather than Isaccea?
 * Asked on hover rather than shipped with every result, because it is one Dijkstra per
 * commune looked at and nobody looks at more than a few.
 */
export interface SeatDistanceMessage {
  type: 'seatDistances';
  uat: number;
}

export type Incoming = InitMessage | ComputeMessage | ExplainMessage | SeatDistanceMessage;

export interface SeatDistanceResultMessage {
  type: 'seat-distances';
  uat: number;
  /** Nearest first; `own` marks the unit it actually belongs to. */
  seats: { seat: number; metres: number; own: boolean }[];
}

export interface ExplainResultMessage {
  type: 'explain-result';
  blockers: {
    seat: number;
    kind: 'no-county-neighbour' | 'capital-only' | 'county-minimum' | 'cap';
    metres: number;
    units: number;
  }[];
}

export interface ReadyMessage {
  type: 'ready';
  uatCount: number;
  adminCostBreaks: number[];
  attributes: Attributes;
  population: Uint32Array;
  administrativeRon: Float32Array;
  operatingRon: Float32Array;
  developmentRon: Float32Array;
  personnelRon: Float32Array;
  adminPersonnelRon: Float32Array;
  incomeRon: Float32Array;
  /** Land area per UAT, for the hover card: how much ground a unit actually covers. */
  areaKm2: Float32Array;
  /**
   * Colours for the map as it is today, where every commune is its own unit.
   *
   * Computed once: today's map does not depend on any slider, so recomputing it on every
   * drag would be work that can never change the answer.
   */
  currentColourOf: Uint8Array;
  /** County code to full name, for the panel. */
  countyNames: Record<string, string>;
}

export interface ResultMessage {
  type: 'result';
  token: number;
  regionOf: Uint16Array;
  /** Palette index per UAT, chosen so no two touching units match. */
  colourOf: Uint8Array;
  reasonOf: Uint8Array;
  overlapOf: Uint8Array;
  tierOf: Int8Array;
  regions: number;
  seeds: number;
  orphanRegions: number;
  belowTarget: number;
  savingsAdminRon: number;
  savingsOperatingRon: number;
  underSeededCounties: string[];
  pinsApplied: Pin[];
  pinsRejected: { pin: Pin; why: 'not-a-seat' | 'county' | 'already-there' }[];
  splitUnits: number[];
  elapsedMs: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type Outgoing =
  | ReadyMessage
  | ResultMessage
  | ErrorMessage
  | ExplainResultMessage
  | SeatDistanceResultMessage;

// `self` in a module worker is a DedicatedWorkerGlobalScope, whose postMessage takes a
// transfer list. The DOM lib types it as Window, which has a different signature.
declare const self: DedicatedWorkerGlobalScope;

let data: ModelData | null = null;
let lastRegionOf: Uint16Array | null = null;
let lastParams: Params | null = null;

async function load(baseUrl: string): Promise<ModelData> {
  const get = async (name: string): Promise<Response> => {
    const response = await fetch(`${baseUrl}${name}`);
    if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
    return response;
  };

  const [manifest, attributes, attributesBin, adjacencyBin, candidacyBin] = await Promise.all([
    get('manifest.json').then((r) => r.json() as Promise<Manifest>),
    get('attributes.json').then((r) => r.json() as Promise<Attributes>),
    get('attributes.bin').then((r) => r.arrayBuffer()),
    get('adjacency.bin').then((r) => r.arrayBuffer()),
    get('candidacy.bin').then((r) => r.arrayBuffer()),
  ]);

  return decode({ manifest, attributes, attributesBin, adjacencyBin, candidacyBin });
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      data = await load(message.baseUrl);
      // Identity assignment: each commune is its own unit, coloured so neighbours differ.
      // The county rule cannot hold here — a county has eighty communes — so this falls back
      // to the touching rule, which is the only one that means anything on today's map.
      const identity = new Uint16Array(data.uatCount);
      for (let i = 0; i < data.uatCount; i += 1) identity[i] = i;
      const currentColourOf = assignUnitColours(data, identity);

      const ready: ReadyMessage = {
        type: 'ready',
        uatCount: data.uatCount,
        adminCostBreaks: data.manifest.adminCostBreaks,
        attributes: data.attributes,
        // Copies, because the worker keeps using its own views afterwards.
        population: data.population.slice(),
        administrativeRon: data.administrativeRon.slice(),
        operatingRon: data.operatingRon.slice(),
        developmentRon: data.developmentRon.slice(),
        personnelRon: data.personnelRon.slice(),
        adminPersonnelRon: data.adminPersonnelRon.slice(),
        incomeRon: data.incomeRon.slice(),
        areaKm2: data.areaKm2.slice(),
        currentColourOf,
        countyNames: data.manifest.countyNames ?? {},
      };
      self.postMessage(ready, [
        ready.population.buffer,
        ready.administrativeRon.buffer,
        ready.operatingRon.buffer,
        ready.developmentRon.buffer,
        ready.personnelRon.buffer,
        ready.adminPersonnelRon.buffer,
        ready.incomeRon.buffer,
        ready.areaKm2.buffer,
        ready.currentColourOf.buffer,
      ]);
      return;
    }

    if (message.type === 'seatDistances') {
      if (!data || !lastRegionOf || !lastParams) return;
      const uat = message.uat;
      const county = data.countyOf[uat]!;
      const own = lastRegionOf[uat]!;
      const seats = new Set<number>();
      for (let i = 0; i < data.uatCount; i += 1) {
        if (data.countyOf[i] === county) seats.add(lastRegionOf[i]!);
      }
      const rows: SeatDistanceResultMessage['seats'] = [];
      for (const seat of seats) {
        const metres = countyRoadDistances(data, data.countyOf[seat]!, [seat]).get(uat);
        if (metres === undefined || !Number.isFinite(metres)) continue;
        rows.push({ seat, metres, own: seat === own });
      }
      rows.sort((a, b) => a.metres - b.metres);
      self.postMessage({
        type: 'seat-distances',
        uat,
        seats: rows.slice(0, 5),
      } satisfies SeatDistanceResultMessage);
      return;
    }

    if (message.type === 'explain') {
      if (!data || !lastRegionOf || !lastParams) return;
      const blockers: ExplainResultMessage['blockers'] = [];
      for (const seat of message.seats) {
        const blocker = mergeBlocker(data, lastParams, lastRegionOf, seat);
        if (!blocker) continue;
        blockers.push({
          seat,
          kind: blocker.kind,
          metres: blocker.kind === 'cap' ? blocker.metres : 0,
          units: blocker.kind === 'county-minimum' ? blocker.units : 0,
        });
      }
      self.postMessage({ type: 'explain-result', blockers } satisfies ExplainResultMessage);
      return;
    }

    if (message.type === 'compute') {
      if (!data) throw new Error('compute before init');
      const started = performance.now();
      const result = runModel(data, message.params, message.pins ?? []);
      // Kept because the assignment below is transferred, not copied, and `explain` needs
      // to know what the current map actually is.
      lastRegionOf = result.regionOf.slice();
      lastParams = message.params;

      // A unit is orphan-tier when its seat is not a centre: absorbed units are always
      // centred on one, clusters never are.
      const isOrphanUnit = new Uint8Array(data.uatCount);
      for (let i = 0; i < data.uatCount; i += 1) {
        const unit = result.regionOf[i]!;
        if (result.tierOf[unit] === -1) isOrphanUnit[unit] = 1;
      }
      const colourOf = assignUnitColours(data, result.regionOf);
      const elapsedMs = performance.now() - started;

      const payload: ResultMessage = {
        type: 'result',
        token: message.token,
        regionOf: result.regionOf,
        colourOf,
        reasonOf: result.reasonOf,
        overlapOf: result.overlapOf,
        tierOf: result.tierOf,
        regions: result.regions,
        seeds: result.seeds,
        orphanRegions: result.orphanRegions,
        belowTarget: result.belowTarget,
        savingsAdminRon: result.savingsAdminRon,
        savingsOperatingRon: result.savingsOperatingRon,
        underSeededCounties: result.underSeededCounties,
        pinsApplied: result.pinsApplied,
        pinsRejected: result.pinsRejected,
        splitUnits: result.splitUnits,
        elapsedMs,
      };
      // Transferred, not copied: 3,186 entries is small, but the transfer keeps the main
      // thread from doing structured-clone work on every frame of a drag.
      self.postMessage(payload, [
        payload.regionOf.buffer,
        payload.colourOf.buffer,
        payload.reasonOf.buffer,
        payload.overlapOf.buffer,
        payload.tierOf.buffer,
      ]);
    }
  } catch (error) {
    const failure: ErrorMessage = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(failure);
  }
};
