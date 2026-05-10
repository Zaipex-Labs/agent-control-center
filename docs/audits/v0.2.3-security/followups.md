# v0.2.3 — follow-ups discovered while shipping the security quick-wins

Bugs noticed during the v0.2.3 implementation/QA pass that were
deliberately NOT fixed in this PR (out of scope per the "fix mínimo,
no refactorices código adyacente" rule). Each one is an independent
follow-up.

---

## F-1 · `audit-qa.mjs` posts to `/api/create-project` (should be `/api/project/create`) · *Bajo*

`scripts/audit-qa.mjs` line 215, 222, 229, 235 fuzz `/api/create-project`,
which is not a registered route. The broker's POST router doesn't
match it and the response is `{ok:false, error:"Not found"}` with
status 404 — **not** the intended traversal/injection rejection from
`handleCreateProject`. The fuzz is therefore not actually exercising
the create-project handler.

- **Why**: the route is `/api/project/create` (see
  `src/broker/index.ts:81`).
- **Fix**: rewrite the four `t(…, '/api/create-project', …)` callsites
  to `/api/project/create`. ~5 LOC.
- **Impact**: cosmetic for now. Q-22 only fixed the `BASE is not
  defined` crash; the actual fuzz logic still doesn't match what the
  audit comment in audit-qa.mjs claims.

---

## F-2 · `claude-in-chrome` extension not connected — fell back to Puppeteer · *Info*

Per `docs/audits/v0.2.2-comprehensive-audit.md` §8 line 454, the QA
should run inside the user's real Chrome via the Claude-in-Chrome
extension. In this session, `mcp__claude-in-chrome__tabs_context_mcp`
returned "Browser extension is not connected" — same problem the
v0.2.2 audit flagged. We fell back to Puppeteer headless (the same
script `scripts/audit-qa.mjs` uses).

- **Consequence**: extensions, real-user fonts, real-user cookies,
  and human "midway" interactions are not exercised.
- **Fix**: install the extension per the audit doc (`claude.ai/chrome`)
  and re-run with the real browser before v0.2.4 sign-off.
- This was already a known follow-up in v0.2.2 — restating here so
  the v0.2.3 post-pr report is honest.

---

## F-3 · Origin policy still admits same-machine cross-port WebSocket attacks · *Info / known limit* · **CLOSED in v0.2.4** — see `docs/audits/v0.2.4-ux-tokens-and-f3/` (commits `40bc1db` / `ae0deb9` / `3f4cb54`)

The Origin allowlist implemented for QW-2 follows the audit's stated
policy (line 103): allow any `http(s)://(localhost|127.0.0.1|[::1])(:port)?`
or no Origin from a loopback remote. This leaves one residual scenario
open: a malicious dev server on `http://127.0.0.1:8080` (different
port, same machine) sends Origin `http://127.0.0.1:8080` → matches the
regex → upgrade allowed. Closing this requires a per-connection
secret the attacker cannot guess (CSRF-style WS token, or
`Sec-WebSocket-Protocol`-carried peer id).

- **Why not in this PR**: the dashboard currently has no peer-id
  flow for `/ws/terminal/<role>` (and browsers can't set custom WS
  headers, so the audit's "X-Peer-Id" suggestion can't be done as
  a literal header). Implementing it requires:
    - a `/api/csrf/issue` endpoint that returns a random one-shot
      token bound to (project, role)
    - the dashboard requests the token before opening the WS and
      passes it via `Sec-WebSocket-Protocol` (which IS settable via
      `new WebSocket(url, [protocol])` in browsers)
    - the broker matches and consumes the token in
      `handleTerminalUpgrade` before `wss.handleUpgrade`
- **Mitigation already in place from QW-2**: the "agent must be
  running" check moved pre-handshake — same-localhost-cross-port
  attackers can no longer probe whether a `(project, role)` exists
  via handshake success alone, only via 503-vs-403 distinction.
- **Track**: schedule for v0.2.4 alongside the dashboard change.

---

## F-4 · Lifecycle handlers in `installLifecycleHandlers` install on EVERY `main()` call · *Bajo*

`installLifecycleHandlers` is currently only called from `main()`
(direct-run path), not from tests / library consumers, so this is
benign — but if anyone later imports `createBrokerServer` AND
manually calls `installLifecycleHandlers` more than once (e.g. during
hot reload of the dev server), `process.on('SIGTERM', …)` will
accumulate listeners. Two consequences:

1. `MaxListenersExceededWarning` after ~10 reloads.
2. The lifecycle path runs N times in parallel on signal.

- **Fix**: track whether handlers are already installed and no-op on
  repeat. Or expose `uninstallLifecycleHandlers(server)` that the
  caller invokes on teardown. ~10 LOC.

---

## F-5 · `closeDatabase` swallows `wal_checkpoint` errors silently · *Info*

`src/broker/database.ts:closeDatabase` runs `wal_checkpoint(TRUNCATE)`
inside a `try { } catch { /* ignore */ }`. If the checkpoint fails
(disk full, locked, corrupt) we silently move to `db.close()` and
leave a non-truncated WAL behind. Acceptable trade-off for shutdown
robustness, but should at least log the failure.

- **Fix**: replace the empty catch with `console.error('[broker:db]
  wal_checkpoint failed', e)`.

---

## F-6 · `mobile-teams.png` first-card "mostly white screen + Z" — same UX-2 bug, different fixtures · *Info / not a regression*

Reviewing `docs/audits/v0.2.3-security/screenshots/teams-mobile.png`
the first card looks dramatically different from the v0.2.2 baseline
(`docs/audits/qa-out/mobile-teams.png` as it stood at commit
`2eb033f`): the v0.2.3 capture shows mostly the office illustration
with a sleep "Zzz" overlay, while v0.2.2 showed two monitors on a
desk.

This is **not** a v0.2.3 regression. Both screenshots exhibit the
same UX-2 mobile-reflow bug: the project card is not narrow-aware,
the office illustration consumes ~60% of the card width, the
"INACTIVO" badge truncates to "IM", and the "última actividad" text
is cut off. The visual difference between the two PNGs is purely
fixture-dependent:

  - v0.2.2 fuzz QA used the user's real local broker, where
    `zaipex-sass` (3+ agents) was the first card → 3-monitor desk
    illustration variant.
  - v0.2.3 fuzz QA seeds a fresh broker with `empty-project` (1
    agent — architect only) → "sleeping office" illustration variant
    (TV + Zzz, the empty-state asset).

The dashboard renders different illustrations based on the project's
agent count; with one agent it shows the "asleep" asset and that's
what the user sees as "mostly white screen + Z".

- **Tracker**: subsumed by **UX-2** in v0.2.2 audit §8 (still open,
  v0.2.4 backlog). The mobile-reflow fix lands there.
- **No code change for v0.2.3.**
