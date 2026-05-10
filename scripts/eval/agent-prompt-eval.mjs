#!/usr/bin/env node
// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.
//
// FASE C-1 (v0.3.0): system-prompt eval harness.
//
// Purpose: gate any aggressive change to buildInstructions(...) (M-1
// in audit §7-bis) behind reproducible behavior tests. Pre-v0.3.0 the
// only signal was "ship it and watch what happens in production".
//
// Mechanism:
//   1. For each variant (baseline / aggressive / experimental),
//      generate the system prompt via buildInstructions and write it
//      to a temp file.
//   2. For each scenario in scripts/eval/scenarios/*.md, spawn
//        claude --bare --print
//               --append-system-prompt "<variant>"
//               --allow-dangerously-skip-permissions
//               "<trigger prompt>"
//      `--bare` strips hooks / auto-memory / plugins so the variant is
//      the only context.
//   3. Capture stdout and run regex checks (must_not_match,
//      must_match) against it.
//   4. Repeat per scenario for `runs` iterations (default 3) to
//      reduce variance.
//   5. Write a JSON report to docs/audits/v0.3.0-team-memory/eval/
//      run-<timestamp>.json (gitignored — audit deliverable).
//
// CI safety:
//   - If the `claude` CLI isn't installed (ENOENT) or non-zero on
//     `--version`, the harness logs a warning and exits 0. This file
//     is not part of `npm test` and is opt-in by humans / scheduled
//     jobs. Failing CI on a missing binary would be a foot-gun.
//
// Cost:
//   - 3 runs × 5 scenarios × 1 variant ≈ 15 calls.
//   - Comparing two variants: 30 calls.
//   - At Sonnet pricing ≈ $0.50–2 per full eval. Don't run on every
//     commit; run on prompt changes and document the result.
//
// Usage:
//   npx tsx scripts/eval/agent-prompt-eval.mjs           # baseline only
//   npx tsx scripts/eval/agent-prompt-eval.mjs --runs 3
//   npx tsx scripts/eval/agent-prompt-eval.mjs \
//       --variant baseline:default \
//       --variant aggressive:scripts/eval/variants/aggressive.txt \
//       --runs 3
//   npx tsx scripts/eval/agent-prompt-eval.mjs --dry-run   # parse + report only

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCENARIO_DIR = join(__dirname, 'scenarios');
const REPORTS_DIR = join(REPO_ROOT, 'docs', 'audits', 'v0.3.0-team-memory', 'eval');

// ── arg parsing ────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { runs: 3, variants: [], dryRun: false, scenario: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = parseInt(argv[++i], 10) || 3;
    else if (a === '--variant') args.variants.push(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: agent-prompt-eval.mjs [--runs N] [--variant name:path] [--scenario name] [--dry-run]');
      process.exit(0);
    }
  }
  if (args.variants.length === 0) args.variants.push('baseline:default');
  return args;
}

// ── claude availability probe ──────────────────────────────────

function probeClaude() {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) {
      return { ok: false, reason: `claude --version exited ${r.status}` };
    }
    return { ok: true, version: r.stdout.trim() };
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? 'claude CLI not found in PATH' : String(e) };
  }
}

// ── scenario loader ────────────────────────────────────────────

// Frontmatter is JSON between --- markers. The body below is freeform
// description for humans; the harness ignores it.
function parseScenario(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`No JSON frontmatter in ${filePath}`);
  let json;
  try {
    json = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`Invalid JSON frontmatter in ${filePath}: ${e.message}`);
  }
  if (!json.name || !json.trigger || !json.expect) {
    throw new Error(`Missing name/trigger/expect in ${filePath}`);
  }
  return json;
}

function loadScenarios(filter) {
  const entries = readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.md')).sort();
  const all = entries.map(name => parseScenario(join(SCENARIO_DIR, name)));
  return filter ? all.filter(s => s.name === filter) : all;
}

// ── prompt builders ────────────────────────────────────────────

// Build the fake conversation context the agent sees. setup messages
// are formatted as a transcript so the agent sees prior context, then
// the trigger is the current incoming message.
function buildTriggerPrompt(scenario) {
  const lines = [];
  if (scenario.setup && scenario.setup.length > 0) {
    lines.push('# Recent context');
    for (const s of scenario.setup) {
      lines.push(`[from ${s.role}]: ${s.message}`);
    }
    lines.push('');
  }
  lines.push('# New message');
  lines.push(`[from ${scenario.trigger.from}]: ${scenario.trigger.message}`);
  lines.push('');
  lines.push('Reply now.');
  return lines.join('\n');
}

