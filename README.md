```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│              ███████╗ █████╗  ██╗██████╗ ███████╗██╗  █╗│
│              ╚══███╔╝██╔══██╗██║██╔══██╗██╔════╝╚██╗██╔╝│
│                ███╔╝ ███████║██║██████╔╝█████╗   ╚███╔╝ │
│               ███╔╝  ██╔══██║██║██╔═══╝ ██╔══╝   ██╔██╗ │
│              ███████╗██║  ██║██║██║     ███████╗██╔╝ ██╗│
│              ╚══════╝╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝│
│                                                         │
│                    AGENTS COMMAND CENTER                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

[![CI](https://github.com/Zaipex-Labs/agent-control-center/actions/workflows/ci.yml/badge.svg)](https://github.com/Zaipex-Labs/agent-control-center/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)
[![Version](https://img.shields.io/badge/version-0.2.0-brightgreen.svg)](package.json)

---

**🇪🇸 Orquestador ligero de agentes de IA para desarrollo en equipo.**
**🇬🇧 Lightweight AI agent orchestrator for team development.**

---

## Tabla de contenidos / Table of Contents

- [¿Qué es? / What is it?](#qué-es--what-is-it)
- [Quick Start](#quick-start)
- [Instalación / Installation](#instalación--installation)
- [Conceptos / Concepts](#conceptos--concepts)
- [Nombres de agentes / Agent Names](#nombres-de-agentes--agent-names)
- [CLI Reference](#cli-reference)
- [MCP Tools Reference](#mcp-tools-reference)
- [Configuración / Configuration](#configuración--configuration)
- [Arquitectura / Architecture](#arquitectura--architecture)
- [Dashboard](#dashboard)
- [Seguridad / Security](#seguridad--security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## ¿Qué es? / What is it?

Permite que múltiples instancias de Claude Code (u otros agentes MCP) se comuniquen entre sí, compartan estado, y se coordinen sin intervención humana. Todo corre en localhost — sin servidores externos, sin APIs de terceros, sin cuentas.

Un broker HTTP local orquesta la comunicación. Cada agente se conecta como un MCP server via stdio. Un CLI (`acc`) permite al humano gestionar proyectos, levantar agentes, y monitorear todo en tiempo real.

<details>
<summary>🇬🇧 English</summary>

Enables multiple Claude Code instances (or other MCP agents) to communicate with each other, share state, and coordinate without human intervention. Everything runs on localhost — no external servers, no third-party APIs, no accounts.

A local HTTP broker orchestrates communication. Each agent connects as an MCP server via stdio. A CLI (`acc`) lets the human manage projects, spawn agents, and monitor everything in real time.

</details>

---

## Quick Start

```bash
# 1. Clonar e instalar / Clone and install
git clone https://github.com/Zaipex-Labs/agent-control-center.git
cd zaipex-acc
npm install
npm run build               # compila el servidor y CLI
npm run dashboard:build     # compila el dashboard web
npm link                    # instala el comando "acc" global

# 2. Crear proyecto desde el dashboard / Create project from the dashboard
acc broker start            # arranca el broker en 127.0.0.1:7899
open http://127.0.0.1:7899  # abre el dashboard en el navegador

#    (o desde el CLI / or from the CLI)
acc project create my-app -d "My application"
acc project add-agent my-app --role backend --cwd ~/app/backend
acc project add-agent my-app --role frontend --cwd ~/app/frontend

# 3. Levantar el equipo / Start the team
acc up my-app

