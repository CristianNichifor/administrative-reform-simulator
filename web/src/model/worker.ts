/**
 * The model, off the main thread.
 *
 * Recomputation has a 150 ms budget so slider drags feel continuous, and the main thread
 * has to stay free to paint. The worker owns the data and posts back a `Uint16Array` of
 * uat index → region index, transferred rather than copied.
 */

import { decode } from './load';
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
  attributes: Attributes;
  population: Uint32Array;
  administrativeRon: Float32Array;
  operatingRon: Float32Array;
}

export interface ResultMessage {
  type: 'result';
  token: number;
  regionOf: Uint16Array;
  tierOf: Int8Array;
  regions: number;
  seeds: number;
  orphanRegions: number;
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
      const ready: ReadyMessage = {
        type: 'ready',
        uatCount: data.uatCount,
        attributes: data.attributes,
        // Copies, because the worker keeps using its own views afterwards.
        population: data.population.slice(),
        administrativeRon: data.administrativeRon.slice(),
        operatingRon: data.operatingRon.slice(),
      };
      self.postMessage(ready, [
        ready.population.buffer,
        ready.administrativeRon.buffer,
        ready.operatingRon.buffer,
      ]);
      return;
    }

    if (message.type === 'compute') {
      if (!data) throw new Error('compute before init');
      const started = performance.now();
      const result = runModel(data, message.params);
      const elapsedMs = performance.now() - started;

      const payload: ResultMessage = {
        type: 'result',
        token: message.token,
        regionOf: result.regionOf,
        tierOf: result.tierOf,
        regions: result.regions,
        seeds: result.seeds,
        orphanRegions: result.orphanRegions,
        savingsAdminRon: result.savingsAdminRon,
        savingsOperatingRon: result.savingsOperatingRon,
        underSeededCounties: result.underSeededCounties,
        elapsedMs,
      };
      // Transferred, not copied: 3,186 entries is small, but the transfer keeps the main
      // thread from doing structured-clone work on every frame of a drag.
      self.postMessage(payload, [payload.regionOf.buffer, payload.tierOf.buffer]);
    }
  } catch (error) {
    const failure: ErrorMessage = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(failure);
  }
};
