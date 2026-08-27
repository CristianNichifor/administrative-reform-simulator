import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { decode } from '../src/model/load';
import { runModel } from '../src/model/model';
import { DEFAULT_PARAMS } from '../src/model/types';
const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../public/data');
const rb = (n: string) => { const b = readFileSync(resolve(dir, n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const rj = (n: string) => JSON.parse(readFileSync(resolve(dir, n), 'utf8'));
/**
 * The brief's 150 ms recompute budget, so slider drags stay continuous.
 *
 * This exists because the budget was quietly broken: ring-based growth, the rebalancing pass
 * and the settle loop each ask for road distances from a seat, and recomputing them took the
 * model to 353 ms. They depend only on the road graph, never on the assignment, so they are
 * cached per dataset — 26 ms. A generous ceiling here, because CI machines vary; the point is
 * to catch a return to hundreds of milliseconds, not to police tens.
 */
it('recomputes inside the budget', () => {
  const data = decode({ manifest: rj('manifest.json'), attributes: rj('attributes.json'), attributesBin: rb('attributes.bin'), adjacencyBin: rb('adjacency.bin'), candidacyBin: rb('candidacy.bin') });
  runModel(data, DEFAULT_PARAMS);
  const times: number[] = [];
  for (let k = 0; k < 7; k++) { const t = performance.now(); runModel(data, DEFAULT_PARAMS); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const median = times[3]!;
  console.log(`median ${median.toFixed(0)} ms, best ${times[0]!.toFixed(0)} ms, worst ${times[6]!.toFixed(0)} ms`);
  expect(median).toBeLessThan(150);
});
