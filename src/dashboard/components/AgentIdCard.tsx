// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState, type CSSProperties } from 'react';
import Avatar from './Avatar';
import AvatarPicker from './AvatarPicker';
import FolderPicker from './FolderPicker';
import { MODELS, getModelLabel, getModelProvider, PROVIDER_DOTS, DEFAULT_MODEL_ID } from '../lib/models';
import { roleStyle } from '../lib/roles';
import { getDefaultName } from '../../shared/names';
import { t } from '../../shared/i18n/browser';
import type { Power } from '../lib/types';

export interface AgentDraft {
  role: string;
  name: string;
  cwd: string;
  instructions: string;
  avatar: string;
  model: string;
  // FASE A-3 (v0.3.2). Canonical power names the user has toggled on.
  // Empty array when none — the broker omits the field from the
  // persisted JSON in that case.
  powers: string[];
}

interface AgentIdCardProps {
  draft: AgentDraft;
  status?: 'online' | 'offline';
  project: string;
  onChange: (next: AgentDraft) => void;
  onDelete: () => void;
  duplicateAvatar?: boolean;
  locked?: boolean;
  lockedHint?: string;
  // FASE A-3 (v0.3.2). Public-projection power list loaded once by
  // the parent (TeamsPage). Empty when /api/powers fails or hasn't
  // resolved yet — the powers section hides itself in that case.
  availablePowers?: Power[];
}

const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#5A6272',
  display: 'flex', alignItems: 'center', gap: 6,
};

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1E2D40',
  background: '#F0ECE3', border: '1px solid #DDD5C8',
  borderRadius: 8, padding: '9px 12px', outline: 'none',
  width: '100%', transition: 'border-color 0.2s, background 0.2s',
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: 1.5, color: '#9AA0AA',
  marginBottom: 2,
};

