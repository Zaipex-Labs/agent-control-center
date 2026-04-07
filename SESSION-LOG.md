# zaipex-acc — Session Log

**Fecha:** 2026-04-06
**Branch:** `fix/improvements-and-i18n`
**Base:** `main` (commit `01eed45`)

---

## Commits realizados (en orden)

```
ae5eba4 test: comprehensive test suite — 151 tests across 14 files
0f2dc5f fix: input validation, body size limit, path traversal prevention
4a228e8 docs: bilingual README - Google style
99acda9 feat: i18n support - español and english
01eed45 feat: zaipex-acc v0.1.0 — Agents Command Center  ← base (main)
```

---

## Lo que se hizo

### 1. Fixes (en commit `99acda9`)
- **Regla 9 en INSTRUCTIONS** (`src/server/index.ts:93`): los agentes manejan mensajes de otros agentes silenciosamente, sin narrar al usuario.
- **Auto-start broker** (`src/server/broker-client.ts:98`): `ensureBroker()` usa `resolveEntryPoint()` para encontrar el broker (.ts o .js), funciona desde cualquier directorio.
- **Limpieza .mcp.json** (`src/cli/commands/up.ts:72-79`): antes de spawnar agentes, borra archivos `.mcp.json` residuales del directorio de cada agente.

### 2. i18n (en commit `99acda9`)
- `src/shared/i18n/en.ts` — 119 keys en inglés
- `src/shared/i18n/es.ts` — 119 keys en español
- `src/shared/i18n/index.ts` — función `t(key, params?)` con detección de idioma: `ACC_LANG` → `config.json` → `LANG` env → default `en`
- Todos los strings del CLI y server usan `t()`
- Comando `acc config set lang <en|es>` guarda preferencia en `~/.zaipex-acc/config.json`
- Las INSTRUCTIONS del MCP server se quedan en inglés

### 3. README (commit `4a228e8`)
- Reescrito estilo Google open source: badges, ASCII banner, tabla de contenidos
- Bilingüe: cada sección en español con `<details>` colapsable en inglés
- Secciones: Quick Start, Instalación, Conceptos, Agent Names, CLI Reference, MCP Tools, Config, Arquitectura, Roadmap, Contributing, License

### 4. Fixes de seguridad y robustez (commit `0f2dc5f`)

| Fix | Archivo | Qué |
|-----|---------|-----|
| Body size limit 1MB | `broker/handlers.ts` | `parseBody()` rechaza requests >1MB, previene OOM |
| Input validation | `broker/handlers.ts` | `project_id` y `role` validados contra `[a-zA-Z0-9_.-]`, previene command injection en tmux |
| Message text limit 100KB | `broker/handlers.ts` | `send-message` y `send-to-role` rechazan texto >100KB |
| Path traversal | `server/channel.ts` | `fromRole` sanitizado en nombres de interrupt files |
| Port validation | `shared/config.ts` | `ACC_PORT` validado rango 1-65535, fallback a 7899 |
| CWD validation | `cli/commands/project.ts` | `add-agent` verifica que el directorio exista |

### 5. Tests (commit `ae5eba4`)

**151 tests en 14 archivos.** Todos pasan.

| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `tests/shared/i18n.test.ts` | 12 | Detección idioma, interpolación, completitud en/es, placeholders match |
| `tests/shared/config.test.ts` | 8 | Constantes válidas (host, port, paths) |
| `tests/shared/types.test.ts` | 5 | Shapes de interfaces (compile-time) |
| `tests/shared/utils.test.ts` | 7 | generateId, getGitRoot, getGitBranch, getTty |
| `tests/shared/utils-extended.test.ts` | 10 | IDs únicos x1000, nombres determinísticos, resolveEntryPoint |
| `tests/broker/database.test.ts` | 30 | CRUD completo: peers, messages, log, shared state |
| `tests/broker/handlers.test.ts` | 32 | Todos los handlers HTTP con mock response |
| `tests/broker/cleanup.test.ts` | 4 | Limpieza de peers muertos por PID |
| `tests/broker/server.test.ts` | 5 | Broker HTTP lifecycle, routing, JSON inválido |
| `tests/broker/validation.test.ts` | 9 | Command injection, body size, metacaracteres |
| `tests/integration/broker.test.ts` | 8 | Flujo completo: register → send → poll → history |
| `tests/integration/message-flow.test.ts` | 7 | 3 agentes, tipos de mensaje, historial, broadcast |
| `tests/integration/peer-lifecycle.test.ts` | 7 | Ciclo de vida completo, aislamiento por proyecto, nombres |
| `tests/integration/shared-state.test.ts` | 7 | CRUD lifecycle, upsert, aislamiento namespace/proyecto |

---

## Análisis de seguridad realizado

### Vulnerabilidades encontradas y su estado

