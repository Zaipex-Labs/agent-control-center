# Post-PR audit · v0.2.3 security quick-wins

**Branch**: `fix/v0.2.3-security-quickwins` · **Commits**: 6 fixes + 1 baseline + 2 review-cycle fixes + 1 docs
**Base**: `47ccc0e` (main, v0.2.2) · **Head**: `b0ff7bd`
**Date**: 2026-05-09

This document closes the v0.2.3 PR loop: it lists each fix with
runnable evidence, the new bugs spotted while shipping, and which
checkboxes in `docs/audits/v0.2.2-comprehensive-audit.md` move from
`- [ ]` to `- [x]`.

---

## 1. Verificación de fixes

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **QW-1** · CSRF + DNS-rebinding (S-NEW-1) | ✅ fixed | code: `src/broker/index.ts:147-167` (Host/Origin gate), `:189-194` (CT gate), `src/broker/origin.ts:1-83` · screenshot: `evidence/csrf-blocked-ct.txt` (415), `evidence/csrf-blocked-origin.txt` (403) · tests: `tests/security/http-origin-check.test.ts` (12 cases) · commit `71cdb80` |
| **QW-2** · WS-hijack RCE (S-NEW-2) | ✅ fixed | code: `src/broker/websocket.ts:31-39`, `src/broker/terminal.ts:472-491` · screenshot: `screenshots/ws-hijack-blocked.png` (browser PoC, blocked) + `evidence/ws-hijack-blocked.txt` (3/3 node probes with forged Origin → 403) · tests: `tests/security/ws-origin-check.test.ts` (9 cases) · commit `f9e949a` |
| **QW-3** · architect-impersonation via set-role (S-NEW-4 / M-5 / L-5) | ✅ fixed | code: `src/broker/handlers.ts:928-958` · screenshot: `evidence/set-role-blocked.txt` (qa peer → arquitectura → 403) · tests: `tests/security/add-agent-validation.test.ts` (`handleSetRole rejects unsafe role + ARCHITECT_ROLE` describe block, 6 cases) · commit `197120b` |
| **QW-5** · graceful shutdown (P-12) | ✅ fixed | code: `src/broker/index.ts:267-308` (shutdownBroker, installLifecycleHandlers), `src/broker/database.ts:136-150` (closeDatabase), `src/broker/websocket.ts:43-49` (closeAllEventsClients), `src/broker/terminal.ts:464-477` (killAllWebAgentsEverywhere) · screenshot: `evidence/sigterm-clean.log` (broker logs SIGTERM → shutdown complete; WS client gets `code=1001 reason=Broker shutting down`) · tests: `tests/broker/lifecycle.test.ts` (5 cases) · commit `1099bc9` |
| **h3-caveat** · shellEscape(target) in scheduleAgentInit | ✅ fixed | code: `src/cli/spawn.ts:205-211` (target now wrapped) · existing canary in `tests/security/add-agent-validation.test.ts` already protects upstream identifiers · commit `8380b53` |
| **Q-22** · `BASE is not defined` in audit-qa.mjs | ✅ fixed | code: `scripts/audit-qa.mjs:200-247` (BASE passed to t() and call sites) · evidence: `qa-report.json` `fuzz[]` now contains real status codes/bodies, no error strings · commit `649a30e` |
| **F-1** · audit-qa.mjs targeting `/api/create-project` (real route is `/api/project/create`) | ✅ fixed in this PR (review cycle) | code: `scripts/audit-qa.mjs` route paths + listener suppression during fuzz · evidence: `qa-report.json` `failedRequests: []`, `consoleErrors: []`, `pageErrors: []`, `fuzz[]` shows the real validation rejections (400 with `Invalid name: contains ".."`, `only [a-zA-Z0-9_.-]` etc.) · commit `cefbb62` |
| **QW-5 close order** · terminals → agents → events → http → db | ✅ fixed in this PR (review cycle) | code: `src/broker/terminal.ts:67-70, 491, 535-543, 562-573` (terminalClients Set + closeAllTerminalClients), `src/broker/index.ts:285-330` (reordered shutdownBroker) · evidence: `evidence/sigterm-clean.log` shows `[broker:lifecycle] received SIGTERM — terminals → agents → events → http → db` · tests: `tests/broker/lifecycle.test.ts > shutdownBroker close order [QW-5 follow-up] > runs cleanup in the order: terminals → agents → events → db` (vi.spyOn-based explicit order assertion) · commit `b0ff7bd` |

### How to reproduce the active verification on a fresh checkout

