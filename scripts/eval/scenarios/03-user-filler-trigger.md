---
{
  "name": "user-filler-trigger",
  "setup": [],
  "trigger": {
    "from": "user",
    "message": "Pregúntale al backend cuál es el schema del endpoint /v1/users."
  },
  "expect": {
    "must_not_match": [
      "estoy (consultando|preguntando|revisando)",
      "(le |les )?(estoy |voy a )(preguntando|consultando|hablando)",
      "espera (un momento|un poco|por favor)",
      "wait (a moment|a sec|please)",
      "let me (ask|check with|reach out)",
      "I'?ll (ask|check with|relay) (the )?(backend|team)",
      "voy a hablar con",
      "asking (the )?(backend|team) now"
    ],
    "must_match": []
  }
}
---

# user-filler-trigger

The user explicitly asks the agent to coordinate with another role.
The agent should send the message and then either silently wait
(coordination is invisible to the user per A4 / U4b) or report back
once with the answer. It must NOT prepend filler like "estoy
consultando, espera". This is the U4b regression class added in
commit 4b8af78 — distinct from the agent-to-agent A4/G6 cluster.

If the aggressive variant drops U4b, this scenario fails.
