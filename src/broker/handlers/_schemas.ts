// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE E-1 / Q-5 (v0.3.0): zod input schemas for the hot HTTP
// handlers (messages / shared / threads). Pre-E-1 every handler
// did its own ad-hoc shape check via `body as Foo` + a few `if (!b.x)
// return error(...)` guards. The cost was inconsistent error
// messages, no protection against wrong-typed values (e.g.
// `limit: "20"`), and a 400 response shape that varied by callsite.
//
// This file is the single source of truth for what each endpoint
// accepts. parseBodyOrError() (in _helpers.ts) parses against one of
// these schemas and writes a structured 400
//   { ok: false, error, code: 'INVALID_BODY', issues: [...] }
// when validation fails. The `issues` array is zod's per-field
// detail, useful when the dashboard surfaces "filename is required"
// rather than just "invalid body".
//
// Coverage: the hottest handlers — every message send + history
// fetch + shared-state R/W + decisions/recall. Less hot endpoints
// (peers/*, threads/*, projects/*, blobs/*) keep `body as X` for
// now; they can migrate gradually as we touch them.

import { z } from 'zod';

// ── Reusable building blocks ──────────────────────────────────

// Mirrors the MCP-side attachmentSchema in src/server/tools.ts.
const attachmentSchema = z.object({
  hash: z.string(),
  mime: z.string(),
  name: z.string(),
  size: z.number(),
});

// Optional metadata. Broker accepts a JSON-encoded string (legacy)
// or an object (new shape). Handlers serialize to string before
// persisting.
const metadataField = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
]).optional();

// MessageType used to be a strict enum; FASE C-3 / M-11 widened it
// to any string at the MCP boundary. Keep parity here.
const messageTypeField = z.string().optional();

// ── Messages ──────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  project_id: z.string().min(1),
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  text: z.string(),
  type: messageTypeField,
  metadata: metadataField,
  thread_id: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  // session_id is added server-side from the broker's clock; tests
  // that pass it through use a fixed value, hence allow but don't
  // require.
  session_id: z.string().optional(),
});

export const sendToRoleSchema = z.object({
  project_id: z.string().min(1),
  from_id: z.string().min(1),
  role: z.string().min(1),
  text: z.string(),
  type: messageTypeField,
  metadata: metadataField,
  thread_id: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  session_id: z.string().optional(),
});

export const pollMessagesSchema = z.object({
  id: z.string().min(1),
});

export const getHistorySchema = z.object({
  project_id: z.string().min(1),
  peer_id: z.string().optional(),
  role: z.string().optional(),
  type: z.string().optional(),
  limit: z.number().int().min(1).max(1_000_000).optional(),
  session_id: z.string().optional(),
  thread_id: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
});

// ── Shared state ──────────────────────────────────────────────

export const sharedSetSchema = z.object({
  project_id: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  // Broker accepts string OR object — the MCP tool serializes objects
  // to JSON; the broker gets the resulting string. We accept either
  // here so a direct REST caller can use the same shape.
  value: z.union([z.string(), z.record(z.string(), z.unknown())]),
  peer_id: z.string().min(1),
});

export const sharedGetSchema = z.object({
  project_id: z.string().min(1),
  peer_id: z.string().optional(),
  namespace: z.string().min(1),
  key: z.string().min(1),
});

export const sharedListSchema = z.object({
  project_id: z.string().min(1),
  peer_id: z.string().optional(),
  namespace: z.string().min(1),
});

export const sharedDeleteSchema = z.object({
  project_id: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  peer_id: z.string().min(1),
});

export const decisionsRecallSchema = z.object({
  project_id: z.string().min(1),
  peer_id: z.string().min(1),
  query: z.string().min(1),
  // Loose ceiling — the handler clamps at RECALL_MAX_LIMIT (20). The
  // max here just stops obvious garbage (`limit: 1e9`) from reaching
  // sql; legitimate "clamp my over-budget limit" callers still go
  // through the handler's Math.min(...).
  limit: z.number().int().min(1).max(10_000).optional(),
});
