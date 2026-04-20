// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import type { Attachment } from '../lib/types';
import { attachmentUrl } from '../lib/api';
import { humanSize } from '../../shared/attachments';

// Styles hoisted to module scope — consistent with PendingAttachmentStrip,
// trivially refactorable into CSS later, and reference Zaipex brand tokens.
const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '6px 10px',
  background: 'var(--z-surface-subtle, rgba(255,255,255,0.05))',
  border: '1px solid var(--z-border)',
  borderRadius: 6,
  color: 'var(--z-text)',
  textDecoration: 'none',
  fontSize: 12,
  fontFamily: 'var(--font-sans, "DM Sans", sans-serif)',
  maxWidth: 320,
};

const nameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sizeStyle: React.CSSProperties = {
  color: 'var(--z-text-muted)',
  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
  fontSize: 10,
};

export default function AttachmentChip({ att }: { att: Attachment }) {
  return (
    <a
      href={attachmentUrl(att.hash)}
      download={att.name}
      style={chipStyle}
      title={`${att.name} · ${att.mime} · ${humanSize(att.size)}`}
    >
      <span aria-hidden style={{ fontSize: 14 }}>📎</span>
      <span style={nameStyle}>{att.name}</span>
      <span style={sizeStyle}>{humanSize(att.size)}</span>
    </a>
  );
}
