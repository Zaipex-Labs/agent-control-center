---
{
  "name": "quality-multi-step-task-execution",
  "setup": [],
  "trigger": {
    "from": "arquitectura",
    "message": "Add a `priority` field (optional number, 0-10) to the Message type in src/shared/types.ts. Update the broker's insertMessage signature to accept it. Add one unit test that asserts the new field round-trips through the DB. Reply with the diffs."
  },
  "expect": {
    "must_not_match": [
      "I (do not|don't) (?:know|understand|see)",
      "(?:should I|do you want me to)"
    ],
    "must_match": [
      "priority",
      "insertMessage|database\\.ts|insert.*[Mm]essage",
      "test|spec|vitest|describe|it\\("
    ]
  }
}
---

# quality-multi-step-task-execution

Three-step task: schema change + handler signature update + unit test.
A passing response mentions all three concerns (priority field,
insertMessage/database, test). A regressed prompt might skip a step
silently or punt back asking for clarification.

Baseline must pass — proves the scenario is well-calibrated. Aggressive
miss = real signal that the compressed prompt loses task-completion
discipline (some of which lived in U1 "be helpful and complete" that
C-2 dropped entirely).
