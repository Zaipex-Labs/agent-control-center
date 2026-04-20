// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect } from 'react';
import type { Attachment } from '../lib/types';
import AttachmentChip from './AttachmentChip';

interface LightboxProps {
  src: string;
  attachment: Attachment;
  onClose: () => void;
}

// Minimal custom lightbox. Navy overlay (matches dashboard chrome),
// monospaced close hint top-right, filename + download chip at bottom.
// ESC and click-outside both dismiss.
export default function Lightbox({ src, attachment, onClose }: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        // Navy overlay, not generic black — feels like part of the app.
        background: 'rgba(20, 31, 46, 0.92)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'stretch', justifyContent: 'space-between',
        padding: 24, cursor: 'zoom-out',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--z-text-light, #e5e7eb)',
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: 12, cursor: 'pointer',
            padding: '4px 8px', letterSpacing: 0.5,
          }}
        >
          Cerrar (ESC)
        </button>
      </div>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          minHeight: 0,
        }}
      >
        <img
          src={src}
          alt={attachment.name}
          style={{
            maxWidth: '92vw', maxHeight: '80vh',
            objectFit: 'contain',
            // Editorial 4px radius — less "app-like" than 8px.
            borderRadius: 4,
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            cursor: 'default',
          }}
        />
      </div>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, paddingTop: 12,
        }}
      >
        <div style={{
          color: 'var(--z-text-light, #e5e7eb)',
          fontFamily: 'var(--font-sans, "DM Sans", sans-serif)',
          fontSize: 14, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {attachment.name}
        </div>
        <AttachmentChip att={attachment} />
      </div>
    </div>
  );
}
