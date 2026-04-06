# zaipex-acc — Agents Command Center

## Zaipex Labs · Documento de Diseño v0.2

---

## Qué es

Un orquestador ligero de agentes de IA para desarrollo en equipo. Agnóstico — funciona con Claude Code, Codex, Copilot, o cualquier agente que soporte MCP.

Resuelve tres problemas:
1. "Tengo dos o más agentes trabajando en paralelo y necesitan coordinarse sin que yo sea el mensajero humano"
2. "Trabajo en múltiples proyectos y no quiero que los agentes de uno interfieran con los de otro"
3. "Cada vez que abro una sesión nueva tengo que levantar todo de cero"

---

## Arquitectura

```
                    ┌─────────────────────────────┐
                    │        BROKER DAEMON         │
                    │    localhost:7899 + SQLite    │
                    │                              │
                    │  ┌─────────┐  ┌───────────┐  │
                    │  │  peers  │  │ messages  │  │
                    │  ├─────────┤  ├───────────┤  │
                    │  │ shared  │  │ msg_log   │  │
                    │  │ _state  │  │           │  │
                    │  └─────────┘  └───────────┘  │
                    └──────┬──────────────┬────────┘
                           │              │
                    MCP Server A    MCP Server B
                    (stdio)         (stdio)
                           │              │
                    Agent A          Agent B
                    rol: backend     rol: frontend
```

### Componentes

**1. Broker Daemon** (`broker.ts`)
- Servidor HTTP en `127.0.0.1:7899`
- SQLite para persistencia
- No toma decisiones, solo rutea y almacena
- Arranca automáticamente con el primer agente
- Limpia peers muertos automáticamente

**2. MCP Server Adapter** (`server.ts`)
- Uno por cada instancia de agente
- Se registra con rol al conectarse
- Envía/recibe mensajes
- Lee/escribe shared state
- Push de mensajes via `claude/channel` protocol

**3. CLI Monitor** (`cli.ts`)
- Dashboard en terminal para el humano
- Ver peers conectados en tiempo real
- Monitorear mensajes entre agentes
- Leer/escribir shared state manualmente
- Ver historial de conversaciones

---

## Gestión de proyectos

### Concepto

Cada proyecto define un equipo de agentes con sus roles y directorios.
Todo (peers, mensajes, shared state, historial) está aislado por proyecto.

### Config de proyecto (`~/.zaipex-acc/projects/<name>.json`)
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
      "agent_args": ["--dangerously-load-development-channels", "server:acc"],
      "instructions": "Eres el agente de backend. Stack: FastAPI + PostgreSQL."
    },
    {
      "role": "frontend",
      "cwd": "~/zaipex/frontend",
      "agent_cmd": "claude",
      "agent_args": ["--dangerously-load-development-channels", "server:acc"],
      "instructions": "Eres el agente de frontend. Stack: Next.js + React 19."
    }
  ],
  "shared_state_defaults": {
    "contracts": {},
    "config": { "api_base": "http://localhost:8000" }
  }
}
```

### CLI de proyectos
```bash
# Gestión
acc project create <name>                          # Crear proyecto nuevo
acc project add-agent <name> --role <r> --cwd <d>  # Agregar agente al proyecto
acc project remove-agent <name> --role <r>         # Quitar agente
acc project edit <name>                            # Abrir config en editor
acc projects                                       # Listar todos los proyectos

# Operación
acc up <name>                   # Levantar todos los agentes del proyecto
acc up <name> --only backend    # Levantar solo uno
acc down <name>                 # Apagar todos los agentes
acc status <name>               # Ver estado actual (quién está vivo, mensajes, etc.)

# Historial
acc history <name>              # Ver historial de mensajes del proyecto
acc history <name> --role backend --last 20
acc shared <name>               # Ver shared state del proyecto
acc shared <name> contracts     # Ver un namespace específico
```

### Lógica de proyecto

Si `ACC_PROJECT` está definido, usa ese proyecto.
Si no, detecta el `git_root` del cwd actual y busca un proyecto que lo contenga.
Si no encuentra ninguno, usa un proyecto default llamado `_default`.

### Spawn con tmux

`acc up` levanta una sesión de tmux con un pane por agente:

```
┌─────────────────────────────────────────────────┐
│ zaipex-saas                                     │
├────────────────────────┬────────────────────────┤
│ [backend]              │ [frontend]             │
│ ~/zaipex/backend       │ ~/zaipex/frontend      │
│                        │                        │
│ Claude Code            │ Claude Code            │
│ Rol: backend           │ Rol: frontend          │
│ Proyecto: zaipex-saas  │ Proyecto: zaipex-saas  │
│                        │                        │
└────────────────────────┴────────────────────────┘
  Ctrl+B → ← para navegar entre agentes
  Ctrl+B d  para detach (siguen corriendo)
