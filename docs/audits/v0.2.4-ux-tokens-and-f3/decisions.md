# v0.2.4 — Decisions log (M-1c)

> Records the load-bearing trade-offs from the v0.2.4 cycle. Future
> rounds should read this before re-opening any of the deferred items.

---

## D-1 · System-prompt compression: conservative target, not aggressive

**Context.** `docs/audits/v0.2.2-comprehensive-audit.md` §7-bis offered
two targets:

- **Conservative**: 1,920 → ~1,400 tokens (~27% recorte). Risk: low.
- **Aggressive**: 1,920 → ~900 tokens (~53% recorte). Risk: medium-high
  — would collapse A5/A6/G2 cluster, which §7-bis flags as "refuerzo
  intencional débil" added in commit `20c7a07` to address production
  refusals.

**Decision.** v0.2.4 ships only the conservative cut. The aggressive
target is **deferred to v0.3.0** until an eval-harness exists.

**Numbers honestly:**

| Layer | Pre-v0.2.4 | Post-v0.2.4 | Δ tokens | Δ % | Source |
|---|---|---|---|---|---|
| System prompt aislado (`buildInstructions`) | 1,922 | 1,540 | **−382** | ~20% | `tests/server/instructions.test.ts` snapshot, measured with `name='Turing', role='backend'` |
| Audit §7-bis conservative target | 1,920 | 1,400 | −520 | ~27% | `docs/audits/v0.2.2-comprehensive-audit.md` line 428 |
| Audit-target shortfall | — | — | **−138** | — | A5+A6+G2 cluster preserved (see below) |

**Why the audit-target had ~138 more tokens of headroom than what M-1b
recovered.** The conservative target table in §7-bis (line 428)
includes "(b) merge A4+G6", "(c) reescribir A2", "(d) acortar G9", and
"(a) borrar `## Your tools` list" — exactly what M-1b applies. The
audit's quoted ~520-tok recorte appears to assume slightly different
baselines for each item (the audit measured against the *combined*
contribution of overlapping rules). Our 382-tok delta is the
empirical, end-to-end measurement: it's the truth for `buildInstructions`
output.

**The remainder of the audit's projected savings comes from the other
M-* items in this cycle:**

| Item | Projected savings | Status v0.2.4 |
|---|---|---|
| **M-1b** (this commit) | ~−382 tok / system prompt | ✅ shipped |
| **M-3** (`set_shared` accepts object) | ~−50 tok / agent / session avg (avoids retries from agents that forgot to JSON.stringify) | ✅ shipped |
| **M-6** (compact attachment footer) | ~−70 tok / attachment | ✅ shipped |
| **M-7** (`send_to_role` JSON shape) | ~−30 tok / agent / session avg (no string parsing for caller chains) | ✅ shipped |
| **M-11** (drop MessageType enum from 3 input schemas) | ~−70 tok | ⏸ v0.3.0 |
| Projected combined savings | ~−602 tok / agent / session | partial |

So the audit-target ~520 tok was for the *system prompt only*; v0.2.4
delivers ~382 there and another ~150 distributed across M-3/M-6/M-7
(per-attachment / per-call). M-11 is the missing piece — the
MessageType enum repeats across `send_message`, `send_to_role`,
`get_history` schemas (~70 tok of duplication). It's deferred because
JSON-schema drops have caused agent compatibility issues elsewhere
and need a small migration.

**What we did NOT collapse, and why.**

- **A5** (no-refusal): added in `20c7a07` after the team observed
  agents replying "esa no es mi área" in production. Until we have a
  reproducible eval (5-10 scenarios, baseline + variant) we can't
  prove the rule is dead weight.
- **A6** (just-do-it): paired with A5 — agent-to-agent task
  pre-authorization. Same reasoning.