export default function AgentIdCard({
  draft, status = 'offline', project,
  onChange, onDelete, duplicateAvatar,
  locked = false, lockedHint,
  availablePowers = [],
}: AgentIdCardProps) {
  const [focused, setFocused] = useState(false);

  const readOnlyInputStyle: CSSProperties = locked ? {
    opacity: 0.7, cursor: 'not-allowed', background: '#E8E3D8',
  } : {};

  const update = <K extends keyof AgentDraft>(field: K, value: AgentDraft[K]) =>
    onChange({ ...draft, [field]: value });

  const style = roleStyle(draft.role);
  const displayName = (draft.name || '').trim() || getDefaultName(draft.role || 'agent');
  const modelId = draft.model || DEFAULT_MODEL_ID;
  const modelLabel = getModelLabel(modelId);
  const provider = getModelProvider(modelId);
  const projectBase = project
    ? project
    : draft.cwd.split('/').filter(Boolean).pop() ?? '';

  return (
    <div style={{
      display: 'flex', borderRadius: 16, overflow: 'hidden',
      border: `1px solid ${focused ? '#4A9FE8' : '#DDD5C8'}`,
      background: '#FAF7F1',
      boxShadow: focused ? '0 0 0 3px rgba(74,159,232,0.12)' : 'none',
      transition: 'border-color 0.25s, box-shadow 0.25s',
    }}>
      {/* ── ID Badge (left) ── */}
      <div style={{
        width: 220, flexShrink: 0,
        padding: '24px 20px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center',
        borderRight: '1px dashed #DDD5C8',
        position: 'relative',
        background: '#F7F4EE',
      }}>
        {/* Perforación decorativa */}
        <span style={{
          position: 'absolute', right: -8, top: '30%',
          width: 16, height: 16, borderRadius: '50%',
          background: '#F0ECE3',
        }} />
        <span style={{
          position: 'absolute', right: -8, bottom: '30%',
          width: 16, height: 16, borderRadius: '50%',
          background: '#F0ECE3',
        }} />

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          textTransform: 'uppercase', letterSpacing: 2, color: '#9AA0AA',
          marginBottom: 14, paddingBottom: 8,
          borderBottom: '1px solid #E8E3D8', width: '100%',
        }}>
          {t('dash.agentIdHeader')}
        </div>

        {/* Avatar picker (acts as both preview and editor) */}
        <div style={{ marginBottom: 14 }}>
          <Avatar
            avatar={draft.avatar}
            seed={displayName || draft.role || 'agent'}
            size={72}
            background={style.avatar}
            title={`${displayName} (${draft.role})`}
          />
        </div>

        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 20,
          color: '#1E2D40', marginBottom: 4,
          maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName}
        </div>

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: 1,
          padding: '3px 12px', borderRadius: 20,
          background: style.badgeBg, color: style.badgeFg,
          marginBottom: 12,
          maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {draft.role || '—'}
        </div>

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: '#5A6272', background: '#E8E3D8',
          padding: '3px 10px', borderRadius: 12,
          marginBottom: 14,
          maxWidth: 180,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: PROVIDER_DOTS[provider], flexShrink: 0,
          }} />
          {modelLabel}
        </div>

        <div style={{
          width: '100%', borderTop: '1px solid #E8E3D8',
          paddingTop: 12, marginTop: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9AA0AA', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('dash.idStatus')}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#1E2D40', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: status === 'online' ? '#3DBA7A' : '#C0BDB5',
              }} />
              {status === 'online' ? t('dash.online').toLowerCase() : t('dash.offline')}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9AA0AA', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('dash.idProject')}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: '#1E2D40', fontWeight: 500,
              maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={projectBase}>
              {projectBase || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Config panel (right) ── */}
      <div style={{
        flex: 1, padding: 24,
        display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0,
      }}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
      >
        <div style={sectionTitleStyle}>{t('dash.agentConfigHeader')}</div>

        {/* Row 1: Name + Role */}
        <div style={{ display: 'flex', gap: 12 }}>
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
              ...inputStyle,
              paddingRight: 36, cursor: 'pointer', appearance: 'none',
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6272' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6272' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 12px center"; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = "#F0ECE3 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6272' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 12px center"; }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Row 3: Avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>{t('dash.changeAvatar')}</label>
          <AvatarPicker
            value={draft.avatar}
            fallbackSeed={displayName || draft.role || 'agent'}
            onChange={value => update('avatar', value)}
          />
          {duplicateAvatar && (
            <div style={{ fontSize: 11, color: '#E8823A', marginTop: 2 }}>
              {t('dash.avatarDuplicate')}
            </div>
          )}
        </div>

        {/* Row 4: Path */}
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

        {/* Row 4.5: Powers (FASE A-3 v0.3.2) — multi-check selector. */}
        {availablePowers.length > 0 && (
          <PowersField
            value={draft.powers}
            available={availablePowers}
            disabled={locked}
            onChange={next => update('powers', next)}
          />
        )}

        {/* Row 5: Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>{t('dash.instructions')}</label>
          <textarea
            value={draft.instructions}
            onChange={e => update('instructions', e.target.value)}
            placeholder={t('dash.instructionsPlaceholder')}
            // v0.3.2.1 MED-1: rows bumped from 3 → 6 so the Tech Lead's
            // long pre-filled instructions don't force the user to wheel
            // through internal scroll to reach the Save button. Modal-level
            // `overscroll-behavior: contain` (TeamsPage.tsx) keeps things
            // tidy; textarea stays on default `auto` so wheel chains to
            // the modal once content edge is reached.
            rows={6}
            style={{
              ...inputStyle, resize: 'vertical', minHeight: 96, lineHeight: 1.5,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#F0ECE3'; }}
          />
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 12, borderTop: '1px solid #EEE8DD', marginTop: 'auto',
        }}>
          {locked ? (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: '#9AA0AA', letterSpacing: 0.5,
            }}>
              {lockedHint || '🔒 Siempre presente — coordinador del equipo'}
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

// ── PowersField (FASE A-3 v0.3.2) ───────────────────────────────
//
// Each power renders as a single checkbox + label. When the user
// toggles a power on, any requiredEnv hint appears beneath the row
// — the spawner still resolves env vars at boot time, but surfacing
// the hint here lets the user fix the export before they hit
// "Encender".
//
// Inline (rather than a separate file) because it's only consumed
// by this card and lives entirely on the dashboard side.

interface PowersFieldProps {
  value: string[];
  available: Power[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}

function PowersField({ value, available, disabled, onChange }: PowersFieldProps) {
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
                <span style={{ color: '#5A6272', fontSize: 12 }}>
                  {p.description}
                </span>
              </label>
              {selected && p.requiredEnv.length > 0 && (
                <span style={{
                  marginLeft: 22,
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: '#A35F2A',
                }}>
                  {t('dash.powersRequires', { vars: p.requiredEnv.join(', ') })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