| # | Severidad | Estado | Descripción |
|---|-----------|--------|-------------|
| S1 | CRÍTICA | **FIXED** | Command injection en tmux via project_id/role — validación de input agregada |
| S2 | CRÍTICA | **MITIGADO** | Command injection en spawn.ts via cwd/args — `shellEscape()` ya existía, validación de cwd agregada |
| S3 | ALTA | **FIXED** | Sin límite de body size en parseBody() — 1MB limit agregado |
| S4 | ALTA | **PENDIENTE** | Sin rate limiting — necesario para cloud |
| S5 | MEDIA | **FIXED** | Sin validación de tipos en input — validación de identifiers agregada |
| S6 | MEDIA | **FIXED** | Path traversal en interrupt files — sanitización de fromRole |
| S7 | BAJA | **FIXED** | ACC_PORT sin validación de rango — fallback a 7899 |

### Bugs encontrados y su estado

| # | Severidad | Estado | Descripción |
|---|-----------|--------|-------------|
| B1 | ALTA | **PENDIENTE** | Cleanup mata peers ajenos — `process.kill(pid, 0)` no funciona cross-user |
| B2 | ALTA | **PENDIENTE** | Poll marca delivered aunque push falle → mensajes perdidos |
| B3 | MEDIA | **PENDIENTE** | session_id en log usa peer ID en vez de session real |
| B4 | MEDIA | **PENDIENTE** | Double-check tmux en down.ts |
| B5 | MEDIA | **PENDIENTE** | Race condition en ensureBroker (2 agentes simultáneos) |
| B6 | BAJA | **PENDIENTE** | Colisión de nombres para roles custom |
| B7 | BAJA | **PENDIENTE** | MESSAGE_TTL hardcoded 30min |

---

## Lo que falta por hacer

### Próximo paso inmediato
- [ ] Merge branch `fix/improvements-and-i18n` → `main`
- [ ] Fix B2 (acknowledgment protocol para mensajes) — es el bug más impactante
- [ ] Fix B4 y B5 (low effort)

### Para v0.2 — Cloud + Dashboard

| Tarea | Esfuerzo | Descripción |
|-------|----------|-------------|
| Bind configurable | Bajo | Cambiar `ACC_HOST` hardcoded a configurable (`0.0.0.0` para cloud) con flag `--listen` |
| Auth por token | Medio | Token por proyecto en header `Authorization: Bearer <token>` |
| HTTPS/TLS | Bajo | Reverse proxy con Caddy, o TLS directo |
| DB remota | Medio | Turso (SQLite distribuido) o PostgreSQL |
| WebSocket | Medio | Reemplazar polling 1s con WS para push real |
| Web dashboard | Alto | React + Vite + TailwindCSS + WS. Live peers, chat timeline, shared state viewer, send message form |
| Dockerfile | Bajo | Node 20 alpine, expose 7899, deploy Fly.io/Railway |
| Schema migrations | Medio | Versioning de schema para upgrades sin romper DB existente |
| Rate limiting | Bajo | Limitar requests por peer |

### Para v0.3

| Tarea | Descripción |
|-------|-------------|
| Plugin system | Extensiones para nuevos agent runtimes |
| Task management | Asignar/trackear tareas entre agentes |
| Métricas | Mensajes/s, latencia, peers activos over time |
| `acc logs -f` | Tail en tiempo real del message_log |
| Acknowledgment protocol | Broker no marca delivered hasta confirmación del agent |

### Para v1.0

| Tarea | Descripción |
|-------|-------------|
| npm publish | Publicar como paquete npm global |
| API estable | Versionado de broker API |
| Docs site | Documentación completa con ejemplos |
| Windows Terminal | Soporte completo de spawn en Windows |

---

## Nombres de agentes

Definidos en `src/shared/utils.ts`:

| Rol | Nombre |
|-----|--------|
| backend | Turing |
| frontend | Lovelace |
| qa | Curie |
| architect | Da Vinci |
| devops | Tesla |
| data | Gauss |
| ml | Euler |
| analytics | Fibonacci |
| security | Enigma |

**Fallback pool** (roles no listados, asignado por hash determinístico):
Faraday, Newton, Hypatia, Hawking, Galileo, Ramanujan, Noether, Fermat, Kepler, Planck

Override: `ACC_NAME` env var o `--name` en `acc project add-agent`

---

## Arquitectura actual

```
                          ┌──────────────────────┐
                          │     Human (CLI)       │
                          │    $ acc up my-app    │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │    BROKER DAEMON      │
                          │  127.0.0.1:7899       │
                          │  SQLite: acc.db       │
                          │  peers | messages     │
                          │  shared_state | log   │
                          └───┬───────────┬───────┘
                              │           │
               ┌──────────────▼──┐   ┌────▼──────────────┐
               │  MCP Server A   │   │  MCP Server B     │
               │  (stdio)        │   │  (stdio)          │
               │  Agent: Turing  │   │  Agent: Lovelace  │
               │  Role: backend  │   │  Role: frontend   │
               └─────────────────┘   └──────────────────-┘
```

## Stack

- Runtime: Node.js 20+
- Lenguaje: TypeScript (strict)
- DB: SQLite via better-sqlite3
- MCP: @modelcontextprotocol/sdk
- CLI: commander + chalk
- Tests: vitest (151 tests)
