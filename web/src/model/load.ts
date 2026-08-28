/**
 * Decode the binary payload emitted by `pipeline/export.py` into typed arrays.
 *
 * There is no parsing step for the numeric data: each buffer is viewed directly as the
 * typed array it already is. The only work done here is building the two compressed-row
 * indexes (neighbours, and candidacy per radius) that turn the model's inner loops into
 * bounds lookups instead of scans.
 */

import type { Attributes, Manifest, ModelData, RadiusSlice } from './types';

const U16 = Uint16Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const F32 = Float32Array.BYTES_PER_ELEMENT;

export interface RawPayload {
  manifest: Manifest;
  attributes: Attributes;
  attributesBin: ArrayBuffer;
  adjacencyBin: ArrayBuffer;
  candidacyBin: ArrayBuffer;
}

/**
 * Build the compressed-row offsets for a list of (row, value) pairs already sorted by row.
 *
 * Returns an array of length `rows + 1`, where slice `[start[i], start[i + 1])` holds
 * row `i`. Rows with no entries produce an empty slice rather than a gap.
 */
function rowOffsets(rowIndex: Uint16Array, rows: number): Uint32Array {
  const start = new Uint32Array(rows + 1);
  for (let i = 0; i < rowIndex.length; i += 1) {
    const row = rowIndex[i]! + 1;
    start[row] = start[row]! + 1;
  }
  for (let r = 0; r < rows; r += 1) {
    start[r + 1] = start[r + 1]! + start[r]!;
  }
  return start;
}

