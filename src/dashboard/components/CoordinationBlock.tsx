// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState, useEffect } from 'react';
import type { LogEntry } from '../lib/types';
import { t, getLang } from '../../shared/i18n/browser';

const ROLE_COLORS: Record<string, string> = {
  backend: '#4A9FE8',
  frontend: '#E8823A',
  qa: '#534AB7',
  devops: '#3DBA7A',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role.toLowerCase()] ?? '#5A6272';
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
}

interface CoordinationBlockProps {
  messages: LogEntry[];
  live?: boolean;
}

export default function CoordinationBlock({ messages, live = false }: CoordinationBlockProps) {
  const [expanded, setExpanded] = useState(false);

  // When the block goes live (agents actively chatting), auto-expand so the
  // user sees the messages stream in instead of a collapsed summary.
  useEffect(() => {
    if (live) setExpanded(true);
  }, [live]);

  const roles = Array.from(new Set(messages.flatMap(m => [m.from_role, m.to_role]).filter(Boolean)));
  const label = roles.length === 2
    ? t('dash.coordinatedTwo', { a: roles[0], b: roles[1] })
    : t('dash.coordinatedOne', { a: roles[0] });

  return (
    <div style={{ margin: '4px 0' }}>
      {/* Collapsed summary */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--z-border)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
      >
        {/* Mini avatars */}
        <div style={{ display: 'flex', marginRight: 2 }}>
          {roles.slice(0, 3).map((role, i) => (
            <div key={role} style={{
              width: 20, height: 20, borderRadius: '50%',
              background: roleColor(role), color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 600,
              marginLeft: i > 0 ? -6 : 0,
              border: '2px solid var(--z-navy-dark)',
              position: 'relative', zIndex: roles.length - i,
            }}>
              {role[0].toUpperCase()}
            </div>
          ))}
        </div>

        <span style={{ fontSize: 12, color: 'var(--z-text-muted)', flex: 1 }}>
          {label} {messages.length === 1 ? t('dash.messagesSingular', { count: messages.length }) : t('dash.messagesPlural', { count: messages.length })}
        </span>

        {live && <InlineTypingDots />}

        <span style={{
          fontSize: 10, color: 'var(--z-text-muted)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
          marginLeft: 6,
        }}>
          &#9654;
        </span>
      </div>

      {/* Expanded messages */}
      {expanded && (
        <div style={{
          marginTop: 6, marginLeft: 16,
          borderLeft: '2px solid var(--z-border)',
          paddingLeft: 12,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {messages.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '4px 0',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: roleColor(m.from_role), color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 600, marginTop: 2,
              }}>
                {(m.from_role || '?')[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--z-text-secondary)' }}>
                    {m.from_role}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--z-text-muted)' }}>
                    &rarr; {m.to_role}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--z-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {formatTime(m.sent_at)}
                  </span>
                </div>
                <div style={{
                  fontSize: 12, color: 'var(--z-text-secondary)',
                  lineHeight: 1.4, marginTop: 2,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.text}
                </div>
              </div>
            </div>
          ))}
          {live && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 0',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: 'var(--z-surface)', border: '1px dashed var(--z-border)',
              }} />
              <InlineTypingDots />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineTypingDots() {
  const dot: React.CSSProperties = {
    width: 5, height: 5, borderRadius: '50%',
    background: 'var(--z-text-secondary)',
    animation: 'typing-bounce 1.2s infinite',
    display: 'inline-block',
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 10,
      background: 'rgba(74,159,232,0.08)',
      border: '1px solid rgba(74,159,232,0.2)',
    }}>
      <span style={{ ...dot, animationDelay: '0s' }} />
      <span style={{ ...dot, animationDelay: '0.2s' }} />
      <span style={{ ...dot, animationDelay: '0.4s' }} />
    </span>
  );
}
