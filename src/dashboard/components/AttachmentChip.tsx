// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState } from 'react';
import type { Attachment } from '../lib/types';
import { humanSize } from '../../shared/attachments';
import { fetchBlobAsObjectUrl } from '../lib/api';
import { useCurrentPeerId } from '../hooks/useDashboardPeer';

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
  cursor: 'pointer',
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

// [H-2] — the blob endpoint now requires X-Peer-Id, so an `<a download>`
// pointing at `/api/blobs/:hash` no longer works (no way to attach
// headers to plain anchor navigation). Click fetches the blob with the
// current peer's id, wraps it in an object URL, triggers a synthetic
// <a download> click, then revokes the URL.
export default function AttachmentChip({ att }: { att: Attachment }) {
  const peerId = useCurrentPeerId();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!peerId || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const url = await fetchBlobAsObjectUrl(att.hash, peerId);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!peerId || downloading}
      style={{
        ...chipStyle,
        opacity: (!peerId || downloading) ? 0.6 : (error ? 0.8 : 1),
        borderColor: error ? 'var(--z-danger, #e8823a)' : 'var(--z-border)',
      }}
      title={error ? error : `${att.name} · ${att.mime} · ${humanSize(att.size)}`}
    >
      <span aria-hidden style={{ fontSize: 14 }}>{downloading ? '⧗' : '📎'}</span>
      <span style={nameStyle}>{att.name}</span>
      <span style={sizeStyle}>{humanSize(att.size)}</span>
    </button>
  );
}
