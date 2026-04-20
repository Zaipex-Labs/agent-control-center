// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useCallback, useState } from 'react';
import type { Attachment } from '../lib/types';
import { uploadBlob } from '../lib/api';

export interface PendingAttachment {
  id: string;                   // local uuid, not the server hash
  file: File;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  attachment?: Attachment;      // populated when status === 'ready'
}

// Matches the default MAX_BLOB_SIZE in src/broker/blobs.ts. If you change
// this default, align it there too.
const MAX = 100 * 1024 * 1024;

// Parallel uploads with local progress/error state. Files above the size
// cap are rejected client-side (returned in `rejected`) so the user gets
// immediate feedback without hitting the network.
export function useAttachmentUpload() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  const addFiles = useCallback((files: File[]) => {
    const rejected = files.filter(f => f.size > MAX);
    const valid = files.filter(f => f.size <= MAX);
    const newItems: PendingAttachment[] = valid.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      status: 'uploading',
    }));
    setPending(prev => [...prev, ...newItems]);

    newItems.forEach(async (item) => {
      try {
        const att = await uploadBlob(item.file);
        setPending(prev => prev.map(p =>
          p.id === item.id ? { ...p, status: 'ready', attachment: att } : p,
        ));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPending(prev => prev.map(p =>
          p.id === item.id ? { ...p, status: 'error', error: msg } : p,
        ));
      }
    });

    return { rejected };
  }, []);

  const remove = useCallback((id: string) => {
    setPending(prev => prev.filter(p => p.id !== id));
  }, []);

  const clear = useCallback(() => setPending([]), []);

  const ready = pending.filter(p => p.status === 'ready').map(p => p.attachment!);
  const uploading = pending.some(p => p.status === 'uploading');
  const hasError = pending.some(p => p.status === 'error');

  return { pending, addFiles, remove, clear, ready, uploading, hasError };
}
