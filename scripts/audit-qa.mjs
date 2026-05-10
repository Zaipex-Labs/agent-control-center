#!/usr/bin/env node
// QA script for zaipex-acc dashboard. Captures screenshots, console
// errors, network failures, perf, and accessibility hints.
// Usage: node scripts/audit-qa.mjs

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:7899';
const OUT = resolve(process.cwd(), 'docs/audits/qa-out');
mkdirSync(OUT, { recursive: true });

const findings = {
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  // [FU-2 v0.2.4] explicit top-level field. Every URL whose origin
  // is NOT `http://127.0.0.1:<port>` (or `localhost:<port>` / `[::1]`)
  // gets recorded here. `[]` is the expected clean state for a tool
  // sold as "local-only".
  externalResources: [],
  metrics: {},
  notes: [],
};

// Returns true when `url` belongs to the broker we're auditing, false
// when it points anywhere else (Google Fonts, analytics, CDNs, …).
function isLocalUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    const host = u.hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();

// `inFuzz` is flipped to true while the fuzz section is running so
// the listeners below stop pushing intentional 4xx into
// failedRequests / consoleErrors. The fuzz results have their own
// `findings.fuzz[]` array; reporting them again as "page errors"
// would just be noise.
let inFuzz = false;

page.on('console', (msg) => {
  if (inFuzz) return;
  if (msg.type() === 'error' || msg.type() === 'warning') {
    findings.consoleErrors.push({
      type: msg.type(),
      text: msg.text().slice(0, 400),
      url: page.url(),
    });
  }
});

page.on('pageerror', (err) => {
  findings.pageErrors.push({
    message: err.message.slice(0, 400),
    stack: (err.stack ?? '').split('\n').slice(0, 6).join('\n'),
    url: page.url(),
  });
});

page.on('requestfailed', (req) => {
  if (inFuzz) return;
  findings.failedRequests.push({
    url: req.url(),
    method: req.method(),
    failure: req.failure()?.errorText,
    page: page.url(),
  });
});

// Set so we don't list the same external URL multiple times (fonts
// load on every page, analytics may re-fire, etc.). The `findings`
// array is the de-duplicated public view written to qa-report.json.
const seenExternal = new Set();

page.on('response', (res) => {
  if (inFuzz) return;
  const url = res.url();
  const status = res.status();
  if (status >= 400) {
    findings.failedRequests.push({
      url,
      method: res.request().method(),
      status,
      page: page.url(),
    });
  }
  // [FU-2 v0.2.4] every response URL that left 127.0.0.1 lands in
  // externalResources, regardless of status. The dashboard is
  // supposed to be 100% local; one entry here is the audit's signal
  // to investigate.
  if (!isLocalUrl(url) && !seenExternal.has(url)) {
    seenExternal.add(url);
    findings.externalResources.push({
      url,
      status,
      seenOn: page.url(),
    });
  }
});

async function snap(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

async function visit(label, url, waitFor = 'networkidle0') {
  console.log(`→ ${label}: ${url}`);
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: waitFor, timeout: 15000 });
  } catch (e) {
    findings.notes.push(`navigation failed @ ${label}: ${e.message}`);
  }
  const t1 = Date.now();
  findings.metrics[label] = { ms: t1 - t0, url };
  await new Promise((r) => setTimeout(r, 800));
  await snap(label);
}

// 1. Home (TeamsPage)
await visit('teams', `${BASE}/`);

// Discover projects from API
const projects = await page.evaluate(async (base) => {
  try {
    const r = await fetch(`${base}/api/projects`);
    const d = await r.json();
    return (d.projects ?? []).map((p) => p.name).slice(0, 3);
  } catch {
    return [];
  }
}, BASE);

findings.notes.push(`projects discovered: ${JSON.stringify(projects)}`);

// 2. Each project page
for (const p of projects) {
  await visit(`project-${p}`, `${BASE}/${encodeURIComponent(p)}`);
}

// 3. History page
if (projects[0]) {
  await visit('history', `${BASE}/${encodeURIComponent(projects[0])}/history`);
}

// 4. Mobile viewport
await page.setViewport({ width: 390, height: 844 });
await visit('mobile-teams', `${BASE}/`);
if (projects[0]) {
  await visit('mobile-project', `${BASE}/${encodeURIComponent(projects[0])}`);
}

