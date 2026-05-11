// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [Q-4] Dashboard types are now sourced from the shared wire module so
// broker and dashboard cannot drift. The wire module deliberately
// avoids node-only imports so this re-export stays browser-clean.
//
// Some components/tests import via the `../lib/types` path — keep this
// shim alive so that contract doesn't break.

export * from '../../shared/wire';
