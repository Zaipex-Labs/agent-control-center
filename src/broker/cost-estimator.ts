// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FU-AE v0.4.0 — cost preview before sending a message.
//
// HONESTY DISCLAIMER (mirrored in the UI): the synthetic baseline
// below was calibrated from a SINGLE measured EQUIPO-5 cycle in
// v0.3.3 + extrapolation. With <20 historical rows for a project,
// the estimator returns those synthetic numbers labelled
// confidence='low'. As real `token_usage` rows accumulate the
// estimator switches to per-project averages. The UI must surface
// the confidence level visibly — never hide it behind a hover or
// tooltip.
//
// Why now and not after we have data: shipping a working "X-XX
// turnos, ~$X-XX" inline next to the Send button is significantly
// more useful than nothing, even at low confidence. Without it,
// users have no signal about cost at all until the v0.3.3 audit
// telephone-pole moment when the bill arrives. The disclaimer
// protects the user from over-trusting the number; the number
// itself protects them from going in blind.

import { selectTokenUsageSince } from './database.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from '../shared/config.js';
import type { ProjectConfig } from '../shared/types.js';
import { ARCHITECT_ROLE } from '../shared/names.js';

// ── Tunable knobs ──────────────────────────────────────────────

// Confidence boundary — below this row count, the per-project
// average isn't reliable enough to override the synthetic baseline.
export const HIGH_CONFIDENCE_THRESHOLD = 100;
export const MEDIUM_CONFIDENCE_THRESHOLD = 20;

// How far back to look for the per-project average. 30 days is wide
// enough to capture cycle variation without dragging in stale data
// from a different team shape.
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

// Anthropic Sonnet 4.x pricing (USD per million tokens). v0.4.0
// assumes Sonnet since that's the default model; refine to
// per-model lookup once we see meaningful Opus usage in production.
// Source: https://www.anthropic.com/pricing (Sonnet 4.x, 2026).
const PRICE_PER_MTOK = {
  input: 3,
  output: 15,
  cache_write: 3.75,
  cache_read: 0.30,
};

// ── Synthetic baseline (v0.3.3 calibration) ────────────────────

// Per the v0.3.3 followups + post-pr-audit: EQUIPO-5 produced 10.5M
// tokens / ~$30 in cache-warm mode. Extrapolated to other team
// sizes assuming roughly linear scaling per active specialist.
// These numbers are intentionally wide ranges — they're a "you're
// in this neighbourhood" signal, not a quote.
interface BaselineBand {
  turnsMin: number;
  turnsMax: number;
  usdMin: number;
  usdMax: number;
}

function syntheticBaseline(agentCount: number): BaselineBand {
  // Interpolate piecewise from the four anchors (SOLO / DUO / TRIO
  // / EQUIPO). Clamp ≥1 and ≥5+ to the endpoint bands.
  const n = Math.max(1, agentCount);
  if (n <= 1) return { turnsMin: 30,  turnsMax: 50,  usdMin: 1,   usdMax: 3 };
  if (n === 2) return { turnsMin: 50,  turnsMax: 90,  usdMin: 5,   usdMax: 10 };
  if (n === 3) return { turnsMin: 80,  turnsMax: 120, usdMin: 8,   usdMax: 15 };
  if (n === 4) return { turnsMin: 110, turnsMax: 180, usdMin: 14,  usdMax: 25 };
  return         { turnsMin: 150, turnsMax: 250, usdMin: 20,  usdMax: 35 };
}

// ── Complexity classifier (keyword heuristic) ──────────────────

// The message text influences turn count: "complete the whole
// feature end-to-end" runs longer than "fix typo in line 42".
// Keyword-based, deliberately simple. No LLM call.
function classifyComplexity(message: string): number {
  const m = message.toLowerCase();
  // Heavyweight markers → multiply 1.3× (top of the band)
  const heavy = [
    'completo', 'completa', 'completas',
    'end-to-end', 'end to end',
    'todo el', 'toda la', 'todos los', 'todas las',
    'full feature', 'feature completa',
    'implementa todo', 'build everything', 'everything',
    'arquitectura completa', 'whole stack',
  ];
  // Lightweight markers → multiply 0.7× (bottom of the band)
  const light = [
    'rápido', 'pequeño', 'pequeña', 'simple', 'small change',
    'minor', 'tweak', 'typo', 'rename', 'one line',
    'una línea', 'cambio pequeño', 'fix simple',
  ];
  if (heavy.some(k => m.includes(k))) return 1.3;
  if (light.some(k => m.includes(k))) return 0.7;
  return 1.0;
}