```

Si no tienes tmux, abre terminales separadas con instrucciones.

---

## Base de datos (SQLite)

Todas las tablas tienen `project_id` para aislar datos por proyecto.

### Tabla: `peers`
```sql
CREATE TABLE peers (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,           -- Proyecto al que pertenece
  pid         INTEGER NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  agent_type  TEXT NOT NULL DEFAULT '',
  cwd         TEXT NOT NULL,
  git_root    TEXT,
  git_branch  TEXT,
  tty         TEXT,
  summary     TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX idx_peers_project ON peers(project_id);
```

### Tabla: `messages`
```sql
CREATE TABLE messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'message',
  text      TEXT NOT NULL,
  metadata  TEXT,
  sent_at   TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (from_id) REFERENCES peers(id)
);
CREATE INDEX idx_messages_project ON messages(project_id);
CREATE INDEX idx_messages_to ON messages(to_id, delivered);
```

### Tabla: `shared_state`
```sql
CREATE TABLE shared_state (
  project_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, namespace, key)
);
```

### Tabla: `message_log`
```sql
CREATE TABLE message_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  from_id   TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  to_role   TEXT NOT NULL,
  type      TEXT NOT NULL,
  text      TEXT NOT NULL,
  metadata  TEXT,
  sent_at   TEXT NOT NULL,
  session_id TEXT NOT NULL
);
CREATE INDEX idx_log_project ON message_log(project_id);
CREATE INDEX idx_log_session ON message_log(session_id);
```

---

## Herramientas MCP (tools)

### Descubrimiento
| Tool | Descripción |
|------|------------|
| `list_peers` | Listar agentes conectados. Filtrar por scope (machine/directory/repo) o por rol |
| `whoami` | Ver mi propio ID, rol, y estado de registro |

### Mensajería
| Tool | Descripción |
|------|------------|
| `send_message` | Enviar mensaje a un peer por ID |
| `send_to_role` | Enviar mensaje a todos los peers con un rol específico |
| `check_messages` | Verificar mensajes nuevos manualmente (fallback) |
| `get_history` | Ver historial de mensajes (filtrar por rol, tipo, o cantidad) |

### Estado compartido
| Tool | Descripción |
|------|------------|
| `set_shared` | Escribir un valor en el estado compartido (namespace + key) |
| `get_shared` | Leer un valor del estado compartido |
| `list_shared` | Listar todas las keys en un namespace |
| `watch_shared` | Recibir notificación cuando un key cambie |

### Identidad
| Tool | Descripción |
|------|------------|
| `set_summary` | Actualizar descripción de trabajo actual |
| `set_role` | Cambiar rol (si necesita reasignarse) |

---

## Broker API (HTTP endpoints)

### Peers
```
POST /register        → { pid, cwd, git_root, git_branch, tty, role, agent_type, summary }
POST /heartbeat       → { id }
POST /unregister      → { id }
POST /set-summary     → { id, summary }
POST /set-role        → { id, role }
POST /list-peers      → { scope, cwd, git_root, exclude_id, role? }
```

### Messages
```
POST /send-message    → { from_id, to_id, type, text, metadata? }
POST /send-to-role    → { from_id, role, type, text, metadata? }
POST /poll-messages   → { id }
POST /get-history     → { role?, type?, limit?, session_id? }
```

### Shared State
```
POST /shared/set      → { namespace, key, value, peer_id }
POST /shared/get      → { namespace, key }
POST /shared/list     → { namespace }
POST /shared/delete   → { namespace, key, peer_id }
```

### Admin
```
GET  /health          → { status, peers_count, messages_pending }
GET  /status          → { peers: [...], shared_state_keys: [...], session_id }
```

---

## Flujo de uso típico

### Escenario: Setup inicial de un proyecto

```bash
# Una sola vez: crear proyecto y definir equipo
$ acc project create zaipex-saas
$ acc project add-agent zaipex-saas --role backend --cwd ~/zaipex/backend
$ acc project add-agent zaipex-saas --role frontend --cwd ~/zaipex/frontend

# Cada día de trabajo:
$ acc up zaipex-saas
# → Abre tmux con 2 panes, cada uno con Claude Code registrado
# → Backend y frontend ya se ven, mismo proyecto, listos
```

### Escenario: Front y Back coordinándose

```
1. acc up zaipex-saas levanta ambos agentes
   → Backend se registra con rol "backend"
   → Frontend se registra con rol "frontend"
   → Ambos ven al otro con list_peers

2. Backend termina endpoint GET /api/users:
   → set_shared("contracts", "api/users/GET", {
       method: "GET",
       response: { users: [{ id, name, email }] },
       status_codes: [200, 401]
     })
   → send_to_role("frontend", type: "contract_update",
       "Listo el GET /api/users, revisa el contrato en shared state")

3. Frontend recibe el mensaje push inmediato:
   → get_shared("contracts", "api/users/GET")
   → Implementa el fetch basándose en el contrato
   → send_to_role("backend", type: "question",
       "¿El endpoint soporta paginación?")

4. Backend recibe y responde:
   → send_message(frontend_id, type: "response",
       "Sí, acepta ?page=N&limit=N, default limit=20")

