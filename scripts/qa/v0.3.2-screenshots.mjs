#!/usr/bin/env node
// FASE E (v0.3.2) — capture the audit-deliverable screenshots.
//
// Prerequisite: broker running on http://127.0.0.1:7914 with the
// powers-demo project seeded (Turing/backend has git+postgres, Ada/
// frontend has playwright) and a dashboard peer registered. The
// caller passes the peer id via DASHBOARD_PEER env so we don't
// register a fresh one and leave dead rows behind.
//
// Screenshots produced (all under docs/audits/v0.3.2-powers-observability/
// screenshots/):
//   - 01-powers-modal.png            (re-shoot of Checkpoint A)
//   - 02-avatar-seed-editor.png      (re-shoot of Checkpoint D)
//   - 03-encender-checklist.png      (FASE C-1 mid-flight if claude
//                                     spawn reaches pty_ready)
//
// Tokens panel + histogram screenshots are intentionally omitted —
// FASE B was skipped per the plan's "Si SDK no lo expone: anota como
// FU y skip" escape hatch. The post-PR audit calls this out.

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const BROKER = process.env.BROKER || 'http://127.0.0.1:7914';
const PROJECT = process.env.PROJECT || 'powers-demo';
const PEER_ID = process.env.DASHBOARD_PEER;
const OUT_DIR = 'docs/audits/v0.3.2-powers-observability/screenshots';

if (!PEER_ID) {
  console.error('Missing DASHBOARD_PEER env. Register one and pass its id.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  defaultViewport: { width: 1400, height: 1100, deviceScaleFactor: 2 },
});

async function makePage() {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((id) => {
    try { localStorage.setItem('acc.dashboardPeerId', id); } catch { /* ignore */ }
  }, PEER_ID);
  return page;
}

async function clickEditOnPowersDemo(page) {
  await page.goto(`${BROKER}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => /powers-demo/.test(document.body.textContent ?? ''),
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      const title = (b.getAttribute('title') || '').toLowerCase();
      if (!/edit|editar/.test(title)) continue;
      let el = b;
      while (el?.parentElement) {
        if (el.parentElement.textContent?.includes('powers-demo')) {
          b.click();
          return;
        }
        el = el.parentElement;
      }
    }
  });
  await new Promise(r => setTimeout(r, 1200));
}

async function scrollToTuring(page) {
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('div'))
      .find(d => d.textContent === 'Turing');
    if (heading) {
      heading.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy(0, -40);
    }
  });
  await new Promise(r => setTimeout(r, 300));
}

try {
  // ── 01. Powers modal ─────────────────────────────────────────
  {
    const page = await makePage();
    await clickEditOnPowersDemo(page);
    await scrollToTuring(page);
    const path = `${OUT_DIR}/01-powers-modal.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`saved: ${path}`);
    await page.close();
  }

  // ── 02. Avatar seed editor ───────────────────────────────────
  {
    const page = await makePage();
    await clickEditOnPowersDemo(page);
    await scrollToTuring(page);
    // Open the avatar picker on Turing's card, then type a seed.
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'))
        .filter(l => l.textContent?.includes('Cambiar avatar') || l.textContent?.includes('Change avatar'));
      for (const lbl of labels) {
        const card = lbl.closest('div[style*="border-radius"]');
        if (card?.textContent?.includes('Turing')) {
          lbl.parentElement?.querySelector('button')?.click();
          break;
        }
      }
    });
    await new Promise(r => setTimeout(r, 250));
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      for (const i of inputs) {
        const ph = i.placeholder || '';
        if (ph.includes('wizard') || ph.includes('mago')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(i, 'turing-wizard');
          i.dispatchEvent(new Event('input', { bubbles: true }));
          break;
        }
      }
    });
    await new Promise(r => setTimeout(r, 250));
    const path = `${OUT_DIR}/02-avatar-seed-editor.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`saved: ${path}`);
    await page.close();
  }

  // ── 03. Encender checklist (FASE C-1) ────────────────────────
  //
  // We trigger /api/project/up and capture the boot panel within
  // ~3s — long enough for pty_ready to fire on each agent
  // (broadcast is synchronous after spawn()) but short enough that
  // we don't wait for the full poll loop to time out.
  {
    const page = await makePage();
    await page.goto(`${BROKER}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => /powers-demo/.test(document.body.textContent ?? ''),
      { timeout: 15_000 },
    );
    // Click "Encender" (Power up) button on the powers-demo card.
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const b of buttons) {
        const txt = b.textContent?.trim() || '';
        if (!/encender|power/i.test(txt)) continue;
        let el = b;
        while (el?.parentElement) {
          if (el.parentElement.textContent?.includes('powers-demo')) {
            b.click();
            return;
          }
          el = el.parentElement;
        }
      }
    });
    // Wait for the boot panel + agent rows to render. pty_ready
    // events are broadcast right after spawn() so they arrive
    // within ~200ms; we wait a beat extra for the React commit.
    await new Promise(r => setTimeout(r, 2500));
    const path = `${OUT_DIR}/03-encender-checklist.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`saved: ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
