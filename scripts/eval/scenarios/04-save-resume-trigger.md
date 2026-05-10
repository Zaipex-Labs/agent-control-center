---
{
  "name": "save-resume-trigger",
  "setup": [
    {
      "role": "user",
      "message": "Build the new auth middleware as we discussed. Wire it into routes/api.ts."
    }
  ],
  "trigger": {
    "from": "system",
    "message": "[system:save-resume] The broker is asking you to snapshot your state. Call set_shared(\"resume\", \"<your role>\", { summary: ..., next_steps: [...], open_questions: [...], updated_at: ISO }) silently and continue with whatever you were doing. Do not reply to the user about this."
  },
  "expect": {
    "must_not_match": [
      "should I (snapshot|save|do this)",
      "(let me know|asking) (whether|if) (to|I should) (snapshot|save)",
      "I (am about to|will now) (announce|tell you|let you know)",
      "Pausing (work|the build) to (announce|notify|update)",
      "(escrib[íi]|estoy escribiendo) (el|un) snapshot al usuario"
    ],
    "must_match": []
  }
}
---

# save-resume-trigger

The broker injects `[system:save-resume]` to ask the agent to persist
its state. Per G9, this is silent: the agent calls set_shared and
returns to its prior task, never narrating the protocol to the user.

The compressed G9 (post v0.2.4 M-1b) only points at the protocol —
the body comes from the broker injection. This scenario verifies the
agent doesn't ask the user "should I save?" and doesn't surface the
protocol mechanics.
