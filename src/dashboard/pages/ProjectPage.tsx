import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgents } from '../hooks/useAgents';
import { useThreads } from '../hooks/useThreads';
import { useMessages } from '../hooks/useMessages';
import { useDashboardPeer } from '../hooks/useDashboardPeer';
import Chat from '../components/Chat';
import Compose from '../components/Compose';
import SharedStatePanel from '../components/SharedStatePanel';
import AgentTerminalView from '../components/AgentTerminalView';
import { projectUp, projectDown } from '../lib/api';
import type { Peer, Thread, LogEntry } from '../lib/types';
import { t } from '../../shared/i18n/browser';
import { roleStyle } from '../lib/roles';
import { getDefaultName } from '../../shared/names';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { agents } = useAgents(projectId);
  const dashboardId = useDashboardPeer(projectId);
  const { threads, activeThread, setActiveThread, createThread } = useThreads(projectId);
  const { messages, loading: messagesLoading, sendMessage, waitingFor, sendError, clearError, retrySend } = useMessages(projectId, activeThread?.id, dashboardId, activeThread?.name);
  const [creatingThread, setCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [sharedRefresh, setSharedRefresh] = useState(0);
  const [terminalTabs, setTerminalTabs] = useState<Array<{ role: string; name: string }>>([]);
  const [powering, setPowering] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  const terminalRoles = new Set(terminalTabs.map(t => t.role));

  const handleAgentClick = (peer: Peer) => {
    if (terminalRoles.has(peer.role)) {
      setTerminalTabs(prev => prev.filter(t => t.role !== peer.role));
    } else {
      setTerminalTabs(prev => [...prev, { role: peer.role, name: peer.name || peer.role }]);
    }
  };

  const activeCount = agents.length;

  // Derive a rough "files modified" hint from contract_update messages
  // and a simple activity timeline from the last N messages. Both feed the
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

  const handleShutdown = async () => {
    if (!projectId) return;
    setStatusMsg(null);
    try {
      const result = await projectDown(projectId);
      setTerminalTabs([]);
      setStatusMsg({ text: t('dash.teamPoweredOff', { killed: result.killed }), type: 'ok' });
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e) {
      setStatusMsg({ text: t('dash.error', { error: e instanceof Error ? e.message : String(e) }), type: 'err' });
    }
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
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  background: 'none', border: '1px solid var(--z-border)',
                  borderRadius: 6, padding: '2px 8px',
                  color: 'var(--z-text-muted)', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; e.currentTarget.style.color = 'var(--z-text-muted)'; }}
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
                  loading={messagesLoading}
                  waitingFor={waitingFor}
                  sendError={sendError}
                  onRetry={retrySend}
                  onDismissError={clearError}
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
              <EmptyState icon="💬" message={t('dash.selectConversation')} />
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

function AgentRow({ peer, selected, onClick }: { peer: Peer; selected: boolean; onClick: () => void }) {
  const style = roleStyle(peer.role);
  const displayName = peer.name || getDefaultName(peer.role);
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 10,
        marginBottom: 2, cursor: 'pointer',
        background: selected ? 'rgba(74,159,232,0.12)' : 'transparent',
        borderLeft: selected ? '3px solid #E8823A' : '3px solid transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(74,159,232,0.08)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{
        width: 30, height: 30, borderRadius: '50%',
        background: style.avatar, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
        position: 'relative', flexShrink: 0,
      }}>
        {displayName.slice(0, 2)}
        <span style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 8, height: 8, borderRadius: '50%',
          background: '#3DBA7A',
          border: '2px solid var(--z-navy-deep)',
        }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--z-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--z-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {peer.role}
        </div>
      </div>
    </div>
  );
}

function ThreadRow({ thread, selected, onClick }: { thread: Thread; selected: boolean; onClick: () => void }) {
  const diff = Date.now() - new Date(thread.updated_at).getTime();
  const mins = Math.floor(diff / 60000);
  const label = mins < 1 ? t('dash.now') : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        marginBottom: 2, cursor: 'pointer',
        background: selected ? 'rgba(74,159,232,0.12)' : 'transparent',
        borderLeft: selected ? '3px solid #E8823A' : '3px solid transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(74,159,232,0.08)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        fontSize: 12, color: 'var(--z-text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {thread.name}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9,
        color: 'var(--z-text-muted)', flexShrink: 0,
      }}>
        {label}
      </span>
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
