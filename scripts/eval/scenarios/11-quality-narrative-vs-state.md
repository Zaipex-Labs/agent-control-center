---
{
  "name": "quality-narrative-vs-state",
  "setup": [
    {
      "role": "user",
      "message": "Equipo: necesitamos POST /users con shape { name: string, email: string }. Backend define el contrato, frontend lo consume. Persistan el contrato en shared state para que ambos lo referencien. Coordinen y avísenme cuando esté listo."
    },
    {
      "role": "frontend",
      "message": "ok, espero tu schema en cuanto lo tengas y wiro el form de registro a POST /users."
    },
    {
      "role": "arquitectura",
      "message": "backend: arranca tú con el schema. frontend espera. publiquen el contract en namespace 'contracts'."
    }
  ],
  "trigger": {
    "from": "user",
    "message": "¿Cómo va el contrato? Resúmeme el estado del POST /users."
  },
  "expect": {
    "must_not_match": [
      "(?:\\n##[^#].*\\n[\\s\\S]*?){3,}",
      "(?:\\n\\|.*\\|\\s*\\n\\|[-:\\s|]+\\|){1,}"
    ],
    "must_match": [
      "name[\\s\\S]{0,80}email|email[\\s\\S]{0,80}name",
      "set_shared|shared[\\s_-]?state|namespace[\\s\\S]{0,40}contract|publish.{0,40}(contract|schema)"
    ]
  }
}
---

# quality-narrative-vs-state

B-5 v0.3.5 — the scenario that protects against the v0.3.4 A-1 regression
class. The v0.3.4 attempt at FU-AF added a B3 rule ("long form goes into
decisions.md") that the model interpreted as license to *omit* contract
identifiers from the chat reply. This scenario forces the issue:

- **Setup**: the coordinator (arquitectura) and a peer (frontend) have
  already discussed a contract for POST /users. The agent under test
  (backend, per the eval harness default role) is the one who would
  publish the schema. Now the user comes back asking for a status update —
  the classic "consolidator turn" where output verbosity bites the bill.

- **Trigger**: user asks for a recap. The agent must produce one.

- **must_match — STATE visibility**:
  - The contract identifiers (`name`, `email`) must appear verbatim,
    within a small window of each other (narrative might separate them
    by a clause, not by paragraphs).
  - The persistence concept must surface in language: `set_shared`,
    `shared state`, `namespace … contract(s)`, or `publish … (contract|schema)`.
  - These are non-negotiable: if either fails, the agent is hiding
    state behind narrative.

- **must_not_match — NARRATIVE bloat**:
  - Three-or-more H2 sections in sequence — the smell of a multi-
    section structured doc (Status / Plan / Implementation / Tests /
    Next steps / etc.) that belongs in `decisions.md`, not in the
    chat reply.
  - A markdown table — same reason. The harness test uses
    `--disallowedTools '*'` so the agent CAN'T actually call
    set_shared; what we're checking is the linguistic SHAPE of the
    reply. Tables are a strong signal of "I'm dumping structured
    state into the chat" — wrong target for the user.

The scenario is intentionally bilingual (user prompts in Spanish, with
English-named contracts) to mirror the v0.3.3 EQUIPO-5 transcripts
where the cost regression was first measured.

## Baseline-first protocol

Per the v0.3.4 followups, **run this scenario against the CURRENT
prompt before changing anything**. Three outcomes:

- **3/3 PASS on the current prompt** — the scenario doesn't expose
  the regression we're trying to catch. Tighten predicates before
  declaring v0.3.5 worth shipping.
- **1-2 / 3 PASS** — scenario is well-calibrated; the prompt fix
  should push it to 3/3 while keeping the other 10 scenarios at 3/3.
- **0/3 PASS** — the regression is latent in the current prompt too.
  Stop and re-investigate before reformulating B3.
