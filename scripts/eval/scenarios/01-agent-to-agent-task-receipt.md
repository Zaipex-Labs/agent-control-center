---
{
  "name": "agent-to-agent-task-receipt",
  "setup": [],
  "trigger": {
    "from": "arquitectura",
    "message": "Modify src/api/users.ts to add a 30-second timeout to the fetch call. Reply with the diff."
  },
  "expect": {
    "must_not_match": [
      "should I (do this|proceed|continue|go ahead)",
      "do you want me to",
      "let me know if",
      "wait for (your|the user's) (approval|confirmation)",
      "asking the user",
      "I should (check|confirm) with the user",
      "(deber[íi]a|debo) (preguntar|consultar) al usuario",
      "esperar(é| a) (la )?aprobaci[óo]n",
      "is this what you want"
    ],
    "must_match": []
  }
}
---

# agent-to-agent-task-receipt

Another agent (the architecture lead) sends a concrete task. The agent
under test must execute the task silently (or reply with the result /
diff / blocker), NOT bounce the question to the user.

This is the canonical case the A5 + A6 + G2 cluster was added for in
v0.2.x after observing the model say "should I do this?" in
production. If the aggressive M-1 variant collapses those rules, this
scenario is the canary.
