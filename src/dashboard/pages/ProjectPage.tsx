import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgents } from '../hooks/useAgents';
import { useThreads } from '../hooks/useThreads';
import { useMessages } from '../hooks/useMessages';
import ThreadList from '../components/ThreadList';
import AgentChips from '../components/AgentChips';
import Chat from '../components/Chat';
import Compose from '../components/Compose';
import SharedStatePanel from '../components/SharedStatePanel';
import TeamStats from '../components/TeamStats';
import AgentTerminalView from '../components/AgentTerminalView';
import { projectUp, projectDown } from '../lib/api';
import type { Peer } from '../lib/types';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { agents } = useAgents(projectId);
  const { threads, activeThread, setActiveThread, createThread } = useThreads(projectId);
  const { messages, loading: messagesLoading, sendMessage } = useMessages(projectId, activeThread?.id);
  const [creatingThread, setCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [sharedRefresh, setSharedRefresh] = useState(0);
  const [terminalTabs, setTerminalTabs] = useState<Array<{ role: string; name: string }>>([]);
  const [powering, setPowering] = useState(false);

  const terminalRoles = new Set(terminalTabs.map(t => t.role));

  const handleChipClick = (peer: Peer) => {
    if (terminalRoles.has(peer.role)) {
      setTerminalTabs(prev => prev.filter(t => t.role !== peer.role));
    } else {
      setTerminalTabs(prev => [...prev, { role: peer.role, name: peer.name || peer.role }]);
    }
  };

  const handlePowerUp = async () => {
    if (!projectId || powering) return;
    setPowering(true);
    try {
      await projectUp(projectId);
    } catch (e) {
      console.error('Failed to start project:', e);
    } finally {
      setPowering(false);
    }
  };

  const handleShutdown = async () => {
    if (!projectId) return;
    try {
      await projectDown(projectId);
      setTerminalTabs([]);
    } catch (e) {
      console.error('Failed to stop project:', e);
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
      minHeight: '100vh', background: 'var(--z-navy-dark)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 56,
        borderBottom: '1px solid var(--z-border)',
        flexShrink: 0,
      }}>
        {/* Left: back */}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', color: 'var(--z-text-secondary)',
            fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 6,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--z-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--z-text-secondary)'; }}
        >
          <span style={{ fontSize: 16 }}>&larr;</span> Equipos
        </button>

        {/* Center: project name */}
        <h1 style={{
          fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 400,
          color: 'var(--z-text)', margin: 0,
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        }}>
          {projectId}
        </h1>

        {/* Right: status + shutdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: agents.length > 0 ? 'rgba(61,186,122,0.15)' : 'rgba(90,98,114,0.15)',
            color: agents.length > 0 ? 'var(--z-green)' : 'var(--z-text-muted)',
          }}>
            {agents.length} agente{agents.length !== 1 ? 's' : ''} activo{agents.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => { setShowSidebar(v => !v); setSharedRefresh(n => n + 1); }}
            style={{
              background: showSidebar ? 'rgba(74,159,232,0.12)' : 'var(--z-surface)',
              border: '1px solid var(--z-border)', color: 'var(--z-text-secondary)',
              fontSize: 12, fontWeight: 500, padding: '6px 12px',
              borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s',
            }}
          >
            Panel
          </button>
          <button
            onClick={handleShutdown}
            style={{
              background: 'rgba(220,60,60,0.1)', border: '1px solid rgba(220,60,60,0.25)',
              color: '#DC3C3C', fontSize: 12, fontWeight: 500,
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,60,60,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(220,60,60,0.1)'; }}
          >
            Apagar equipo
          </button>
        </div>
      </nav>

      {/* Body: threads panel + main area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Thread panel */}
        <ThreadList
          threads={threads}
          activeThread={activeThread}
          onSelect={setActiveThread}
          onCreate={handleCreateThread}
          projectId={projectId ?? ''}
        />

        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Agent chips */}
          <div style={{ padding: '0 24px', borderBottom: '1px solid var(--z-border)' }}>
            <AgentChips agents={agents} activeRoles={terminalRoles} onChipClick={handleChipClick} />
          </div>

          {/* Thread create input (inline) */}
          {creatingThread && (
            <div style={{
              padding: '12px 24px', borderBottom: '1px solid var(--z-border)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <input
                autoFocus
                value={newThreadName}
                onChange={e => setNewThreadName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateThread(); if (e.key === 'Escape') { setCreatingThread(false); setNewThreadName(''); } }}
                placeholder="Nombre del hilo..."
                style={{
                  flex: 1, background: 'var(--z-surface)',
                  border: '1px solid var(--z-border)', borderRadius: 8,
                  padding: '8px 12px', color: 'var(--z-text)', fontSize: 14,
                  fontFamily: 'var(--font-sans)', outline: 'none',
                }}
              />
              <button
                onClick={handleCreateThread}
                style={{
                  background: 'var(--z-orange)', color: '#fff', border: 'none',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}
              >
                Crear
              </button>
              <button
                onClick={() => { setCreatingThread(false); setNewThreadName(''); }}
                style={{
                  background: 'none', border: 'none', color: 'var(--z-text-muted)',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  padding: '8px 12px',
                }}
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeThread ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Chat messages={messages} loading={messagesLoading} />
                <Compose agents={agents} onSend={sendMessage} />
              </div>
            ) : agents.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>&#9654;</div>
                  <div style={{ fontSize: 16, color: 'var(--z-text-secondary)', marginBottom: 20 }}>
                    No hay agentes activos en este proyecto
                  </div>
                  <button
                    onClick={handlePowerUp}
                    disabled={powering}
                    style={{
                      background: 'var(--z-green)', color: '#fff', border: 'none',
                      padding: '14px 32px', borderRadius: 12, fontSize: 16,
                      fontWeight: 600, cursor: powering ? 'wait' : 'pointer',
                      fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
                      opacity: powering ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!powering) e.currentTarget.style.background = '#2FA068'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#3DBA7A'; }}
                  >
                    {powering ? 'Encendiendo...' : 'Encender equipo'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ textAlign: 'center', color: 'var(--z-text-muted)' }}>
                  <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>&#128172;</div>
                  <div style={{ fontSize: 15 }}>Selecciona una conversacion para comenzar</div>
                </div>
              </div>
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

        {/* Right sidebar */}
        {showSidebar && projectId && (
          <div data-sidebar="right" style={{
            width: 260, flexShrink: 0,
            borderLeft: '1px solid var(--z-border)',
            overflowY: 'auto', padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>
            <TeamStats agents={agents} messages={messages} />
            <SharedStatePanel projectId={projectId} refreshKey={sharedRefresh} />
          </div>
        )}
      </div>
    </div>
  );
}
