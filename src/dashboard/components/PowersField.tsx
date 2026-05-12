// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A-3 v0.3.2 + FU-X v0.3.3 — Multi-check powers picker.
//
// Originally inline in AgentIdCard (FASE A-3 v0.3.2). Extracted to its
// own file in v0.3.3 so CompactAgentIdCard (Create modal) and
// AgentIdCard (Edit modal) share a single component — closing FU-X
// from the v0.3.2 powers-observability followups. `compact: true`
// renders the env-var hint as a small `*` glyph with a tooltip instead
// of a full inline line so the Create modal stays dense.

import { type CSSProperties } from 'react';
import type { Power } from '../../shared/wire';
import { t } from '../../shared/i18n/browser';

const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#5A6272',
};

export interface PowersFieldProps {
  value: string[];
  available: Power[];
  disabled: boolean;
  onChange: (next: string[]) => void;
  compact?: boolean;
}

export default function PowersField({ value, available, disabled, onChange, compact = false }: PowersFieldProps) {
  const toggle = (name: string) => {
    if (disabled) return;
    const next = value.includes(name)
      ? value.filter(p => p !== name)
      : [...value, name];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={labelStyle}>{t('dash.powersLabel')}</label>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '10px 12px', borderRadius: 8,
        background: '#F0ECE3', border: '1px solid #DDD5C8',
      }}>
        {available.map(p => {
          const selected = value.includes(p.name);
          const envHint = p.requiredEnv.length > 0
            ? t('dash.powersRequires', { vars: p.requiredEnv.join(', ') })
            : null;
          return (
            <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.6 : 1,
                  fontSize: 13, color: '#1E2D40',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggle(p.name)}
                  style={{ width: 14, height: 14, accentColor: '#3DBA7A' }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                  {p.name}
                </span>
                {compact && envHint && (
                  <span
                    title={envHint}
                    style={{ color: '#A35F2A', fontSize: 14, cursor: 'help', fontFamily: 'var(--font-mono)' }}
                  >
                    *
                  </span>
                )}
                <span style={{ color: '#5A6272', fontSize: 12 }}>
                  {p.description}
                </span>
              </label>
              {!compact && selected && envHint && (
                <span style={{
                  marginLeft: 22,
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: '#A35F2A',
                }}>
                  {envHint}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