// ── Project agent count ────────────────────────────────────────

// Count specialist agents (excludes the architect / coordinator,
// since the synthetic baseline already accounts for it as part of
// every cycle). Returns 0 if the project config can't be read.
function countSpecialists(projectId: string): number {
  const path = join(PROJECTS_DIR, `${projectId}.json`);
  if (!existsSync(path)) return 0;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as ProjectConfig;
    return config.agents.filter(a => a.role !== ARCHITECT_ROLE).length;
  } catch {
    return 0;
  }
}

// ── Per-turn cost from real data ───────────────────────────────

function costOfRow(input: number, output: number, cacheWrite: number, cacheRead: number): number {
  return (
    (input * PRICE_PER_MTOK.input)
    + (output * PRICE_PER_MTOK.output)
    + (cacheWrite * PRICE_PER_MTOK.cache_write)
    + (cacheRead * PRICE_PER_MTOK.cache_read)
  ) / 1_000_000;
}

function avgCostPerTurnSince(projectId: string, sinceIso: string): { avg: number; sampleSize: number } {
  const rows = selectTokenUsageSince(projectId, sinceIso);
  if (rows.length === 0) return { avg: 0, sampleSize: 0 };
  const totalUsd = rows.reduce(
    (sum, r) => sum + costOfRow(r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens),
    0,
  );
  return { avg: totalUsd / rows.length, sampleSize: rows.length };
}

// ── Public API ─────────────────────────────────────────────────

export type Confidence = 'low' | 'medium' | 'high';

export interface CostEstimate {
  estimatedTurns: [number, number];
  estimatedCostUSD: [number, number];
  confidence: Confidence;
  sampleSize: number;
  // Description of what fed the estimate, for the "¿cómo se calcula?"
  // disclosure modal in the UI.
  basis: {
    agents: number;
    complexity: 'light' | 'normal' | 'heavy';
    source: 'synthetic-v0.3.3' | 'project-avg';
    avgUsdPerTurn?: number;
  };
}

export function estimateCost(projectId: string, message: string): CostEstimate {
  const agents = countSpecialists(projectId);
  const multiplier = classifyComplexity(message);
  const complexity: 'light' | 'normal' | 'heavy' =
    multiplier > 1.2 ? 'heavy' : multiplier < 0.8 ? 'light' : 'normal';

  const baseline = syntheticBaseline(agents);
  const turnsMin = Math.round(baseline.turnsMin * multiplier);
  const turnsMax = Math.round(baseline.turnsMax * multiplier);

  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { avg, sampleSize } = avgCostPerTurnSince(projectId, sinceIso);

  let usdMin: number;
  let usdMax: number;
  let confidence: Confidence;
  let source: 'synthetic-v0.3.3' | 'project-avg';
  let avgUsdPerTurn: number | undefined;

  if (sampleSize >= HIGH_CONFIDENCE_THRESHOLD && avg > 0) {
    // High-confidence path — use real per-turn cost from this
    // project's history. Apply ±25% band on either side of the
    // point estimate to capture cycle variance.
    confidence = 'high';
    source = 'project-avg';
    avgUsdPerTurn = avg;
    const center = avg * ((turnsMin + turnsMax) / 2);
    usdMin = round2(center * 0.75);
    usdMax = round2(center * 1.25);
  } else if (sampleSize >= MEDIUM_CONFIDENCE_THRESHOLD && avg > 0) {
    // Medium — same per-turn cost but wider band (±50%) because
    // 20-99 rows is enough to bias correctly but not enough to
    // narrow the range.
    confidence = 'medium';
    source = 'project-avg';
    avgUsdPerTurn = avg;
    const center = avg * ((turnsMin + turnsMax) / 2);
    usdMin = round2(center * 0.5);
    usdMax = round2(center * 1.5);
  } else {
    // Low — synthetic baseline. The UI must label this prominently
    // so the user doesn't over-trust the number.
    confidence = 'low';
    source = 'synthetic-v0.3.3';
    usdMin = round2(baseline.usdMin * multiplier);
    usdMax = round2(baseline.usdMax * multiplier);
  }

  return {
    estimatedTurns: [turnsMin, turnsMax],
    estimatedCostUSD: [usdMin, usdMax],
    confidence,
    sampleSize,
    basis: {
      agents,
      complexity,
      source,
      ...(avgUsdPerTurn !== undefined ? { avgUsdPerTurn: round4(avgUsdPerTurn) } : {}),
    },
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