# 4. Monitorear / Monitor
acc status my-app
acc history my-app
```

---

## Instalación / Installation

### Requisitos / Requirements

**Obligatorios**
- **Node.js** 20+ y **npm** 9+
- **Python 3** en el `PATH` — el broker lo usa para darle un PTY a Claude Code cuando lanza agentes desde el dashboard web. Ya viene instalado en macOS y la mayoría de distros Linux.
- **Claude Code CLI** (`claude`) en el `PATH`, con soporte para `--dangerously-load-development-channels`. Es la dependencia principal: cada agente es una instancia de Claude Code.

**Recomendados**
- **tmux** (Linux/macOS) — si prefieres lanzar agentes desde el CLI (`acc up`) en vez del dashboard, se abren cada uno en un split pane de tmux.

**Plataformas soportadas / Supported platforms**
- ✅ **Linux** y **macOS** — soporte de primera clase.
- 🚧 **Windows** — en el roadmap (v1.0). Por ahora recomendamos WSL2.

> 💡 Zaipex ACC corre **100% en localhost**. No necesitas cuentas, API keys, servidores externos, ni abrir puertos al internet. Todo se guarda en `~/.zaipex-acc/`.

### Desde el código fuente / From source

```bash
git clone https://github.com/Zaipex-Labs/agent-control-center.git
cd zaipex-acc
npm install
npm run build            # compila TypeScript (servidor + CLI)
npm run dashboard:build  # compila el dashboard React (Vite)
npm link                 # instala "acc" globalmente / installs "acc" globally
```

Después puedes arrancar el broker y abrir el dashboard:

```bash
acc broker start
open http://127.0.0.1:7899    # macOS
xdg-open http://127.0.0.1:7899  # Linux
```

<details>
<summary>🇬🇧 Development mode</summary>

```bash
npm run dev:cli -- projects        # run CLI without building
npm run dev                        # run MCP server directly
npm test                           # run tests with vitest
npm run test:watch                 # watch mode
```

</details>

---

## Conceptos / Concepts

### Broker

Servidor HTTP que corre en `127.0.0.1:7899`. Solo rutea mensajes y almacena estado en SQLite (`~/.zaipex-acc/acc.db`). No toma decisiones — es un bus de comunicación pasivo. Se auto-arranca con el primer agente que se conecta. Limpia peers muertos cada 30 segundos.

<details>
<summary>🇬🇧 English</summary>

HTTP server running on `127.0.0.1:7899`. It only routes messages and stores state in SQLite (`~/.zaipex-acc/acc.db`). It makes no decisions — it's a passive communication bus. Auto-starts when the first agent connects. Cleans up stale peers every 30 seconds.

</details>

### Agentes / Agents

Cada agente es una instancia de Claude Code (u otro agente MCP compatible) con un rol asignado (backend, frontend, qa, etc.). Se registra con el broker al conectarse. Puede enviar/recibir mensajes, leer/escribir estado compartido, y ver quién más está conectado.

<details>
<summary>🇬🇧 English</summary>

Each agent is a Claude Code instance (or other MCP-compatible agent) with an assigned role (backend, frontend, qa, etc.). It registers with the broker on connection. It can send/receive messages, read/write shared state, and see who else is connected.

</details>

### Roles

Los roles definen la responsabilidad del agente. Cada rol recibe automáticamente un nombre de científico famoso. Múltiples agentes pueden compartir el mismo rol — `send_to_role` permite broadcast a todos los agentes con un rol dado.

<details>
<summary>🇬🇧 English</summary>

Roles define the agent's responsibility. Each role automatically receives a famous scientist's name. Multiple agents can share the same role — `send_to_role` enables broadcasting to all agents with a given role.

</details>

### Estado compartido / Shared State

Key-value store organizado por namespaces. Ideal para publicar contratos de API, esquemas, configuraciones, o cualquier dato que el equipo necesite. Persiste en SQLite — sobrevive reinicios.

<details>
<summary>🇬🇧 English</summary>

Key-value store organized by namespaces. Ideal for publishing API contracts, schemas, configurations, or any data the team needs. Persisted in SQLite — survives restarts.

</details>

### Proyectos / Projects

Un proyecto agrupa agentes que trabajan juntos. Cada proyecto tiene su propia configuración en `~/.zaipex-acc/projects/<name>.json`. Los datos (mensajes, peers, shared state) se aíslan por proyecto.

<details>
<summary>🇬🇧 English</summary>

A project groups agents that work together. Each project has its own config at `~/.zaipex-acc/projects/<name>.json`. Data (messages, peers, shared state) is isolated per project.

</details>

---

## Nombres de agentes / Agent Names

Cada rol tiene un nombre de científico famoso asignado por defecto:

| Rol / Role | Nombre / Name |
|------------|---------------|
| `backend` | Turing |
| `frontend` | Lovelace |
| `qa` | Curie |
| `architect` | Da Vinci |
| `devops` | Tesla |
| `data` | Gauss |
| `ml` | Euler |
| `analytics` | Fibonacci |
| `security` | Enigma |

Roles no listados reciben un nombre del pool de respaldo: Faraday, Newton, Hypatia, Hawking, Galileo, Ramanujan, Noether, Fermat, Kepler, Planck.

<details>
<summary>🇬🇧 English</summary>

Each role has a default famous scientist name assigned. Unlisted roles receive a name from the fallback pool: Faraday, Newton, Hypatia, Hawking, Galileo, Ramanujan, Noether, Fermat, Kepler, Planck.

</details>

---

## CLI Reference

### Proyectos / Projects

| Comando / Command | Descripción / Description |
|---|---|
| `acc projects` | Listar proyectos / List projects |
| `acc project create <name> [-d <desc>]` | Crear proyecto / Create project |
| `acc project add-agent <name> -r <role> --cwd <dir>` | Agregar agente / Add agent |
| `acc project remove-agent <name> -r <role>` | Quitar agente / Remove agent |
| `acc project show <name>` | Ver configuración / Show config |

### Operación / Operations

| Comando / Command | Descripción / Description |
|---|---|
| `acc up <name> [--only <role>] [--strategy <s>]` | Levantar agentes / Start agents |
| `acc down <name>` | Apagar agentes / Stop agents |
| `acc status [name]` | Estado del broker y peers / Broker and peers status |
| `acc peers [name]` | Peers activos / Active peers |

### Datos / Data

| Comando / Command | Descripción / Description |
|---|---|
| `acc history <name> [-r <role>] [-l <n>]` | Historial de mensajes / Message history |
| `acc shared <name> [namespace] [key]` | Ver estado compartido / View shared state |
| `acc send <name> <msg> --to-role <role>` | Enviar mensaje / Send message |

### Configuración / Configuration

| Comando / Command | Descripción / Description |
|---|---|
| `acc config set lang <en\|es>` | Cambiar idioma / Change language |

### Broker

| Comando / Command | Descripción / Description |
|---|---|
| `acc broker start` | Arrancar broker manualmente / Start broker manually |
| `acc broker stop` | Parar broker / Stop broker |
| `acc broker status` | Estado del broker / Broker status |

---

## MCP Tools Reference

Herramientas disponibles para los agentes via el protocolo MCP:

| Tool | Params | Description |
|------|--------|-------------|
| `list_peers` | `scope?: "project" \| "machine" \| "directory" \| "repo"` | Listar agentes conectados / List connected agents |
| `whoami` | — | Identidad del agente / Agent identity |
| `send_message` | `to_id: string, text: string, type?: MessageType` | Mensaje directo por ID / Direct message by ID |
| `send_to_role` | `role: string, text: string, type?: MessageType` | Broadcast por rol / Broadcast by role |
| `check_messages` | — | Leer mensajes pendientes / Read pending messages |
| `get_history` | `role?: string, type?: string, limit?: number` | Historial del proyecto / Project history |
| `set_shared` | `namespace: string, key: string, value: any` | Escribir estado compartido / Write shared state |
| `get_shared` | `namespace: string, key: string` | Leer estado compartido / Read shared state |
| `list_shared` | `namespace: string` | Listar keys de namespace / List namespace keys |
| `set_summary` | `summary: string` | Actualizar resumen / Update summary |
| `set_role` | `role: string` | Cambiar rol / Change role |

**Message types:** `message`, `question`, `response`, `contract_update`, `notification`, `task_request`, `task_complete`

---

## Configuración / Configuration

### Variables de entorno / Environment Variables

| Variable | Default | Descripción / Description |
|----------|---------|--------------------------|
| `ACC_HOME` | `~/.zaipex-acc` | Directorio de datos / Data directory |
| `ACC_PORT` | `7899` | Puerto del broker / Broker port |
| `ACC_PROJECT` | auto-detectado | Proyecto activo / Active project |
| `ACC_ROLE` | `""` | Rol del agente / Agent role |
| `ACC_NAME` | auto-asignado | Nombre del agente / Agent name |
| `ACC_LANG` | auto-detectado | Idioma del CLI (en, es) / CLI language |

### Archivo de configuración / Config file

`~/.zaipex-acc/config.json` — preferencias persistentes:

```json
{
  "lang": "es"
}
```

### Configuración de proyecto / Project config

`~/.zaipex-acc/projects/<name>.json`:

```json
{
  "name": "my-app",
  "description": "My application",
  "created_at": "2026-04-06T...",
  "agents": [
    {
      "role": "backend",
      "cwd": "~/app/backend",
      "agent_cmd": "claude",
      "agent_args": ["--dangerously-load-development-channels", "server:zaipex-acc"],
      "instructions": "Stack: FastAPI + PostgreSQL. Responsible for the API."
    }
  ]
}
```

---

## Arquitectura / Architecture

```
                          ┌──────────────────────┐
                          │     Human (CLI)       │
                          │    $ acc up my-app    │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │    BROKER DAEMON      │
                          │  127.0.0.1:7899       │
                          │                       │
                          │  ┌─────────────────┐  │
                          │  │   SQLite DB      │  │
                          │  │  ~/.zaipex-acc/  │  │
                          │  │    acc.db        │  │
                          │  └─────────────────┘  │
                          │                       │
                          │  peers | messages     │
                          │  shared_state         │
                          │  message_log          │
                          └───┬───────────┬───────┘
                              │           │
               ┌──────────────▼──┐   ┌────▼──────────────┐
               │  MCP Server A   │   │  MCP Server B     │
               │  (stdio)        │   │  (stdio)          │
               └──────────────┬──┘   └────┬──────────────┘
                              │           │
               ┌──────────────▼──┐   ┌────▼──────────────┐
               │  Agent A        │   │  Agent B          │
               │  name: Turing   │   │  name: Lovelace   │
               │  role: backend  │   │  role: frontend   │
               │  cwd: ~/back    │   │  cwd: ~/front     │
               └─────────────────┘   └──────────────────-┘

  tmux session "acc-my-app"
  ┌──────────────────┬──────────────────┐
  │ Window 0         │ Window 1         │
  │ Turing (backend) │ Lovelace (front) │
  │                  │                  │
  │ > claude         │ > claude         │
  │                  │                  │
  └──────────────────┴──────────────────┘