- **G2** (respond immediately, don't ask permission): same cluster.
- **U4b** (no intermediate "preguntando a X" status messages):
  introduced separately in `4b8af78`, attacks a *different* failure
  mode (verbose narration toward the user). Not in the audit's
  collapse target.
- **`MessageType` enum repetition** in 3 input schemas (~70 tok):
  M-11 in audit. Skipped in v0.2.4 because changing the schema means
  potentially breaking existing agents in flight. Leave for v0.3.0 +
  migration test.

**What unblocks the aggressive target (~900 tok).** A reproducible
eval at `scripts/eval/agent-prompt-eval.mjs` (path proposed by §7-bis
line 432) covering at least:

  1. Agent-to-agent task receipt: variant must still execute without
     pestering the user.
  2. Vague refusal trigger: variant must NOT respond "ask another
     agent".
  3. User filler trigger: variant must NOT prepend "estoy
     consultando".
  4. Save-resume trigger: variant must execute without G9 expanded.
  5. Cross-agent escalation: variant must coordinate silently.

If aggressive variant + harness pass all five with zero regressions
across 3+ runs, escalate. Otherwise hold.

---

## D-2 · CSRF token store is in-memory, not persisted

**Context.** F-3 introduces a Map<token, …> in `src/broker/csrf-tokens.ts`
to gate `/ws/terminal/<role>` upgrades.

**Decision.** Tokens live only in memory. They are not written to the
SQLite db.

**Why.** TTL is 60 seconds and tokens are one-shot. A broker restart
naturally invalidates them, which is the desired behaviour: the
dashboard's `useDashboardPeer` heartbeat will re-register on
broker-down anyway, and a fresh `requestWsToken` call will issue a
new one. Persistence would buy us nothing, and would introduce a
real risk of leaking long-lived tokens into a backup.

**Token cleanup.** `startTokenCleanup` registers a 30-second interval
that purges expired entries; the broker's `shutdownBroker` (QW-5)
calls `stopTokenCleanup` first in the lifecycle order so the timer
doesn't fight the shutdown event loop.

---

## D-3 · UX-1: hide /history rather than implement it

**Context.** `App.tsx:9-11` rendered a literal `<h1>History</h1>` stub.

**Decision.** Remove the route. Catch-all `<Route path="*">` redirects
unmatched paths to `/`.

**Why.** Implementing a full history page is v0.3.0 scope (depends on
the cross-project leak fixes S-NEW-3 and the `get_history` paginated
defaults from M-5). Leaving the placeholder in confused users who
clicked the route from a stale link. Hiding it removes confusion at
zero feature cost.

---

## D-4 · WS token validation runs BEFORE proc-existence check

**Context.** F-3-C order in `handleTerminalUpgrade`:

  1. Origin gate
  2. Token gate (consumes the token)
  3. Proc-existence check (503 if no live agent)

**Decision.** Token consumption happens *before* the proc check.

**Why.** A cross-port attacker with no token sees 403 at step 2 — they
cannot distinguish "role exists" from "role missing" via 503-vs-403.
Only a holder of a valid token (the legitimate dashboard) ever sees
503, and it can re-request a fresh token if it acted on a stale view.

**Cost.** A dashboard whose agent dies between `requestWsToken` and
the WS connect attempt burns one token per failed attempt. With a 60s
TTL and the dashboard's exponential-backoff retry, this is a
negligible amount of extra DB-less Map churn.

---

## D-5 · Self-host fonts, drop fontsource (npm package)

**Context.** UX-3 needs DM Sans, DM Serif Display, JetBrains Mono
served locally instead of from `fonts.gstatic.com`.

**Decision.** Download three woff2 files (latin-only subset, variable
fonts where applicable) directly to `src/dashboard/public/fonts/`. No
new dependency.

**Why.**

- `@fontsource/*` would have added 3 npm packages to the dependency
  graph for ~85 KB of static files. Net loss in supply-chain surface.
- Latin subset covers ES + EN, which is what the dashboard targets.
  Latin-ext (cyrillic-extra-Latin) was dropped: 7 fewer files.
- Variable fonts mean weights 400-700 share one .woff2 each — total 3
  files for 11 weight × family combinations.

**Verification.** `qa-report.json.externalResources` must be empty
after the v0.2.4 QA pass.
