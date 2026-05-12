# Cache discipline

> Where the team-coordination cost actually lives, and how to keep it cheap.

ACC builds on top of Claude Code, which uses Anthropic's prompt cache.
Cache reads are billed at **~10% of base input rate** — that's the rate
that makes multi-agent coordination economically reasonable. Discarding
the cache between every task pays full price each time.

This doc explains what's cached, what invalidates it, and the
"encender once, work many tasks" pattern that v0.3.3 measurements
showed is roughly **10× cheaper** than the alternative.

---

## What gets cached

Per agent, per `acc up` session:

- The **system prompt** built by `buildInstructions(...)` — ~735 tokens
  in v0.3.4, including the FASE A regla de concisión.
- **Project skills** appended at boot (everything in
  `~/.zaipex-acc/projects/<id>/skills/`, capped at 8 KiB total).
- **Tool definitions** for every MCP server attached to the agent
  (zaipex-acc + any powers like `git`, `postgres`, `playwright`).
- **Recent conversation history** with the broker (last N turns,
  size depends on traffic).

The first turn after `acc up` pays full price to write the cache.
**Every subsequent turn reads from cache** at the discounted rate
until the cache expires.

### Cache TTL

Anthropic controls cache expiry. In practice:

- **Default**: ~5 minutes of inactivity invalidates the cache.
- **`ephemeral_1h_*` keys**: the model gets to keep specific cache
  blocks for ~1 hour. This is why a busy team can stay "warm" all
  morning without re-paying input costs.
- **Idle 10+ minutes**: cache cold, next turn re-pays write cost.

`token_usage` rows in the broker DB split out `cache_creation_tokens`
(the write) and `cache_read_tokens` (the read) so you can see in the
TokensPanel whether you're paying write cost (cold) or read cost
(warm).

---

## What invalidates the cache

Any change to the **prefix** of the cached content invalidates everything
after that change. The relevant invalidators for ACC:

1. **`acc down`** kills the claude process. Next `acc up` is a fresh
   session — cold cache. Pays full write cost on first turn.
2. **Editing any skill file** in `~/.zaipex-acc/projects/<id>/skills/`.
   The loader re-reads at boot, so the skill content is part of the
   prefix; a change shifts the prefix and invalidates downstream
   caches.
3. **Changing an agent's `instructions`** field or `role` in the
   project config. Same reasoning — they're in the system prompt.
4. **Swapping the agent's `model`** (e.g. Sonnet → Opus). Caches are
   per-model.
5. **Changing powers** (the v0.3.3 FU-Y restart hint is the visible
   reminder of this).
6. **Broker restart**. The agent processes survive, but the broker's
   shared-state caches don't carry across restarts.

What does NOT invalidate the cache:

- Sending new user / agent messages (those go AFTER the cached prefix).
- Editing files in the agent's `cwd` (cwd is part of the prompt but
  doesn't change during a session).
- Recalling / remembering team memory (`recall` / `remember` are tools,
  their bodies are inputs not prompt prefix).

---

## The "encender once, work many tasks" pattern

**Do:**

- Start the team with `acc up` (or "Encender" in the dashboard) once
  at the start of a working session.
- Send the team as many tasks as you want over the next 1-2 hours.
- The first task pays the write cost (~$0.50-$2 depending on team
  size). Every subsequent task pays the read cost (~10× cheaper).

**Don't:**

- Send a task, hit "Apagar" because "I'm done for now", then "Encender"
  10 minutes later for the next task. **Each cycle re-pays the write
  cost.**
- `acc down` + `acc up` between unrelated tasks "to start fresh".
  Even if the tasks are unrelated, the cached prefix is the same
  (it's the agent's identity, not the task's content). Reusing it is
  pure win.

### Measured impact

In the v0.3.3 EQUIPO-5 live evaluation:

- Total: **10.5M tokens, 226 turns, ~$30**.
- Breakdown: **~85% cache_read** (~$2 at discount) + ~15% other
  categories (input, output, cache_write — the bulk of the $30).
- If we'd run **without cache** (e.g. 5 separate `acc up/down` cycles
  for the same 5 sub-tasks), total cost would have been
  ~$300 instead of $30. The cache is the difference between
  "interesting demo" and "actually usable in production."

The single highest-leverage cost optimization you can do as a user
is **leave the team running** between related tasks.

---

## When to actually `acc down`

- End of the working day (cache expires soon anyway).
- Switching to a different project where you'll be for a while
  (the broker can only host one active team at a time).
- After a meaningful config change (powers, skills, instructions,
  model) — the cache is already invalidated, might as well restart
  cleanly.
- The agents are misbehaving and you want to reset their conversation
  state. Rare, but legitimate.

If you find yourself reaching for `acc down` to "give the team a break,"
**don't**. The team has no concept of break and the dashboard already
keeps you informed about what they're doing. Leave them warm.

---

## v0.3.4 — UI warning

When the dashboard detects an `acc down` followed by `acc up` within
**60 seconds**, it shows a non-blocking inline notice:

> *"Reiniciar el equipo descarta el cache de contexto (~$1-3 por
> reset en proyecto típico). Si solo necesitas que algo cambie,
> revisa skills o powers en lugar de reiniciar."*

This is a soft warning — the user can still proceed if they meant to.
The threshold (60 s) and the cost estimate (~$1-3) are calibrated
against the v0.3.3 measurement. If your team is larger or your
skills set is unusually big, your reset cost is proportionally higher.
