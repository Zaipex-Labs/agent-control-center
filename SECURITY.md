# Política de Seguridad / Security Policy

Zaipex ACC es mantenido por el **equipo de Zaipex Labs**. Tomamos la seguridad en serio, aunque el diseño del proyecto sea intencionalmente simple.

---

## Modelo de amenazas (threat model)

Zaipex ACC es una herramienta de **desarrollo local**. El modelo de amenazas parte de estas asunciones:

- Corres el broker en tu propia máquina de desarrollo.
- Confías en los procesos locales de tu máquina.
- NO expones el broker a ningún otro host (ni siquiera por LAN).

Bajo esas asunciones, las siguientes cosas **no son vulnerabilidades**, son comportamiento por diseño:

- **Sin autenticación**. Cualquier proceso local puede hablar con el broker en `127.0.0.1:7899`. Si quieres aislamiento, usa contenedores, usuarios de sistema separados, o perfiles de seguridad del SO.
- **Los datos están en texto plano** en `~/.zaipex-acc/acc.db`. Si alguien más tiene acceso a tu usuario del sistema, tiene acceso a los mensajes entre agentes.
- **Los agentes corren con `--dangerously-skip-permissions`** cuando los lanza el dashboard web. Claude Code puede leer y escribir cualquier cosa dentro del `cwd` que configuraste. Configura `cwd` solo a directorios donde confíes en el agente.

---

## Lo que SÍ es una vulnerabilidad

- El broker escuchando en `0.0.0.0` en lugar de `127.0.0.1` (eso sería un bug grave).
- Inyección de mensajes que pueda escapar del sandbox del `cwd` del agente hacia otros directorios del sistema sin autorización.
- RCE (remote code execution) desde un payload del dashboard o MCP tool.
- Bypass del check de `project_id` que deje que un peer vea o modifique datos de otro proyecto.
- Leaks de información (ej. paths del home del usuario, tokens de otras apps, secretos del entorno) al log del CLI, del dashboard o de los mensajes broadcast.

Si encuentras algo de eso, **por favor no lo reportes en un issue público**.

---

## Cómo reportar

**Escríbenos de forma privada a [security@zaipex.ai](mailto:security@zaipex.ai)** con:

1. Una descripción del problema
2. Pasos para reproducirlo (PoC si puedes)
3. Qué versión de Zaipex ACC estás corriendo (`acc --version` o el hash del commit)
4. Tu OS y versión de Node

Trataremos de:

- Confirmarte el recibo dentro de **48 horas**
- Evaluar el impacto y responderte con un plan de acción dentro de **7 días**
- Publicar un fix y un advisory de GitHub Security una vez corregido

Si la vulnerabilidad es significativa y nos ayudas a arreglarla, con gusto te damos crédito en el advisory (a menos que prefieras anonimato).

---

## Versiones soportadas

Mientras el proyecto esté en `0.x` solo daremos soporte de seguridad al `main` branch y la última release publicada. A partir de `1.0.0` mantendremos la última minor.

---

<details>
<summary>🇬🇧 English summary</summary>

Zaipex ACC is a **local-only development tool**. The threat model assumes you trust your own machine and its local processes, and you never expose the broker beyond `127.0.0.1`. Given that, no-auth and plaintext storage are by design.

**What IS a vulnerability**: broker binding to `0.0.0.0`, cross-project data leaks, RCE from crafted messages, secrets leaked into broadcast messages.

**How to report**: email [security@zaipex.ai](mailto:security@zaipex.ai) privately. Do NOT open a public issue. We aim to acknowledge within 48 hours and respond with a plan within 7 days.

</details>
