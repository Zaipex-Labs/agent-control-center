# Project skills

> Per-project markdown files that get appended to every agent's system
> prompt at boot. Use them to encode team conventions in one place
> ("always use ESM", "tests live in `tests/<area>/`") instead of
> repeating yourself in agent instructions.

Available since **v0.3.0**.

---

## How it works

Each project can have a `skills/` directory at
`~/.zaipex-acc/projects/<project>/skills/`. Every file matching
`/^[a-zA-Z0-9_-]+\.md$/` is concatenated, in lexicographic order, into
a `## Project skills` section appended to the system prompt of every
agent at MCP-server boot.

Layout:

```
~/.zaipex-acc/projects/
├── my-team.json              # existing project config
└── my-team/
    └── skills/
        ├── conventions.md
        ├── tooling.md
        └── tests.md
```

Resulting prompt suffix:

```markdown
## Project skills

### conventions.md
Use ESM modules everywhere. Never CJS.

### tests.md
Tests live in tests/<area>/. Import the unit under test with the
same path the source uses.

### tooling.md
Use pnpm, not npm. We pin via the lockfile.
```

The loader is fault-tolerant: a missing directory, an unreadable
file, or a symlink that escapes the directory all silently produce
an empty section. **Boot never fails because of a skill file.**

---

## Limits

| Constraint | Value | Notes |
|---|---|---|
| Filename pattern | `/^[a-zA-Z0-9_-]+\.md$/` | No spaces, no dots beyond `.md`, no path separators. |
| Per-file size | 8 KiB | Enforced by the broker on save (HTTP 413). |
| Total budget per project | 8 KiB | Enforced by the loader at boot. First file that would push the total over the cap is skipped; the broker logs a `[acc-server] project skills total exceeded 8192 bytes — some files were skipped` warning to stderr. |
| Hot reload | None at v0.3.0 | Skills are read once at agent startup. Restart the agent to pick up changes. |

8 KiB is roughly 2,000 tokens at 4 chars/token — about the same size
as the system prompt itself. Larger and skills start dwarfing the
behavior rules.

---

## Editing skills

### From the dashboard

`Skills` button in the project's top nav opens a modal with create /
edit / delete. The modal validates the filename pattern client-side
and surfaces the broker's 413 if the content exceeds 8 KiB.

### From the filesystem

You can also drop files directly into
`~/.zaipex-acc/projects/<project>/skills/`. The dashboard picks them
up on the next list refresh; agents need a restart.

### Via the REST API

```bash
PEER=$(curl -s -X POST http://127.0.0.1:7899/api/register \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"my-team","pid":1,"cwd":"/","role":"user","agent_type":"dashboard"}' \
  | jq -r .id)

curl -X POST http://127.0.0.1:7899/api/skills/save \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"my-team\",\"peer_id\":\"$PEER\",\"filename\":\"esm.md\",\"content\":\"Always ESM. Never CJS.\"}"
```

All four endpoints follow the same pattern:

| Endpoint | Body |
|---|---|
| `POST /api/skills/list` | `{ project_id, peer_id }` |
| `POST /api/skills/get` | `{ project_id, peer_id, filename }` |
| `POST /api/skills/save` | `{ project_id, peer_id, filename, content }` |
| `POST /api/skills/delete` | `{ project_id, peer_id, filename }` |

Every endpoint requires the peer to be a registered member of
`project_id` (S-NEW-3 cross-project membership gate).

---

## What to put in a skill

**Good fits.** Conventions that don't change often and apply to every
agent on the team:

- `use-esm.md` — "Always ESM. Never CJS."
- `tests.md` — "Tests live in `tests/<area>/`. Use vitest."
- `naming.md` — "Files: kebab-case. React components: PascalCase."
- `pkg-mgr.md` — "Use pnpm, not npm. We pin via the lockfile."
- `commit-style.md` — "feat(area): subject. Body wraps at 72."

**Bad fits.** State that changes per task or per agent — that goes
into shared state (set_shared / get_shared) or agent instructions:

- ❌ "I'm working on the auth feature" — that's `set_summary`.
- ❌ "API spec for /v1/users" — that's a contract, use
  `set_shared("contracts", ...)`.
- ❌ "I'll handle backend, you handle frontend" — that's an agent's
  per-session instructions.

The right test: **would you copy-paste this into every new agent's
system prompt?** If yes, it's a skill. If it changes between tasks,
it isn't.

---

## See also

- `docs/skills/example-conventions.md` — example skill file you can
  copy into a project as a starting point.
- `src/shared/skills.ts` — the loader. Path validation, symlink
  defense, 8 KiB cap.
- `src/broker/handlers/skills.ts` — REST handlers.
- `src/dashboard/components/SkillsModal.tsx` — dashboard CRUD UI.
