// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [Q-1] Back-compat barrel. Pre-v0.2.5 this file was 1900 LOC of
// HTTP handlers; v0.2.5 split it into `src/broker/handlers/*.ts`
// (one file per concern: peers, shared, messages, threads, blobs,
// projects, plus _helpers). Every existing import path
// (`from '../broker/handlers.js'`) keeps working through this
// re-export.

export * from './handlers/index.js';