export function decode(raw: RawPayload): ModelData {
  const { manifest, attributes } = raw;
  const n = manifest.uatCount;

  // attributes.bin: population u32 | seatX f32 | seatY f32 | admin f32 | operating f32
  let offset = 0;
  const population = new Uint32Array(raw.attributesBin, offset, n);
  offset += n * U32;
  const seatX = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const seatY = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  // Finance series follow in the order the manifest records, one float32 block each.
  const administrativeRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const operatingRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const developmentRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const personnelRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const adminPersonnelRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const incomeRon = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const areaKm2 = new Float32Array(raw.attributesBin, offset, n);
  offset += n * F32;
  const perimeterKm = new Float32Array(raw.attributesBin, offset, n);

  // Intern county codes so the "same county" test in the inner loop is an integer
  // comparison rather than a string comparison.
  const countyCodes: string[] = [];
  const countyIndex = new Map<string, number>();
  const countyOf = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const code = attributes.county[i]!;
    let idx = countyIndex.get(code);
    if (idx === undefined) {
      idx = countyCodes.length;
      countyCodes.push(code);
      countyIndex.set(code, idx);
    }
    countyOf[i] = idx;
  }

  // adjacency.bin: a u16[] | b u16[] | roadM f32[] | traversable u8[].
  //
  // Every shared border ships, whether a road crosses it or not, sorted so the traversable
  // ones come first. The model walks only those — it cannot grow over a border with no road
  // — while the colouring needs all of them, because two units that touch on screen must not
  // be given the same colour whether or not a road joins them.
  const allEdges = manifest.edgeCount;
  const edgeA = new Uint16Array(raw.adjacencyBin, 0, allEdges);
  const edgeB = new Uint16Array(raw.adjacencyBin, allEdges * U16, allEdges);
  const edgeRoad = new Float32Array(raw.adjacencyBin, allEdges * U16 * 2, allEdges);
  const edgeShared = new Float32Array(raw.adjacencyBin, allEdges * U16 * 2 + allEdges * 4, allEdges);
  const edgeTraversable = new Uint8Array(
    raw.adjacencyBin,
    allEdges * U16 * 2 + allEdges * 8,
    allEdges,
  );

  // Traversable first in the file, so the model's edge count is just the length of that run.
  let edges = 0;
  while (edges < allEdges && edgeTraversable[edges] === 1) edges += 1;

  const degree = new Uint32Array(n);
  for (let e = 0; e < edges; e += 1) {
    const a = edgeA[e]!;
    const b = edgeB[e]!;
    degree[a] = degree[a]! + 1;
    degree[b] = degree[b]! + 1;
  }
  const neighbourStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    neighbourStart[i + 1] = neighbourStart[i]! + degree[i]!;
  }
  const cursor = neighbourStart.slice(0, n);
  const neighbours = new Uint16Array(edges * 2);
  const neighbourRoadM = new Float32Array(edges * 2);
  for (let e = 0; e < edges; e += 1) {
    const a = edgeA[e]!;
    const b = edgeB[e]!;
    const metres = edgeRoad[e]!;
    neighbours[cursor[a]!] = b;
    neighbourRoadM[cursor[a]!] = metres;
    cursor[a] = cursor[a]! + 1;
    neighbours[cursor[b]!] = a;
    neighbourRoadM[cursor[b]!] = metres;
    cursor[b] = cursor[b]! + 1;
  }
  // The Python reference iterates neighbours in SIRUTA order, which is index order here.
  // Sorted together with their distances, so the two arrays stay aligned — sorting the
  // neighbour row alone would silently pair each neighbour with the wrong distance.
  for (let i = 0; i < n; i += 1) {
    const from = neighbourStart[i]!;
    const to = neighbourStart[i + 1]!;
    const pairs = [];
    for (let e = from; e < to; e += 1) pairs.push([neighbours[e]!, neighbourRoadM[e]!] as const);
    pairs.sort((x, y) => x[0] - y[0]);
    for (let k = 0; k < pairs.length; k += 1) {
      neighbours[from + k] = pairs[k]![0];
      neighbourRoadM[from + k] = pairs[k]![1];
    }
  }

  // The touching graph, over every shared border. Used only for colouring.
  const touchDegree = new Uint32Array(n);
  for (let e = 0; e < allEdges; e += 1) {
    touchDegree[edgeA[e]!] = touchDegree[edgeA[e]!]! + 1;
    touchDegree[edgeB[e]!] = touchDegree[edgeB[e]!]! + 1;
  }
  const touchStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i += 1) touchStart[i + 1] = touchStart[i]! + touchDegree[i]!;
  const touchCursor = touchStart.slice(0, n);
  const touching = new Uint16Array(allEdges * 2);
  const touchingSharedKm = new Float32Array(allEdges * 2);
  for (let e = 0; e < allEdges; e += 1) {
    const a = edgeA[e]!;
    const b = edgeB[e]!;
    const shared = edgeShared[e]!;
    touching[touchCursor[a]!] = b;
    touchingSharedKm[touchCursor[a]!] = shared;
    touchCursor[a] = touchCursor[a]! + 1;
    touching[touchCursor[b]!] = a;
    touchingSharedKm[touchCursor[b]!] = shared;
    touchCursor[b] = touchCursor[b]! + 1;
  }

  // candidacy.bin: per radius, absorber u16[] | target u16[] | overlap u8[] | seat u8[]
  const byRadius = new Map<number, RadiusSlice>();
  const absorberSeen = new Set<number>();
  for (const radius of manifest.radiusGrid) {
    const block = manifest.candidacyByRadius[String(radius)];
    if (!block) continue;
    const { start, count } = block;
    // Every radius block is laid out contiguously, but the four arrays within a block are
    // not adjacent to the same arrays of other blocks, so offsets are computed per block
    // from the global cursor the exporter used.
    const base = start * (U16 * 2 + 2);
    const absorber = new Uint16Array(raw.candidacyBin, base, count);
    const target = new Uint16Array(raw.candidacyBin, base + count * U16, count);
    const overlap = new Uint8Array(raw.candidacyBin, base + count * U16 * 2, count);
    const seatInside = new Uint8Array(raw.candidacyBin, base + count * U16 * 2 + count, count);

    for (let i = 0; i < count; i += 1) absorberSeen.add(absorber[i]!);

    byRadius.set(radius, {
      target,
      overlap,
      seatInside,
      rowStart: rowOffsets(absorber, n),
    });
  }

  // The capital of each county, and Bucharest, resolved once. `isCapital` in the payload
  // marks county capitals; Bucharest is identified by its county rather than by the flag,
  // because its six sectors are merged into one centre rather than competing as six.
  const capitalOfCounty = new Map<number, number>();
  const bucharestSectors: number[] = [];
  let bucharestIndex = -1;
  let bucharestCounty = -1;
  let ilfovCounty = -1;
  for (let i = 0; i < n; i += 1) {
    if (attributes.county[i] === 'IF') ilfovCounty = countyOf[i]!;
    if (attributes.county[i] === 'B') {
      bucharestSectors.push(i);
      if (bucharestIndex === -1) {
        bucharestIndex = i;
        bucharestCounty = countyOf[i]!;
      }
      continue;
    }
    if (attributes.isCapital[i] && !capitalOfCounty.has(countyOf[i]!)) {
      capitalOfCounty.set(countyOf[i]!, i);
    }
  }

  return {
    manifest,
    attributes,
    uatCount: n,
    population,
    seatX,
    seatY,
    administrativeRon,
    operatingRon,
    developmentRon,
    personnelRon,
    adminPersonnelRon,
    incomeRon,
    countyOf,
    countyCodes,
    capitalOfCounty,
    bucharestIndex,
    bucharestCounty,
    bucharestSectors,
    ilfovCounty,
    neighbours,
    neighbourRoadM,
    touching,
    touchStart,
    touchingSharedKm,
    areaKm2,
    perimeterKm,
    neighbourStart,
    byRadius,
    absorbers: Uint16Array.from([...absorberSeen].sort((a, b) => a - b)),
  };
}
