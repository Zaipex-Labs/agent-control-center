// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import {
  parseAttachmentsFromMetadata,
  serializeAttachments,
  renderAttachmentFooter,
  isImageMime,
  humanSize,
} from '../../src/shared/attachments.js';

describe('attachments helpers', () => {
  const att = { hash: 'deadbeef', mime: 'image/png', name: 'shot.png', size: 4096 };

  it('serializeAttachments returns JSON with attachments array', () => {
    const s = serializeAttachments([att]);
    expect(JSON.parse(s)).toEqual({ attachments: [att] });
  });

  it('serializeAttachments merges with existing metadata', () => {
    const s = serializeAttachments([att], { topic: 'debug' });
    expect(JSON.parse(s)).toEqual({ topic: 'debug', attachments: [att] });
  });

  it('parseAttachmentsFromMetadata returns [] on null', () => {
    expect(parseAttachmentsFromMetadata(null)).toEqual([]);
  });

  it('parseAttachmentsFromMetadata returns [] on invalid JSON', () => {
    expect(parseAttachmentsFromMetadata('{not json')).toEqual([]);
  });

  it('parseAttachmentsFromMetadata extracts array', () => {
    expect(parseAttachmentsFromMetadata(JSON.stringify({ attachments: [att] }))).toEqual([att]);
  });

  it('parseAttachmentsFromMetadata filters malformed entries', () => {
    const raw = JSON.stringify({ attachments: [att, { hash: 'x' }, 'bad'] });
    expect(parseAttachmentsFromMetadata(raw)).toEqual([att]);
  });

  it('isImageMime recognises png/jpeg/webp/gif', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    expect(isImageMime('image/gif')).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(isImageMime('application/pdf')).toBe(false);
  });

  it('humanSize formats bytes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('renderAttachmentFooter lists image+file with path+mime+size', () => {
    const footer = renderAttachmentFooter([
      att,
      { hash: 'cafe', mime: 'application/pdf', name: 'spec.pdf', size: 12000 },
    ]);
    expect(footer).toContain('[image: ~/.zaipex-acc/blobs/deadbeef.png · image/png · 4.0 KB]');
    expect(footer).toContain('[file: ~/.zaipex-acc/blobs/cafe.pdf · application/pdf · 11.7 KB · spec.pdf]');
  });

  it('renderAttachmentFooter returns empty string for []', () => {
    expect(renderAttachmentFooter([])).toBe('');
  });
});