// 5. Reset to desktop, test interactions
await page.setViewport({ width: 1440, height: 900 });
if (projects[0]) {
  await page.goto(`${BASE}/${encodeURIComponent(projects[0])}`, {
    waitUntil: 'networkidle0',
  });

  // Try to find composer textarea + send test
  const composerSelector = 'textarea, [contenteditable="true"]';
  const composerCount = await page.$$eval(composerSelector, (els) => els.length);
  findings.notes.push(`composer candidates on project page: ${composerCount}`);

  // Count interactive elements
  const stats = await page.evaluate(() => {
    return {
      buttons: document.querySelectorAll('button').length,
      links: document.querySelectorAll('a').length,
      inputs: document.querySelectorAll('input,textarea,select').length,
      images: document.querySelectorAll('img').length,
      imagesWithoutAlt: [...document.querySelectorAll('img')].filter(
        (i) => !i.alt
      ).length,
      buttonsWithoutLabel: [...document.querySelectorAll('button')].filter(
        (b) =>
          !b.textContent?.trim() &&
          !b.getAttribute('aria-label') &&
          !b.getAttribute('title')
      ).length,
      headingsH1: document.querySelectorAll('h1').length,
      langAttr: document.documentElement.lang,
      title: document.title,
      meta: {
        description: document.querySelector('meta[name="description"]')?.content,
      },
    };
  });
  findings.metrics.a11yQuick = stats;

  // Check for external resource loads (privacy in a "local-only" tool)
  const externals = await page.evaluate(() => {
    const u = new URL(location.href);
    const sameHost = u.host;
    return performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => {
        try {
          return new URL(n).host !== sameHost;
        } catch {
          return false;
        }
      });
  });
  findings.metrics.externalResources = externals;

  // Bundle size
  const bundleStats = await page.evaluate(() => {
    const r = performance.getEntriesByType('resource');
    const js = r.filter((x) => x.initiatorType === 'script');
    const css = r.filter((x) => x.initiatorType === 'link' || x.name.endsWith('.css'));
    return {
      jsCount: js.length,
      jsBytes: js.reduce((s, x) => s + (x.transferSize || 0), 0),
      jsDecoded: js.reduce((s, x) => s + (x.decodedBodySize || 0), 0),
      cssCount: css.length,
      cssBytes: css.reduce((s, x) => s + (x.transferSize || 0), 0),
      total: r.length,
    };
  });
  findings.metrics.bundle = bundleStats;
}

// 6. Hammer the broker with bad inputs (lightweight fuzz)
//
// [Q-22] — page.evaluate() serialises the function to a string and
// runs it inside the browser context, where the node-side `BASE`
// const is undefined. Pass BASE as the first argument so the browser
// gets a real value and the QA report stops being littered with
// "BASE is not defined" errors.
//
// [F-1 follow-up] — paths in the fuzz callsites must match the real
// broker routes (see src/broker/index.ts:60-90). The previous
// audit-qa.mjs targeted /api/create-project which doesn't exist;
// every fuzz response was just the dispatcher's "Not found" 404.
inFuzz = true;
const fuzz = [];
const t = async (base, path, init) => {
  try {
    const r = await fetch(`${base}${path}`, init);
    return { path, status: r.status, body: (await r.text()).slice(0, 120) };
  } catch (e) {
    return { path, error: e.message };
  }
};

fuzz.push(await page.evaluate(t, BASE, '/api/projects', undefined));
fuzz.push(
  await page.evaluate(
    t,
    BASE,
    '/api/blobs/0000000000000000000000000000000000000000000000000000000000000000',
    undefined
  )
);
fuzz.push(
  await page.evaluate(t, BASE, '/api/blobs/notahash', undefined)
);
fuzz.push(
  await page.evaluate(t, BASE, '/api/project/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '../../etc/pwned' }),
  })
);
fuzz.push(
  await page.evaluate(t, BASE, '/api/project/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'a; rm -rf /' }),
  })
);
fuzz.push(
  await page.evaluate(t, BASE, '/api/project/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
);
fuzz.push(
  await page.evaluate(t, BASE, '/api/project/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(1000) }),
  })
);
findings.fuzz = fuzz;
inFuzz = false;

// 7. Check for broker binding (must be 127.0.0.1 only)
findings.notes.push(
  `broker host check: connecting via ${BASE} succeeded; verify 0.0.0.0 with separate socket test if needed`
);

writeFileSync(
  join(OUT, 'qa-report.json'),
  JSON.stringify(findings, null, 2)
);

console.log(
  `\nDone. Console errors: ${findings.consoleErrors.length}, page errors: ${findings.pageErrors.length}, failed requests: ${findings.failedRequests.length}, fuzz responses: ${fuzz.length}`
);
console.log(`Output: ${OUT}`);

await browser.close();
