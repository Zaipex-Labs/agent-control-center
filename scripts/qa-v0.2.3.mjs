#!/usr/bin/env node
// QA pass for v0.2.3 security quick-wins. Captures both the baseline
// dashboard screenshots and active-verification artifacts that prove
// each fix works end-to-end.
//
// Usage:
//   ACC_PORT=7919 node scripts/qa-v0.2.3.mjs
//
// Prereq: a broker running at http://127.0.0.1:$ACC_PORT (defaults to
// 7899). The script seeds two projects (`demo`, `empty-project`) if
// they don't exist so the project-desktop screenshots have content.

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';
import { createServer } from 'node:http';

const PORT = Number(process.env.ACC_PORT ?? 7899);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve(process.cwd(), 'docs/audits/v0.2.3-security');
const SHOTS = join(OUT, 'screenshots');
const EV = join(OUT, 'evidence');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(EV, { recursive: true });

const log = (...a) => console.log(...a);

// ── 1. Baseline screenshots via puppeteer ──────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

async function snap(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function visit(url, waitMs = 800) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, waitMs));
}

await visit(`${BASE}/`);
await snap('teams-desktop');

await page.setViewport({ width: 390, height: 844 });
await visit(`${BASE}/`);
await snap('teams-mobile');

await page.setViewport({ width: 1440, height: 900 });
await visit(`${BASE}/demo`);
await snap('project-desktop');

await visit(`${BASE}/empty-project`);
await snap('project-empty-desktop');

await visit(`${BASE}/demo/history`);
await snap('history-desktop');

log('[base] screenshots written →', SHOTS);

// ── 2. Active verification ─────────────────────────────────────────

// Helper: raw HTTP request that lets us override Host / Origin / CT.
function rawPost(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(body).toString(),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fmt(label, req, res) {
  return [
    `# ${label}`,
    '',
    `# request →`,
    `POST ${req.path} HTTP/1.1`,
    `Host: ${req.headers.Host ?? '127.0.0.1:' + PORT}`,
    ...(req.headers.Origin ? [`Origin: ${req.headers.Origin}`] : []),
    ...(req.headers['Content-Type'] ? [`Content-Type: ${req.headers['Content-Type']}`] : []),
    '',
    req.body,
    '',
    '',
    `# response ←`,
    `HTTP/1.1 ${res.status}`,
    `Content-Type: ${res.headers['content-type'] ?? '-'}`,
    '',
    res.body,
    '',
  ].join('\n');
}

// QW-1a: CSRF blocked by Content-Type gate
{
  const reqInfo = {
    path: '/api/project/delete',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ project_id: 'demo' }),
  };
  const res = await rawPost(reqInfo.path, reqInfo.headers, reqInfo.body);
  writeFileSync(join(EV, 'csrf-blocked-ct.txt'), fmt(
    'csrf-blocked-ct — POST with Content-Type: text/plain rejected with 415 [QW-1]',
    reqInfo,
    res,
  ));
  log(`[QW-1a] CSRF text/plain → ${res.status} ${res.status === 415 ? '✓' : '✗ FAIL'}`);
}

// QW-1b: CSRF blocked by Origin gate
{
  const reqInfo = {
    path: '/api/project/delete',
    headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.com' },
    body: JSON.stringify({ project_id: 'demo' }),
  };
  const res = await rawPost(reqInfo.path, reqInfo.headers, reqInfo.body);
  writeFileSync(join(EV, 'csrf-blocked-origin.txt'), fmt(
    'csrf-blocked-origin — POST with external Origin rejected with 403 [QW-1]',
    reqInfo,
    res,
  ));
  log(`[QW-1b] CSRF external Origin → ${res.status} ${res.status === 403 ? '✓' : '✗ FAIL'}`);
}

// QW-3: set_role: 'arquitectura' blocked
{
  // Need a registered peer to drive set_role on. Register one first.
  const reg = await rawPost(
    '/api/register',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ pid: process.pid, cwd: '/tmp', role: 'qa', project_id: 'demo' }),
  );
  const peer = JSON.parse(reg.body);

  const reqInfo = {
    path: '/api/set-role',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: peer.id, role: 'arquitectura' }),
  };
  const res = await rawPost(reqInfo.path, reqInfo.headers, reqInfo.body);
  writeFileSync(join(EV, 'set-role-blocked.txt'), fmt(
    `set-role-blocked — peer ${peer.id} (role=qa) tries to self-promote to arquitectura — rejected with 403 [QW-3]`,
    reqInfo,
    res,
  ));
  log(`[QW-3]   set_role arquitectura → ${res.status} ${res.status === 403 ? '✓' : '✗ FAIL'}`);
}

