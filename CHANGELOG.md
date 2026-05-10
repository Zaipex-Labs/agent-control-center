# Changelog

All notable changes to **zaipex-acc** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] — 2026-04

Security patch release. Four findings from the v0.2.1 audit
(`docs/audits/v0.2.1-audit.md`), three of them listed as vulnerabilities
in `SECURITY.md`.

### Security
- **[C-1]** `handleCreateProject` now validates the project name against
  path traversal, null bytes, shell metacharacters and length overflow.
  Previously `name: "../../../tmp/pwned"` wrote a config file outside
  `PROJECTS_DIR`.
- **[H-1]** `send_message` and `send_to_role` now enforce project
  isolation: `fromPeer.project_id`, `toPeer.project_id` and the body
  `project_id` must match (403 `PROJECT_MISMATCH` otherwise). Previously
  a peer in project A could target peers in project B by knowing the
  target peer_id.
- **[H-2]** `GET /api/blobs/:hash` now requires an `X-Peer-Id` header
  and validates that the blob belongs to the peer's project via
  `blob_refs`. Dashboard components fetch blobs as authenticated
  responses and render them through `URL.createObjectURL`. Unknown
  hashes return 403 (not 404) to prevent enumeration.
  `Cache-Control` downgraded from `public` to `private`.
- **[H-3]** Shell-injection surface in `role`/`name` removed.
  `handleAddAgent` and `handleUpdateProject` now call
  `assertSafeIdentifier`. `spawnWithTmux` and `tmuxInjectWithContext`
  use `execFileSync` (no shell) and split every tmux invocation into
  argv. The `sh -c "sleep 2 && …"` pattern is now a Node `setTimeout`.
  Defense in depth: `assertSafeIdentifier` is called again at the
  spawn boundary.

### Changed
- `attachmentUrl(hash)` helper removed from the dashboard public API.
  Replaced by `useBlobUrl(hash)` hook with automatic object-URL
  lifecycle management and a `DashboardPeerContext` provider.
- Blob `Cache-Control: public, max-age=31536000, immutable` →
  `private, max-age=31536000, immutable`.
- `validateIdentifiers` extracted to `src/shared/validate.ts`. Hardened
  to reject `..`, path separators, shell metacharacters, null bytes,
  and identifiers longer than 64 chars. Character class unchanged at
  `[a-zA-Z0-9_.-]` (dotted names like `my.proj` still work).

### Fixed
- `tests/cli/spawn.test.ts isMcpServerRegistered` no longer depends on
  `claude` being in `PATH` (mocks `node:child_process`). The test was
  timing out in environments without Claude Code installed; now runs
  in ~17ms.

### Technical
- New `blobBelongsToProject(hash, projectId)` helper in
  `src/broker/blob-refs.ts`.
- No new runtime dependencies.
- `npm audit fix` applied: `hono` 4.12.10→4.12.14 and
  `@hono/node-server` 1.19.12→1.19.14 (transitives of
  `@modelcontextprotocol/sdk`). `npm audit --omit=dev` now reports 0
  vulnerabilities.

## [0.2.1] — 2026-04

### Added
- Multimodal messages: agents and users can attach images (PNG/JPEG/WebP/GIF) and generic files up to 100 MB (configurable via `ACC_MAX_BLOB_SIZE`).
- `POST /api/blobs/upload` + `GET /api/blobs/:hash` endpoints with SHA256 content-addressed dedup.
- Reference counting (`blob_refs` table) and startup GC for orphan blobs (with 1h grace period to protect fresh uploads).
- Dashboard: inline image rendering with branded lightbox (navy overlay, JetBrains Mono close hint, filename strip with download); download chips for non-image files; attach button and drag-and-drop on composer; `PendingAttachmentStrip` with upload progress/error states.
- MCP `send_message` / `send_to_role` accept an `attachments: [{hash, mime, name, size}]` array.
- Runtime fallback: non-multimodal agents receive a `[image: ~/.zaipex-acc/blobs/<hash>.png · image/png · 4.0 KB]` footer so they can open the file with their Read tool.
- Dev-only `GET /api/blobs/_stats` endpoint for observability (total blobs, total bytes, orphan count).

### Changed
- `ensureDirectories()` now creates `~/.zaipex-acc/blobs/`.
- `handleSendMessage` / `handleSendToRole` are now async (import blobs/refs at the top of the module).

### Technical
- No new runtime dependencies (uses Node-native `crypto.createHash('sha256')`).
- No schema migration on `messages` / `message_log` — attachments are encoded in the existing `metadata` JSON column alongside any existing `topic` field.
- Upload filenames are `encodeURIComponent`-wrapped on the client and `decodeURIComponent`-unwrapped on the server to support UTF-8 (e.g. `diagrama arquitectura v2.pdf`).
- Structured `{ code: 'BLOB_NOT_FOUND' | 'BLOB_TOO_LARGE' }` error responses so clients can react (re-upload, surface quota).
- ~700 additional tests across storage, refs, HTTP endpoints, messaging, channel fallback, cleanup, and GC.

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

[0.2.1]: https://github.com/Zaipex-Labs/agent-control-center/releases/tag/v0.2.1
[0.2.0]: https://github.com/Zaipex-Labs/agent-control-center/releases/tag/v0.2.0
[0.1.0]: https://github.com/Zaipex-Labs/agent-control-center/releases/tag/v0.1.0