```bash
# 1. build
npm run build && npm run dashboard:build

# 2. start a side broker on a non-default port
ACC_HOME=/tmp/acc-qa-v0.2.3 ACC_PORT=7919 node dist/broker/index.js &

# 3. seed projects so the project pages have content
curl -s -X POST http://127.0.0.1:7919/api/project/create \
  -H "Content-Type: application/json" -d '{"name":"demo"}'
curl -s -X POST http://127.0.0.1:7919/api/project/add-agent \
  -H "Content-Type: application/json" \
  -d '{"project_id":"demo","role":"backend","name":"Turing","cwd":"/tmp"}'
curl -s -X POST http://127.0.0.1:7919/api/project/create \
  -H "Content-Type: application/json" -d '{"name":"empty-project"}'

# 4. run QA pass (regenerates docs/audits/v0.2.3-security/screenshots
#    + evidence/, except sigterm)
ACC_PORT=7919 node scripts/qa-v0.2.3.mjs

# 5. run sigterm capture (spins up its own throwaway broker)
bash scripts/qa-v0.2.3-sigterm.sh

# 6. baseline qa-report.json (regenerates docs/audits/qa-out/)
QA_BASE=http://127.0.0.1:7919 node scripts/audit-qa.mjs
```

### Test suite

```
$ npx vitest run
Test Files   48 passed (48)
     Tests  454 passed (454)
   Duration  ~1.2 s
```

Including the four files added/extended in this PR:

- `tests/security/ws-origin-check.test.ts` — 9 new
- `tests/security/http-origin-check.test.ts` — 12 new
- `tests/security/add-agent-validation.test.ts` — 16 existing + 6 new (set_role)
- `tests/broker/lifecycle.test.ts` — 6 new (5 baseline + 1 close-order assertion added during review)

`npx tsc --noEmit` exits clean (0 errors).

---

## 2. Hallazgos nuevos detectados durante la PR

Five follow-ups were spotted in passing while implementing the
quick-wins. None of them block the v0.2.3 ship; each is documented in
`docs/audits/v0.2.3-security/followups.md` with its own root cause
and proposed fix.

| ID | Severidad | Resumen | Tracker |
|---|---|---|---|
| F-1 | Bajo | `audit-qa.mjs` posts to `/api/create-project`, which doesn't exist (real route is `/api/project/create`) — fuzz isn't actually exercising the handler | **resolved in this PR** (commit `cefbb62`) — followups.md §F-1 marked done |
| F-2 | Info | Claude-in-Chrome extension still not connected; QA fell back to Puppeteer (already a v0.2.2 follow-up) | followups.md §F-2 |
| F-3 | Info / known limit | Origin policy admits `127.0.0.1:<other-port>` — same-machine cross-port WS hijack remains open until per-connection token / dashboard X-Peer-Id flow exists | followups.md §F-3 |
| F-4 | Bajo | `installLifecycleHandlers` is not idempotent — repeat calls accumulate signal listeners (benign today since only `main()` calls it once) | followups.md §F-4 |
| F-5 | Info | `closeDatabase` swallows `wal_checkpoint` errors silently — should log them | followups.md §F-5 |
| F-6 | Info / not a regression | `mobile-teams.png` first-card "white screen + Z" is a fixture artifact (different seeded projects → different empty-state illustration), not a v0.2.3 regression — same UX-2 bug from v0.2.2 | followups.md §F-6 (subsumed by UX-2 in v0.2.4) |

- [x] F-1 — fix audit-qa.mjs route paths · **fixed in `cefbb62`**
- [ ] F-2 — re-run QA inside Claude-in-Chrome extension
- [x] F-3 — per-connection WS token + dashboard subprotocol carry · **closed in v0.2.4** (`docs/audits/v0.2.4-ux-tokens-and-f3/`)
- [ ] F-4 — make installLifecycleHandlers idempotent
- [ ] F-5 — log wal_checkpoint failures in closeDatabase
- [ ] F-6 — UX-2 mobile reflow (subsumed by v0.2.4)

---

## 3. Regresiones potenciales

The Content-Type gate from QW-1 (`POST /api/* must be application/json`)
is the only change with a meaningful blast radius. I checked every
consumer in the repo:

| Caller | Sends `Content-Type: application/json`? | Verdict |
|---|---|---|
| `src/dashboard/lib/api.ts` (all dashboard fetches) | yes (explicit `Content-Type: 'application/json'` on every POST) | ✓ no regression |
| `src/server/index.ts` (MCP server → broker via `/api/heartbeat`, `/api/poll-messages`, etc.) | yes (line 196 `headers: { 'Content-Type': 'application/json' }`) | ✓ no regression |
| `src/cli/index.ts` & `src/cli/spawn.ts` | uses `fetch` — Node's built-in fetch defaults to `text/plain;charset=UTF-8` for string bodies, but the CLI passes JSON via `JSON.stringify` and explicit `'Content-Type': 'application/json'` headers (verified) | ✓ no regression |
| Test fixtures (`tests/**`) | yes (every fetch / rawPost we found uses `'Content-Type': 'application/json'`) | ✓ no regression — full suite green (453/453) |
| External tooling that posts to the broker (curl, scripts) | depends on the user — `curl -d '{…}'` defaults to `application/x-www-form-urlencoded`, which now returns 415 | ⚠ behaviour change |

