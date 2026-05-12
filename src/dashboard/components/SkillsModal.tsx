// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE B-3 (v0.3.0): minimal CRUD UI for the per-project skills under
// ~/.zaipex-acc/projects/<id>/skills/. KISS — no markdown preview, no
// rich editor, just a textarea. Skills are concatenated into every
// agent's system prompt at boot (see src/shared/skills.ts).

import { useEffect, useState } from 'react';
import { t } from '../../shared/i18n/browser';
import {
  listSkills, getSkill, saveSkill, deleteSkill,
  listSkillExamples,
  type SkillFileMeta, type SkillExample,
} from '../lib/api';

const SKILL_FILENAME_RE = /^[a-zA-Z0-9_-]+\.md$/;
const MAX_TOTAL_BYTES = 8 * 1024;

interface SkillsModalProps {
  projectId: string;
  peerId: string;
  onClose: () => void;
}

export default function SkillsModal({ projectId, peerId, onClose }: SkillsModalProps) {
  const [files, setFiles] = useState<SkillFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state. `editing` is the filename being edited (empty string
  // for "new"); null means the empty list / picker view.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftFilename, setDraftFilename] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);

  // B-4 v0.3.4 — examples subview. When `showExamples` is true the
  // modal renders the curated starter skills (loaded lazily on first
  // open) instead of the editor or the list. Copying one calls the
  // same saveSkill endpoint as the editor, then drops back to the list.
  const [showExamples, setShowExamples] = useState(false);
  const [examples, setExamples] = useState<SkillExample[]>([]);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await listSkills(projectId, peerId);
      setFiles(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [projectId, peerId]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function startNew() {
    setEditing('');
    setDraftFilename('');
    setDraftContent('');
  }

  async function startEdit(filename: string) {
    setEditing(filename);
    setDraftFilename(filename);
    try {
      const resp = await getSkill(projectId, peerId, filename);
      setDraftContent(resp.content);
    } catch (e) {
      setError((e as Error).message);
      setEditing(null);
    }
  }

  function cancelEdit() {
    setEditing(null);
    setDraftFilename('');
    setDraftContent('');
  }

  async function commitSave() {
    if (!SKILL_FILENAME_RE.test(draftFilename)) {
      setError(t('dash.skillsFilenameInvalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSkill(projectId, peerId, draftFilename, draftContent);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function openExamples() {
    setShowExamples(true);
    setError(null);
    setCopiedToast(null);
    if (examples.length > 0) return;
    setExamplesLoading(true);
    try {
      const list = await listSkillExamples();
      setExamples(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExamplesLoading(false);
    }
  }

  function closeExamples() {
    setShowExamples(false);
    setCopiedToast(null);
  }

  async function copyExample(ex: SkillExample) {
    setCopying(ex.filename);
    setError(null);
    try {
      await saveSkill(projectId, peerId, ex.filename, ex.content);
      setCopiedToast(ex.filename);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopying(null);
    }
  }

  async function commitDelete(filename: string) {
    // Use a plain confirm dialog — KISS. The CLAUDE-in-Chrome warning
    // about modals doesn't apply to the user's browser.
     
    if (!confirm(t('dash.skillsDeleteConfirm', { filename }))) return;
    try {
      await deleteSkill(projectId, peerId, filename);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const overBudget = totalBytes > MAX_TOTAL_BYTES;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--z-navy-dark)', borderRadius: 16, padding: 28,
          width: 'min(720px, 92vw)',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          color: 'var(--z-text)',
          border: '1px solid var(--z-border)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t('dash.skillsTitle')}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--z-border)',
              color: 'var(--z-text-secondary)', fontSize: 12,
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            }}
          >
            {t('dash.skillsClose')}
          </button>
        </div>

        {error && (
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 12,
            background: 'rgba(216,90,48,0.12)',
            border: '1px solid rgba(216,90,48,0.4)',
            color: '#D85A30', fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {/* Examples subview (takes precedence when toggled) */}
        {showExamples ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                {t('dash.skillsExamplesTitle')}
              </h3>
              <button
                onClick={closeExamples}
                style={{
                  background: 'none', border: '1px solid var(--z-border)',
                  color: 'var(--z-text-secondary)', fontSize: 12,
                  padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                {t('dash.skillsExamplesBack')}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--z-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {t('dash.skillsExamplesIntro')}
            </p>

            {copiedToast && (
              <div style={{
                padding: 8, borderRadius: 6,
                background: 'rgba(46,160,67,0.12)',
                border: '1px solid rgba(46,160,67,0.4)',
                color: '#2EA047', fontSize: 12,
              }}>
                {t('dash.skillsCopied')} ({copiedToast})
              </div>
            )}

            {examplesLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--z-text-muted)' }}>…</div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {examples.map(ex => {
                  const alreadyExists = files.some(f => f.filename === ex.filename);
                  return (
                    <div
                      key={ex.filename}
                      style={{
                        padding: 12, borderRadius: 8,
                        background: 'var(--z-navy-deep)',
                        border: '1px solid var(--z-border)',
                        display: 'flex', flexDirection: 'column', gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--z-text)' }}>
                            {ex.filename}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--z-text-muted)' }}>
                            {ex.description}
                          </span>
                        </div>
                        <button
                          onClick={() => void copyExample(ex)}
                          disabled={copying !== null || alreadyExists}
                          style={{
                            background: alreadyExists ? 'var(--z-navy-dark)' : 'var(--z-orange)',
                            border: alreadyExists ? '1px solid var(--z-border)' : 'none',
                            color: alreadyExists ? 'var(--z-text-muted)' : '#fff',
                            fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                            padding: '6px 12px', borderRadius: 6,
                            cursor: (copying !== null || alreadyExists) ? 'default' : 'pointer',
                            opacity: copying === ex.filename ? 0.6 : 1,
                          }}
                        >
                          {copying === ex.filename
                            ? t('dash.skillsCopying')
                            : alreadyExists
                              ? `✓ ${ex.filename}`
                              : t('dash.skillsCopyToTeam')}
                        </button>
                      </div>
                      <pre style={{
                        margin: 0, padding: 10, borderRadius: 6,
                        background: 'var(--z-navy-darkest, #0b1220)',
                        color: 'var(--z-text-secondary)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        lineHeight: 1.5,
                        maxHeight: 180, overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        border: '1px solid var(--z-border)',
                      }}>
                        {ex.content}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : editing !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
            <label style={{ fontSize: 12, color: 'var(--z-text-secondary)' }}>
              {t('dash.skillsFilenameLabel')}
            </label>
            <input
              type="text"
              value={draftFilename}
              onChange={e => setDraftFilename(e.target.value)}
              placeholder={t('dash.skillsFilenamePlaceholder')}
              disabled={editing !== ''}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 13,
                padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--z-border)',
                background: 'var(--z-navy-deep)',
                color: 'var(--z-text)',
              }}
            />

            <label style={{ fontSize: 12, color: 'var(--z-text-secondary)', marginTop: 6 }}>
              {t('dash.skillsContentLabel')}
            </label>
            <textarea
              value={draftContent}
              onChange={e => setDraftContent(e.target.value)}
              placeholder={t('dash.skillsContentPlaceholder')}
              rows={14}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 13,
                padding: '10px 12px', borderRadius: 6,
                border: '1px solid var(--z-border)',
                background: 'var(--z-navy-deep)',
                color: 'var(--z-text)',
                resize: 'vertical',
                minHeight: 200,
                flex: 1,
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{
                  background: 'none', border: '1px solid var(--z-border)',
                  color: 'var(--z-text-secondary)', fontSize: 12,
                  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                {t('dash.skillsCancel')}
              </button>
              <button
                onClick={() => void commitSave()}
                disabled={saving || draftFilename.length === 0}
                style={{
                  background: 'var(--z-orange)', border: 'none',
                  color: '#fff', fontSize: 12,
                  padding: '6px 14px', borderRadius: 6,
                  cursor: saving ? 'wait' : 'pointer',
                  opacity: (saving || draftFilename.length === 0) ? 0.5 : 1,
                }}
              >
                {saving ? '…' : t('dash.save')}
              </button>
            </div>
          </div>
        ) : (
          // List view
          <>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--z-text-muted)' }}>…</div>
            ) : files.length === 0 ? (
              <div style={{
                padding: 24, fontSize: 13, color: 'var(--z-text-secondary)',
                background: 'var(--z-navy-deep)', borderRadius: 8,
                lineHeight: 1.55,
              }}>
                {t('dash.skillsEmpty')}
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {files.map(f => (
                  <div
                    key={f.filename}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 6,
                      background: 'var(--z-navy-deep)',
                      border: '1px solid var(--z-border)',
                    }}
                  >
                    <div
                      onClick={() => void startEdit(f.filename)}
                      style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--z-text)' }}>
                        {f.filename}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-muted)' }}>
                        {f.size} B
                      </span>
                    </div>
                    <button
                      onClick={() => void commitDelete(f.filename)}
                      style={{
                        background: 'none', border: '1px solid rgba(216,90,48,0.4)',
                        color: '#D85A30', fontSize: 11,
                        padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      {t('dash.skillsDelete')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 12, fontSize: 11,
              color: overBudget ? '#D85A30' : 'var(--z-text-muted)',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {overBudget
                  ? t('dash.skillsSizeOver')
                  : t('dash.skillsSizeUsed', { used: totalBytes, budget: MAX_TOTAL_BYTES })}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => void openExamples()}
                  style={{
                    background: 'none',
                    border: '1px solid var(--z-border)',
                    color: 'var(--z-text-secondary)', fontSize: 12,
                    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  {t('dash.skillsExamples')}
                </button>
                <button
                  onClick={startNew}
                  style={{
                    background: 'var(--z-orange)', border: 'none',
                    color: '#fff', fontSize: 12, fontWeight: 500,
                    padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  {t('dash.skillsNew')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
