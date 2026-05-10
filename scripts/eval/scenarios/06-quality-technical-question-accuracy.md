---
{
  "name": "quality-technical-question-accuracy",
  "setup": [],
  "trigger": {
    "from": "arquitectura",
    "message": "How does the broker clean up stale peers? What file owns the cleanup loop and how often does it run?"
  },
  "expect": {
    "must_not_match": [
      "I (do not|don't) know",
      "(?:no tengo|no sé) (?:cómo|información)"
    ],
    "must_match": [
      "cleanup\\.ts|30\\s?s|stale\\s?peers?|CLEANUP_INTERVAL"
    ]
  }
}
---

# quality-technical-question-accuracy

Probe whether the agent still reads the code before answering (P1 in
the post-C-2 prompt). A passing response cites at least one of:
- the file name (`cleanup.ts`)
- the interval (`30s` / `CLEANUP_INTERVAL`)
- the symbol name (`stalePeers`)

Baseline must pass — if it doesn't, the scenario itself is
miscalibrated. If baseline 3/3 and aggressive misses → real signal that
P1 was lost or weakened by the C-2 compression.