```

<details>
<summary>🇬🇧 How it works</summary>

1. `acc up` starts the broker (if not running) and spawns agents in tmux windows
2. Each agent connects as an MCP server via stdio and registers with the broker
3. Agents discover each other via `list_peers` and communicate via `send_message` / `send_to_role`
4. Shared state is persisted in SQLite — survives agent restarts
5. The broker cleans up stale peers every 30 seconds
6. `acc down` terminates the tmux session and all agents

</details>

---

## Dashboard

Zaipex ACC incluye un dashboard web que se sirve desde el mismo broker en `http://127.0.0.1:7899`. Desde ahí puedes:

- Crear y editar equipos con editor visual de agentes (nombre, rol, modelo Claude, cwd, instrucciones personalizadas)
- Levantar y apagar proyectos con botones (igual que `acc up` / `acc down`)
- Ver el chat en vivo entre agentes como hilos de conversación, con juntas colapsables para la coordinación agente ↔ agente
- Ver el **status line real de Claude Code** (`Thinking… (12s · ↓ 230 tokens)`) de cada agente en tiempo real
- Avatares generativos por agente (DiceBear bottts), nombres de científicos por rol default (Turing, Lovelace, Curie, Da Vinci…)
- Tech Lead / Arquitecto permanente en cada proyecto que coordina al equipo y mantiene documentación viva (`progress.md`, `decisions.md`, `current.md`)
- Explorar el estado compartido (`shared_state`) por namespace
- Reconexión automática al recargar la página

