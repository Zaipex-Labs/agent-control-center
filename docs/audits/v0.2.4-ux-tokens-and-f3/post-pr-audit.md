# Post-PR audit · v0.2.4 UX + tokens + F-3

**Branch**: `fix/v0.2.4-ux-tokens-and-f3` · **Commits**: 17 (3 F-3 + 6 UX + 5 tokens + 1 build fixup + 2 docs)
**Base**: `ee91c5f` (main, v0.2.3) · **Head**: `b18d2a4`
**Date**: 2026-05-09

This document closes the v0.2.4 PR loop: it lists each fix with
runnable evidence, the new bugs spotted while shipping, and which
checkboxes in `docs/audits/v0.2.2-comprehensive-audit.md` move from
`- [ ]` to `- [x]`.

---

## 1. Verificación de fixes

### F-3 (security — close residual S-NEW-2 cross-port hijack)

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **F-3-A** · `/api/csrf/issue` endpoint + Map storage + lifecycle cleanup | ✅ fixed | code: `src/broker/csrf-tokens.ts` (token store), `src/broker/handlers.ts:961-995` (handleCsrfIssue), `src/broker/index.ts:135-141, 285-287, 314-316` (route + lifecycle) · tests: `tests/security/ws-csrf-token.test.ts` (12 cases — token store unit + handler validation + cross-project rejection) · evidence: `evidence/ws-token-flow.txt` · commit `40bc1db` |
| **F-3-B** · dashboard requests token before /ws/terminal | ✅ fixed | code: `src/dashboard/lib/api.ts:111-127` (requestWsToken), `src/dashboard/components/Terminal.tsx:21-101` (peerId from context, awaits token, carries via Sec-WebSocket-Protocol) · build: vite OK · commit `ae0deb9` |
| **F-3-C** · handleTerminalUpgrade consumes acc-token subprotocol | ✅ fixed | code: `src/broker/terminal.ts:42-72` (handleProtocols echo + extractAccToken), `src/broker/terminal.ts:511-528` (consume + binding match) · tests: `tests/security/ws-cross-port-blocked.test.ts` (7 cases: no token, wrong role, wrong project, expired, replay, valid+no-agent, malformed) + `tests/security/ws-origin-check.test.ts:163-171` (updated 503-vs-403 assertion) · commit `3f4cb54` |

**Net effect**: cross-port WS hijack on `http://127.0.0.1:<other-port>`
is now blocked because the attacker has no peer_id (different origin's
localStorage), cannot trade for a token, cannot pass the gate. Token +
Origin = AND, not OR. F-3 caveat in `v0.2.3-security/followups.md` is
closed.

### UX

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **UX-1** · `/history` placeholder | ✅ fixed | code: `src/dashboard/App.tsx` — route removed, catch-all `<Route path="*">` redirects to `/` · evidence: `evidence/history-hidden.txt` · screenshot: `screenshots/history-redirect.png` · commit `68a39ca` |
| **UX-2** · Mobile (390/500px) reflow | ✅ fixed | code: `src/dashboard/styles/zaipex.css` @media `<= 768px` rules + `src/dashboard/pages/TeamsPage.tsx` + `ProjectPage.tsx` className tags · evidence: `evidence/mobile-no-overflow.txt` · screenshots: `screenshots/teams-mobile.png`, `screenshots/project-with-agents-mobile.png` · commit `57bbab6` |
| **UX-3** · Google Fonts external resource leak | ✅ fixed | code: `src/dashboard/index.html` (link tags removed), `src/dashboard/styles/zaipex.css` (@font-face), `src/dashboard/public/fonts/*.woff2` (3 files) · evidence: `evidence/fonts-local.txt` (claude-in-chrome read_network_requests showing `/fonts/` only, 0 fonts.gstatic.com) · commit `11e01fe` |
| **UX-4** · `/api/blobs/<bad-hash>` falls through to SPA | ✅ fixed | code: `src/broker/index.ts:228-234` — `/api/*` typed JSON 404 before SPA fallback · tests: `tests/security/http-origin-check.test.ts` (3 new cases) · evidence: `evidence/blob-404.txt` · commit `b08ad60` |
| **UX-5** · Triple empty-state CTA | ✅ fixed | code: `src/dashboard/pages/ProjectPage.tsx:455-477` — sidebar reduced to em-dash; central EmptyState retains the only CTA · evidence: `evidence/empty-state-clean.txt` · screenshot: `screenshots/project-empty-desktop.png` · commit `a9e1235` |
| **UX-6** · Header buttons unclear / shutdown shows on empty | ✅ fixed | code: `src/dashboard/pages/ProjectPage.tsx:395-456` — Save tooltip describes disabled reason, Panel toggle is directional, Shutdown hidden when activeCount === 0 · i18n: 6 new keys (3 EN + 3 ES) · evidence: claude-in-chrome `find()` returns the title attribute on the button · commit `9b3e284` |