// ── variant resolver ───────────────────────────────────────────

async function resolveVariantPrompt(spec) {
  // spec is "name:source" where source is either "default" (use
  // current buildInstructions) or a file path.
  const [name, ...rest] = spec.split(':');
  const source = rest.join(':');
  if (source === 'default' || source === '') {
    const mod = await import(join(REPO_ROOT, 'src', 'server', 'index.ts'));
    return { name, prompt: mod.buildInstructions('Eval', 'backend') };
  }
  const filePath = resolve(REPO_ROOT, source);
  if (!existsSync(filePath)) {
    throw new Error(`Variant source not found: ${filePath}`);
  }
  return { name, prompt: readFileSync(filePath, 'utf8') };
}

// ── runner ─────────────────────────────────────────────────────

function runOnce(variantPrompt, triggerPrompt, timeoutMs = 90_000) {
  // Two trade-offs to be aware of:
  //   1. We do NOT pass --bare. --bare requires ANTHROPIC_API_KEY (OAuth
  //      is ignored), and the typical user runs the harness with their
  //      normal Claude auth. The cost is that local hooks / plugins /
  //      auto-memory CAN influence the run — runs across machines may
  //      diverge. For aggressive-prompt regression decisions we care
  //      about WITHIN-machine variance (baseline vs variant on the same
  //      laptop), which is unaffected.
  //   2. --disallowedTools "*" forbids tool calls. The eval probes what
  //      the agent SAYS in its first response, not what it does. Without
  //      this the agent might burn time on Bash/Read/Edit and the
  //      regex check would have to wade through tool-call boilerplate.
  return new Promise((resolveCall) => {
    const args = [
      '--print',
      '--append-system-prompt', variantPrompt,
      '--disallowedTools', '*',
      '--disable-slash-commands',
      triggerPrompt,
    ];
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const t = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      clearTimeout(t);
      resolveCall({ stdout, stderr, code, killed });
    });
    child.on('error', err => {
      clearTimeout(t);
      resolveCall({ stdout, stderr, code: -1, killed: false, error: String(err) });
    });
  });
}

// Patterns that mean the call never reached the model. These poison
// the regex check (the error is short and benign-looking) so we treat
// them as test ERRORS, not test passes / fails.
const AUTH_ERROR_PATTERNS = [
  /not logged in/i,
  /please run \/login/i,
  /(invalid|expired) (api key|token)/i,
  /unauthorized/i,
];

function isAuthError(stdout, stderr, exitCode) {
  if (exitCode === 0) return false;
  const text = `${stdout}\n${stderr}`;
  return AUTH_ERROR_PATTERNS.some(re => re.test(text));
}

function checkExpect(response, expect) {
  const failures = [];
  for (const pat of expect.must_not_match || []) {
    const re = new RegExp(pat, 'i');
    if (re.test(response)) failures.push({ kind: 'must_not_match', pattern: pat });
  }
  for (const pat of expect.must_match || []) {
    const re = new RegExp(pat, 'i');
    if (!re.test(response)) failures.push({ kind: 'must_match_missing', pattern: pat });
  }
  return { passed: failures.length === 0, failures };
}

