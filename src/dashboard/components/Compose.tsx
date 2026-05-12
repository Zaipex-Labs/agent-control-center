// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Peer, MessageType, Attachment } from '../lib/types';
import { t } from '../../shared/i18n/browser';
import { ARCHITECT_ROLE } from '../../shared/names';
import { useAttachmentUpload } from '../hooks/useAttachmentUpload';
import PendingAttachmentStrip from './PendingAttachmentStrip';
import { estimateMessageCost, type CostEstimate } from '../lib/api';

interface ComposeProps {
  agents: Peer[];
  projectId?: string;
  onSend: (toRole: string, text: string, type?: MessageType, attachments?: Attachment[]) => Promise<void>;
}

export default function Compose({ agents, projectId, onSend }: ComposeProps) {
  const [text, setText] = useState('');
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useAttachmentUpload();

  const roles = Array.from(new Set(agents.map(a => a.role))).filter(Boolean);
  const defaultRole = roles.includes(ARCHITECT_ROLE) ? ARCHITECT_ROLE : (roles[0] || t('dash.all'));
  const displayTarget = targetRole ?? defaultRole;

  const canSend = (!!text.trim() || upload.ready.length > 0) && !sending && !upload.uploading;

  // FU-AE v0.4.0 — cost preview. Debounced fetch on text change so
  // we don't hit the broker on every keystroke. Hidden entirely when
  // the textarea is empty (no signal to estimate from). The preview
  // never blocks Send — it's informational only.
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      // Sub-threshold message — too short to estimate meaningfully.
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void estimateMessageCost(projectId, trimmed)
        .then(r => { if (!cancelled) setEstimate(r); })
        .catch(() => { if (!cancelled) setEstimate(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [text, projectId]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(
        displayTarget,
        trimmed || '(adjunto)',
        undefined,
        upload.ready.length > 0 ? upload.ready : undefined,
      );
      setText('');
      upload.clear();
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
    } finally {
      setSending(false);
    }
  }, [text, canSend, onSend, displayTarget, upload]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = '40px';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) upload.addFiles(files);
      }}
      style={{
        position: 'relative',
        borderTop: '1px solid var(--z-border)',
        background: 'var(--z-navy-dark)',
        outline: dragging ? '2px dashed var(--z-orange)' : 'none',
      }}
    >
      {dragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(232,130,58,0.08)', pointerEvents: 'none',
          color: 'var(--z-orange)', fontWeight: 600, fontSize: 14,
          fontFamily: 'var(--font-sans, "DM Sans", sans-serif)',
        }}>
          {t('dash.attach.dropHere')}
        </div>
      )}

      {/* Pending uploads above the composer */}
      {upload.pending.length > 0 && (
        <div style={{ padding: '10px 24px 0' }}>
          <PendingAttachmentStrip pending={upload.pending} onRemove={upload.remove} />
        </div>
      )}

      {/* FU-AE v0.4.0 — cost preview. Visible inline, never hidden
          behind a hover. Color + suffix tell the user whether the
          number is real-data-driven or a synthetic estimate. The
          "¿cómo se calcula?" button opens a small disclosure with
          the basis breakdown. */}
      {estimate && (
        <CostPreview estimate={estimate} onExplain={() => setShowHowItWorks(true)} />
      )}
      {showHowItWorks && estimate && (
        <CostHowItWorks estimate={estimate} onClose={() => setShowHowItWorks(false)} />
      )}

      <div style={{
        padding: '12px 24px',
        display: 'flex', alignItems: 'flex-end', gap: 10,
      }}>
        {/* Target selector */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowDropdown(v => !v)}
            style={{
              background: 'var(--z-surface)', border: '1px solid var(--z-border)',
              borderRadius: 8, padding: '8px 12px',
              color: 'var(--z-text-secondary)', fontSize: 13,
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', gap: 4,
              whiteSpace: 'nowrap', fontWeight: 500,
            }}
          >
            {t('dash.to')}: {displayTarget} <span style={{ fontSize: 10, marginLeft: 2 }}>&#9660;</span>
          </button>

          {showDropdown && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0,
              background: 'var(--z-surface)', border: '1px solid var(--z-border)',
              borderRadius: 8, marginBottom: 4, minWidth: 140,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 10,
              overflow: 'hidden',
            }}>
              <div
                onClick={() => { setTargetRole(null); setShowDropdown(false); }}
                style={{
                  padding: '8px 14px', fontSize: 13, color: 'var(--z-text)',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {t('dash.all')}
              </div>
              {roles.map(role => (
                <div
                  key={role}
                  onClick={() => { setTargetRole(role); setShowDropdown(false); }}
                  style={{
                    padding: '8px 14px', fontSize: 13, color: 'var(--z-text)',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {role}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title={t('dash.attach.button')}
          aria-label={t('dash.attach.button')}
          style={{
            background: 'var(--z-surface)', border: '1px solid var(--z-border)',
            borderRadius: 8, padding: '8px 10px',
            cursor: 'pointer', color: 'var(--z-text-secondary)',
            fontSize: 14, flexShrink: 0,
          }}
        >📎</button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={e => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) upload.addFiles(files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={t('dash.messagePlaceholder')}
          rows={1}
          style={{
            flex: 1, background: 'var(--z-surface)',
            border: '1px solid var(--z-border)', borderRadius: 10,
            padding: '10px 14px', color: 'var(--z-text)', fontSize: 14,
            fontFamily: 'var(--font-sans)', outline: 'none',
            resize: 'none', height: 40, lineHeight: 1.4,
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--z-orange)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title={upload.uploading ? t('dash.attach.uploading') : undefined}
          style={{
            background: canSend ? 'var(--z-orange)' : 'var(--z-surface)',
            color: canSend ? '#fff' : 'var(--z-text-muted)',
            border: canSend ? 'none' : '1px solid var(--z-border)',
            padding: '9px 20px', borderRadius: 10, fontSize: 13,
            fontWeight: 600, cursor: canSend ? 'pointer' : 'default',
            fontFamily: 'var(--font-sans)', flexShrink: 0,
            transition: 'background 0.15s, color 0.15s',
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? '...' : t('dash.send')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FU-AE v0.4.0 — cost preview pieces
// ─────────────────────────────────────────────────────────────

// Style palette per confidence. The disclaimer must be visible
// inline (per the FASE E plan), not behind a hover. low gets the
// most prominent disclaimer because that's the synthetic-baseline
// case where the number is most likely to be wrong.
const CONFIDENCE_STYLES: Record<'low' | 'medium' | 'high', {
  border: string;
  fg: string;
  bg: string;
  badgeBg: string;
  badgeFg: string;
}> = {
  low: {
    border: 'rgba(154, 160, 170, 0.5)',
    fg: '#9AA0AA',
    bg: 'rgba(154, 160, 170, 0.08)',
    badgeBg: '#9AA0AA',
    badgeFg: '#1E2D40',
  },
  medium: {
    border: 'rgba(232, 195, 141, 0.6)',
    fg: '#E8C38D',
    bg: 'rgba(232, 195, 141, 0.10)',
    badgeBg: '#E8C38D',
    badgeFg: '#1E2D40',
  },
  high: {
    border: 'rgba(61, 186, 122, 0.55)',
    fg: '#3DBA7A',
    bg: 'rgba(61, 186, 122, 0.08)',
    badgeBg: '#3DBA7A',
    badgeFg: '#fff',
  },
};

function CostPreview({ estimate, onExplain }: { estimate: CostEstimate; onExplain: () => void }) {
  const s = CONFIDENCE_STYLES[estimate.confidence];
  const [tMin, tMax] = estimate.estimatedTurns;
  const [uMin, uMax] = estimate.estimatedCostUSD;
  const disclaimer: Record<'low' | 'medium' | 'high', string> = {
    low: t('dash.cost.disclaimer.low'),
    medium: t('dash.cost.disclaimer.medium'),
    high: t('dash.cost.disclaimer.high'),
  };
  return (
    <div style={{
      margin: '8px 24px 0',
      padding: '8px 12px',
      borderRadius: 8,
      border: `1px solid ${s.border}`,
      background: s.bg,
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: 'var(--font-mono)', fontSize: 12,
      color: s.fg,
      flexWrap: 'wrap',
    }}>
      <span style={{
        background: s.badgeBg, color: s.badgeFg,
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
        padding: '2px 7px', borderRadius: 4,
        textTransform: 'uppercase',
      }}>
        {estimate.confidence}
      </span>
      <span style={{ color: 'var(--z-text)' }}>
        ~{tMin}–{tMax} {t('dash.cost.turns')} · ~${uMin}–${uMax}
      </span>
      <span style={{ color: s.fg, fontStyle: 'italic', flex: 1, minWidth: 200 }}>
        {disclaimer[estimate.confidence]}
      </span>
      <button
        type="button"
        onClick={onExplain}
        style={{
          background: 'none', border: 'none', padding: 0,
          color: s.fg, fontSize: 11, cursor: 'pointer',
          textDecoration: 'underline', textUnderlineOffset: 3,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {t('dash.cost.howItWorks')}
      </button>
    </div>
  );
}

function CostHowItWorks({ estimate, onClose }: { estimate: CostEstimate; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--z-navy-dark)', borderRadius: 12,
          border: '1px solid var(--z-border)',
          padding: '20px 24px', width: 'min(520px, 92vw)',
          color: 'var(--z-text)', fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{t('dash.cost.howItWorks')}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--z-text-muted)',
              fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >×</button>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--z-text-secondary)', margin: '0 0 12px' }}>
          {t('dash.cost.explain.intro')}
        </p>
        <ul style={{
          fontSize: 12, lineHeight: 1.6, color: 'var(--z-text-secondary)',
          margin: 0, paddingLeft: 18,
        }}>
          <li>{t('dash.cost.explain.agents', { count: estimate.basis.agents })}</li>
          <li>{t('dash.cost.explain.complexity', { level: estimate.basis.complexity })}</li>
          <li>{t('dash.cost.explain.source', {
            source: estimate.basis.source === 'project-avg' ? t('dash.cost.source.realData') : t('dash.cost.source.synthetic'),
            sampleSize: estimate.sampleSize,
          })}</li>
          {estimate.basis.avgUsdPerTurn !== undefined && (
            <li>{t('dash.cost.explain.avgPerTurn', { avg: estimate.basis.avgUsdPerTurn.toFixed(4) })}</li>
          )}
        </ul>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--z-text-muted)', margin: '12px 0 0', fontStyle: 'italic' }}>
          {t('dash.cost.explain.disclaimer')}
        </p>
      </div>
    </div>
  );
}
