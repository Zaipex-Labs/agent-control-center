// FASE E-2 / Q (v0.3.0): minimal eslint config — flat-config style
// (ESLint 9+). Scope is intentionally narrow: only the rules listed
// here, only the directories listed below. Adding more rules right
// now would require codebase-wide edits we haven't budgeted.
//
// Surface today:
//   - no-unused-vars (TS-aware)
//   - react-hooks/rules-of-hooks
//   - react-hooks/exhaustive-deps (warn, not error)
//
// Run with `npm run lint`. CI step is allow-fail initially so a
// fresh warning never blocks a deploy. Promote to required once the
// noise is cleaned up.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // What NOT to lint. We don't fight build artefacts, vendored output,
  // or the test fixture dirs.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'docs/**',
      'scripts/eval/scenarios/**',
      'scripts/eval/variants/**',
      '**/*.d.ts',
      'eslint.config.js',
      'vitest.config.ts',
    ],
  },

  // Base recommendations from eslint + typescript-eslint, but only
  // the no-unused-vars rule promoted to error. Everything else stays
  // warn or off (per the FASE E-2 spec: "solo reglas que no
  // requieren rewrites masivos").
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide overrides.
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        // Common runtime globals — node + browser. The rules below
        // are agnostic of where each file runs; eslint complains about
        // setTimeout / fetch / etc. otherwise.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        AbortController: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        FileList: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        // Browser-specific. Files that don't use them won't trip.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        Storage: 'readonly',
        WebSocket: 'readonly',
        Image: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        // Node test runtime.
        global: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      // The single load-bearing rule for now. Catches dead variables,
      // unused imports, and dropped function arguments. The
      // `argsIgnorePattern` lets us keep `_arg` placeholders for
      // signatures we don't use yet.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none',  // don't flag unused fn args — too many in
                          // signature-driven code (event handlers,
                          // tool callbacks). Only catch unused locals.
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Disable the JS version so we don't double-report.
      'no-unused-vars': 'off',

      // Allow `any` — too many call-sites, not worth this round.
      '@typescript-eslint/no-explicit-any': 'off',

      // Allow non-null assertions (test code uses `!` heavily). The
      // assertions are explicit at the type boundary and catching
      // them globally would mean ~50 edits for noise.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Allow `require()` style imports in tests / scripts that need
      // dynamic imports. We're ESM everywhere; these are rare.
      '@typescript-eslint/no-require-imports': 'off',

      // Disabled: many handlers use `body as Foo` as the explicit
      // type cast. zod migration is a separate job (E-1 covers the
      // hot paths).
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // Empty catch blocks are intentional in many places (best-
      // effort writes, `try { ... } catch { /* ignore */ }`).
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Terminal.ts handles ANSI escape sequences via \x1b regexes
      // — that's the whole point. Control chars in regex literals
      // are intentional throughout xterm/PTY processing code.
      'no-control-regex': 'off',

      // Regex character classes use `\-` defensively (no-op but safe)
      // — banning them would force edits with no behaviour change.
      'no-useless-escape': 'off',

      // Useless eslint-disable directives are downgraded to warnings —
      // some are kept around as forward-compat stubs.
      'no-unused-private-class-members': 'off',
    },
  },

  // React hook rules — only on dashboard files.
  {
    files: ['src/dashboard/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',  // warn, not error —
                                                // many existing hooks
                                                // would need cleanup
                                                // for full compliance
    },
  },

  // Tests can be a bit looser. We don't want unused imports or vars,
  // but other rules can stay relaxed.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Eval scripts use process.argv parsing + node:* APIs heavily.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    rules: {
      // Vanilla JS files don't run through TypeScript inference, so
      // some TS rules don't apply cleanly.
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
];
