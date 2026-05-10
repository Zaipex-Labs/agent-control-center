// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState } from 'react';
import type { Attachment } from '../lib/types';
import { isImageMime } from '../../shared/attachments';
import AttachmentChip from './AttachmentChip';
import Lightbox from './Lightbox';
import { useBlobUrl } from '../hooks/useBlobUrl';

// Renders a list of attachments below a message. Images become clickable
// thumbnails that open the lightbox; non-images become download chips.
// Shared between MessageBubble and the CoordMessage inside Meeting.
export default function AttachmentsRow({ attachments }: { attachments: Attachment[] }) {
  const [zoom, setZoom] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8,
        marginTop: 8,
      }}>
        {attachments.map(att => isImageMime(att.mime) ? (
          <InlineImage key={att.hash} att={att} onZoom={() => setZoom(att)} />
        ) : (
          <AttachmentChip key={att.hash} att={att} />
        ))}
      </div>
      {zoom && (
        <Lightbox
          attachment={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  );
}

// Small helper kept co-located because it's only used here. Fetches the
// blob via useBlobUrl, shows a skeleton while loading and a subtle
// error state if the fetch failed (e.g. the blob was GC'd or the peer
// session expired).
function InlineImage({ att, onZoom }: { att: Attachment; onZoom: () => void }) {
  const { url, error } = useBlobUrl(att.hash);

  const frameStyle: React.CSSProperties = {
    padding: 0,
    border: '1px solid var(--z-border)',
    borderRadius: 8,
    background: 'transparent',
    cursor: url ? 'zoom-in' : 'default',
    maxWidth: 320,
    overflow: 'hidden',
    display: 'block',
  };

  if (error) {
    return (
      <div
        style={{
          ...frameStyle,
          cursor: 'default',
          padding: '16px 20px',
          color: 'var(--z-danger, #e8823a)',
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          fontSize: 11,
        }}
        title={error}
      >
        {att.name} · unavailable
      </div>
    );
  }

  if (!url) {
    // Skeleton — same footprint as a real thumbnail so the chat doesn't
    // reflow once the bytes arrive.
    return (
      <div
        style={{
          ...frameStyle,
          cursor: 'default',
          width: 160,
          height: 120,
          background: 'var(--z-surface-subtle, rgba(255,255,255,0.04))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--z-text-muted)',
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          fontSize: 11,
        }}
        aria-label={`Loading ${att.name}`}
      >
        ⧗
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onZoom}
      title={att.name}
      style={frameStyle}
    >
      <img
        src={url}
        alt={att.name}
        loading="lazy"
        style={{
          display: 'block',
          maxWidth: 320,
          maxHeight: 240,
          objectFit: 'contain',
        }}
      />
    </button>
  );
}
