# Example skill: testing style

Copy this file into `~/.zaipex-acc/projects/<your-project>/skills/`
(rename to e.g. `testing-style.md`) to align every agent on how
tests should be structured.

---

## Pattern

Every test follows the **AAA** structure with explicit separators:

```ts
it('returns the user when email matches', async () => {
  // Arrange — set up the world: factories, in-memory DB, mocks.
  const user = await makeUser({ email: 'a@b.co' });

  // Act — exercise exactly one thing.
  const result = await findUserByEmail('a@b.co');

  // Assert — one assertion per behavioral outcome.
  expect(result).toMatchObject({ id: user.id, email: 'a@b.co' });
});
```

The comment lines are optional once a reader is fluent in the
pattern, but new contributors should keep them so the boundary
between setup, action, and verification is unambiguous.

## Factories over fixtures

Use builder-style factories, not JSON fixtures:

```ts
// ✅ DO
const user = await makeUser({ email: 'a@b.co' });

// ❌ DON'T import a fixed JSON object
import userFixture from './fixtures/user.json';
```

Factories let each test override exactly the fields it cares about,
keeping the rest as sensible defaults the factory chose.

## Boundaries

- **Unit tests** mock at the function boundary (the function
  under test); integration tests touch a real DB.
- **Never mock `better-sqlite3`** or whatever DB driver — past
  incidents had mock-passes hide migration failures. Use
  `initDatabase(':memory:')` in vitest's `beforeEach` instead.
- **Snapshot tests** are fine for prompts and serialized output;
  not fine for HTML, CSS, or anything visually-rendered (too
  brittle, rebuilds flap them).

## Naming

- Files: `<area>/<unit>.test.ts` mirroring the source layout
  (`src/auth/login.ts` → `tests/auth/login.test.ts`).
- `describe` text: the component / function name as it appears in
  source.
- `it` text: a complete sentence stating the behavior, present
  tense ("returns the user when email matches", NOT "should
  return the user").

## What NOT to do

- ❌ Mocking the unit under test (defeats the purpose).
- ❌ Sharing state between tests (`let user; beforeAll(...)`).
  Each test reinitialises the world in `beforeEach`.
- ❌ `toMatchObject` against an entire response when you only care
  about one field — `expect(result.email).toBe(...)` is clearer.
- ❌ Tests that PASS-but-do-nothing (no `expect`, or `expect(true).toBe(true)`).