### Tokens (M-* per audit §7)

| Hallazgo | Estado | Evidencia |
|---|---|---|
| **M-1a** · save-resume protocol injected dynamically | ✅ shipped | code: `src/broker/handlers.ts:680-707` — `buildSaveResumePrompt(role, now, kind)` produces the self-contained protocol · commit `bc94af9` |
| **M-1b** · system prompt conservative compression | ✅ shipped | code: `src/server/index.ts:53-117` — drop `## Your tools`, merge A4+G6, rewrite A2, collapse G9 · tests: `tests/server/instructions.test.ts` (12 cases — 6 prompt-structure asserts, 5 buildSaveResumePrompt E2E asserts, 1 length budget) · measurements: 7,685 → 6,157 chars, 1,922 → 1,540 tokens (~−382 tok / ~20%) · diff: `prompt-diff.md` · commit `5cd9471` |
| **M-1c** · decisions log | ✅ shipped | doc: `decisions.md` (D-1 conservative-vs-aggressive trade-off; D-2 in-memory token store; D-3 hide /history; D-4 token-before-proc; D-5 self-hosted fonts) · commit `2205621` |
| **M-3** · `set_shared.value` accepts string|object | ✅ shipped | code: `src/server/tools.ts:185-217` · tests: `tests/server/tools.test.ts` (2 new cases) · commit `afc06e0` (+ `b18d2a4` tsc fixup) |
| **M-4** · `delete_shared` exposed as MCP tool | ✅ shipped | code: `src/server/tools.ts:243-280` · tests: `tests/server/tools.test.ts` (2 new + registration list updated) · commit `9f22e0d` |
| **M-6** · compact attachment footer | ✅ shipped | code: `src/shared/attachments.ts:85-103` — `[image: <hash[:8]>.<ext> · <size>]` · tests: `tests/shared/attachments.test.ts` (2 new asserting no path leak) + `tests/server/channel-attachments.test.ts` (carry-over: existing tests updated to new format) · commit `9ebb3ab` |
| **M-7** · `send_to_role` JSON shape | ✅ shipped | code: `src/server/tools.ts:142-152` · tests: `tests/server/tools.test.ts` (existing assertion updated) · commit `b0e2276` |
| **M-9** · language-agnostic A2 phrasing | ✅ shipped | merged into M-1b (`5cd9471`) — A2 now reads "no filler acknowledgements ('thanks', 'sure thing', 'let me know if…')" |

### How to reproduce verification on a fresh checkout

