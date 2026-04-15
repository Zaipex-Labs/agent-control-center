# Changelog

All notable changes to **zaipex-acc** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04

### Added
- **Web dashboard** in real time (3-column workspace view, live coordination, chat threads).
- **Permanent tech lead role** with dedicated coordination rules.
- **Generative avatars** for agents and threads (DiceBear).
- **Live agent status line** and auto-reconnect popup on reload.
- **Team management** from the dashboard: create, edit, search, sort, shutdown, single-active guardrail.
- **Localization (i18n)** for CLI and dashboard, with auto-detection and sync via `/api/lang`.
- **Thread inheritance**: agent replies automatically land in the right thread.

### Changed
- Restructured the agent system prompt into A/U/G rule groups (agent / user / general).
- Stricter agent-to-agent rules, while keeping user-facing responses friendly and complete.

### Fixed
- Multiple reliability fixes around peer lifecycle, message delivery, and dashboard reconnection.

## [0.1.0] — 2026-03

### Added
- Initial public release of **Agents Command Center**.
- **Broker daemon** on `127.0.0.1:7899` with SQLite persistence (`~/.zaipex-acc/acc.db`).
- **MCP server** per agent: `list_peers`, `whoami`, `send_message`, `send_to_role`, `check_messages`, `get_history`, `set_shared`, `get_shared`, `list_shared`, `set_summary`, `set_role`.
- **`acc` CLI** for project management, agent spawning (tmux / windows-terminal / fallback), status, history, shared state, and broker control.
- Cross-agent messaging, shared key-value state, and persistent message log isolated per project.

[0.2.0]: https://github.com/Zaipex-Labs/agent-control-center/releases/tag/v0.2.0
[0.1.0]: https://github.com/Zaipex-Labs/agent-control-center/releases/tag/v0.1.0
