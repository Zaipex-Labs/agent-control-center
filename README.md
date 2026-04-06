# zaipex-acc — Agents Command Center

Orquestador ligero de agentes de IA para desarrollo en equipo. Permite que múltiples instancias de Claude Code (u otros agentes MCP) se comuniquen entre sí, compartan estado, y se coordinen sin intervención humana.

## Quick Start

```bash
# Instalar
npm install
npm run build

# Crear un proyecto
acc project create mi-proyecto -d "Mi app"
acc project add-agent mi-proyecto --role backend --cwd ~/app/backend
acc project add-agent mi-proyecto --role frontend --cwd ~/app/frontend

# Levantar agentes
acc up mi-proyecto

# Ver estado
acc status mi-proyecto
acc peers mi-proyecto

# Enviar un mensaje desde la terminal
acc send mi-proyecto "Implementa el endpoint /users" --to-role backend

# Ver historial
acc history mi-proyecto

# Apagar
acc down mi-proyecto
```

## Instalación

Requiere Node.js 20+.

```bash
git clone https://github.com/zaipex-labs/zaipex-acc.git
cd zaipex-acc
npm install
npm run build
npm link   # instala "acc" globalmente
```

Para desarrollo:

```bash
npm run dev:cli -- projects          # corre CLI sin compilar
npm run dev                          # corre MCP server
npm test                             # tests con vitest
npm run test:watch                   # tests en modo watch
```

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

- **Broker** — Servidor HTTP en `127.0.0.1:7899`. Rutea mensajes y almacena estado en SQLite (`~/.zaipex-acc/acc.db`). Se auto-arranca con el primer agente.
- **MCP Server** — Uno por instancia de agente. Se registra con rol y proyecto. Expone tools al agente para comunicarse.
- **CLI (`acc`)** — Herramienta para el humano: gestión de proyectos, spawn de agentes, monitor.

## CLI

### Proyectos

```bash
acc projects                                          # listar proyectos
acc project create <nombre> [-d <descripción>]        # crear proyecto
acc project add-agent <nombre> -r <rol> --cwd <dir>   # agregar agente
acc project remove-agent <nombre> -r <rol>            # quitar agente
acc project show <nombre>                             # ver config
```

### Operación

```bash
acc up <nombre> [--only <rol>] [--strategy <s>]   # levantar agentes
acc down <nombre>                                  # apagar agentes
acc status [nombre]                                # estado del broker y peers
acc peers [nombre]                                 # peers activos
```

### Datos

```bash
acc history <nombre> [-r <rol>] [-l <n>]   # historial de mensajes
acc shared <nombre> [namespace] [key]      # ver shared state
acc send <nombre> <mensaje> --to-role <r>  # enviar mensaje
```

## MCP Tools

El servidor MCP expone estas herramientas al agente:

| Tool | Descripción |
|------|-------------|
| `list_peers` | Ver otros agentes del proyecto |
| `whoami` | Identidad del agente |
| `send_message` | Enviar mensaje directo por ID |
| `send_to_role` | Broadcast por rol |
| `check_messages` | Leer mensajes pendientes |
| `get_history` | Historial de conversación |
| `set_shared` | Escribir estado compartido |
| `get_shared` | Leer estado compartido |
| `list_shared` | Listar keys de un namespace |
| `set_summary` | Actualizar resumen del agente |
| `set_role` | Cambiar rol del agente |

## Configuración

| Variable de entorno | Default | Descripción |
|---------------------|---------|-------------|
| `ACC_HOME` | `~/.zaipex-acc` | Directorio de datos |
| `ACC_PORT` | `7899` | Puerto del broker |
| `ACC_PROJECT` | auto-detectado | Proyecto activo |
| `ACC_ROLE` | `""` | Rol del agente |

## Stack

- **Runtime:** Node.js 20+
- **Lenguaje:** TypeScript (strict mode)
- **Base de datos:** SQLite via `better-sqlite3`
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **CLI:** `commander` + `chalk`
- **Testing:** vitest

## Licencia

MIT — Zaipex Labs
