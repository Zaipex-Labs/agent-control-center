# Example skill: project conventions

Copy this file into `~/.zaipex-acc/projects/<your-project>/skills/`
(rename to e.g. `conventions.md`) as a starting point. Keep what
applies to your team, drop the rest.

---

## Modules and tooling

- **ESM only.** All imports use `import ...`. No `require()`.
- **Package manager: pnpm.** The lockfile is the source of truth —
  do not commit changes from a different package manager.
- **Node 20+.** No older runtimes on CI or in production.

## Tests

- Tests live in `tests/<area>/<file>.test.ts`. Mirror the source
  layout: `src/auth/login.ts` → `tests/auth/login.test.ts`.
- Use vitest. Snapshot tests are fine for prompts and serialized
  output; not fine for HTML or CSS (too brittle).
- Integration tests touch a real database (no mocks of better-sqlite3).
  Past incidents: mocked tests passed while a real migration broke
  in prod.

## File and identifier naming

- Filenames: kebab-case (`auth-middleware.ts`, not
  `authMiddleware.ts`).
- React components: PascalCase, one component per file.
- Functions and variables: camelCase. Constants in SCREAMING_SNAKE_CASE
  only when truly constant (cap values, env-key names).

## Commits

- Format: `feat(area): subject` / `fix(area): subject` /
  `chore(area): subject`. Subject in imperative.
- Body wraps at 72 columns. Reference issues at the top of the body,
  not in the subject.