```bash
# 1. build
npm run build && npm run dashboard:build

# 2. start a side broker on a non-default port
ACC_HOME=/tmp/acc-qa-v0.2.4 ACC_PORT=7929 node dist/broker/index.js &

# 3. seed projects so the dashboard has content
curl -s -X POST http://127.0.0.1:7929/api/project/create \
  -H "Content-Type: application/json" -H "Origin: http://localhost:7929" \
  -d '{"name":"demo-team","description":"QA test project with backend + frontend agents"}'
curl -s -X POST http://127.0.0.1:7929/api/project/add-agent \
  -H "Content-Type: application/json" -H "Origin: http://localhost:7929" \
  -d '{"project_id":"demo-team","role":"backend","name":"Turing","cwd":"/tmp"}'
curl -s -X POST http://127.0.0.1:7929/api/project/add-agent \
  -H "Content-Type: application/json" -H "Origin: http://localhost:7929" \
  -d '{"project_id":"demo-team","role":"frontend","name":"Lovelace","cwd":"/tmp"}'
curl -s -X POST http://127.0.0.1:7929/api/project/create \
  -H "Content-Type: application/json" -H "Origin: http://localhost:7929" \
  -d '{"name":"empty-team","description":"Project with only the architect"}'

# 4. run QA pass (regenerates docs/audits/qa-out)
QA_BASE=http://127.0.0.1:7929 ACC_PORT=7929 node scripts/audit-qa.mjs

# 5. test UX-4 manually
curl -i http://127.0.0.1:7929/api/blobs/notahash
curl -i http://127.0.0.1:7929/api/does-not-exist

# 6. test F-3 endpoint manually (replace dash-id with the value from
#    /api/register and a real role of an alive agent)
curl -X POST http://127.0.0.1:7929/api/csrf/issue \
  -H "Content-Type: application/json" -H "Origin: http://localhost:7929" \
  -d '{"peer_id":"<dash-id>","project_id":"demo-team","role":"backend"}'
```

### Test suite

```
$ npx vitest run
Test Files   51 passed (51)
     Tests  492 passed (492)
   Duration  ~1.3s
```

New test files / extensions:
- `tests/security/ws-csrf-token.test.ts` — 12 cases (token store + handler)
- `tests/security/ws-cross-port-blocked.test.ts` — 7 cases (full WS gate)
- `tests/server/instructions.test.ts` — 12 cases (system prompt M-1b + buildSaveResumePrompt E2E)
- `tests/security/ws-origin-check.test.ts` — 1 updated case (503 → 403)
- `tests/security/http-origin-check.test.ts` — 3 new cases (UX-4)
- `tests/server/tools.test.ts` — 4 new cases (M-3, M-4) + 1 updated (M-7)
- `tests/shared/attachments.test.ts` — 2 updated (M-6 compact)
- `tests/server/channel-attachments.test.ts` — 2 updated (M-6 carry-over)

`npx tsc --noEmit` exits clean (0 errors).
`npm run dashboard:build` exits clean.
`npm audit --audit-level=high` reports 0 vulnerabilities.

---

## 2. Hallazgos nuevos detectados durante la PR

| ID | Severidad | Resumen | Tracker |
|---|---|---|---|
| FU-1 | Bajo | Empty-state center column shows the same CTA when project has only the architect agent (since the architect is filtered out of "active" peers). The semantics are correct — only the user-facing copy could be richer ("Empieza por Encender — solo el arquitecto está presente") | `followups.md` §FU-1 |
| FU-2 | Info | claude-in-chrome `read_network_requests` confirmed 0 external fonts, but the qa-report.json schema produced by `audit-qa.mjs` does not have an `externalResources` field — it relies on `failedRequests` being empty. We should add an explicit assert to the script | `followups.md` §FU-2 |
| FU-3 | Info | `_resetShutdownLatchForTests` was added in v0.2.3; F-3 brings new test-only helpers (`_resetTokensForTests`, `_peekTokenForTests`, `_tokenCountForTests`). Convention is "underscore prefix = test-only" but there's no programmatic enforcement (eslint rule). | `followups.md` §FU-3 |
| FU-4 | Bajo | `useDashboardPeer` heartbeat handles broker-down by re-registering on next cycle, but a token request that fires *while* the heartbeat is mid-retry can race. Symptom: 1-2 extra retries on the WS reconnect. Not user-visible. | `followups.md` §FU-4 |

---

## 3. Regresiones potenciales

This release has three meaningful behaviour changes; I checked each
consumer in the repo:

### a) UX-3 self-hosted fonts vs system fonts

