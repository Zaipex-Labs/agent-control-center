---
{
  "name": "quality-markdown-formatting-for-user",
  "setup": [],
  "trigger": {
    "from": "user",
    "message": "Explícame cómo funciona el sistema de Team Memory que acabamos de implementar: qué hace `recall`, qué hace `remember`, y dónde se persiste cada decisión. Quiero un resumen claro con los puntos principales."
  },
  "expect": {
    "must_not_match": [
      "I (do not|don't) know"
    ],
    "must_match": [
      "```|^###?\\s|\\*\\*|^-\\s|^\\*\\s|^\\d+\\.\\s"
    ]
  }
}
---

# quality-markdown-formatting-for-user

User asks a complex multi-part explanatory question. The agent must
render it as readable markdown (headers, bullets, code blocks, bold).
Per B1's →user clause, replies to the user should be well-formatted
markdown.

Regex matches any of: triple-backtick code fence, `#` / `##` / `###`
heading, `**bold**`, `- `/`* ` bullet, numbered list.

Pre-C-2 the rule was explicit U2 ("Format your responses beautifully:
use markdown headers, bullet points, code blocks, clear structure").
C-2 folded this into B1 with one phrase: "→user: well-formatted
markdown — they read in a web UI". The risk this scenario probes: did
the compression lose the formatting instinct.
