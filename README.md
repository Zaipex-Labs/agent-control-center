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

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)
[![Version](https://img.shields.io/badge/version-0.1.0-brightgreen.svg)](package.json)

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
git clone https://github.com/zaipex-labs/zaipex-acc.git
cd zaipex-acc && npm install && npm run build && npm link

# 2. Crear proyecto / Create project
acc project create my-app -d "My application"

# 3. Agregar agentes / Add agents
acc project add-agent my-app --role backend --cwd ~/app/backend
acc project add-agent my-app --role frontend --cwd ~/app/frontend

# 4. Levantar / Start
acc up my-app

# 5. Monitorear / Monitor
acc status my-app
acc history my-app
```

---

## Instalación / Installation

### Requisitos / Requirements

- **Node.js** 20+
- **npm** 9+
- **tmux** (recomendado para Linux/macOS — spawns agents in split panes)
- **Claude Code CLI** (para agentes Claude Code)

### Desde el código fuente / From source

```bash
git clone https://github.com/zaipex-labs/zaipex-acc.git
cd zaipex-acc
npm install
npm run build
npm link          # instala "acc" globalmente / installs "acc" globally
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

## Roadmap

| Version | Features |
|---------|----------|
| **v0.2** | Dashboard web en tiempo real, webhooks para integraciones externas, soporte para más agent runtimes |
| **v0.3** | Sistema de plugins, task management integrado, métricas y observabilidad |
| **v1.0** | Publicación en npm, API estable, documentación completa, soporte para Windows Terminal |

<details>
<summary>🇬🇧 English</summary>

| Version | Features |
|---------|----------|
| **v0.2** | Real-time web dashboard, webhooks for external integrations, support for more agent runtimes |
| **v0.3** | Plugin system, integrated task management, metrics and observability |
| **v1.0** | npm publish, stable API, complete documentation, Windows Terminal support |

</details>

---

## Contributing

¡Contribuciones son bienvenidas! / Contributions are welcome!

1. Fork el repositorio / Fork the repository
2. Crea una rama / Create a branch: `git checkout -b feat/my-feature`
3. Haz tus cambios y agrega tests / Make changes and add tests
4. Asegúrate que pasa todo / Ensure everything passes:
   ```bash
   npm run build
   npm test
   npx tsc --noEmit
   ```
5. Abre un PR con descripción clara / Open a PR with a clear description

### Guidelines

- TypeScript strict mode — no `any` unless unavoidable
- All broker handlers return JSON
- Localhost only (`127.0.0.1`) — never `0.0.0.0`
- Errors must be descriptive — never silently catch
- ESM imports only — no `require`

---

## License

[MIT](LICENSE) — Zaipex Labs

---

<p align="center">
  Made with ❤️ by <a href="https://zaipex.ai">Zaipex Labs</a>
</p>
