# Contribuir a Zaipex ACC

¡Gracias por querer aportar! Esto es un proyecto open source del **equipo de Zaipex Labs** y todas las contribuciones son bienvenidas — desde reportar un bug hasta agregar una nueva integración.

> 🇬🇧 **English**: see the collapsible English section at the end of each block.

---

## Antes de empezar

1. **Abre un issue primero** si vas a hacer un cambio no trivial. Nos ahorra a ambos que termines un PR que no encaja con la dirección del proyecto.
2. **Busca issues existentes** antes de crear uno nuevo. Etiquetas útiles:
   - `good first issue` — perfecto para estrenar
   - `help wanted` — necesitamos ayuda acá
   - `discussion` — no hay decisión todavía, opina
3. **Respeta el código de conducta** — sé amable y respetuoso. No hay mucho más que decir.

---

## Idioma

- **Código e identificadores** (nombres de funciones, variables, archivos, APIs, tipos): **inglés**.
- **Documentación, README, comentarios user-facing, strings de UI, logs del CLI**: **español primario**, inglés como sección colapsable cuando aplique.
- **Commits**: en español está bien, en inglés también. Lo importante es que expliquen el "por qué".

Es el estilo de Zaipex Labs: hacemos herramientas de IA pensadas para hispanohablantes sin sacrificar que el código pueda ser leído y forkeado por cualquiera en el mundo.

---

## Setup de desarrollo

```bash
git clone https://github.com/Zaipex-Labs/agent-control-center.git
cd zaipex-acc
npm install
npm run build            # compila servidor + CLI
npm run dashboard:build  # compila dashboard
npm link                 # instala "acc" global
```

Para desarrollar con hot reload:

```bash
npm run dev:cli -- projects        # corre el CLI sin compilar
npm run dev                        # corre el MCP server directamente
npm run dashboard:dev              # Vite dev server del dashboard
```

Para correr los tests:

```bash
npm test                  # una corrida
npm run test:watch        # modo watch
npx tsc --noEmit          # type check sin emitir
```

---

## Flujo de un PR

1. **Fork** el repo a tu cuenta.
2. **Rama nueva**: `git checkout -b feat/mi-feature` (`fix/…`, `docs/…`, `refactor/…` también funcionan).
3. **Cambios + tests**: si agregas lógica de negocio, agrega un test en `tests/`. Usamos [vitest](https://vitest.dev/).
4. **Verifica antes del push**:
   ```bash
   npm run build
   npm run dashboard:build
   npm test
   npx tsc --noEmit
   ```
5. **Commit**: mensaje descriptivo. Preferimos el formato `tipo(scope): descripción corta` (ej. `fix(broker): handle zombie peers after reload`) pero no es obligatorio.
6. **Push y PR**: apunta a `main`. En la descripción explica **qué cambia, por qué, y cómo probarlo**.

Si tu PR afecta el dashboard, incluye una screenshot del antes/después.

---

## Guidelines de código

- **TypeScript strict mode** — evita `any` a menos que sea inevitable.
- **Todos los handlers del broker devuelven JSON** con shape `{ ok: boolean, ... }` o un error con `{ ok: false, error: string }`.
- **Localhost only** — el broker SIEMPRE escucha en `127.0.0.1`, nunca en `0.0.0.0`. Esto no es configurable por diseño. Si haces un PR que expone el broker a la red, no lo mergeamos.
- **Errores descriptivos** — nunca hagas `catch { /* swallow */ }` sin un comentario explicando por qué. El ruido silencioso es el peor enemigo del debugging.
- **ESM imports únicamente** — nada de `require`.
- **Console output** del MCP server va a `stderr` (stdout está reservado para el protocolo MCP).

---

## Qué NO hacer

- **No subir binarios** o artefactos de build al repo (`dist/`, `node_modules/`, `*.db`).
- **No commitear claves o tokens**, obvio. El proyecto no usa ninguna, así que si ves una en un PR es señal de que algo salió mal.
- **No agregar dependencias pesadas** sin discutirlo. Queremos mantener la instalación ligera.
- **No romper la compatibilidad del API del broker** sin bumpear la versión y documentarlo.

---

## Preguntas

¿Dudas? Abre un issue con la etiqueta `question`, o escríbenos en [discussions](https://github.com/Zaipex-Labs/agent-control-center/discussions).

---

<details>
<summary>🇬🇧 English summary</summary>

Thanks for contributing! Zaipex ACC is open source by the **Zaipex Labs team**.

- **Code & identifiers**: English.
- **Docs, comments, UI strings, CLI output**: Spanish primary, English in collapsible sections.
- **PR flow**: fork → feature branch → tests → `npm run build && npm run dashboard:build && npm test && npx tsc --noEmit` → PR against `main` with a clear description.
- **Non-negotiable guidelines**: TypeScript strict, broker always on `127.0.0.1`, descriptive errors, ESM only, no silent catches.

Open an issue first for non-trivial changes so we can align on direction.

</details>
