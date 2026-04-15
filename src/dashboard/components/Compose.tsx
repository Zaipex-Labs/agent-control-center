// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState, useRef, useCallback } from 'react';
import type { Peer, MessageType } from '../lib/types';
import { t } from '../../shared/i18n/browser';
import { ARCHITECT_ROLE } from '../../shared/names';

interface ComposeProps {
  agents: Peer[];
  onSend: (toRole: string, text: string, type?: MessageType) => Promise<void>;
}

export default function Compose({ agents, onSend }: ComposeProps) {
  const [text, setText] = useState('');
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const roles = Array.from(new Set(agents.map(a => a.role))).filter(Boolean);
  // Default every new conversation to the architect so they route the work.
  // The user can still override via the dropdown.
  const defaultRole = roles.includes(ARCHITECT_ROLE) ? ARCHITECT_ROLE : (roles[0] || t('dash.all'));
  const displayTarget = targetRole ?? defaultRole;

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(displayTarget, trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend, displayTarget]);

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
    <div style={{
      borderTop: '1px solid var(--z-border)',
      padding: '12px 24px',
      display: 'flex', alignItems: 'flex-end', gap: 10,
      background: 'var(--z-navy-dark)',
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
        disabled={!text.trim() || sending}
        style={{
          background: text.trim() ? 'var(--z-orange)' : 'var(--z-surface)',
          color: text.trim() ? '#fff' : 'var(--z-text-muted)',
          border: text.trim() ? 'none' : '1px solid var(--z-border)',
          padding: '9px 20px', borderRadius: 10, fontSize: 13,
          fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default',
          fontFamily: 'var(--font-sans)', flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
          opacity: sending ? 0.6 : 1,
        }}
      >
        {sending ? '...' : t('dash.send')}
      </button>
    </div>
  );
}
