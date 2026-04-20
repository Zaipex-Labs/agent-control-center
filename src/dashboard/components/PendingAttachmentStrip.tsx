// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import type { PendingAttachment } from '../hooks/useAttachmentUpload';

interface Props {
  pending: PendingAttachment[];
  onRemove: (id: string) => void;
}

const stripStyle: React.CSSProperties = {
  display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 0 8px',
};

const itemBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '4px 8px', borderRadius: 6,
  border: '1px solid var(--z-border)',
  fontSize: 11,
  fontFamily: 'var(--font-sans, "DM Sans", sans-serif)',
  color: 'var(--z-text)',
};

const itemReady: React.CSSProperties = {
  ...itemBase,
  background: 'var(--z-surface-subtle, rgba(255,255,255,0.05))',
};

const itemError: React.CSSProperties = {
  ...itemBase,
  background: 'var(--z-danger-soft, rgba(232,130,58,0.1))',
  borderColor: 'var(--z-danger, #e8823a)',
  color: 'var(--z-danger, #e8823a)',
};

const removeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--z-text-muted)',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
};

export default function PendingAttachmentStrip({ pending, onRemove }: Props) {
  if (pending.length === 0) return null;
  return (
    <div style={stripStyle}>
      {pending.map(p => (
        <div
          key={p.id}
          style={p.status === 'error' ? itemError : itemReady}
          title={p.error ?? `${p.file.name} · ${p.status}`}
        >
          <span>{p.file.name}</span>
          {p.status === 'uploading' && <span aria-label="uploading">…</span>}
          {p.status === 'error' && <span aria-label="error">!</span>}
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label="remove"
            style={removeBtn}
          >×</button>
        </div>
      ))}
    </div>
  );
}
