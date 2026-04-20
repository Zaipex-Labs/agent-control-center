// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState } from 'react';
import type { Attachment } from '../lib/types';
import { attachmentUrl } from '../lib/api';
import { isImageMime } from '../../shared/attachments';
import AttachmentChip from './AttachmentChip';
import Lightbox from './Lightbox';

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
          <button
            key={att.hash}
            type="button"
            onClick={() => setZoom(att)}
            title={att.name}
            style={{
              padding: 0,
              border: '1px solid var(--z-border)',
              borderRadius: 8,
              background: 'transparent',
              cursor: 'zoom-in',
              maxWidth: 320,
              overflow: 'hidden',
              display: 'block',
            }}
          >
            <img
              src={attachmentUrl(att.hash)}
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
        ) : (
          <AttachmentChip key={att.hash} att={att} />
        ))}
      </div>
      {zoom && (
        <Lightbox
          src={attachmentUrl(zoom.hash)}
          attachment={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  );
}