**The one behaviour change**: ad-hoc `curl -d '{…}'` calls without
`-H 'Content-Type: application/json'` will now get 415 instead of
silently being parsed as a form-encoded body that happened to have a
JSON shape. This is the desired security behaviour but is a
breaking change for any operator who relied on the previous lenience.
Documented in the QW-1 commit message and in this audit so the next
operator who sees a 415 has a clear pointer.

The Origin gate is even narrower — it never affected anything that
already runs on loopback (remoteAddress check passes). Verified by
the full test suite staying green and the dashboard QA pass running
end-to-end without any unexpected 4xx in
`docs/audits/v0.2.3-security/qa-report.json`.

The QW-5 lifecycle change does NOT trigger on test code paths
(`installLifecycleHandlers` is only called from `main()` direct-run);
test runs use `createBrokerServer()` directly. So there's no
unhandledRejection-handler-fights-vitest interaction.

---

## 4. Estado del audit principal

The following checkboxes in `docs/audits/v0.2.2-comprehensive-audit.md`
flip from `- [ ]` to `- [x]` with this PR. Marked in
`docs/audits/v0.2.2-comprehensive-audit.md` as part of this commit
(see the diff in the same commit that adds this file).

- [x] **QW-1** Rechazar requests cuyo `Origin` no sea local + `Host` ≠ localhost · **fixed in `71cdb80` (v0.2.3)**
- [x] **QW-2** Añadir `verifyClient` a los dos `WebSocketServer` · **fixed in `f9e949a` (v0.2.3)**
- [x] **QW-3** `assertSafeIdentifier` + reject `ARCHITECT_ROLE` en `handleSetRole` · **fixed in `197120b` (v0.2.3)**
- [x] **QW-5** SIGTERM/SIGINT/uncaughtException/unhandledRejection · **fixed in `1099bc9` (v0.2.3)**
- [x] **S-NEW-1** CSRF + DNS-rebinding contra el broker HTTP · **fixed in `71cdb80` (v0.2.3)** (mismo que QW-1)
- [x] **S-NEW-2** WebSocket-hijacking → RCE · **fixed in `f9e949a` (v0.2.3)** (mismo que QW-2). **F-3 caveat closed in v0.2.4** (`40bc1db` + `ae0deb9` + `3f4cb54`) — token + Origin gate (AND).
- [x] **S-NEW-4** `handleSetRole` acepta cualquier string · **fixed in `197120b` (v0.2.3)**
- [x] **P-12** Sin handlers SIGTERM/SIGINT/uncaughtException · **fixed in `1099bc9` (v0.2.3)**
- [x] **M-5 v0.2.1** `set_role` sin whitelist · **fixed in `197120b` (v0.2.3)** (HTTP layer; MCP/CLI same handler)
- [x] **L-5 v0.2.1** HTTP `handleSetRole` sin validación · **fixed in `197120b` (v0.2.3)** (mismo que QW-3)
- [x] **H-3 caveat** `shellEscape(target)` en `scheduleAgentInit` · **fixed in `8380b53` (v0.2.3)**

Six new findings explicitly remain `- [ ]` because this PR's scope
was the listed quick-wins only:

- S-NEW-3 (cross-project leak en endpoints), S-NEW-5..10 (path
  traversal, attachment cap, role JSON injection, thread brute-force,
  blob ref leak, terminal rate-limit) — all out of scope.
- M-5 / M-7 v0.2.1 prompt interpolation residuals — out of scope.
- All §5 / §6 / §7 / §8 items — out of scope.

---

## 5. Final commit list

```
2eb033f  docs(audit): v0.2.2 comprehensive audit baseline + QA artifacts
f9e949a  fix(security): QW-2 verifyClient on /ws and /ws/terminal — Origin check [S-NEW-2]
71cdb80  fix(security): QW-1 reject non-JSON CT + Origin/Host check on HTTP [S-NEW-1]
197120b  fix(security): QW-3 validate set_role + reserve ARCHITECT_ROLE [S-NEW-4]
1099bc9  fix(security): QW-5 SIGTERM/SIGINT/uncaught handlers + graceful shutdown [P-12]
8380b53  fix(security): h3-caveat shellEscape(target) in scheduleAgentInit
649a30e  fix(qa): Q-22 BASE not defined in audit-qa.mjs fuzz()
093913f  docs(audit): v0.2.3 post-PR audit + QA artifacts + main audit updates
cefbb62  fix(qa): F-1 audit-qa.mjs uses real broker routes + suppresses fuzz noise   ← review cycle
b0ff7bd  fix(security): order WS shutdown terminals→events→db [QW-5 follow-up]      ← review cycle
```

Six original fix commits + one baseline + one initial post-PR doc +
two review-cycle fixes (F-1 fully closed, QW-5 close order made
explicit). All signed by the repo's author identity; none touch
`main`.
