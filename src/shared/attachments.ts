// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Multimodal attachments shared between broker, MCP server, and dashboard.
// The physical blobs live in ~/.zaipex-acc/blobs/<sha256>.<ext> (see
// src/broker/blobs.ts). Messages carry references to them via the
// `metadata` JSON column on `messages` / `message_log`:
//
//   { "attachments": [{ "hash": "...", "mime": "image/png",
//                       "name": "shot.png", "size": 4096 }] }
//
// Consumers that don't understand attachments simply ignore the key.

export interface Attachment {
  hash: string;
  mime: string;
  name: string;
  size: number;
}

export const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
};

export function extensionFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function serializeAttachments(
  atts: Attachment[],
  existing?: Record<string, unknown>,
): string {
  return JSON.stringify({ ...(existing ?? {}), attachments: atts });
}

function isAttachment(x: unknown): x is Attachment {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.hash === 'string'
    && typeof o.mime === 'string'
    && typeof o.name === 'string'
    && typeof o.size === 'number';
}

export function parseAttachmentsFromMetadata(meta: string | null): Attachment[] {
  if (!meta) return [];
  try {
    const parsed = JSON.parse(meta) as { attachments?: unknown };
    if (!Array.isArray(parsed.attachments)) return [];
    return parsed.attachments.filter(isAttachment);
  } catch {
    return [];
  }
}

// Textual fallback for runtimes that don't natively handle multimodal
// inputs. Each attachment becomes a bracketed line appended after the
// message body, so an agent like Claude Code can open the file with its
// Read tool (image/* is rendered visually, others as text).
export function renderAttachmentFooter(atts: Attachment[]): string {
  if (atts.length === 0) return '';
  const lines = atts.map(a => {
    const ext = extensionFromMime(a.mime);
    const path = `~/.zaipex-acc/blobs/${a.hash}.${ext}`;
    const size = humanSize(a.size);
    if (isImageMime(a.mime)) {
      return `[image: ${path} · ${a.mime} · ${size}]`;
    }
    return `[file: ${path} · ${a.mime} · ${size} · ${a.name}]`;
  });
  return '\n\n' + lines.join('\n');
}
