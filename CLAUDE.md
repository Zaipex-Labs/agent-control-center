# zaipex-acc — Agents Command Center

## Qué es este proyecto

Un orquestador ligero de agentes de IA para desarrollo en equipo. Permite que múltiples instancias de Claude Code (u otros agentes MCP) se comuniquen entre sí, compartan estado, y se coordinen sin intervención humana.

Esto es un producto de **Zaipex Labs**. Se publica open source.

## Stack

- **Runtime:** Node.js 20+ (NO Bun — debe ser universal)
- **Lenguaje:** TypeScript (strict mode)
- **Base de datos:** SQLite via `better-sqlite3`
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **CLI:** `commander` + `chalk`
- **Testing:** vitest
- **Sin dependencias externas** — todo corre local en localhost

## Principios de desarrollo

- **Cero magia.** Código explícito, sin abstracciones innecesarias.
- **Localhost only.** El broker NUNCA escucha en 0.0.0.0. Siempre 127.0.0.1.
- **Cross-platform.** Debe funcionar en Linux, macOS, y Windows.
- **Un solo SQLite.** Todo en `~/.zaipex-acc/acc.db`.
- **Errores claros.** Si algo falla, el mensaje debe decir qué y cómo arreglarlo.

## Arquitectura

```
┌─────────────────────────────┐
│        BROKER DAEMON         │
│    127.0.0.1:7899 + SQLite   │
│                              │
│  peers | messages | shared   │
│  _state | message_log        │
└──────┬──────────────┬────────┘
       │              │
  MCP Server A    MCP Server B
  (stdio)         (stdio)
       │              │
  Agent A          Agent B
  rol: backend     rol: frontend
  project: saas    project: saas
```

### Componentes

**Broker** (`src/broker/`) — Servidor HTTP en 127.0.0.1:7899. Solo rutea y almacena. No toma decisiones. Auto-arranca con el primer agente, limpia peers muertos cada 30s.

**MCP Server** (`src/server/`) — Uno por instancia de agente. Se registra con rol y proyecto. Envía/recibe mensajes. Lee/escribe shared state. Push via `notifications/claude/channel`.

**CLI** (`src/cli/`) — Herramienta `acc` para el humano. Gestión de proyectos, spawn de agentes, monitor en tiempo real.

## Base de datos

Todas las tablas usan `project_id` para aislar datos por proyecto.

```sql
-- Agentes conectados
CREATE TABLE peers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  agent_type TEXT NOT NULL DEFAULT 'claude-code',
  cwd TEXT NOT NULL,
  git_root TEXT,
  git_branch TEXT,
  tty TEXT,
  summary TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX idx_peers_project ON peers(project_id);

-- Mensajes pendientes de entrega
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  text TEXT NOT NULL,
  metadata TEXT,
  sent_at TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_messages_project ON messages(project_id);
CREATE INDEX idx_messages_to ON messages(to_id, delivered);

-- Estado compartido (key-value por namespace)
CREATE TABLE shared_state (
  project_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, namespace, key)
);

-- Historial persistente de toda la comunicación
CREATE TABLE message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_role TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata TEXT,
  sent_at TEXT NOT NULL,
  session_id TEXT NOT NULL
);
CREATE INDEX idx_log_project ON message_log(project_id);
CREATE INDEX idx_log_session ON message_log(session_id);
```

### Message types válidos:
`message`, `question`, `response`, `contract_update`, `notification`, `task_request`, `task_complete`

## Broker API

### Peers
```
POST /register     body: { pid, cwd, git_root?, git_branch?, tty?, role, agent_type?, summary?, project_id }
                   resp: { id }

POST /heartbeat    body: { id }
                   resp: { ok: true }

POST /unregister   body: { id }
                   resp: { ok: true }

POST /set-summary  body: { id, summary }
                   resp: { ok: true }

POST /set-role     body: { id, role }
                   resp: { ok: true }

POST /list-peers   body: { project_id, scope?, cwd?, git_root?, exclude_id?, role? }
                   resp: Peer[]
                   scope: "project" (default) | "machine" | "directory" | "repo"
```

### Messages
```
POST /send-message  body: { project_id, from_id, to_id, type?, text, metadata? }
                    resp: { ok: true } | { ok: false, error: string }

POST /send-to-role  body: { project_id, from_id, role, type?, text, metadata? }
                    resp: { ok: true, sent_to: number }

POST /poll-messages body: { id }
                    resp: { messages: Message[] }

POST /get-history   body: { project_id, role?, type?, limit?, session_id? }
                    resp: { messages: LogEntry[] }
```

### Shared State
```
POST /shared/set    body: { project_id, namespace, key, value (JSON string), peer_id }
                    resp: { ok: true }

POST /shared/get    body: { project_id, namespace, key }
                    resp: { value: any, updated_by, updated_at } | { error: "not found" }

POST /shared/list   body: { project_id, namespace }
                    resp: { keys: string[] }

POST /shared/delete body: { project_id, namespace, key, peer_id }
                    resp: { ok: true }
```

### Admin
```
GET /health         resp: { status: "ok", peers: number, pending_messages: number }
```

## MCP Tools

El server expone estas herramientas al agente:

