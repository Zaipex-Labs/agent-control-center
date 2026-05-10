#!/usr/bin/env node
// FASE A checkpoint benchmark: recall() latency at scale.
// Seeds 1000 decisions across mixed-content rows, then measures
// searchDecisions() over a representative query.
//
// Run: npx tsx scripts/bench/recall-latency.mjs
//
// The 100ms target is what tests/broker/database.test.ts pins; this
// harness produces a more readable report (median, p95, throughput)
// for the checkpoint deliverable.

import { performance } from 'node:perf_hooks';
import { initDatabase, setSharedStateWithMeta, searchDecisions } from '../../src/broker/database.ts';

initDatabase(':memory:');

const N = 1000;
const RUNS = 200;
const PROJECT = 'bench-proj';
const NS = 'decisions';

const corpus = [
  'use esm modules everywhere — never cjs',
  'auth uses jwt with 7-day rotation, refresh via /auth/refresh',
  'database is postgres 16, never sqlite for prod',
  'logs go to stderr in jsonl format',
  'every public function has a zod schema at the boundary',
  'lorem ipsum dolor sit amet consectetur adipiscing elit',
  'http client is native fetch — no axios, no got',
  'tests live in tests/<area>/, not co-located',
];

const now = '2026-05-10T12:00:00Z';
for (let i = 0; i < N; i++) {
  const v = corpus[i % corpus.length];
  setSharedStateWithMeta(PROJECT, NS, `key-${i}`, v, 'p1', now, {
    author_role: 'backend',
    author_peer_id: 'p1',
  });
}

console.log(`Seeded ${N} decisions in namespace "${NS}".`);

function bench(query, limit) {
  const samples = [];
  // Warmup
  for (let i = 0; i < 10; i++) searchDecisions(PROJECT, NS, query, limit);
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    searchDecisions(PROJECT, NS, query, limit);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const max = samples[samples.length - 1];
  return { median, p95, max };
}

const queries = [
  ['esm', 5],
  ['jwt', 5],
  ['postgres', 5],
  ['lorem', 5],          // worst-case: hits ~12.5% of rows
  ['nonexistent', 5],    // best-case: zero matches
];

console.log('\nQuery'.padEnd(16) + 'limit'.padStart(7) + 'median'.padStart(12) + 'p95'.padStart(10) + 'max'.padStart(10));
console.log('─'.repeat(55));
for (const [q, lim] of queries) {
  const r = bench(q, lim);
  console.log(
    String(`"${q}"`).padEnd(16) +
    String(lim).padStart(7) +
    `${r.median.toFixed(2)} ms`.padStart(12) +
    `${r.p95.toFixed(2)} ms`.padStart(10) +
    `${r.max.toFixed(2)} ms`.padStart(10),
  );
}

console.log(`\n${N} rows · ${RUNS} runs/query · target: median < 100 ms`);
