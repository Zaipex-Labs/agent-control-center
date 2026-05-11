// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A-3 (v0.3.2) — GET /api/powers.
//
// Returns the public projection of the powers registry so the
// dashboard can render the multi-check selector inside the agent
// editor. The endpoint is read-only and stateless — the registry
// lives in code (src/shared/powers.ts), not on disk or in the DB.
// listPublicPowers() strips server-only command/args fields before
// they cross the wire.

import type { ServerResponse } from 'node:http';
import { listPublicPowers } from '../../shared/powers.js';
import { json } from './_helpers.js';

export function handleListPowers(res: ServerResponse): void {
  json(res, { powers: listPublicPowers() });
}