// QW-2a: WS-hijack via node ws client with an explicit external
// Origin header. Browsers cannot forge their Origin (they always send
// location.origin), but a non-browser attacker can — and SECURITY.md
// explicitly lists "Origin = remote attacker" as the threat. The
// audit policy (line 103) requires exactly this rejection.
async function probeWs(origin, label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal/backend?project=demo`, {
      headers: { Origin: origin },
    });
    let upgradeStatus = null;
    ws.on('upgrade', (msg) => { upgradeStatus = msg.statusCode; });
    ws.on('unexpected-response', (_req, msg) => {
      upgradeStatus = msg.statusCode;
      ws.terminate();
      resolve({ label, origin, opened: false, upgradeStatus });
    });
    ws.on('open', () => {
      ws.close();
      resolve({ label, origin, opened: true, upgradeStatus });
    });
    ws.on('error', () => resolve({ label, origin, opened: false, upgradeStatus }));
    ws.on('close', (code) => resolve({ label, origin, opened: false, upgradeStatus, closeCode: code }));
  });
}

const probes = [
  await probeWs('http://attacker.com', 'external Origin'),
  await probeWs('https://evil.localhost.attacker.com', 'subdomain spoofing'),
  await probeWs('http://10.0.0.5', 'private LAN IP'),
];
const probeText = probes.map(p =>
  `# ${p.label}: Origin=${p.origin}\n  upgradeStatus=${p.upgradeStatus} opened=${p.opened}${p.closeCode != null ? ` closeCode=${p.closeCode}` : ''}`
).join('\n\n');
writeFileSync(join(EV, 'ws-hijack-blocked.txt'), [
  '# QW-2 / S-NEW-2 — WebSocket upgrade from external Origin rejected',
  '#',
  '# Each probe is a node ws client connecting to /ws/terminal/backend?project=demo',
  '# with a forged Origin header. The broker should respond 403 Forbidden on the',
  '# HTTP upgrade — never accept the WS handshake.',
  '',
  probeText,
  '',
].join('\n'));
log(`[QW-2a]  ws-hijack-blocked.txt written (${probes.filter(p => p.upgradeStatus === 403).length}/3 probes got 403)`);

// QW-2b: visual screenshot of the existing S-NEW-2 PoC served from a
// different localhost port. Even though our Origin policy admits any
// localhost variant (per audit line 103), the agent-not-running check
// added in this same PR still rejects pre-handshake — visible in the
// screenshot as 1006/error.
const POC_PORT = 18080;
const pocServer = createServer((req, res) => {
  if (req.url === '/poc.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>S-NEW-2 PoC verification</title>
<style>body{font-family:ui-monospace,monospace;padding:1em;max-width:720px;background:#fff;color:#111;}
h1{font-size:1.1em}
#log{white-space:pre-wrap;background:#111;color:#afa;padding:1em;height:40vh;overflow:auto;}
.ok{color:#3da}
.bad{color:#e44}</style>
</head>
<body>
<h1>QW-2 verification &mdash; WS-hijack from a different localhost port</h1>
<p>Origin: <code id="o"></code> &middot; Target: <code id="t"></code></p>
<p>Even when the Origin is technically a localhost variant, the broker
also refuses the upgrade when no agent is running for that role
(defense-in-depth from QW-2). Expected outcome: WS does NOT open.</p>
<div id="log"></div>
<script>
  const url = 'ws://127.0.0.1:${PORT}/ws/terminal/backend?project=demo';
  document.getElementById('o').textContent = location.origin;
  document.getElementById('t').textContent = url;
  const log = (cls, msg) => { const el = document.getElementById('log'); const span = document.createElement('span'); span.className = cls; span.textContent = msg + '\\n'; el.appendChild(span); };
  log('', '[*] origin = ' + location.origin);
  log('', '[*] opening ' + url);
  const ws = new WebSocket(url);
  ws.onopen = () => log('bad', '[FAIL] connection OPENED -- fix is broken');
  ws.onerror = () => log('ok', '[+] WebSocket error fired (expected for blocked upgrade)');
  ws.onclose = (e) => log('ok', '[+] WS CLOSE code=' + e.code + ' reason=' + (e.reason || '(empty)'));
</script>
</body>
</html>`);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => pocServer.listen(POC_PORT, '127.0.0.1', r));
log(`[poc] serving PoC on http://127.0.0.1:${POC_PORT}/poc.html`);

await visit(`http://127.0.0.1:${POC_PORT}/poc.html`, 1500);
await snap('ws-hijack-blocked');
log('[QW-2b]  ws-hijack-blocked.png written');

await new Promise((r) => pocServer.close(r));

// ── 3. Sigterm-clean: this is captured by the caller (run a separate
// broker on a side port, send SIGTERM, capture stderr). Done outside
// this script — see scripts/qa-v0.2.3-sigterm.sh.
log('[note] sigterm-clean evidence captured separately by qa-v0.2.3-sigterm.sh');

await browser.close();
log('[done]');
