#!/usr/bin/env node
// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [P-3] Bench harness comparing the old (sync) git-status path vs the
// new async + Promise.all path. The point isn't raw throughput — git
// itself dominates wall time — but the BLOCKING characteristic of the
// old code: under N agents the broker's event loop stalled for
// agents.length × git-status latency, while the new code lets all
// spawns proceed concurrently and never holds the loop.
//
// Usage:
//   node scripts/bench/p3-list-modified.mjs            # 4 fake repos
//   node scripts/bench/p3-list-modified.mjs --agents 8 # other counts

import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const agentsArgIndex = args.indexOf('--agents');
const N_AGENTS = agentsArgIndex >= 0 ? parseInt(args[agentsArgIndex + 1], 10) : 4;
const ITERATIONS = 50;

function setupRepos(n) {
  const repos = [];
  for (let i = 0; i < n; i++) {
    const dir = mkdtempSync(join(tmpdir(), `acc-bench-p3-${i}-`));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email b@b.io', { cwd: dir });
    execSync('git config user.name b', { cwd: dir });
    // Seed enough modified files that git-status has real work to do.
    for (let f = 0; f < 50; f++) {
      writeFileSync(join(dir, `file-${f}.txt`), `init ${f}\n`);
    }
    execSync('git add .', { cwd: dir });
    execSync('git commit -q -m init', { cwd: dir });
    // Now mutate half the files — those become the actual diff.
    for (let f = 0; f < 25; f++) {
      writeFileSync(join(dir, `file-${f}.txt`), `changed ${f}\n`);
    }
    repos.push(dir);
  }
  return repos;
}

function tearDown(repos) {
  for (const r of repos) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// Old path: sequential execSync per repo (simulating pre-P-3 broker).
function gitModifiedFilesSync(cwd) {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const out = execSync('git status --porcelain', {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2500,
    });
    return out.split('\n').filter(line => line.length >= 3);
  } catch {
    return [];
  }
}

function syncRun(repos) {
  const out = [];
  for (const r of repos) {
    out.push(gitModifiedFilesSync(r));
  }
  return out;
}

// New path: async execFile + Promise.all (post-P-3).
async function gitModifiedFilesAsync(cwd) {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd, encoding: 'utf-8', timeout: 2500,
    });
    return stdout.split('\n').filter(line => line.length >= 3);
  } catch {
    return [];
  }
}

async function asyncRun(repos) {
  return Promise.all(repos.map(gitModifiedFilesAsync));
}

function fmtMs(ns) {
  return `${(ns / 1e6).toFixed(2)} ms`;
}

function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function summarize(label, samples) {
  const sorted = [...samples].sort((a, b) => Number(a - b));
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  const mean = samples.reduce((a, b) => a + Number(b), 0) / samples.length;
  console.log(
    `  ${label.padEnd(20)} median=${fmtMs(Number(median)).padStart(10)}` +
    `  p95=${fmtMs(Number(p95)).padStart(10)}` +
    `  p99=${fmtMs(Number(p99)).padStart(10)}` +
    `  mean=${fmtMs(mean).padStart(10)}`,
  );
}

async function main() {
  console.log(`[P-3] gitModifiedFiles bench — ${N_AGENTS} agents × ${ITERATIONS} iterations`);
  const repos = setupRepos(N_AGENTS);
  try {
    // Warm-up
    syncRun(repos);
    await asyncRun(repos);

    const syncSamples = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = process.hrtime.bigint();
      syncRun(repos);
      syncSamples.push(process.hrtime.bigint() - t0);
    }

    const asyncSamples = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = process.hrtime.bigint();
      await asyncRun(repos);
      asyncSamples.push(process.hrtime.bigint() - t0);
    }

    summarize('sync (sequential)', syncSamples);
    summarize('async (Promise.all)', asyncSamples);

    const syncMedian = Number([...syncSamples].sort((a, b) => Number(a - b))[Math.floor(syncSamples.length / 2)]);
    const asyncMedian = Number([...asyncSamples].sort((a, b) => Number(a - b))[Math.floor(asyncSamples.length / 2)]);
    const speedup = syncMedian / asyncMedian;
    console.log(`\n  Δ async vs sync (median wall): ${speedup.toFixed(2)}× faster`);
    console.log('  (Note: with N=1 agent the speedup is ~1× — the win compounds with N.)');
  } finally {
    tearDown(repos);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
