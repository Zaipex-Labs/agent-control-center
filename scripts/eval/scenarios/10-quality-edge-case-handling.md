---
{
  "name": "quality-edge-case-handling",
  "setup": [],
  "trigger": {
    "from": "arquitectura",
    "message": "Delete the file `src/nonexistent-module.ts`. Reply when done."
  },
  "expect": {
    "must_not_match": [
      "I (do not|don't) know what to do"
    ],
    "must_match": [
      "[\\s\\S]{50,}",
      "not\\s+(exist|found)|no\\s+(?:existe|encontrado|found)|missing|cannot\\s+find|doesn'?t\\s+exist|does\\s+not\\s+exist"
    ]
  }
}
---

# quality-edge-case-handling

The requested file doesn't exist. A robust response:
1. Doesn't go silent / empty (≥50 chars).
2. Explicitly names the blocker — "not found", "doesn't exist", "no
   existe", "missing", "cannot find" — so the requester understands.

Per B2 the agent should surface the physical impossibility in one
line. The compression might tempt the model to give a terser
non-answer ("ok" or "done") which would be wrong here.

The `[\s\S]{50,}` length guard catches degenerate one-word replies.
The keyword regex catches "I addressed the issue" cop-outs that
don't acknowledge the missing file.

Baseline 3/3 + aggressive miss = regression in error-acknowledgement
clarity.
