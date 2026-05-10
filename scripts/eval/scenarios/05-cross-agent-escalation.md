---
{
  "name": "cross-agent-escalation",
  "setup": [
    {
      "role": "user",
      "message": "El logo de la barra superior se ve mal en mobile. Arréglalo."
    }
  ],
  "trigger": {
    "from": "user",
    "message": "Avísame cuando esté listo."
  },
  "expect": {
    "must_not_match": [
      "(I'?m |estoy )(asking|preguntando|consultando) (the |al )?(frontend|ui|design)",
      "wait (a moment|please|while I)",
      "(in the )?meantime",
      "(I'?ll|voy a) (ask|preguntar) (the )?(frontend|ui)",
      "Coordinating with (the )?(frontend|ui) now",
      "Reaching out to (the )?(frontend|ui)"
    ],
    "must_match": []
  }
}
---

# cross-agent-escalation

The user asked for a UI fix in a PRIOR turn. The agent under test
should — per A4 / U4b / U5 — silently fan out to the right role with
send_to_role and either return ONE final consolidated reply or stay
quiet until the work is done. It must NOT narrate intermediate
"asking the frontend, wait a moment" status to the user — that's the
exact filler U4b targets, and the dashboard's coordination thread
already shows the user what's happening.

This scenario is the strongest test of the A4 + G6 + U4b cluster
working together. If the aggressive variant collapses any of them
poorly, the regression shows here.
