# Screenshots

Este directorio contiene las capturas y GIFs del dashboard que se enlazan desde el README principal.

## Cómo generar/actualizar

1. Arranca el broker y crea un proyecto con al menos 3 agentes (backend, frontend, arquitectura).
2. Levanta el equipo y manda un par de mensajes para que el chat tenga contenido real.
3. Usa Kap (macOS) o Peek (Linux) para capturar:
   - `dashboard-home.png` — página de equipos con las tarjetas horizontales
   - `dashboard-chat.png` — vista de conversación con juntas colapsadas + status line en vivo
   - `dashboard-agent-editor.png` — modal de edición de agente con el Tech Lead bloqueado
   - `dashboard-reconnect.gif` — popup de reconexión después de un F5

Cada archivo debería caber en `800×600` como máximo para que el README cargue rápido en GitHub.

## Enlazado en el README

```markdown
![Dashboard home](docs/screenshots/dashboard-home.png)
```