The `font-family: var(--font-sans)` already had system fallbacks
(`-apple-system, sans-serif`), so a font failing to load doesn't
break the page. Visual consistency with the v0.2.3 baseline is
preserved — verified side-by-side with `screenshots/teams-desktop.png`
on this branch vs the v0.2.3 audit screenshot at
`docs/audits/v0.2.3-security/screenshots/teams-desktop.png`.

### b) F-3 token gate vs legitimate dashboard

The dashboard's existing flow (`Terminal.tsx`) was the only consumer
of `/ws/terminal/<role>`. The token request is awaited before the WS
opens; failures (e.g. broker-down) reuse the existing
exponential-backoff retry path. Since the dashboard's
`useDashboardPeer` already re-registers on broker reconnect, the
new gate piggybacks cleanly on the existing reconnection logic.

### c) M-1b prompt compression

Risk: an agent whose previously-needed rule was compressed away
might regress. Mitigation: `tests/server/instructions.test.ts` locks
in (i) prompt length budget, (ii) "## Your tools" gone, (iii) A4
mentions silent + G6 gone, (iv) A2 language-agnostic, (v) G9
collapsed, plus 5 E2E asserts on `buildSaveResumePrompt` ensuring
the broker-injected protocol still names every required JSON key
(summary, next_steps, open_questions, updated_at) and instructs
"silently".

A behavioural eval-harness (`scripts/eval/agent-prompt-eval.mjs`)
is the right next layer; deferred to v0.3.0 per
`decisions.md` D-1.

---

## 4. Estado del audit principal

The following checkboxes in `docs/audits/v0.2.2-comprehensive-audit.md`
flip from `- [ ]` to `- [x]` with this PR (already updated in-place
in the same commit list):

- **F-3** (`v0.2.3-security/followups.md`): closed
- **S-NEW-2 caveat**: 100% (Origin + token AND-gated)
- **UX-1, UX-2, UX-3, UX-4, UX-5, UX-6**: all closed
- **M-1, M-3, M-4, M-6, M-7, M-9**: all closed

`v0.2.3-security/post-pr-audit.md` is also updated to reflect F-3
closure (the S-NEW-2 caveat row no longer carries an asterisk).

---

## 5. Final commit list

```
40bc1db  fix(security): F-3-A CSRF token endpoint + lifecycle cleanup
ae0deb9  fix(security): F-3-B dashboard requests CSRF token before /ws/terminal
3f4cb54  fix(security): F-3-C handleTerminalUpgrade consumes acc-token subprotocol
68a39ca  fix(ux): UX-1 hide /history placeholder route until the page exists
57bbab6  fix(ux): UX-2 mobile reflow at <768px (cards + ProjectPage header)
11e01fe  fix(ux): UX-3 self-host DM Sans / DM Serif / JetBrains Mono
b08ad60  fix(ux): UX-4 /api/* never falls through to SPA fallback (typed 404)
a9e1235  fix(ux): UX-5 collapse empty-state CTA to a single central call-to-action
9b3e284  fix(ux): UX-6 disabled tooltips, hide shutdown when 0 agents, label panel
bc94af9  fix(tokens): M-1a save-resume protocol injected dynamically by broker
5cd9471  fix(tokens): M-1b conservative system-prompt compression (~382 tok / ~20%)
2205621  docs(audit): M-1c v0.2.4 decisions log (D-1..D-5)
afc06e0  fix(tokens): M-3 set_shared accepts string OR object, JSON-encodes server-side
9f22e0d  fix(tokens): M-4 expose delete_shared as an MCP tool
9ebb3ab  fix(tokens): M-6 compact attachment footer (~55 tok/attachment saved)
b0e2276  fix(tokens): M-7 send_to_role returns broker JSON shape (not free-form string)
b18d2a4  fix(build): tsc error on z.record needing 2 args (M-3 follow-up)
```

Three F-3 commits + six UX commits + five tokens commits + one
build fixup + two audit doc commits. None touch `main`.
