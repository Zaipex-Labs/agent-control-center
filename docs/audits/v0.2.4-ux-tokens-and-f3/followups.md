# v0.2.4 — follow-ups discovered while shipping UX + tokens + F-3

Bugs and observations noticed during the v0.2.4 implementation/QA
pass that were deliberately NOT fixed in this PR. None of them block
the v0.2.4 ship.

---

## FU-1 · Empty-state copy on a project with only the architect · *Bajo*

When a project has just the permanent tech-lead (`arquitectura`)
agent and no other roles, the central panel still renders
`No hay agentes activos en este proyecto` + `Encender equipo`.

That copy is technically accurate — the architect counts as a
dashboard-internal peer, not an "active agent" in the team sense —
but it can confuse a new user who *just* added the team.

- **Fix idea**: when `agents.length === 1 && agents[0].role ===
  ARCHITECT_ROLE`, render a slightly different message:
  `Tu equipo aún no tiene roles. Encender equipo arrancará al
  arquitectura.`
- **Where**: `src/dashboard/pages/ProjectPage.tsx:643-652`
- **Effort**: ~10 LOC + 1 i18n key.

---

## FU-2 · audit-qa.mjs has no `externalResources` field · *Info*

The QA contract in the v0.2.4 plan asks for `externalResources: []`
in `qa-report.json`. Today the script asserts the implicit version
(everything that loaded was 200, no failed requests), but the report
has no field that explicitly enumerates the external origins it saw.

The verification we ran in claude-in-chrome (live
`read_network_requests` on the tab) did show 0 external requests,
but a CI-runnable artifact would be safer.

- **Fix idea**: in `scripts/audit-qa.mjs`, after each `page.goto(...)`,
  walk `page.frames()` and capture
  `frame.url()`/`frame.requests()` for any URL whose origin is not
  `http://127.0.0.1:<port>`. Write the list under
  `report.externalResources` (or `[]` when clean).
- **Effort**: ~30 LOC.

---

## FU-3 · No eslint rule enforces `_underscorePrefix = test-only` · *Info*

We've added several `_resetXForTests`, `_peekXForTests`,
`_tokenCountForTests` helpers (in `csrf-tokens.ts`,
`broker/index.ts:_resetShutdownLatchForTests`). The convention is
that anything starting with `_` should never be imported from
production code, but nothing enforces this. A future contributor
could accidentally tree-shake them away or, worse, call them at
runtime.

- **Fix idea**: eslint rule `no-restricted-imports` paired with a
  small custom rule that blocks `_*` imports outside
  `tests/**`. Or rename to `__INTERNAL__resetX` with explicit
  `@internal` JSDoc.
- **Effort**: ~30 LOC (eslint rule) once the project actually adopts
  eslint (Q-1 in v0.2.2 audit).

---

## FU-4 · Token request can race the dashboard heartbeat re-register · *Bajo*

Scenario:
  1. Broker restarts.
  2. Dashboard's `useDashboardPeer` heartbeat fails next tick → tries
     to re-register.
  3. Before the re-register lands, `Terminal.tsx` calls
     `requestWsToken(projectId, role, peerId!)` with the *stale*
     peerId.
  4. Broker rejects 403 (peer not registered).
  5. Terminal.tsx's catch schedules a retry; the heartbeat
     re-registers; next attempt succeeds.

Net result: 1-2 extra retries on the WS reconnect, no functional
breakage. Visible in the dev console as transient 403 lines.

- **Fix idea**: `useDashboardPeer` exposes a small
  `awaitFreshPeerId()` Promise that the Terminal awaits before its
  first token request after reconnect. Or simpler: token-request
  retry with a clear "stale peer" hint that triggers an immediate
  re-register.
- **Effort**: ~20 LOC.

---

## FU-5 · `installLifecycleHandlers` idempotency (carry-over from v0.2.3 F-4) · *Info*

Still open: registering CSRF token cleanup added another piece of
shared state that benefits from idempotent install. The fix in
v0.2.3 followups F-4 should now be done as a unit.

- **Fix idea**: track a "lifecycle handlers installed" boolean (or a
  WeakSet of servers) and no-op on repeat.
- **Effort**: ~10 LOC; landing this also retires F-4 from
  v0.2.3 followups.
