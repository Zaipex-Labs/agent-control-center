// scripts/screenshot-dashboard.mjs
//
// Seeds a throwaway "acc-demo" project with fake peers + a realistic
// coordination thread, then captures 4 dashboard screenshots with
// puppeteer, then tears everything down.
//
// Requires: broker running on 127.0.0.1:7899, puppeteer installed.
// Usage:    node scripts/screenshot-dashboard.mjs

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://127.0.0.1:7899';
const PROJECT = 'acc-demo';
const OUT = resolve('docs/screenshots');
mkdirSync(OUT, { recursive: true });

// ── Broker API helpers ────────────────────────────────────────

async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${text}`);
  return json;
}

async function apiGet(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function isBrokerAlive() {
  try {
    const r = await fetch(`${BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function deleteProjectIfExists() {
  const { projects } = await apiGet('/api/projects');
  if (projects.some(p => p.name === PROJECT)) {
    console.log(`[seed] deleting previous ${PROJECT}`);
    await api('/api/project/delete', { project_id: PROJECT }).catch(() => {});
  }
}

// ── Seed realistic demo data ──────────────────────────────────

async function seed() {
  console.log('[seed] creating project');
  await api('/api/project/create', {
    name: PROJECT,
    description: 'Demo team used to capture dashboard screenshots',
  });

  console.log('[seed] adding backend + frontend agents');
  await api('/api/project/add-agent', {
    project_id: PROJECT,
    role: 'backend',
    cwd: '/tmp/acc-demo/backend',
    name: 'Turing',
    instructions: 'You own the FastAPI backend. Stack: FastAPI + PostgreSQL 16.',
  });
  await api('/api/project/add-agent', {
    project_id: PROJECT,
    role: 'frontend',
    cwd: '/tmp/acc-demo/frontend',
    name: 'Lovelace',
    instructions: 'You own the Next.js frontend. Stack: Next.js 15 + React 19 + Tailwind.',
  });

  console.log('[seed] registering fake peers');
  // Dashboard peer (so messages can come "from the user")
  const dash = await api('/api/register', {
    project_id: PROJECT,
    pid: 1,
    cwd: '/',
    role: 'user',
    name: 'Dashboard',
    agent_type: 'dashboard',
    summary: 'Web dashboard',
  });

  // Fake agent peers — use our own script PID so process.kill(pid, 0)
  // succeeds in the broker's liveness check (PID 1 throws EPERM on macOS
  // because launchd is root-owned).
  const arch = await api('/api/register', {
    project_id: PROJECT,
    pid: process.pid,
    cwd: '/tmp/acc-demo/lead',
    role: 'arquitectura',
    name: 'Da Vinci',
    summary: 'Diseñando el flujo de login y reset de contraseña',
  });

  const be = await api('/api/register', {
    project_id: PROJECT,
    pid: process.pid,
    cwd: '/tmp/acc-demo/backend',
    role: 'backend',
    name: 'Turing',
    summary: 'Implementando POST /api/auth/login con JWT',
  });

  const fe = await api('/api/register', {
    project_id: PROJECT,
    pid: process.pid,
    cwd: '/tmp/acc-demo/frontend',
    role: 'frontend',
    name: 'Lovelace',
    summary: 'Montando el formulario de login con validación en React Hook Form',
  });

  console.log('[seed] creating thread');
  const thread = await api('/api/threads/create', {
    project_id: PROJECT,
    name: 'Flujo de login',
    created_by: dash.id,
  });

  const tid = thread.id;
  const send = (from, to, text, type = 'message') =>
    api('/api/send-message', {
      project_id: PROJECT,
      from_id: from,
      to_id: to,
      text,
      thread_id: tid,
      type,
    });

  console.log('[seed] seeding messages in thread');
  await send(dash.id, arch.id,
    'Hola Da Vinci, necesito que montemos el flujo de login del SaaS. Email + password para empezar, después vemos OAuth. ¿Puedes coordinar al equipo?');

  await send(arch.id, dash.id,
    '¡Perfecto! Empiezo a diseñar el flujo. Le pido a Turing el endpoint y a Lovelace la pantalla. Vuelvo en un momento con el plan.',
    'response');

  // Agent-to-agent coordination (this becomes the "meeting" / collapsed block)
  await send(arch.id, be.id,
    'Turing, para el login necesito que expongas `POST /api/auth/login` con `{email, password}` → `{token, user}`. JWT firmado con `ACC_JWT_SECRET`, expiración 1h. ¿Cuándo lo puedes tener?',
    'task_request');

  await send(be.id, arch.id,
    'Entendido. Lo publico en shared:contracts/auth-login. ETA 30 min — ya tengo el modelo de User listo, solo falta el handler y los tests.',
    'response');

  await send(arch.id, fe.id,
    'Lovelace, para el frontend: pantalla de login en `/login`. Contract publicado en shared:contracts/auth-login. Usa React Hook Form + Zod para la validación. Guarda el token en httpOnly cookie vía el BFF de Next.',
    'task_request');

  await send(fe.id, arch.id,
    '¡Perfecto! Ya tengo el layout, solo lo conecto al endpoint cuando Turing publique. Mientras voy haciendo la pantalla con loading states y error handling.',
    'response');

  await send(be.id, arch.id,
    'Listo — endpoint publicado, contrato en shared:contracts/auth-login, 12 tests pasando. Todo tuyo Lovelace.',
    'task_complete');

  await send(fe.id, arch.id,
    'Conectado y funcionando. Login+logout end-to-end, validación en tiempo real, manejo de errores 401. ¿Quieres que agregue el "recordarme"?',
    'task_complete');

  await send(arch.id, dash.id,
    '✅ Login listo. Turing expuso `POST /api/auth/login` con JWT, Lovelace montó la pantalla en `/login` con validación. Todo documentado en progress.md. ¿Seguimos con el reset de contraseña?',
    'response');

  console.log('[seed] seeding shared state');
  await api('/api/shared/set', {
    project_id: PROJECT,
    namespace: 'contracts',
    key: 'auth-login',
    value: JSON.stringify({
      method: 'POST',
      path: '/api/auth/login',
      request: { email: 'string', password: 'string' },
      response: { token: 'string (JWT)', user: { id: 'string', email: 'string', name: 'string' } },
      errors: { 401: 'invalid credentials', 422: 'validation failed' },
    }, null, 2),
    peer_id: be.id,
  });

  await api('/api/shared/set', {
    project_id: PROJECT,
    namespace: 'contracts',
    key: 'user-model',
    value: JSON.stringify({
      id: 'uuid',
      email: 'string (unique)',
      password_hash: 'string (bcrypt)',
      name: 'string',
      created_at: 'timestamp',
    }, null, 2),
    peer_id: be.id,
  });

  await api('/api/shared/set', {
    project_id: PROJECT,
    namespace: 'config',
    key: 'jwt',
    value: JSON.stringify({
      secret_env: 'ACC_JWT_SECRET',
      expiration: '1h',
      algorithm: 'HS256',
    }, null, 2),
    peer_id: arch.id,
  });

  return { dash, arch, be, fe };
}

// ── Cleanup ───────────────────────────────────────────────────

async function cleanup(peers) {
  console.log('[cleanup] unregistering peers');
  for (const p of Object.values(peers)) {
    await api('/api/unregister', { id: p.id }).catch(() => {});
  }
  console.log('[cleanup] deleting project');
  await api('/api/project/delete', { project_id: PROJECT }).catch(() => {});
}

// ── Puppeteer capture ─────────────────────────────────────────

async function capture() {
  console.log('[shot] launching puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();

    // 1. Teams page
    console.log('[shot] teams page');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500)); // let avatars/styles settle
    await page.screenshot({ path: `${OUT}/teams.png`, fullPage: false });

    // 2. Workspace — navigate to the demo project and open the thread
    console.log('[shot] workspace / chat');
    await page.goto(`${BASE}/${PROJECT}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // Click the "Flujo de login" thread. React's event delegation picks up
    // real mouse clicks at any descendant of the onClick node, so clicking
    // on the label span is enough. We use page.mouse.click(x, y) which
    // dispatches real pointer events (puppeteer's .click() on an element
    // handle does the same thing under the hood).
    const threadBox = await page.evaluate(() => {
      const leaf = Array.from(document.querySelectorAll('span,div'))
        .find(el => (el.textContent || '').trim() === 'Flujo de login');
      if (!leaf) return null;
      const r = leaf.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (threadBox) {
      await page.mouse.click(threadBox.x, threadBox.y);
      console.log('  clicked thread at', threadBox);
    } else {
      console.log('  thread not found in DOM');
    }
    await new Promise(r => setTimeout(r, 2500)); // let messages + avatars render
    await page.screenshot({ path: `${OUT}/workspace.png`, fullPage: false });

    // 3. Meeting — click the first agent-to-agent meeting block to expand
    // it, so meeting.png shows the meeting opened with its internal
    // messages (visually distinct from the chat overview shot).
    console.log('[shot] meeting');
    const meetingBox = await page.evaluate(() => {
      const PHRASES = /\b(llam[oó]|marc[oó]|toc[oó] la puerta|avent[oó]|mand[oó] un memo|grit[oó]|intercept[oó]|hizo una se[ñn]a|cit[oó] a|pas[oó] una nota|cuchichearon|stand-?up|platicaron|intercambiaron|videollamada|palomas mensajeras)\b/i;
      const spans = Array.from(document.querySelectorAll('span'));
      const hit = spans.find(el => PHRASES.test(el.textContent || ''));
      if (!hit) return null;
      hit.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = hit.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        label: (hit.textContent || '').trim().slice(0, 80),
      };
    });
    console.log('  meeting label:', meetingBox?.label);
    if (meetingBox) {
      await page.mouse.click(meetingBox.x, meetingBox.y);
      await new Promise(r => setTimeout(r, 600));
      // Re-scroll because expanding pushes content around
      await page.evaluate(() => {
        const PHRASES = /\b(llam[oó]|marc[oó]|toc[oó] la puerta|avent[oó]|mand[oó] un memo|grit[oó]|intercept[oó]|hizo una se[ñn]a|cit[oó] a|pas[oó] una nota|cuchichearon|stand-?up|platicaron|intercambiaron|videollamada|palomas mensajeras)\b/i;
        const hit = Array.from(document.querySelectorAll('span'))
          .find(el => PHRASES.test(el.textContent || ''));
        if (hit) hit.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
      await new Promise(r => setTimeout(r, 400));
    }
    await page.screenshot({ path: `${OUT}/meeting.png`, fullPage: false });

    // 4. Shared state — the right sidebar is hidden by a CSS media query
    // at exactly 1280px viewport (`@media (max-width: 1280px)`). Override
    // that rule with an inline <style> so the panel renders in our shot.
    // We also make sure showSidebar is true (default is true, but if any
    // previous click toggled it off we click the Panel button again).
    console.log('[shot] shared state');
    await page.addStyleTag({
      content: 'aside[data-sidebar="right"] { display: flex !important; }',
    });
    await new Promise(r => setTimeout(r, 200));

    const sidebarMounted = await page.evaluate(() => {
      // After the style override, the sidebar should have a non-zero width
      // IF showSidebar is also true (which controls the React conditional).
      const aside = document.querySelector('aside[data-sidebar="right"]');
      return !!aside && aside.getBoundingClientRect().width > 0;
    });
    console.log('  sidebar mounted:', sidebarMounted);

    if (!sidebarMounted) {
      // React didn't render the aside — click the "Panel" button to toggle.
      const panelBox = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => /^panel$/i.test((b.textContent || '').trim()));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (panelBox) {
        await page.mouse.click(panelBox.x, panelBox.y);
        await new Promise(r => setTimeout(r, 700));
      }
    }

    // Collapse the meeting block from the previous shot so the right
    // sidebar content (contracts) dominates the view.
    await page.evaluate(() => {
      const PHRASES = /\b(llam[oó]|marc[oó]|toc[oó] la puerta|avent[oó]|mand[oó] un memo|grit[oó]|intercept[oó]|hizo una se[ñn]a|cit[oó] a|pas[oó] una nota|cuchichearon|stand-?up|platicaron|intercambiaron|videollamada|palomas mensajeras)\b/i;
      const hit = Array.from(document.querySelectorAll('span'))
        .find(el => PHRASES.test(el.textContent || ''));
      if (hit) {
        const r = hit.getBoundingClientRect();
        // Dispatch a real click via MouseEvent to collapse it
        hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
      }
    });

    // Scroll the shared-state section header to the top of the aside.
    await page.evaluate(() => {
      const aside = document.querySelector('aside[data-sidebar="right"]');
      if (!aside) return;
      // Find a leaf heading element whose text is "Estado compartido" / "Shared state"
      const headers = Array.from(aside.querySelectorAll('h3,h4,div'));
      const hit = headers.find(el =>
        /^(shared state|estado compartido)$/i.test((el.textContent || '').trim()),
      );
      if (hit) hit.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}/shared-state.png`, fullPage: false });
  } finally {
    await browser.close();
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!(await isBrokerAlive())) {
    console.error('Broker not reachable at ' + BASE);
    process.exit(1);
  }

  await deleteProjectIfExists();

  let peers;
  try {
    peers = await seed();
    await capture();
    console.log('[done] screenshots in ' + OUT);
  } finally {
    if (peers) await cleanup(peers);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
