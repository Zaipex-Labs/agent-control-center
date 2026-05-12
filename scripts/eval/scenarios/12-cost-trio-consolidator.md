---
{
  "name": "cost-trio-consolidator",
  "setup": [
    {
      "role": "user",
      "message": "Equipo: necesitamos implementar password reset por email. Backend define endpoints + tabla. Frontend implementa /forgot-password y /reset-password. QA valida. Persistan los contratos en shared state. Coordinen y avísenme."
    },
    {
      "role": "arquitectura",
      "message": "plan: backend → schema + endpoints + tabla `password_reset_tokens` (user_id, token_hash, expires_at, used_at). frontend → forms + integración. qa → 10+ tests críticos: happy path, expiry, reuse, rate-limit. publiquen en namespace 'contracts'. arranca backend."
    },
    {
      "role": "backend",
      "message": "diseñado: POST /auth/password-reset/request {email}, POST /auth/password-reset/confirm {token, new_password}. tabla: password_reset_tokens(id uuid, user_id uuid fk, token_hash text, expires_at timestamptz, used_at timestamptz nullable). expiry 24h. publicado en contracts/password-reset (request shape, response shape, errors 400/401/410). rate-limit por email: 3 requests / 15min."
    },
    {
      "role": "frontend",
      "message": "wireado /forgot-password (input email + submit) y /reset-password/:token (input password + confirm). integrado a backend. estados de error UX: token-invalid, token-expired, password-weak, rate-limited. leí contracts/password-reset OK."
    },
    {
      "role": "qa",
      "message": "12 tests escritos: happy path (1), token expiry (2), token reuse (2), invalid email (1), rate-limit (3), password complexity (2), concurrent requests (1). todos green local. coverage 94% en módulo auth. publicado en contracts/password-reset-tests checklist."
    }
  ],
  "trigger": {
    "from": "user",
    "message": "¿Cómo va la feature de password reset? Resumen por favor."
  },
  "expect": {
    "must_not_match": [],
    "must_match": []
  }
}
---

# cost-trio-consolidator

B-3 v0.3.5 — cost-delta measurement scenario. This is a TRÍO-3-style
setup (3 specialist roles reporting back to a coordinator + user
asking for status) designed to force a long consolidator turn, the
single most expensive turn in the v0.3.3 EQUIPO-5 cost analysis.

**No assertions on content** (empty must_match / must_not_match arrays
= every run auto-passes). The point isn't to gate behavior here —
scenario 11 already does that. The point is to measure response
LENGTH (chars / est. tokens) between the v0.3.4 baseline prompt and
the v0.3.5 reformulated B3, on a setup that historically generated
the long output that FU-AF was supposed to address.

The 5-message setup approximates the consolidator's working memory
after 3 specialists report back through the coordinator. The user
trigger ("¿Cómo va? Resumen") is the canonical cost-bomb prompt —
in v0.3.3, the EQUIPO-5 consolidator turn averaged ~6-8 nested
sections + tables + JSON code fences.

**Measurement protocol:**

1. Run `scenario=cost-trio-consolidator runs=3` against the
   pre-B1 prompt (variant = old prompt).
2. Run the same 3 runs against the post-B1 prompt (variant =
   default / new prompt).
3. Compare avg response chars × 0.25 ≈ output tokens.
4. Target per v0.3.3 forecast: 30-50% reduction.

If reduction <20%, the prompt change worked partially. If >50%, the
change may be too aggressive (cross-check against B-2 33/33 result).
