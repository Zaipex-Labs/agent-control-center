#!/usr/bin/env node
// Benchmark for audit hallazgo P-1.
// Question: does re-preparing better-sqlite3 statements per call cost
// measurably more than caching them once?
//
// Setup mirrors handlePollMessages' hot statement (selectUndelivered)
// and a representative write (markDelivered) on a fresh in-memory DB
// loaded with 10,000 undelivered messages spread across 4 to-peers.
//
// Run: node scripts/bench/p1-prepared-stmt.mjs

import Database from 'better-sqlite3';

const ROWS = 10_000;
const ITERATIONS = 1_000;
const TO_PEERS = ['p-alice', 'p-bob', 'p-carol', 'p-dave'];

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function median(arr) {
  return pct(arr, 50);
}

function fmt(ns) {
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)} µs`;
  return `${(ns / 1_000_000).toFixed(3)} ms`;
}

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'message',
      text TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      thread_id TEXT
    );
    CREATE INDEX idx_messages_to ON messages(to_id, delivered);
  `);

  const insert = db.prepare(`
    INSERT INTO messages (project_id, from_id, to_id, type, text, sent_at, delivered)
    VALUES (?, ?, ?, 'message', ?, ?, 0)
  `);
  const fill = db.transaction((rows) => {
    for (const r of rows) insert.run(...r);
  });
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < ROWS; i++) {
    const to = TO_PEERS[i % TO_PEERS.length];
    rows.push([
      'proj-1',
      'p-sender',
      to,
      `msg ${i}`,
      new Date(now - (ROWS - i) * 1000).toISOString(),
    ]);
  }
  fill(rows);
  return db;
}

function bench(label, fn) {
  // Warm-up
  for (let i = 0; i < 50; i++) fn(i);

  const samples = new Float64Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    fn(i);
    const t1 = process.hrtime.bigint();
    samples[i] = Number(t1 - t0);
  }
  const arr = Array.from(samples);
  const med = median(arr);
  const p95 = pct(arr, 95);
  const p99 = pct(arr, 99);
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return { label, med, p95, p99, mean };
}

function report(name, results) {
  console.log(`\n--- ${name} ---`);
  console.log(
    'label                    median       p95         p99         mean'
  );
  for (const r of results) {
    console.log(
      `${r.label.padEnd(24)} ${fmt(r.med).padEnd(12)} ${fmt(r.p95).padEnd(11)} ${fmt(r.p99).padEnd(11)} ${fmt(r.mean)}`
    );
  }
  if (results.length === 2) {
    const [a, b] = results;
    const deltaMed = ((a.med - b.med) / b.med) * 100;
    const deltaP95 = ((a.p95 - b.p95) / b.p95) * 100;
    const deltaP99 = ((a.p99 - b.p99) / b.p99) * 100;
    console.log(
      `Δ (re-prepare vs cached): median ${deltaMed.toFixed(1)}%  p95 ${deltaP95.toFixed(1)}%  p99 ${deltaP99.toFixed(1)}%`
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// Read-side: SELECT … WHERE to_id = ? AND delivered = 0
// ──────────────────────────────────────────────────────────────────
{
  const db = setupDb();
  const SQL = `
    SELECT id, project_id, from_id, to_id, type, text, sent_at, thread_id
    FROM messages WHERE to_id = ? AND delivered = 0
    ORDER BY id ASC LIMIT 100
  `;
  const cached = db.prepare(SQL);

  const reprep = bench('reprep selectUndeliv', (i) => {
    const stmt = db.prepare(SQL);
    return stmt.all(TO_PEERS[i % TO_PEERS.length]);
  });
  const oncePr = bench('cached selectUndeliv', (i) => {
    return cached.all(TO_PEERS[i % TO_PEERS.length]);
  });
  report('selectUndelivered (read, returns ~2500 rows per peer)', [
    reprep,
    oncePr,
  ]);
  db.close();
}

// ──────────────────────────────────────────────────────────────────
// Read-side: SELECT … WHERE to_id = ? AND delivered = 0 LIMIT 10
// (more realistic poll: small page)
// ──────────────────────────────────────────────────────────────────
{
  const db = setupDb();
  const SQL = `
    SELECT id, project_id, from_id, to_id, type, text, sent_at, thread_id
    FROM messages WHERE to_id = ? AND delivered = 0
    ORDER BY id ASC LIMIT 10
  `;
  const cached = db.prepare(SQL);

  const reprep = bench('reprep selectUnd-LIMIT10', (i) => {
    const stmt = db.prepare(SQL);
    return stmt.all(TO_PEERS[i % TO_PEERS.length]);
  });
  const oncePr = bench('cached selectUnd-LIMIT10', (i) => {
    return cached.all(TO_PEERS[i % TO_PEERS.length]);
  });
  report('selectUndelivered LIMIT 10 (realistic poll page)', [reprep, oncePr]);
  db.close();
}

// ──────────────────────────────────────────────────────────────────
// Write-side: UPDATE messages SET delivered=1 WHERE id IN (…)
// markDelivered uses a parameterized "?,?,?,…" variadic — re-preparing
// is forced anyway when the IN-list size changes. We bench the
// fixed-size case (10 ids) only.
// ──────────────────────────────────────────────────────────────────
{
  const db = setupDb();
  const SQL = `UPDATE messages SET delivered = 1 WHERE id IN (?,?,?,?,?,?,?,?,?,?)`;
  const cached = db.prepare(SQL);

  // Pre-fetch ids to mark; re-mark same rows is a no-op for correctness
  const ids = db
    .prepare('SELECT id FROM messages WHERE to_id = ? LIMIT 10')
    .all('p-alice')
    .map((r) => r.id);

  const reprep = bench('reprep markDelivered', () => {
    const stmt = db.prepare(SQL);
    return stmt.run(...ids);
  });
  const oncePr = bench('cached markDelivered', () => {
    return cached.run(...ids);
  });
  report('markDelivered IN(?…?) 10 ids (write)', [reprep, oncePr]);
  db.close();
}

// ──────────────────────────────────────────────────────────────────
// Microbench: just db.prepare() with no .run/.all — isolates the
// prepare cost itself.
// ──────────────────────────────────────────────────────────────────
{
  const db = setupDb();
  const SQL = `
    SELECT id, project_id, from_id, to_id, type, text, sent_at, thread_id
    FROM messages WHERE to_id = ? AND delivered = 0
    ORDER BY id ASC LIMIT 10
  `;
  const reprep = bench('db.prepare() only', () => db.prepare(SQL));
  console.log(
    `\n--- prepare() cost in isolation ---\n  ${reprep.label}: median ${fmt(reprep.med)}  p95 ${fmt(reprep.p95)}  p99 ${fmt(reprep.p99)}  mean ${fmt(reprep.mean)}`
  );
  db.close();
}

console.log('\nDone.');
