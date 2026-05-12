// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// TypeScript 6 tightened resolution for side-effect imports. CSS
// files imported solely for their side effects (the bundler injects
// the styles into the page) now need an ambient declaration so the
// compiler doesn't error out. Vite handles the actual loading; this
// declaration just satisfies the type-checker.
declare module '*.css';