> 📸 _Screenshot y GIF en `docs/screenshots/` — pendiente de actualizar tras cambios recientes._

---

## Seguridad / Security

Zaipex ACC está diseñado para **uso local exclusivo en tu máquina de desarrollo**. Algunas cosas importantes que debes saber:

- **Sin autenticación.** El broker no requiere ni acepta credenciales. Cualquier proceso local puede pegarle al endpoint HTTP.
- **Solo localhost.** El servidor SIEMPRE escucha en `127.0.0.1`, nunca en `0.0.0.0`. Esto no es configurable por diseño.
- **No lo expongas a internet.** No lo pongas detrás de un reverse proxy, un túnel SSH público, ngrok, ni nada que sea accesible desde fuera de tu máquina. Si lo haces, cualquier persona podría ver tus mensajes entre agentes y manipular tu estado compartido.
- **Los agentes usan `--dangerously-skip-permissions`.** Cuando el dashboard lanza un Claude Code, lo hace con ese flag para no bloquearse en diálogos de confirmación. Asegúrate de que los `cwd` que configures sean directorios donde confíes en que el agente edite archivos.
- **Datos sensibles.** Los mensajes, el historial, los summaries y el estado compartido se guardan en texto plano en `~/.zaipex-acc/acc.db`. Si compartes tu máquina, ese archivo contiene todo lo que tus agentes han dicho.

