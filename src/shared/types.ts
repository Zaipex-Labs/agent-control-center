// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [Q-4] All wire types now live in `./wire.ts` so the dashboard bundle
// can import them without dragging in node-only modules. This shim
// stays here for the historical import path used across the broker,
// MCP server, CLI, and tests. Add new shapes to `./wire.ts`, not here.

export * from './wire.js';