5. Sesión nueva al día siguiente:
   $ acc up zaipex-saas
   → Los agentes nuevos se levantan
   → get_history(role: "backend", last: 50)
   → Ve toda la conversación anterior
   → get_shared("contracts") → ve todos los contratos vigentes
   → Continúa donde se quedó

6. Cambio de proyecto:
   $ acc down zaipex-saas
   $ acc up cliente-acme
   → Ahora los agentes son los de otro proyecto
   → Datos completamente aislados
```

---

## Stack técnico

- **Runtime:** Node.js (sin dependencia de Bun)
- **Lenguaje:** TypeScript
- **Base de datos:** SQLite (via better-sqlite3)
- **MCP SDK:** @modelcontextprotocol/sdk
- **CLI:** Commander.js + chalk para colores
- **Zero dependencias externas** — todo corre local

---

## Estructura de archivos

```
zaipex-acc/
├── src/
│   ├── broker/
│   │   ├── index.ts          -- Servidor HTTP principal
│   │   ├── database.ts       -- Setup y queries SQLite
│   │   ├── handlers.ts       -- Handlers de cada endpoint
│   │   └── cleanup.ts        -- Limpieza de peers muertos
│   ├── server/
│   │   ├── index.ts          -- MCP server principal
│   │   ├── tools.ts          -- Definición de herramientas MCP
│   │   ├── broker-client.ts  -- Cliente HTTP para el broker
│   │   └── channel.ts        -- Push de mensajes via channel
│   ├── cli/
│   │   ├── index.ts          -- CLI principal (entry point `acc`)
│   │   ├── commands/
│   │   │   ├── project.ts    -- create, add-agent, remove-agent, edit, list
│   │   │   ├── up.ts         -- Levantar agentes (tmux spawn)
│   │   │   ├── down.ts       -- Apagar agentes
│   │   │   ├── status.ts     -- Estado del proyecto
│   │   │   ├── history.ts    -- Ver historial de mensajes
│   │   │   ├── shared.ts     -- Ver/editar shared state
│   │   │   ├── peers.ts      -- Listar peers activos
│   │   │   └── send.ts       -- Enviar mensaje desde CLI
│   │   ├── spawn.ts          -- Lógica de tmux/terminal spawn
│   │   └── ui.ts             -- Formateo y colores
│   └── shared/
│       └── types.ts          -- Tipos compartidos
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                   -- MIT
└── .github/
    └── workflows/
        └── ci.yml            -- Tests y lint
```

### Datos locales (`~/.zaipex-acc/`)
```
~/.zaipex-acc/
├── acc.db                    -- SQLite (peers, messages, shared_state, log)
├── projects/
│   ├── zaipex-saas.json      -- Config del proyecto SaaS
│   ├── cliente-acme.json     -- Config de proyecto de consultoría
│   └── _default.json         -- Proyecto default (auto-generado)
└── config.json               -- Config global (port, log level, etc.)
```

---

## Configuración

| Variable de entorno | Default | Descripción |
|---------------------|---------|-------------|
| `ACC_PORT` | `7899` | Puerto del broker |
| `ACC_PROJECT` | auto-detect | Proyecto activo (override manual) |
| `ACC_ROLE` | `""` | Rol default al registrarse |
| `ACC_SESSION_ID` | auto-generated | ID de sesión para agrupar historial |
| `ACC_LOG_LEVEL` | `info` | Nivel de logging (debug, info, warn, error) |

---

## Diferencias vs claude-peers-mcp

| Feature | claude-peers-mcp | zaipex-acc |
|---------|-----------------|------------|
| Roles | ❌ | ✅ Registro con rol, envío por rol |
| Proyectos | ❌ | ✅ Aislamiento completo por proyecto |
| Spawn automático | ❌ | ✅ `acc up` levanta todo el equipo |
| Shared State | ❌ | ✅ Key-value compartido con namespaces |
| Message Types | ❌ | ✅ question, response, contract_update, etc. |
| Historial persistente | ❌ | ✅ message_log sobrevive sesiones |
| Envío por rol | ❌ | ✅ send_to_role sin necesitar ID |
| CLI completo | Básico | ✅ project mgmt, watch, history, shared state |
| Agnóstico | Solo Claude Code | ✅ Cualquier agente MCP |
| Dependencia de OpenAI | Opcional | ❌ Cero dependencias externas |
| Runtime | Bun only | ✅ Node.js (universal) |

---

## Roadmap futuro

### v0.2
- Webhooks para notificaciones externas
- Web UI para monitoreo (standalone HTML, estilo Zaipex)
- Soporte para múltiples proyectos/rigs simultáneos

### v0.3
- Plugins para integraciones (Slack, Discord, etc.)
- Task management integrado (como Agent Teams pero agnóstico)
- Métricas de comunicación entre agentes

### v1.0
- Protocolo estable y documentado
- npm package publicado
- Documentación completa en zaipex.ai/labs/acc

---

*Zaipex Labs — IA y Datos listos para usar. Sin la complejidad.*
