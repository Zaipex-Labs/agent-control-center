// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { presetValue, fileToAvatarDataUrl, resolveAvatarSrc, generateRandomSeeds, extractSeed } from '../lib/avatar';
import { t } from '../../shared/i18n/browser';

const PRESET_COUNT = 8;

interface AvatarPickerProps {
  value: string | undefined | null;
  fallbackSeed: string;
  onChange: (value: string) => void;
}

export default function AvatarPicker({ value, fallbackSeed, onChange }: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rollToken, setRollToken] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Current selection (if it's a preset OR the implicit fallback) goes first
  // so it stays visible after opening the panel. Remaining slots are filled
  // with fresh random seeds each time the picker opens or the refresh button
  // is clicked. If the user uploaded an image (data URL), nothing is anchored.
  const explicitSeed = extractSeed(value);
  const isUpload = !!value && !explicitSeed;
  const anchorSeed = explicitSeed ?? (isUpload ? null : fallbackSeed);
  const seeds = useMemo<string[]>(() => {
    const random = generateRandomSeeds(PRESET_COUNT - (anchorSeed ? 1 : 0));
    return anchorSeed ? [anchorSeed, ...random] : random;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollToken, anchorSeed]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError(t('dash.avatarInvalidFile'));
      return;
    }
    const dataUrl = await fileToAvatarDataUrl(file);
    if (!dataUrl) {
      setUploadError(t('dash.avatarInvalidFile'));
      return;
    }
    onChange(dataUrl);
    setOpen(false);
  };

  const currentSrc = resolveAvatarSrc(value, fallbackSeed);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {/* Current avatar preview — click to expand */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('dash.changeAvatar')}
        style={{
          width: 56, height: 56, borderRadius: 12,
          border: open ? '2px solid #E8823A' : '2px solid #D0C9BE',
          padding: 0, overflow: 'hidden', cursor: 'pointer',
          background: '#fff', flexShrink: 0,
          transition: 'border-color 0.15s',
        }}
      >
        <img src={currentSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </button>

      {open && (
        <div style={{
          flex: 1, background: '#FAFAF8', border: '1px solid #E2DDD4',
          borderRadius: 10, padding: 12,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#5A6272',
              textTransform: 'uppercase', letterSpacing: 0.6,
            }}>
              {t('dash.avatarPresets')}
            </span>
            <button
              type="button"
              onClick={() => setRollToken(n => n + 1)}
              title={t('dash.avatarShuffle')}
              aria-label={t('dash.avatarShuffle')}
              style={{
                background: 'none', border: '1px solid #D0C9BE', borderRadius: 6,
                padding: '3px 10px', fontSize: 12, color: '#5A6272',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 13 }}>↻</span>
              {t('dash.avatarShuffle')}
            </button>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6,
            marginBottom: 12,
          }}>
            {seeds.map((seed, idx) => {
              const presetVal = presetValue(seed);
              const selected = value
                ? value === presetVal
                : seed === fallbackSeed;
              const src = resolveAvatarSrc(presetVal, seed);
              return (
                <button
                  key={`${seed}-${idx}`}
                  type="button"
                  onClick={() => { onChange(presetVal); setOpen(false); }}
                  title={seed}
                  style={{
                    padding: 0, width: '100%', aspectRatio: '1 / 1',
                    borderRadius: 8, overflow: 'hidden',
                    border: selected ? '2px solid #E8823A' : '1px solid #D0C9BE',
                    background: '#fff', cursor: 'pointer',
                  }}
                >
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              );
            })}
          </div>

          {/* FASE D (v0.3.2). Free-text seed: any string the user types
              maps to dicebear:<seed> live. Helpful when the preset grid's
              random seeds don't surface anything memorable and the user
              wants a deterministic, recognizable handle (a project
              codename, the agent's nickname, their cat's name…). */}
          <SeedInput value={extractSeed(value)} onChange={seed => onChange(seed ? presetValue(seed) : '')} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                background: '#fff', border: '1px solid #D0C9BE', borderRadius: 8,
                padding: '6px 12px', fontSize: 12, color: '#5A6272',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {t('dash.avatarUpload')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])}
            />
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{
                  background: 'none', border: 'none', color: '#8AA8C0',
                  fontSize: 12, cursor: 'pointer', padding: '6px 4px',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {t('dash.avatarReset')}
              </button>
            )}
          </div>
          {uploadError && (
            <div style={{ fontSize: 11, color: '#DC3C3C', marginTop: 6 }}>
              {uploadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// FASE D (v0.3.2). Free-text seed editor with a live thumbnail. The
// input keeps its own draft string so the user can blank it and retype
// without losing focus on every keystroke — onChange to the parent
// fires for every visible state, but the local draft drives the
// thumbnail (resolveAvatarSrc is cheap; the dicebear bottts cache
// dedupes repeat seeds).
interface SeedInputProps {
  value: string | null;
  onChange: (seed: string) => void;
}

function SeedInput({ value, onChange }: SeedInputProps) {
  const [draft, setDraft] = useState(value ?? '');
  // Pull external value changes into the input. The preset grid and the
  // shuffle button both write through `onChange` upstream, so the seed
  // field should reflect whatever was picked.
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const previewSrc = resolveAvatarSrc(
    draft ? presetValue(draft) : null,
    draft || 'default',
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 10,
      padding: 8, borderRadius: 8,
      background: '#F5F1E8', border: '1px solid #E2DDD4',
    }}>
      <img
        src={previewSrc}
        alt=""
        style={{
          width: 40, height: 40, borderRadius: 8,
          flexShrink: 0,
          background: '#fff',
          border: '1px solid #D0C9BE',
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={{
          fontSize: 10, fontWeight: 600, color: '#9AA0AA',
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          {t('dash.avatarSeedLabel')}
        </label>
        <input
          type="text"
          value={draft}
          onChange={e => {
            const next = e.target.value;
            setDraft(next);
            onChange(next.trim());
          }}
          placeholder={t('dash.avatarSeedPlaceholder')}
          spellCheck={false}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 12,
            padding: '6px 8px', borderRadius: 6,
            border: '1px solid #D0C9BE', background: '#fff',
            color: '#1E2D40', outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#D0C9BE'; }}
        />
      </div>
    </div>
  );
}
