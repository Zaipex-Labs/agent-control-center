# Example skill: API response shape

Copy this file into `~/.zaipex-acc/projects/<your-project>/skills/`
(rename to e.g. `api-shape.md`) so every agent on the team replies
to the same `{ok, data?, error?}` envelope when designing or
consuming HTTP/RPC endpoints.

---

## Wire shape

Every backend response — successful or not — uses this envelope:

```jsonc
{
  "ok": true | false,
  "data": ...,    // present iff ok === true
  "error": "...", // present iff ok === false (short human-readable)
  "code": "...",  // present iff ok === false (stable machine code)
  "issues": [...] // optional, validation breakdown when applicable
}
```

## Why

- Frontend `if (resp.ok)` reads naturally with no special-case.
- Errors carry both a *short* human string (for toasts/UI) AND a
  *stable* machine code so the frontend can branch without
  pattern-matching on the message.
- Validation errors (zod, joi, etc.) emit an `issues[]` array with
  `{path, message, code}` per field — same shape the broker uses
  for `INVALID_BODY`.

## Examples

Successful read:

```json
{ "ok": true, "data": { "id": 42, "email": "a@b.co" } }
```

Validation error (`POST /users`, invalid email):

```json
{
  "ok": false,
  "code": "INVALID_BODY",
  "error": "email: invalid format",
  "issues": [{ "path": "email", "message": "invalid format", "code": "invalid_format" }]
}
```

Conflict (email already taken):

```json
{ "ok": false, "code": "EMAIL_TAKEN", "error": "Email already registered" }
```

## What NOT to do

- ❌ Different shape per endpoint (`{users: [...]}` here, `{result: ...}` there).
- ❌ HTTP status code as the only error signal — keep `ok: false` AND a
  non-2xx status, but the body still has the envelope.
- ❌ Putting the error message in `data` instead of `error` ("did the
  call succeed?" should never require parsing).
