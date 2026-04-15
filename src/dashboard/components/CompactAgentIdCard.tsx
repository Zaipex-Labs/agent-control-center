// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { type CSSProperties, useState } from 'react';
import Avatar from './Avatar';
import FolderPicker from './FolderPicker';
import { MODELS, DEFAULT_MODEL_ID } from '../lib/models';
import { roleStyle } from '../lib/roles';
import { getDefaultName } from '../../shared/names';
import { t } from '../../shared/i18n/browser';

export interface CompactAgentDraft {
  role: string;
  name: string;
  cwd: string;
  instructions: string;
  model: string;
}

interface CompactAgentIdCardProps {
  draft: CompactAgentDraft;
  onChange: (next: CompactAgentDraft) => void;
  onDelete: () => void;
  locked?: boolean;
  lockedHint?: string;
}

const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#5A6272',
};

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1E2D40',
  background: '#F0ECE3', border: '1px solid #DDD5C8',
  borderRadius: 8, padding: '9px 12px', outline: 'none',
  width: '100%', transition: 'border-color 0.2s, background 0.2s',
};

const selectBgImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6272' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";

export default function CompactAgentIdCard({ draft, onChange, onDelete, locked = false, lockedHint }: CompactAgentIdCardProps) {
  const [focused, setFocused] = useState(false);

  const update = <K extends keyof CompactAgentDraft>(field: K, value: CompactAgentDraft[K]) =>
    onChange({ ...draft, [field]: value });

  const readOnlyInputStyle: React.CSSProperties = locked ? {
    opacity: 0.7,
    cursor: 'not-allowed',
    background: '#E8E3D8',
  } : {};

  const style = roleStyle(draft.role);
  const displayName = (draft.name || '').trim() || getDefaultName(draft.role || 'agent');
  const seed = displayName || draft.role || 'new-agent';
  const modelId = draft.model || DEFAULT_MODEL_ID;

  return (
    <div style={{
      display: 'flex', borderRadius: 14, overflow: 'hidden',
      border: `1px solid ${focused ? '#4A9FE8' : '#DDD5C8'}`,
      background: '#FAF7F1',
      boxShadow: focused ? '0 0 0 3px rgba(74,159,232,0.12)' : 'none',
      transition: 'border-color 0.25s, box-shadow 0.25s',
    }}>
      {/* ── Compact badge (left) ── */}
      <div style={{
        width: 140, flexShrink: 0,
        padding: '18px 14px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRight: '1px dashed #DDD5C8',
        background: '#F7F4EE',
        gap: 10,
      }}>
        <Avatar
          avatar={null}
          seed={seed}
          size={64}
          background={style.avatar}
          title={displayName}
        />
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          textTransform: 'uppercase', letterSpacing: 1.5, color: '#9AA0AA',
          textAlign: 'center',
        }}>
          {t('dash.autoAvatar')}
        </div>
      </div>

      {/* ── Config panel (right) ── */}
      <div
        style={{
          flex: 1, padding: 18,
          display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
        }}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
      >
        {/* Row 1: Name + Role */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>{t('dash.agentNameLabel')}</label>
            <input
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              placeholder={draft.role ? getDefaultName(draft.role) : t('dash.agentNamePlaceholder')}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#F0ECE3'; }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>{t('dash.agentRoleLabel')}</label>
            <input
              value={draft.role}
              onChange={e => update('role', e.target.value)}
              placeholder={t('dash.agentRolePlaceholder')}
              style={{ ...inputStyle, ...readOnlyInputStyle }}
              disabled={locked}
              readOnly={locked}
              onFocus={e => { if (!locked) { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; } }}
              onBlur={e => { if (!locked) { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#F0ECE3'; } }}
            />
          </div>
        </div>

        {/* Row 2: Model */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>{t('dash.modelLabel')}</label>
          <select
            value={modelId}
            onChange={e => update('model', e.target.value)}
            style={{
              ...inputStyle, paddingRight: 34, cursor: 'pointer', appearance: 'none',
              backgroundImage: selectBgImage,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = `#fff ${selectBgImage} no-repeat right 12px center`; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = `#F0ECE3 ${selectBgImage} no-repeat right 12px center`; }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Row 3: Path */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>{t('dash.pathLabel')}</label>
          {locked ? (
            <div style={{ ...inputStyle, ...readOnlyInputStyle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {draft.cwd || '—'}
            </div>
          ) : (
            <FolderPicker
              value={draft.cwd}
              onChange={value => update('cwd', value)}
            />
          )}
        </div>

        {/* Row 4: Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>{t('dash.instructions')}</label>
          <textarea
            value={draft.instructions}
            onChange={e => update('instructions', e.target.value)}
            placeholder={t('dash.instructionsPlaceholder')}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 52, lineHeight: 1.5 }}
            onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#F0ECE3'; }}
          />
        </div>

        {/* Footer: delete link or locked hint */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {locked ? (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: '#9AA0AA', letterSpacing: 0.5,
            }}>
              {lockedHint || '🔒 Siempre presente'}
            </span>
          ) : (
            <button
              onClick={onDelete}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: '#D85A30', background: 'none', border: 'none',
                cursor: 'pointer', opacity: 0.65, padding: 0,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.65'; }}
            >
              ✕ {t('dash.removeAgent')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
