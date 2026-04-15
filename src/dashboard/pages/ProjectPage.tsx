import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgents } from '../hooks/useAgents';
import { useThreads } from '../hooks/useThreads';
import { useMessages } from '../hooks/useMessages';
import { useDashboardPeer } from '../hooks/useDashboardPeer';
import Chat from '../components/Chat';
import Compose from '../components/Compose';
import SharedStatePanel from '../components/SharedStatePanel';
import AgentTerminalView from '../components/AgentTerminalView';
import AgentDesk, { type DeskState } from '../components/AgentDesk';
import EmptyOffice from '../components/EmptyOffice';
import DeskPapers from '../components/DeskPapers';
import { projectUp, projectDown, saveResume } from '../lib/api';
import type { Peer, Thread, LogEntry } from '../lib/types';
import { t } from '../../shared/i18n/browser';
import { roleStyle } from '../lib/roles';
import { getDefaultName } from '../../shared/names';

// How recent a peer's last outbound message has to be to flip its desk
// state from "waiting" to "working".
const WORKING_WINDOW_MS = 45_000;

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { agents } = useAgents(projectId);
  const dashboardId = useDashboardPeer(projectId);
  const { threads, activeThread, setActiveThread, createThread, deleteThread } = useThreads(projectId);
  const [deletingThread, setDeletingThread] = useState<Thread | null>(null);
  const { messages, loading: messagesLoading, sendMessage, waitingFor, sendError, clearError, retrySend } = useMessages(projectId, activeThread?.id, dashboardId, activeThread?.name);
  const [creatingThread, setCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [sharedRefresh, setSharedRefresh] = useState(0);
  // Persist open terminal tabs per project so they survive a page reload.
  // The underlying agent processes keep running in the broker regardless —
  // this just restores which tabs the dashboard was showing.
  const terminalStorageKey = projectId ? `acc.terminals.${projectId}` : null;
  const [terminalTabs, setTerminalTabs] = useState<Array<{ role: string; name: string }>>(() => {
    if (!terminalStorageKey) return [];
    try {
      const stored = localStorage.getItem(terminalStorageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!terminalStorageKey) return;
    try {
      localStorage.setItem(terminalStorageKey, JSON.stringify(terminalTabs));
    } catch {
      // localStorage unavailable — ignore
    }
  }, [terminalStorageKey, terminalTabs]);
  const [powering, setPowering] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null);
  const flashClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);

  // "Dirty" means there is agent activity the user hasn't explicitly saved
  // yet. The latest message in the feed is compared against lastSavedAt.
  // Once the user saves, dirty goes false until a new message arrives.
  const latestMessageAt = useMemo(() => {
    if (messages.length === 0) return 0;
    return new Date(messages[messages.length - 1].sent_at).getTime();
  }, [messages]);
  const isDirty = latestMessageAt > (lastSavedAt ?? 0);

  // Click a paper in the work desk → find the most recent message whose
  // text mentions that file path and flash it in the chat feed.
  const handleOpenPath = (path: string) => {
    const base = path.split('/').pop() ?? path;
    // Scan from newest to oldest so we land on the most recent mention.
    let match: typeof messages[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messages[i].text;
      if (text.includes(path) || text.includes(base)) {
        match = messages[i];
        break;
      }
    }
    if (!match) {
      setStatusMsg({ text: t('dash.noMentionFound', { path: base }), type: 'err' });
      setTimeout(() => setStatusMsg(null), 3000);
      return;
    }
    if (flashClearTimer.current) clearTimeout(flashClearTimer.current);
    setFlashMessageId(match.id);
    flashClearTimer.current = setTimeout(() => setFlashMessageId(null), 1800);
  };

  const terminalRoles = new Set(terminalTabs.map(t => t.role));

  const handleAgentClick = (peer: Peer) => {
    if (terminalRoles.has(peer.role)) {
      setTerminalTabs(prev => prev.filter(t => t.role !== peer.role));
    } else {
      setTerminalTabs(prev => [...prev, { role: peer.role, name: peer.name || peer.role }]);
    }
  };

  const activeCount = agents.length;

  // Per-role "working" flag derived from recent outbound messages. A role
  // counts as working if any agent of that role has sent something in the
  // last WORKING_WINDOW_MS.
  const workingRoles = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const m of messages) {
      if (!m.from_role || m.from_role === 'user') continue;
      if (now - new Date(m.sent_at).getTime() < WORKING_WINDOW_MS) set.add(m.from_role);
    }
    return set;
  }, [messages]);

  const deskStateFor = (peer: Peer): DeskState => {
    if (workingRoles.has(peer.role)) return 'working';
    return 'waiting';
  };

  // Derive a simple activity timeline from the last N messages for the
  // right-side context panel.
  const timelineItems = useMemo<LogEntry[]>(() => messages.slice(-6).reverse(), [messages]);
  const contractCount = useMemo(
    () => messages.filter(m => m.type === 'contract_update').length,
    [messages],
  );
  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return messages.filter(m => new Date(m.sent_at).toDateString() === today).length;
  }, [messages]);
  const activeTimeLabel = useMemo(() => {
    if (agents.length === 0) return '--';
    const earliest = agents.reduce((min, p) => p.registered_at < min ? p.registered_at : min, agents[0].registered_at);
    const ms = Date.now() - new Date(earliest).getTime();
    const hrs = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }, [agents]);

  const handlePowerUp = async () => {
    if (!projectId || powering) return;
    setPowering(true);
    setStatusMsg(null);
    try {
      const result = await projectUp(projectId);
      setStatusMsg({ text: t('dash.teamPoweredOn', { agents: result.agents, strategy: result.strategy }), type: 'ok' });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e) {
      setStatusMsg({ text: t('dash.error', { error: e instanceof Error ? e.message : String(e) }), type: 'err' });
    } finally {
      setPowering(false);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (!projectId || saving) return false;
    setSaving(true);
    setStatusMsg(null);
    try {
      await saveResume(projectId);
      setLastSavedAt(Date.now());
      setStatusMsg({ text: t('dash.savedToastShort'), type: 'ok' });
      setTimeout(() => setStatusMsg(null), 2500);
      return true;
    } catch (e) {
      setStatusMsg({ text: t('dash.saveFailed') + ': ' + (e instanceof Error ? e.message : String(e)), type: 'err' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const doShutdown = async () => {
    if (!projectId) return;
    setStatusMsg(null);
    try {
      const result = await projectDown(projectId);
      setTerminalTabs([]);
      setStatusMsg({ text: t('dash.teamPoweredOff', { killed: result.killed }), type: 'ok' });
      // Back to the home (oficinas) once shutdown completes.
      setTimeout(() => navigate('/'), 600);
    } catch (e) {
      setStatusMsg({ text: t('dash.error', { error: e instanceof Error ? e.message : String(e) }), type: 'err' });
    }
  };

  const handleShutdown = () => {
    if (isDirty) {
      setShutdownConfirm(true);
    } else {
      void doShutdown();
    }
  };

  const handleSaveAndShutdown = async () => {
    setShutdownConfirm(false);
    const ok = await handleSave();
    if (ok) await doShutdown();
  };

  const handleShutdownWithoutSaving = async () => {
    setShutdownConfirm(false);
    await doShutdown();
  };

  const handleCreateThread = async () => {
    if (!creatingThread) {
      setCreatingThread(true);
      return;
    }
    const name = newThreadName.trim();
    if (!name) return;
    await createThread(name);
    setNewThreadName('');
    setCreatingThread(false);
  };

  return (
    <div style={{
      height: '100vh', background: 'var(--z-navy-dark)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* ── Top nav ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', height: 52,
        background: 'var(--z-navy-deep)',
        borderBottom: '1px solid var(--z-border)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            background: 'none', border: 'none', color: 'var(--z-text-secondary)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            padding: 0, transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#E8823A'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--z-text-secondary)'; }}
        >
          ← {t('dash.teams')}
        </button>

        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 400,
          color: 'var(--z-text)',
        }}>
          {projectId}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            padding: '4px 10px', borderRadius: 12, letterSpacing: 0.5,
            background: activeCount > 0 ? 'rgba(61,186,122,0.15)' : 'rgba(90,98,114,0.15)',
            color: activeCount > 0 ? 'var(--z-green)' : 'var(--z-text-muted)',
          }}>
            {activeCount === 1 ? t('dash.agentsActive', { count: activeCount }) : t('dash.agentsActivePlural', { count: activeCount })}
          </span>
          {isDirty && (
            <span
              title={t('dash.dirty')}
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#E8823A',
                boxShadow: '0 0 6px rgba(232,130,58,0.6)',
                marginRight: 2,
              }}
            />
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving || !isDirty}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              padding: '5px 12px', borderRadius: 6,
              border: '1px solid rgba(61,186,122,0.4)',
              background: isDirty ? 'rgba(61,186,122,0.12)' : 'transparent',
              color: isDirty ? 'var(--z-green)' : 'var(--z-text-muted)',
              cursor: saving ? 'wait' : (isDirty ? 'pointer' : 'default'),
              opacity: !isDirty ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (isDirty && !saving) { e.currentTarget.style.background = 'rgba(61,186,122,0.22)'; } }}
            onMouseLeave={e => { if (isDirty && !saving) { e.currentTarget.style.background = 'rgba(61,186,122,0.12)'; } }}
          >
            {saving ? '…' : t('dash.save')}
          </button>
          <button
            onClick={() => { setShowSidebar(v => !v); setSharedRefresh(n => n + 1); }}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              padding: '5px 12px', borderRadius: 6,
              border: '1px solid var(--z-border)',
              background: showSidebar ? 'rgba(74,159,232,0.08)' : 'transparent',
              color: 'var(--z-text-secondary)', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; e.currentTarget.style.color = 'var(--z-text-secondary)'; }}
          >
            {t('dash.panel')}
          </button>
          <button
            onClick={handleShutdown}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              padding: '5px 12px', borderRadius: 6,
              border: '1px solid rgba(216,90,48,0.4)',
              background: 'transparent', color: '#D85A30',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(216,90,48,0.1)'; e.currentTarget.style.borderColor = '#D85A30'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(216,90,48,0.4)'; }}
          >
            {t('dash.shutdown')}
          </button>
        </div>
      </nav>

      {/* ── Body: 3 columns ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ══════════ LEFT SIDEBAR ══════════ */}
        <aside style={{
          width: 240, flexShrink: 0,
          background: 'var(--z-navy-deep)',
          borderRight: '1px solid var(--z-border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Agents section */}
          <SidebarSection title={t('dash.agents')} />
          <div style={{ padding: '0 8px', flex: '0 0 auto', overflowY: 'auto', maxHeight: '40%' }}>
            {agents.length === 0 ? (
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--z-text-muted)', padding: '12px 14px',
              }}>
                {t('dash.noActiveAgents')}
              </div>
            ) : (
              agents.map(peer => (
                <AgentRow
                  key={peer.id}
                  peer={peer}
                  state={deskStateFor(peer)}
                  selected={terminalRoles.has(peer.role)}
                  onClick={() => handleAgentClick(peer)}
                />
              ))
            )}
          </div>

          {/* Threads section */}
          <div style={{ borderTop: '1px solid var(--z-border)', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <div style={{
              padding: '12px 16px 8px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                textTransform: 'uppercase', letterSpacing: 1.5,
                color: 'var(--z-text-muted)',
              }}>
                {t('dash.conversations')}
              </span>
              <button
                onClick={handleCreateThread}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                  background: 'rgba(232,130,58,0.12)',
                  border: '1px solid rgba(232,130,58,0.4)',
                  borderRadius: 6, padding: '4px 10px',
                  color: '#E8823A', cursor: 'pointer',
                  transition: 'all 0.15s', letterSpacing: 0.3,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E8823A'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(232,130,58,0.12)'; e.currentTarget.style.color = '#E8823A'; }}
              >
                + {t('dash.new').replace(/^\+\s*/, '')}
              </button>
            </div>
            {creatingThread && (
              <div style={{ padding: '0 8px 8px' }}>
                <input
                  autoFocus
                  value={newThreadName}
                  onChange={e => setNewThreadName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateThread(); if (e.key === 'Escape') { setCreatingThread(false); setNewThreadName(''); } }}
                  placeholder={t('dash.threadNamePlaceholder')}
                  style={{
                    width: '100%', background: 'var(--z-surface)',
                    border: '1px solid var(--z-border)', borderRadius: 8,
                    padding: '6px 10px', color: 'var(--z-text)', fontSize: 12,
                    fontFamily: 'var(--font-sans)', outline: 'none',
                  }}
                />
              </div>
            )}
            <div style={{ padding: '0 8px', overflowY: 'auto', flex: 1 }}>
              {threads.length === 0 ? (
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: 'var(--z-text-muted)', padding: '8px 14px',
                }}>
                  {t('dash.noConversations')}
                </div>
              ) : (
                threads
                  .filter(th => th.status === 'active')
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .map(th => (
                    <ThreadRow
                      key={th.id}
                      thread={th}
                      selected={activeThread?.id === th.id}
                      onClick={() => setActiveThread(th)}
                      onDelete={() => setDeletingThread(th)}
                    />
                  ))
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{ borderTop: '1px solid var(--z-border)', padding: '12px 16px' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              textTransform: 'uppercase', letterSpacing: 1.5,
              color: 'var(--z-text-muted)', marginBottom: 8,
            }}>
              {t('dash.teamActivity')}
            </div>
            <StatRow label={t('dash.messagesToday')} value={String(todayCount)} />
            <StatRow label={t('dash.contracts')} value={String(contractCount)} />
            <StatRow label={t('dash.activeTime')} value={activeTimeLabel} />
          </div>
        </aside>

        {/* ══════════ MAIN ══════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Status banner */}
          {statusMsg && (
            <div style={{
              padding: '8px 24px',
              background: statusMsg.type === 'ok' ? 'rgba(61,186,122,0.1)' : 'rgba(220,60,60,0.1)',
              borderBottom: `1px solid ${statusMsg.type === 'ok' ? 'rgba(61,186,122,0.25)' : 'rgba(220,60,60,0.25)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, color: statusMsg.type === 'ok' ? 'var(--z-green)' : '#DC3C3C' }}>
                {statusMsg.text}
              </span>
              <button onClick={() => setStatusMsg(null)} style={{
                background: 'none', border: 'none', color: 'var(--z-text-muted)',
                fontSize: 14, cursor: 'pointer', padding: '0 4px',
              }}>&times;</button>
            </div>
          )}

          {/* Feed + compose */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeThread ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Chat
                  messages={messages}
                  agents={agents}
                  loading={messagesLoading}
                  waitingFor={waitingFor}
                  sendError={sendError}
                  onRetry={retrySend}
                  onDismissError={clearError}
                  flashMessageId={flashMessageId}
                />
                <Compose agents={agents} onSend={sendMessage} />
              </div>
            ) : agents.length === 0 ? (
              <EmptyState
                icon="▶"
                message={t('dash.noActiveAgents')}
                action={{
                  label: powering ? t('dash.poweringUpShort') : t('dash.powerUpTeam'),
                  onClick: handlePowerUp,
                  disabled: powering,
                }}
              />
            ) : (
              <EmptyOffice onCreate={handleCreateThread} />
            )}

            {/* Terminal panel */}
            {terminalTabs.length > 0 && projectId && (
              <AgentTerminalView
                projectId={projectId}
                tabs={terminalTabs}
                onClose={() => setTerminalTabs([])}
              />
            )}
          </div>
        </div>

        {/* ══════════ RIGHT PANEL ══════════ */}
        {showSidebar && projectId && (
          <aside data-sidebar="right" style={{
            width: 260, flexShrink: 0,
            background: 'var(--z-navy-deep)',
            borderLeft: '1px solid var(--z-border)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            <RightPanelSection title={t('dash.workDesk')}>
              <DeskPapers projectId={projectId} refreshKey={sharedRefresh} onOpenPath={handleOpenPath} />
            </RightPanelSection>

            <RightPanelSection title={t('dash.sharedState')}>
              <SharedStatePanel projectId={projectId} refreshKey={sharedRefresh} />
            </RightPanelSection>

            <RightPanelSection title={t('dash.timeline')}>
              {timelineItems.length === 0 ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-muted)' }}>
                  {t('dash.noMessagesInThread')}
                </div>
              ) : (
                timelineItems.map((m, i) => (
                  <TimelineRow key={m.id ?? i} entry={m} last={i === timelineItems.length - 1} />
                ))
              )}
            </RightPanelSection>
          </aside>
        )}
      </div>

      {deletingThread && (
        <DeleteThreadModal
          thread={deletingThread}
          onCancel={() => setDeletingThread(null)}
          onConfirm={async () => {
            const id = deletingThread.id;
            setDeletingThread(null);
            try {
              await deleteThread(id);
            } catch (e) {
              setStatusMsg({ text: t('dash.errorDeleting', { error: e instanceof Error ? e.message : String(e) }), type: 'err' });
            }
          }}
        />
      )}

      {shutdownConfirm && (
        <UnsavedShutdownModal
          onCancel={() => setShutdownConfirm(false)}
          onSaveAndShutdown={handleSaveAndShutdown}
          onShutdownAnyway={handleShutdownWithoutSaving}
          saving={saving}
        />
      )}
    </div>
  );
}

function UnsavedShutdownModal({
  onCancel, onSaveAndShutdown, onShutdownAnyway, saving,
}: {
  onCancel: () => void;
  onSaveAndShutdown: () => void;
  onShutdownAnyway: () => void;
  saving: boolean;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--z-navy-dark)', borderRadius: 16, padding: 28,
          width: 480, border: '1px solid var(--z-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400,
          color: 'var(--z-text)', margin: '0 0 12px',
        }}>
          {t('dash.unsavedTitle')}
        </h2>
        <p style={{
          color: 'var(--z-text-secondary)', fontSize: 13, lineHeight: 1.55,
          margin: '0 0 24px',
        }}>
          {t('dash.unsavedBody')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onSaveAndShutdown}
            disabled={saving}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: '#3DBA7A', color: '#fff', border: 'none',
              padding: '11px 18px', borderRadius: 10,
              fontWeight: 500, cursor: saving ? 'wait' : 'pointer',
              transition: 'background 0.15s', opacity: saving ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = '#2EA568'; }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.background = '#3DBA7A'; }}
          >
            {t('dash.saveAndShutdown')}
          </button>
          <button
            onClick={onShutdownAnyway}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: 'transparent', color: '#D85A30',
              border: '1px solid rgba(216,90,48,0.45)',
              padding: '11px 18px', borderRadius: 10,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(216,90,48,0.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {t('dash.shutdownWithout')}
          </button>
          <button
            onClick={onCancel}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: 'none', border: '1px solid var(--z-border)',
              padding: '11px 18px', borderRadius: 10,
              color: 'var(--z-text-secondary)', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--z-text-secondary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; }}
          >
            {t('dash.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteThreadModal({
  thread, onCancel, onConfirm,
}: {
  thread: Thread;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--z-navy-dark)', borderRadius: 16, padding: 28,
          width: 440, border: '1px solid var(--z-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400,
          color: 'var(--z-text)', margin: '0 0 12px',
        }}>
          {t('dash.deleteThreadTitle', { name: thread.name })}
        </h2>
        <p style={{
          color: 'var(--z-text-secondary)', fontSize: 13, lineHeight: 1.55,
          margin: '0 0 24px',
        }}>
          {t('dash.deleteThreadBody')}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: 'none', border: '1px solid var(--z-border)', borderRadius: 8,
              padding: '10px 22px', color: 'var(--z-text-secondary)', cursor: 'pointer',
            }}
          >
            {t('dash.cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: '#D85A30', color: '#fff', border: 'none',
              padding: '10px 24px', borderRadius: 8,
              fontWeight: 500, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#B6411A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#D85A30'; }}
          >
            {t('dash.deleteThreadConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Little helpers for the workspace layout ──

function SidebarSection({ title }: { title: string }) {
  return (
    <div style={{ padding: '14px 16px 8px' }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        textTransform: 'uppercase', letterSpacing: 1.5,
        color: 'var(--z-text-muted)',
      }}>
        {title}
      </span>
    </div>
  );
}

function AgentRow({ peer, state, selected, onClick }: {
  peer: Peer;
  state: DeskState;
  selected: boolean;
  onClick: () => void;
}) {
  const displayName = peer.name || getDefaultName(peer.role);
  // peer.summary is the "what I'm currently doing" status line the agent
  // updates via set_summary. Fall back to role when empty.
  const statusLine = (peer.summary && peer.summary.trim()) || peer.role;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        marginBottom: 2, cursor: 'pointer',
        background: selected ? 'rgba(74,159,232,0.12)' : 'transparent',
        borderLeft: selected ? '3px solid #E8823A' : '3px solid transparent',
        transition: 'background 0.15s',
        opacity: state === 'offline' ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!selected && state !== 'offline') e.currentTarget.style.background = 'rgba(74,159,232,0.08)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <AgentDesk role={peer.role} state={state} size={56} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--z-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--z-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {statusLine}
        </div>
      </div>
    </div>
  );
}

function ThreadRow({ thread, selected, onClick, onDelete }: {
  thread: Thread;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const diff = Date.now() - new Date(thread.updated_at).getTime();
  const mins = Math.floor(diff / 60000);
  const label = mins < 1 ? t('dash.now') : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', borderRadius: 8,
        marginBottom: 2, cursor: 'pointer',
        background: selected || hovered ? 'rgba(74,159,232,0.12)' : 'transparent',
        borderLeft: selected ? '3px solid #E8823A' : '3px solid transparent',
        transition: 'background 0.15s',
      }}
    >
      <span style={{
        fontSize: 12, color: 'var(--z-text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {thread.name}
      </span>
      {hovered ? (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title={t('dash.deleteThread')}
          aria-label={t('dash.deleteThread')}
          style={{
            background: 'none', border: 'none', padding: 2,
            color: '#D85A30', cursor: 'pointer', fontSize: 14,
            lineHeight: 1, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(216,90,48,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
        >
          ✕
        </button>
      ) : (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--z-text-muted)', flexShrink: 0,
        }}>
          {label}
        </span>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--z-text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function RightPanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--z-border)' }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        textTransform: 'uppercase', letterSpacing: 1.5,
        color: 'var(--z-text-muted)', marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function TimelineRow({ entry, last }: { entry: LogEntry; last: boolean }) {
  const style = roleStyle(entry.from_role);
  const time = new Date(entry.sent_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const preview = entry.text.replace(/\[Hilo:[^\]]*\][^.]*\.\s*/, '').slice(0, 60);
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', position: 'relative' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: style.avatar, marginTop: 5, flexShrink: 0,
      }} />
      {!last && (
        <span style={{
          position: 'absolute', left: 3.5, top: 15, bottom: -5,
          width: 1, background: 'var(--z-border)',
        }} />
      )}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-secondary)', lineHeight: 1.4, minWidth: 0 }}>
        <span style={{ color: 'var(--z-text)' }}>{entry.from_role}</span>
        {entry.to_role && entry.to_role !== 'user' && ` → ${entry.to_role}`}
        <span style={{ display: 'block', color: 'var(--z-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview}
        </span>
        <span style={{ display: 'block', fontSize: 9, color: 'var(--z-text-muted)', marginTop: 1 }}>
          {time}
        </span>
      </div>
    </div>
  );
}

function EmptyState({ icon, message, action }: {
  icon: string;
  message: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>{icon}</div>
        <div style={{ fontSize: 15, color: 'var(--z-text-secondary)', marginBottom: action ? 20 : 0 }}>
          {message}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            disabled={action.disabled}
            style={{
              background: 'var(--z-green)', color: '#fff', border: 'none',
              padding: '12px 28px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: action.disabled ? 'wait' : 'pointer',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
              opacity: action.disabled ? 0.6 : 1,
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
