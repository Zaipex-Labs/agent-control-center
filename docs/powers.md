# Powers (extra MCP servers per agent)

> Attach external Model Context Protocol (MCP) servers to a specific
> agent at spawn time. The ACC team-coordination tools stay available
> on every agent; powers add one or more *additional* MCP servers so
> a role can do work the coordinator tools alone can't (read git
> history, query a database, drive a browser).

Available since **v0.3.2**.

---

## How it works

Every agent in a project config can declare a `powers` array of
canonical names. At spawn time the broker resolves each name against
a static registry (`src/shared/powers.ts`), substitutes template
variables (`${cwd}`, `${ENV_NAME}`), and writes a per-agent JSON
file that gets passed to `claude` via `--mcp-config`.

Persistent state and on-disk layout:

```
~/.zaipex-acc/projects/<project>/
├── <project>.json              # project config (declares powers)
├── skills/                     # per-project skills (v0.3.0)
└── mcp/
    └── <role>.json             # generated --mcp-config (v0.3.2)
```

The `mcp/<role>.json` file is regenerated on every "Encender" so
registry updates, env-var changes, and template substitutions stay
in sync. An agent that opts OUT of every power has its file removed
so no stale wiring lingers.

---

## The v0.3.2 seed registry

| Name         | What it does                                                  | Requires env                  | Launch command                                              |
|--------------|---------------------------------------------------------------|-------------------------------|-------------------------------------------------------------|
| `git`        | Read-only git inspection (log, diff, show, status)            | —                             | `uvx mcp-server-git --repository <agent cwd>`               |
| `postgres`   | Read-only SQL access (SELECTs only)                            | `POSTGRES_CONNECTION_STRING`  | `npx -y @modelcontextprotocol/server-postgres <conn-string>` ⚠️ deprecated, see below |
| `playwright` | Browser automation (navigate, click, fill, screenshot)         | —                             | `npx -y @playwright/mcp@latest`                             |

You'll need the underlying runners installed on your machine:

- `uvx` — installs Python MCP servers in an ephemeral env. Install
  with `pip install pipx && pipx install uv` or via your package
  manager. First `git`-power spawn downloads ~33 deps; subsequent
  spawns reuse the cached install (~ms boot).
- `npx` — bundled with Node.js. Used for both `postgres` and
  `playwright`.

### Postgres power: upstream deprecation (as of 2026-05)

`@modelcontextprotocol/server-postgres@0.6.2` prints
`Package no longer supported. Contact Support at https://www.npmjs.com/support`
on every spawn. The package still works for now, but it will likely
stop receiving security fixes. Maintained alternatives at the time of
writing include `@henkey/postgres-mcp-server` (Node) and
`crystaldba/postgres-mcp` (Python, served via uvx). We did NOT swap
the registry in v0.3.2 because the MCP-postgres ecosystem is still
fragmenting — see FU-Z in `docs/audits/v0.3.2-powers-observability/
followups.md`. Switching is a one-line registry change once the
community converges on a successor.

For now: if your team relies on the postgres power, treat the
deprecation warning as a soft DEPRECATED notice. The `git` and
`playwright` powers are unaffected.

Adding a new power is a code change: append an entry to
`POWERS_REGISTRY` in `src/shared/powers.ts`, add a test in
`tests/shared/powers.test.ts`, and the dashboard picker picks it up
automatically (no separate UI work).

---

## Turning powers on for an agent

From the dashboard:

1. Open the team's **Edit** modal.
2. Each agent card now has a **Powers** section between Path and
   Instructions.
3. Toggle the powers you want for that agent. If a power requires an
   env var (e.g. `POSTGRES_CONNECTION_STRING`), the modal shows a
   hint inline.
4. Save.

From a raw project JSON (`~/.zaipex-acc/projects/<project>.json`):

```jsonc
{
  "name": "my-team",
  "description": "…",
  "agents": [
    {
      "role": "arquitectura",
      "cwd": "/Users/me/.zaipex-acc/techlead/my-team",
      "agent_cmd": "claude",
      "agent_args": [],
      "instructions": "…",
      "powers": ["git"]
    },
    {
      "role": "backend",
      "cwd": "/repo/backend",
      "agent_cmd": "claude",
      "agent_args": [],
      "instructions": "…",
      "powers": ["git", "postgres"]
    }
  ]
}
```

The field is fully optional; agents that don't declare it keep the
ACC-only setup they had pre-v0.3.2.

---

## What happens at spawn time

For each agent with `powers`:

1. **Resolve** the name → `POWERS_REGISTRY[name]`. Unknown names log
   a `[powers] agent "<role>": power "<name>" not in registry` line
   to broker stderr and are skipped.
2. **Check required env**. If any name in `requiredEnv` is missing or
   empty, the broker logs a warning naming the variable(s) and skips
   the power. Other powers on the same agent still apply.
3. **Substitute** template variables. `${cwd}` becomes the agent's
   working directory; `${ENV_NAME}` is replaced with the inherited
   env value.
4. **Write** `~/.zaipex-acc/projects/<project>/mcp/<role>.json` in
   the canonical Claude Code shape:

   ```json
   {
     "mcpServers": {
       "git": {
         "command": "uvx",
         "args": ["mcp-server-git", "--repository", "/repo/backend"]
       }
     }
   }
   ```

5. **Append** `--mcp-config <path>` to the claude invocation alongside
   the existing `--dangerously-skip-permissions
   --dangerously-load-development-channels server:zaipex-acc`.

The result: when the agent boots, it sees both the ACC team tools
AND the power's tools in its MCP catalog. The model can call them
freely.

---

## Telling the agent to actually use a power

Instructions and skills are still the source of truth for the
*behavioral* layer. A power gives the model access to tools; what it
does with them is up to your prompts.

Two ways to nudge a role toward a power:

### 1. Per-agent instruction

In the agent's `instructions` field (Edit modal → Instructions):

> You have the `git` power. Before modifying any file, call
> `git_log --max-count 5 <path>` to understand recent context. Cite
> commit shas in your reply so the user can follow up.

### 2. Project-wide skill

Drop a markdown file into `~/.zaipex-acc/projects/<project>/skills/`
(or use the dashboard's Skills editor). Every agent on the team
loads it. See `docs/skills/example-power-git.md` for a starter.

---

## Security note

Powers run with the same permissions as the agent process. The
broker's defense-in-depth around shell-metacharacter validation
(H-3, FU-H) covers the agent's identifier, NOT the env-var values
the spawner substitutes into argv. Treat `POSTGRES_CONNECTION_STRING`
and any other `requiredEnv` variable as trusted input.

The Claude Code flag `--dangerously-skip-permissions` stays in
effect, same as before powers existed. If you've got a more
restrictive deployment in mind, the v1.0 milestone audit tracks
removing that flag — powers don't make the situation worse than
ACC's baseline.
