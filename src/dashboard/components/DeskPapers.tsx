// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useRef, useState } from 'react';
import { listModifiedFiles, listSharedKeys, getSharedState, type ModifiedFile } from '../lib/api';
import { t } from '../../shared/i18n/browser';

// Extension palette — mirrors the reference mock.
const EXT_STYLES: Record<string, { bg: string; fg: string }> = {
  py:   { bg: '#eeedfe', fg: '#534AB7' },
  ts:   { bg: '#fef0e5', fg: '#d85a30' },
  tsx:  { bg: '#fef0e5', fg: '#d85a30' },
  js:   { bg: '#fef8e5', fg: '#b87a0d' },
  jsx:  { bg: '#fef0e5', fg: '#d85a30' },
  css:  { bg: '#e6f1fb', fg: '#185FA5' },
  scss: { bg: '#e6f1fb', fg: '#185FA5' },
  html: { bg: '#fef0e5', fg: '#d85a30' },
  json: { bg: '#eaf3de', fg: '#3b6d11' },
  md:   { bg: '#e8e3d8', fg: '#5a6272' },
  rs:   { bg: '#f5ded8', fg: '#a63d1a' },
  go:   { bg: '#e0f1f5', fg: '#0e7f99' },
  sql:  { bg: '#fef0e5', fg: '#d85a30' },
  yml:  { bg: '#eaf3de', fg: '#3b6d11' },
  yaml: { bg: '#eaf3de', fg: '#3b6d11' },
};
const FALLBACK = { bg: '#e8e3d8', fg: '#5a6272' };

