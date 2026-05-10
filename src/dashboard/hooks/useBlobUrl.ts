// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useState } from 'react';
import { fetchBlobAsObjectUrl } from '../lib/api';
import { useCurrentPeerId } from './useDashboardPeer';

// [H-2] — the GET /api/blobs/:hash endpoint now requires an X-Peer-Id
// header. <img src=…> can't set custom headers, so every component that
// renders a blob fetches the bytes and exposes them via URL.createObjectURL.
// This hook owns that lifecycle: it creates the object URL on mount,
// revokes it on unmount or hash change, and surfaces error state so the
// UI can render a placeholder instead of a broken image.

export interface UseBlobUrlState {
  url: string | null;
  error: string | null;
  loading: boolean;
}

export function useBlobUrl(hash: string): UseBlobUrlState {
  const peerId = useCurrentPeerId();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!peerId) {
      // No peer yet — keep the placeholder; the parent will re-render
      // once useDashboardPeer settles.
      setUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    setUrl(null);
    setError(null);

    fetchBlobAsObjectUrl(hash, peerId)
      .then(u => {
        if (cancelled) {
          // Component already unmounted or hash changed — don't leak the
          // object URL we just created.
          URL.revokeObjectURL(u);
          return;
        }
        createdUrl = u;
        setUrl(u);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [hash, peerId]);

  return { url, error, loading: url === null && error === null && !!peerId };
}

// Convenience hook for `<a download>` — fetches the blob and triggers
// a programmatic download click when invoked. Callers typically wrap
// it in a button that also shows a loading/error state via useBlobUrl.
export async function downloadBlob(hash: string, peerId: string, filename: string): Promise<void> {
  const objectUrl = await fetchBlobAsObjectUrl(hash, peerId);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on next tick so the click had time to register on WebKit.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
