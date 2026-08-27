/**
 * The model, off the main thread.
 *
 * Recomputation has a 150 ms budget so slider drags feel continuous, and the main thread
 * has to stay free to paint. The worker owns the data and posts back a `Uint16Array` of
 * uat index → region index, transferred rather than copied.
 */

import { decode } from './load';
import { assignUnitColours } from './colour';
import { runModel } from './model';
import type { Attributes, Manifest, ModelData, Params } from './types';

export interface InitMessage {
  type: 'init';
  baseUrl: string;
}

export interface ComputeMessage {
  type: 'compute';
  params: Params;
  /** Echoed back so the UI can discard results that a later drag has superseded. */
  token: number;
}

export type Incoming = InitMessage | ComputeMessage;

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
  /**
   * Colours for the map as it is today, where every commune is its own unit.
   *
   * Computed once: today's map does not depend on any slider, so recomputing it on every
   * drag would be work that can never change the answer.
   */
  currentColourOf: Uint8Array;
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
  elapsedMs: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type Outgoing = ReadyMessage | ResultMessage | ErrorMessage;

// `self` in a module worker is a DedicatedWorkerGlobalScope, whose postMessage takes a
// transfer list. The DOM lib types it as Window, which has a different signature.
declare const self: DedicatedWorkerGlobalScope;

let data: ModelData | null = null;

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
      const identity = new Uint16Array(data.uatCount);
      for (let i = 0; i < data.uatCount; i += 1) identity[i] = i;
      const currentColourOf = assignUnitColours(data, identity, new Uint8Array(data.uatCount));

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
        currentColourOf,
      };
      self.postMessage(ready, [
        ready.population.buffer,
        ready.administrativeRon.buffer,
        ready.operatingRon.buffer,
        ready.developmentRon.buffer,
        ready.personnelRon.buffer,
        ready.adminPersonnelRon.buffer,
        ready.incomeRon.buffer,
        ready.currentColourOf.buffer,
      ]);
      return;
    }

    if (message.type === 'compute') {
      if (!data) throw new Error('compute before init');
      const started = performance.now();
      const result = runModel(data, message.params);

      // A unit is orphan-tier when its seat is not a centre: absorbed units are always
      // centred on one, clusters never are.
      const isOrphanUnit = new Uint8Array(data.uatCount);
      for (let i = 0; i < data.uatCount; i += 1) {
        const unit = result.regionOf[i]!;
        if (result.tierOf[unit] === -1) isOrphanUnit[unit] = 1;
      }
      const colourOf = assignUnitColours(data, result.regionOf, isOrphanUnit);
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