function extOf(path: string): string {
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

interface DeskPapersProps {
  projectId: string;
  refreshKey?: number;
  onOpenPath?: (path: string) => void;
}

interface PaperEntry {
  path: string;
  file: ModifiedFile | null; // from git
  note: string;              // from shared_state
  noteAgent: string;         // from shared_state
}

const PAGE_SIZE = 14;

export default function DeskPapers({ projectId, refreshKey, onOpenPath }: DeskPapersProps) {
  const [papers, setPapers] = useState<PaperEntry[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Clamp the page index when the papers list shrinks.
  useEffect(() => {
    if (!papers) return;
    const maxPage = Math.max(0, Math.ceil(papers.length / PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [papers, page]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      showToast(t('dash.copiedPath'));
    } catch {
      showToast(t('dash.copyFailed'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [gitFiles, sharedKeys] = await Promise.all([
          listModifiedFiles(projectId).catch(() => [] as ModifiedFile[]),
          listSharedKeys(projectId, 'files').catch(() => [] as string[]),
        ]);

        // Fetch all shared-state notes in parallel.
        const notesList = await Promise.all(
          sharedKeys.map(async (key) => {
            try {
              const entry = await getSharedState(projectId, 'files', key);
              let parsed: { note?: string; agent?: string } = {};
              try { parsed = JSON.parse(entry.value); } catch { parsed = { note: entry.value }; }
              return { key, note: parsed.note ?? '', agent: parsed.agent ?? entry.updated_by };
            } catch {
              return { key, note: '', agent: '' };
            }
          }),
        );

        if (cancelled) return;

        // Merge: git is the base, shared_state notes enrich matching paths.
        // Shared-state keys not present in git still show up (intentional
        // "I worked on this" marker).
        const byPath = new Map<string, PaperEntry>();
        for (const f of gitFiles) {
          byPath.set(f.path, { path: f.path, file: f, note: '', noteAgent: '' });
        }
        for (const n of notesList) {
          const existing = byPath.get(n.key);
          if (existing) {
            existing.note = n.note;
            existing.noteAgent = n.agent;
          } else if (n.note) {
            byPath.set(n.key, { path: n.key, file: null, note: n.note, noteAgent: n.agent });
          }
        }

        setPapers(Array.from(byPath.values()));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    load();
    const interval = setInterval(load, 12_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId, refreshKey]);

  if (papers === null) {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-muted)' }}>
        {t('dash.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#D85A30' }}>
        {error}
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--z-text-muted)', padding: '8px 0',
      }}>
        {t('dash.noFilesYet')}
      </div>
    );
  }

  // Pre-seed rotations per index so rotation stays stable across re-renders.
  const rotations = [-3, 2, 1.5, -1.5, 3, -2, 1, -1, 2.5, -2.5, 0.5, -0.5];

  const totalPages = Math.max(1, Math.ceil(papers.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const visiblePapers = papers.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div style={{ position: 'relative' }}>
    <div style={{
      position: 'relative',
      background: 'var(--z-surface)',
      border: '1px solid var(--z-border)',
      borderRadius: 10,
      padding: 10,
      minHeight: 160,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
    }}>
      {visiblePapers.map((p, visibleIdx) => {
        const i = pageStart + visibleIdx;
        const ext = extOf(p.path);
        const extStyle = EXT_STYLES[ext] ?? FALLBACK;
        const name = baseName(p.path);
        const rotation = rotations[i % rotations.length];
        return (
          <div
            key={p.path}
            title={`${p.path}${p.note ? ` — ${p.note}` : ''}${p.file?.role ? ` · ${p.file.role}` : ''}`}
            style={{
              background: '#F7F4EE',
              borderRadius: 5,
              boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
              padding: '6px 8px 7px',
              width: 92,
              display: 'flex', flexDirection: 'column', gap: 3,
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 0.25s',
              cursor: onOpenPath ? 'pointer' : 'default',
              userSelect: 'none',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = `rotate(${rotation}deg)`; }}
            onClick={() => {
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              onOpenPath?.(p.path);
            }}
            onContextMenu={e => {
              e.preventDefault();
              copyPath(p.path);
            }}
            onPointerDown={() => {
              longPressFired.current = false;
              longPressTimer.current = setTimeout(() => {
                longPressFired.current = true;
                copyPath(p.path);
              }, 550);
            }}
            onPointerUp={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
            onPointerLeave={() => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
            }}
          >
            <span style={{
              alignSelf: 'flex-start',
              fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 500,
              padding: '2px 6px', borderRadius: 3,
              background: extStyle.bg, color: extStyle.fg,
            }}>
              {ext || 'file'}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: '#1E2D40', fontWeight: 500,
              lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}>
              {name}
            </span>
            {p.note && (
              <span style={{
                fontSize: 9, color: '#5A6272', lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {p.note}
              </span>
            )}
            {(p.file?.role || p.noteAgent) && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                color: '#8AA8C0',
                alignSelf: 'flex-end',
              }}>
                {p.file?.name || p.file?.role || p.noteAgent}
              </span>
            )}
          </div>
        );
      })}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%',
          transform: 'translateX(-50%)',
          background: '#1E2D40', color: '#E8E3D8',
          padding: '6px 14px', borderRadius: 20,
          fontSize: 11, fontFamily: 'var(--font-mono)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
          animation: 'acc-step-in 0.2s ease both',
          zIndex: 2,
        }}>
          {toast}
        </div>
      )}
    </div>

    {totalPages > 1 && (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 2px 0',
        fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--z-text-muted)',
      }}>
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          style={{
            background: 'none', border: '1px solid var(--z-border)',
            borderRadius: 6, padding: '3px 10px',
            color: page === 0 ? 'var(--z-text-muted)' : 'var(--z-text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            cursor: page === 0 ? 'default' : 'pointer',
            opacity: page === 0 ? 0.4 : 1,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { if (page !== 0) { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; e.currentTarget.style.color = page === 0 ? 'var(--z-text-muted)' : 'var(--z-text-secondary)'; }}
        >
          ←
        </button>
        <span>
          {page + 1} / {totalPages} · {papers.length} {papers.length === 1 ? 'archivo' : 'archivos'}
        </span>
        <button
          onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1}
          style={{
            background: 'none', border: '1px solid var(--z-border)',
            borderRadius: 6, padding: '3px 10px',
            color: page >= totalPages - 1 ? 'var(--z-text-muted)' : 'var(--z-text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            cursor: page >= totalPages - 1 ? 'default' : 'pointer',
            opacity: page >= totalPages - 1 ? 0.4 : 1,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { if (page < totalPages - 1) { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; e.currentTarget.style.color = page >= totalPages - 1 ? 'var(--z-text-muted)' : 'var(--z-text-secondary)'; }}
        >
          →
        </button>
      </div>
    )}
    </div>
  );
}