```typescript
// Descubrimiento
list_peers(scope?: "project" | "machine" | "directory" | "repo"): Peer[]
whoami(): { id, role, project_id, summary }

// Mensajería
send_message(to_id: string, text: string, type?: MessageType): void
send_to_role(role: string, text: string, type?: MessageType): void
check_messages(): Message[]
get_history(options?: { role?: string, type?: string, limit?: number }): LogEntry[]

// Estado compartido
set_shared(namespace: string, key: string, value: any): void
get_shared(namespace: string, key: string): any
list_shared(namespace: string): string[]

// Identidad
set_summary(summary: string): void
set_role(role: string): void
```

## CLI (`acc`)

```bash
# Proyectos
acc projects                                        # Listar proyectos
acc project create <name>                           # Crear proyecto
acc project add-agent <name> --role <r> --cwd <d>   # Agregar agente
acc project remove-agent <name> --role <r>          # Quitar agente
acc project show <name>                             # Ver config del proyecto

# Operación
acc up <name> [--only <role>]     # Levantar agentes (tmux en Linux/macOS, procesos en Windows)
acc down <name>                   # Apagar agentes
acc status [name]                 # Estado actual

# Datos
acc history <name> [--role <r>] [--last <n>]   # Historial de mensajes
acc shared <name> [namespace] [key]            # Ver shared state
acc send <name> --to-role <r> <message>        # Enviar mensaje desde CLI
acc peers [name]                               # Peers activos

# Admin
acc broker start                  # Arrancar broker manualmente
acc broker stop                   # Parar broker
acc broker status                 # Estado del broker
```

## Estructura de archivos

```
zaipex-acc/
├── src/
│   ├── broker/
│   │   ├── index.ts           -- createBrokerServer(), arranca HTTP
│   │   ├── database.ts        -- initDatabase(), prepared statements
│   │   ├── handlers.ts        -- handler por cada endpoint
│   │   └── cleanup.ts         -- cleanStalePeers() cada 30s
│   ├── server/
│   │   ├── index.ts           -- main(), MCP server setup + polling loop
│   │   ├── tools.ts           -- definiciones de tools MCP
│   │   ├── broker-client.ts   -- brokerFetch<T>(), isBrokerAlive(), ensureBroker()
│   │   └── channel.ts         -- pushMessage() via notifications/claude/channel
│   ├── cli/
│   │   ├── index.ts           -- entry point, commander setup
│   │   ├── commands/
│   │   │   ├── project.ts     -- create, add-agent, remove-agent, show, list
│   │   │   ├── up.ts          -- spawn agentes
│   │   │   ├── down.ts        -- kill agentes
│   │   │   ├── status.ts      -- estado del proyecto
│   │   │   ├── history.ts     -- historial de mensajes
│   │   │   ├── shared.ts      -- shared state CRUD
│   │   │   ├── peers.ts       -- listar peers
│   │   │   └── send.ts        -- enviar mensaje manual
│   │   ├── spawn.ts           -- SpawnStrategy: tmux | windows-terminal | fallback
│   │   └── ui.ts              -- colores, tablas, formateo
│   └── shared/
│       ├── types.ts           -- interfaces y tipos
│       ├── config.ts          -- paths, defaults, env vars
│       └── utils.ts           -- getGitRoot(), generateId(), etc.
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── LICENSE                    -- MIT
└── CLAUDE.md                  -- este archivo
```

## Config de proyecto (`~/.zaipex-acc/projects/<name>.json`)

```json
{
  "name": "zaipex-saas",
  "description": "Plataforma SaaS de Zaipex Labs",
  "created_at": "2026-04-05T...",
  "agents": [
    {
      "role": "backend",
      "cwd": "~/zaipex/backend",
      "agent_cmd": "claude",
      "agent_args": ["--dangerously-load-development-channels", "server:zaipex-acc"],
      "instructions": "Stack: FastAPI + PostgreSQL 16. Eres responsable de la API."
    },
    {
      "role": "frontend",
      "cwd": "~/zaipex/frontend",
      "agent_cmd": "claude",
      "agent_args": ["--dangerously-load-development-channels", "server:zaipex-acc"],
      "instructions": "Stack: Next.js + React 19. Eres responsable del UI."
    }
  ]
}
```

## Orden de implementación

Construir en este orden exacto, probando cada módulo antes de avanzar:

1. `src/shared/types.ts` + `src/shared/config.ts` + `src/shared/utils.ts`
2. `src/broker/database.ts`
3. `src/broker/handlers.ts`
4. `src/broker/cleanup.ts`
5. `src/broker/index.ts` — probar con curl que todos los endpoints responden
6. `src/server/broker-client.ts`
7. `src/server/channel.ts`
8. `src/server/tools.ts`
9. `src/server/index.ts` — probar que dos instancias se ven y se mandan mensajes
10. `src/cli/` — empezar por project, luego status, luego up/down
11. Tests con vitest

## Reglas de código

- Usar `import` / `export` (ESM), no `require`
- Tipos explícitos, no `any` excepto donde es inevitable
- Errores con mensajes descriptivos, nunca silenciar catches vacíos
- Console output solo via stderr en el MCP server (stdout es el protocolo MCP)
- Todos los handlers del broker devuelven JSON
- El broker SIEMPRE escucha en `127.0.0.1`, NUNCA en `0.0.0.0`
