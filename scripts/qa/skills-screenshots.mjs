#!/usr/bin/env node
// FASE F (v0.3.0): capture Skills modal screenshots for the audit
// deliverable (docs/audits/v0.3.0-team-memory/screenshots/).
//
// Prerequisite: broker running on http://127.0.0.1:7910 with the
// qa-demo project + dashboard peer + 2 skills seeded by /tmp/seed-qa.sh.
// Re-seeds skills if they were deleted by previous runs.

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BROKER = 'http://127.0.0.1:7910';
const PROJECT = 'qa-demo';
const OUT_DIR = 'docs/audits/v0.3.0-team-memory/screenshots';

mkdirSync(OUT_DIR, { recursive: true });

async function api(path, body) {
  const r = await fetch(`${BROKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Re-register a fresh dashboard peer (cleanup may have evicted previous
// ones). Re-register before EACH api call too — the broker's
// cleanStalePeers (every 30s) can evict between puppeteer ticks if the
// browser launch + first page load is slow on cold boot.
async function freshPeer() {
  const reg = await api('/api/register', {
    project_id: PROJECT, pid: 1, cwd: '/', role: 'user',
    name: 'Dashboard', agent_type: 'dashboard',
  });
  return reg.id;
}
let peerId = await freshPeer();
console.log(`peer: ${peerId}`);

// Drop any leftover skills then re-seed two known ones.
const list = await api('/api/skills/list', { project_id: PROJECT, peer_id: peerId });
for (const f of list.files) {
  await api('/api/skills/delete', { project_id: PROJECT, peer_id: peerId, filename: f.filename });
}

const browser = await puppeteer.launch({
  headless: 'new',
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();

  // We need a peer_id in localStorage so the dashboard's
  // useDashboardPeer hook resolves. Set it before the page loads JS.
  await page.evaluateOnNewDocument((id) => {
    try { localStorage.setItem('acc.dashboardPeerId', id); } catch { /* ignore */ }
  }, peerId);

  // ── Empty-state screenshot ───────────────────────────────────
  await page.goto(`http://127.0.0.1:7910/${PROJECT}`, { waitUntil: 'networkidle0' });
  // Click "Skills" button.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('Skills'))
  );
  const clickSkillsBtn = async () => {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Skills');
      if (btn) btn.click();
    });
  };
  await clickSkillsBtn();
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: join(OUT_DIR, 'skills-modal-empty.png'), fullPage: false });
  console.log('captured: skills-modal-empty.png');

  // Close the modal (Escape) before re-seeding.
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  // ── Re-seed skills, capture list view ────────────────────────
  peerId = await freshPeer();
  await api('/api/skills/save', {
    project_id: PROJECT, peer_id: peerId, filename: 'use-esm.md',
    content: 'Always use ESM modules. Never CJS.\nImports use `import ... from \'...\'`. No `require()`.',
  });
  peerId = await freshPeer();
  await api('/api/skills/save', {
    project_id: PROJECT, peer_id: peerId, filename: 'tests.md',
    content: 'Tests live in `tests/<area>/<file>.test.ts`. Use vitest.\nMirror source layout.',
  });
  peerId = await freshPeer();
  await api('/api/skills/save', {
    project_id: PROJECT, peer_id: peerId, filename: 'commits.md',
    content: 'Commit format: `feat(area): subject`. Body wraps at 72.',
  });

  await clickSkillsBtn();
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: join(OUT_DIR, 'skills-modal-list.png'), fullPage: false });
  console.log('captured: skills-modal-list.png');

  // ── Editor view (click Nuevo skill) ──────────────────────────
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Nuevo skill');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 400));
  // Type a filename + content into the editor.
  await page.type('input[placeholder*="use-esm"]', 'pkg-manager.md');
  await page.type('textarea', 'Use pnpm, not npm. The lockfile is the source of truth.');
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: join(OUT_DIR, 'skills-modal-editor.png'), fullPage: false });
  console.log('captured: skills-modal-editor.png');
} finally {
  await browser.close();
}

console.log(`\nAll screenshots written to ${OUT_DIR}/`);