Si encuentras una vulnerabilidad, por favor **no abras un issue público**. Escríbenos a <security@zaipex.ai> (o al correo que el equipo indique). Más detalles en [`SECURITY.md`](SECURITY.md).

---

## Roadmap

| Version | Features |
|---------|----------|
| **v0.2** ✅ | Dashboard web en tiempo real, tech lead permanente, avatares generativos, status line en vivo, reconexión automática |
| **v0.3** | Webhooks para integraciones externas, soporte para más agent runtimes (Gemini CLI, Codex), sistema de plugins |
| **v0.4** | Task management integrado, métricas y observabilidad |
| **v1.0** | Publicación en npm, API estable, documentación completa, **soporte nativo para Windows** |

<details>
<summary>🇬🇧 English</summary>

| Version | Features |
|---------|----------|
| **v0.2** ✅ | Real-time web dashboard, permanent tech lead, generative avatars, live status line, auto-reconnect |
| **v0.3** | Webhooks for external integrations, support for more agent runtimes (Gemini CLI, Codex), plugin system |
| **v0.4** | Integrated task management, metrics and observability |
| **v1.0** | npm publish, stable API, complete documentation, **native Windows support** |

</details>

---

## Contributing

¡Contribuciones son bienvenidas! Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) para el flujo completo. En corto:

1. Fork el repositorio
2. Crea una rama: `git checkout -b feat/mi-feature`
3. Haz tus cambios y agrega tests
4. Asegúrate que pasa todo:
   ```bash
   npm run build
   npm run dashboard:build
   npm test
   npx tsc --noEmit
   ```
5. Abre un PR con descripción clara

### Guidelines

- **Idioma del código**: inglés (identificadores, APIs, nombres de archivos).
- **Idioma de la documentación**: español primario, inglés como sección colapsable. Es el estilo de **Zaipex Labs**.
- TypeScript strict mode — evita `any` a menos que sea inevitable
- Todos los handlers del broker devuelven JSON
- Solo localhost (`127.0.0.1`) — nunca `0.0.0.0`
- Errores descriptivos — nunca hagas `catch { /* ignored */ }` sin razón
- Solo ESM imports — no `require`

---

## License

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE). Built by **[Zaipex Labs](https://zaipex.ai)**.

---

<p align="center">
  Hecho con ❤️ por el <strong>equipo de <a href="https://zaipex.ai">Zaipex Labs</a></strong>
</p>
