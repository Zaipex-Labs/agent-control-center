// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Message, MessageType } from '../shared/types.js';
import {
  parseAttachmentsFromMetadata,
  renderAttachmentFooter,
} from '../shared/attachments.js';

export interface SenderInfo {
  from_id: string;
  from_role: string;
  from_cwd: string;
}

// ── Channel push delivery (MCP notification) ───────────────────

export async function pushMessage(
  mcpServer: Server,
  message: Message,
  senderInfo: SenderInfo,
): Promise<void> {
  // Textual fallback for runtimes that don't consume multimodal MCP
  // payloads natively. The receiver (e.g. Claude Code) can open the
  // file from the path in the footer with its Read tool.
  const footer = renderAttachmentFooter(parseAttachmentsFromMetadata(message.metadata ?? null));
  await mcpServer.notification({
    method: 'notifications/claude/channel',
    params: {
      content: message.text + footer,
      meta: {
        from_id: senderInfo.from_id,
        from_role: senderInfo.from_role,
        from_cwd: senderInfo.from_cwd,
        sent_at: message.sent_at,
      },
    },
  });
}

// ── Interrupt file delivery (last resort) ──────────────────────

export function writeInterruptFile(
  cwd: string,
  fromRole: string,
  type: MessageType,
  text: string,
  sentAt: string,
  metadata?: string | null,
): void {
  const dir = join(cwd, '.acc-messages');
  mkdirSync(dir, { recursive: true });
  const timestamp = sentAt.replace(/[:.]/g, '-');
  const safeRole = fromRole.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${timestamp}_${safeRole}.md`;
  const footer = renderAttachmentFooter(parseAttachmentsFromMetadata(metadata ?? null));
  const content = `# Mensaje de ${fromRole} (${type})\n\n**Enviado:** ${sentAt}\n\n---\n\n${text}${footer}\n`;
  writeFileSync(join(dir, filename), content);
}