// ── main ───────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const probe = args.dryRun ? { ok: true, version: 'dry-run' } : probeClaude();
  if (!probe.ok) {
    console.warn(`[eval] skip: ${probe.reason}`);
    process.exit(0);
  }

  const scenarios = loadScenarios(args.scenario);
  if (scenarios.length === 0) {
    console.error('[eval] no scenarios matched');
    process.exit(1);
  }

  const variants = [];
  for (const spec of args.variants) {
    variants.push(await resolveVariantPrompt(spec));
  }

  console.log(`[eval] claude: ${probe.version}`);
  console.log(`[eval] scenarios: ${scenarios.length} · variants: ${variants.length} · runs: ${args.runs}`);
  if (args.dryRun) {
    for (const s of scenarios) {
      console.log(`  - ${s.name}: ${(s.expect.must_not_match || []).length} must-not / ${(s.expect.must_match || []).length} must-match`);
    }
    return;
  }

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const results = [];

  for (const variant of variants) {
    console.log(`\n[eval] variant=${variant.name} (${Math.ceil(variant.prompt.length / 4)} tok)`);
    for (const scenario of scenarios) {
      const trigger = buildTriggerPrompt(scenario);
      const runs = [];
      let authErrorSeen = false;
      for (let i = 0; i < args.runs; i++) {
        const callStart = performance.now();
        const r = await runOnce(variant.prompt, trigger);
        const elapsedMs = Math.round(performance.now() - callStart);
        const resp = r.stdout.trim();

        // Auth errors poison every subsequent run — bail out of this
        // variant/scenario loop and surface the issue clearly.
        if (isAuthError(r.stdout, r.stderr, r.code)) {
          authErrorSeen = true;
          runs.push({
            run: i + 1, passed: false, errored: true,
            errorReason: 'auth (claude not logged in / invalid key)',
            elapsedMs, exitCode: r.code, killed: r.killed,
            stderrSnippet: r.stderr.slice(-400),
            response: resp,
            failures: [],
          });
          console.log(`  ERROR ${scenario.name} run=${i + 1}/${args.runs} — auth (run \`claude /login\` and retry)`);
          break;
        }

        // Unexpected non-zero exit (timeouts, OOM) is also an error,
        // distinct from a legitimate test failure.
        if (r.code !== 0 || r.killed) {
          runs.push({
            run: i + 1, passed: false, errored: true,
            errorReason: r.killed ? 'timeout' : `exit ${r.code}`,
            elapsedMs, exitCode: r.code, killed: r.killed,
            stderrSnippet: r.stderr.slice(-400),
            response: resp,
            failures: [],
          });
          console.log(`  ERROR ${scenario.name} run=${i + 1}/${args.runs} — ${r.killed ? 'timeout' : `claude exit ${r.code}`}`);
          continue;
        }

        const check = checkExpect(resp, scenario.expect);
        runs.push({
          run: i + 1,
          passed: check.passed,
          failures: check.failures,
          elapsedMs,
          exitCode: r.code,
          killed: r.killed,
          stderrSnippet: r.stderr.slice(-400),
          response: resp,
        });
        const tag = check.passed ? 'PASS' : 'FAIL';
        console.log(`  ${tag} ${scenario.name} run=${i + 1}/${args.runs} (${elapsedMs}ms)`);
        if (!check.passed) {
          for (const f of check.failures) {
            console.log(`        ↳ ${f.kind}: /${f.pattern}/i`);
          }
        }
      }
      // If auth errors hit, stop the whole run — every following call
      // would error the same way and burn time.
      if (authErrorSeen) {
        console.error('\n[eval] aborting: claude is not logged in. Run `claude /login` and retry.');
        process.exit(2);
      }
      const passCount = runs.filter(r => r.passed).length;
      const errorCount = runs.filter(r => r.errored).length;
      results.push({
        variant: variant.name,
        scenario: scenario.name,
        passCount,
        errorCount,
        totalRuns: runs.length,
        runs,
      });
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  const summary = summarize(results, variants);

  // Persist report.
  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const reportPath = join(REPORTS_DIR, `run-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({
    started_at: startedAt,
    total_ms: totalMs,
    runs_per_scenario: args.runs,
    variants: variants.map(v => ({ name: v.name, prompt_length: v.prompt.length, prompt_tokens_est: Math.ceil(v.prompt.length / 4) })),
    scenarios: scenarios.map(s => s.name),
    results,
    summary,
  }, null, 2));

  console.log('\n[eval] summary');
  for (const row of summary.rows) {
    const errTag = row.errorCount > 0 ? ` (${row.errorCount} ERR)` : '';
    console.log(`  ${row.variant.padEnd(14)} ${row.scenario.padEnd(36)} ${row.passCount}/${row.totalRuns}${errTag}`);
  }
  console.log(`\n[eval] total ${totalMs}ms · report: ${reportPath}`);

  // Exit non-zero if any scenario didn't pass 3/3 across the variants
  // tested. Useful when the harness is wired into a manual gate.
  process.exit(summary.allPerfect ? 0 : 1);
}

function summarize(results, variants) {
  const rows = results.map(r => ({
    variant: r.variant,
    scenario: r.scenario,
    passCount: r.passCount,
    errorCount: r.errorCount ?? 0,
    totalRuns: r.totalRuns,
  }));
  const allPerfect = results.every(r => r.passCount === r.totalRuns && (r.errorCount ?? 0) === 0);
  const perVariant = {};
  for (const v of variants) {
    const vRows = results.filter(r => r.variant === v.name);
    const passed = vRows.filter(r => r.passCount === r.totalRuns && (r.errorCount ?? 0) === 0).length;
    perVariant[v.name] = { perfectScenarios: passed, totalScenarios: vRows.length };
  }
  return { rows, allPerfect, perVariant };
}

main().catch(err => {
  console.error('[eval] fatal:', err);
  process.exit(2);
});
