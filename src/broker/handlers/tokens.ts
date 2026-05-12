// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A v0.3.3 — Aggregate query over `token_usage` rows.
// GET /api/projects/<id>/tokens?period=today|week|month
//
// Returns enough shape for the ProjectPage panel:
//   - by_agent: per-role totals (4 categories + sum + turn count)
//   - total: project-wide rollup
//   - by_hour: 24-hour histogram bucketed UTC for client to chart
//   - top_turns: 5 most-expensive turns for the modal drill-down
//
// Aggregation is JS-side because SQLite's date functions don't play
// well with ISO-8601 strings and the row count is bounded by `period`
// (worst case: hundreds of turns/day × N agents × 30 days ≈ tens of
// thousands of rows — still trivial in memory).

import type { ServerResponse } from 'node:http';
import {
  selectTokenUsageSince,
  countCoordEventsSince,
  selectCoordEventsByPair,
  countTokenTurnsSince,
  type TokenUsageRow,
} from '../database.js';
import { json, error } from './_helpers.js';
import { estimateCost } from '../cost-estimator.js';

export type TokenPeriod = 'today' | 'week' | 'month';

function periodSince(period: TokenPeriod): string {
  const now = new Date();
  switch (period) {
    case 'today': {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case 'week': {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d.toISOString();
    }
    case 'month': {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return d.toISOString();
    }
  }
}

interface AgentBucket {
  role: string;
  peer_id: string | null;
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
  turns: number;
}

interface HourBucket {
  hour: string;
  total: number;
}

interface TopTurn {
  turn_uuid: string | null;
  peer_id: string | null;
  role: string;
  model: string;
  total: number;
  created_at: string;
}

function rowTotal(r: TokenUsageRow): number {
  return r.input_tokens + r.output_tokens + r.cache_creation_tokens + r.cache_read_tokens;
}

function aggregate(rows: TokenUsageRow[]) {
  const byAgent = new Map<string, AgentBucket>();
  const byHour = new Map<string, number>();
  const totals = { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0, turns: 0 };

  for (const r of rows) {
    const t = rowTotal(r);
    totals.input += r.input_tokens;
    totals.output += r.output_tokens;
    totals.cache_creation += r.cache_creation_tokens;
    totals.cache_read += r.cache_read_tokens;
    totals.total += t;
    totals.turns++;

    // by_agent — keyed by role; peer_id captured from the most recent row.
    let agent = byAgent.get(r.role);
    if (!agent) {
      agent = {
        role: r.role,
        peer_id: r.peer_id,
        input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0, turns: 0,
      };
      byAgent.set(r.role, agent);
    }
    agent.input += r.input_tokens;
    agent.output += r.output_tokens;
    agent.cache_creation += r.cache_creation_tokens;
    agent.cache_read += r.cache_read_tokens;
    agent.total += t;
    agent.turns++;
    if (r.peer_id) agent.peer_id = r.peer_id;

    // by_hour — UTC-bucketed ISO key for the histogram.
    const hour = new Date(r.created_at);
    hour.setUTCMinutes(0, 0, 0);
    const hourKey = hour.toISOString();
    byHour.set(hourKey, (byHour.get(hourKey) ?? 0) + t);
  }

  const top_turns: TopTurn[] = rows
    .map(r => ({
      turn_uuid: r.turn_uuid,
      peer_id: r.peer_id,
      role: r.role,
      model: r.model,
      total: rowTotal(r),
      created_at: r.created_at,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const by_hour: HourBucket[] = Array.from(byHour.entries())
    .map(([hour, total]) => ({ hour, total }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  return {
    by_agent: Array.from(byAgent.values()).sort((a, b) => b.total - a.total),
    total: totals,
    by_hour,
    top_turns,
  };
}

export function handleProjectTokens(projectId: string, period: string | null, res: ServerResponse): void {
  if (!projectId) return error(res, 'Missing project_id');
  const p: TokenPeriod = period === 'week' || period === 'month' ? period : 'today';
  const since = periodSince(p);
  const rows = selectTokenUsageSince(projectId, since);
  const agg = aggregate(rows);
  json(res, {
    period: p,
    since,
    ...agg,
  });
}

// FU-AH v0.3.4 — coord overhead audit endpoint. Returns enough shape
// for a small dashboard panel: total inter-agent coord events, total
// assistant turns, ratio, and a (from_role → to_role) breakdown so
// the user can see whether one specialist is chattier than others.
// Analysis + prompt tuning lives in v0.3.5 once there's a week+ of
// real data; v0.3.4 ships just the read surface.
export function handleProjectCoordOverhead(
  projectId: string,
  period: string | null,
  res: ServerResponse,
): void {
  if (!projectId) return error(res, 'Missing project_id');
  const p: TokenPeriod = period === 'week' || period === 'month' ? period : 'today';
  const since = periodSince(p);
  const coord = countCoordEventsSince(projectId, since);
  const turns = countTokenTurnsSince(projectId, since);
  const ratio = turns > 0 ? coord / turns : 0;
  const by_pair = selectCoordEventsByPair(projectId, since);
  json(res, {
    period: p,
    since,
    coord_events: coord,
    total_turns: turns,
    coord_ratio: ratio,
    by_pair,
  });
}

// FU-AE v0.4.0 — Pre-send cost estimation. Reads URL search param
// `message` (the draft text) and returns a synthetic-baseline-backed
// estimate that becomes increasingly real-data-driven as the
// project's `token_usage` table accumulates rows. See
// src/broker/cost-estimator.ts for the model + thresholds.
export function handleProjectEstimateCost(
  projectId: string,
  message: string | null,
  res: ServerResponse,
): void {
  if (!projectId) return error(res, 'Missing project_id');
  // Empty message yields a zero-turn estimate — the dashboard hides
  // the preview entirely when the textarea is empty, but the broker
  // tolerates the call so the client doesn't have to short-circuit.
  const estimate = estimateCost(projectId, message ?? '');
  json(res, estimate);
}
