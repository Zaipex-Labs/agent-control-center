// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects, projectUp, projectDown, createProject, updateProject, deleteProject } from '../lib/api';
import type { Project, AgentConfig } from '../lib/types';
import Avatar from '../components/Avatar';
import AgentIdCard, { type AgentDraft } from '../components/AgentIdCard';
import CompactAgentIdCard, { type CompactAgentDraft } from '../components/CompactAgentIdCard';
import { t } from '../../shared/i18n/browser';
import { getDefaultName, ARCHITECT_ROLE, ARCHITECT_DEFAULT_INSTRUCTIONS } from '../../shared/names';
import { officeIndex, renderOffice } from '../lib/offices';

const ROLE_COLORS: Record<string, string> = {
  backend: '#4A9FE8',
  frontend: '#E8823A',
  qa: '#534AB7',
  data: '#534AB7',
  devops: '#3DBA7A',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role.toLowerCase()] ?? '#5A6272';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('dash.justNow');
  if (mins < 60) return t('dash.minAgo', { mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('dash.hAgo', { hrs });
  const days = Math.floor(hrs / 24);
  return t('dash.dAgo', { days });
}

function AgentBadge({ name, role, avatar }: { name: string; role: string; avatar?: string }) {
  return (
    <Avatar
      avatar={avatar}
      seed={name || role || 'agent'}
      size={36}
      background={roleColor(role)}
      title={`${name} (${role})`}
    />
  );
}

const AGENTS_PREVIEW = 3;

function ProjectCard({ project, onClick, onPowerUp, onShutdown, onEdit, onDelete, starting, stopping, startLog }: { project: Project; onClick: () => void; onPowerUp: () => void; onShutdown: () => void; onEdit: () => void; onDelete: () => void; starting: boolean; stopping: boolean; startLog: Array<{ text: string; done: boolean }> }) {
  const isActive = project.active_peers > 0 || project.tmux_running === true;
  const showingBootPanel = starting && startLog.length > 0;
  const bootFinished = showingBootPanel && startLog.every(s => s.done);
  const bootInProgress = showingBootPanel && !bootFinished;
  // After boot finishes the peers may not have registered yet, so treat the
  // card as "active" for visuals until the user navigates away.
  const displayActive = isActive || bootFinished;
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const hasOverflow = project.agents.length > AGENTS_PREVIEW;
  const visibleAgents = agentsExpanded ? project.agents : project.agents.slice(0, AGENTS_PREVIEW);
  const lastActivity = project.peers.length > 0
    ? project.peers.reduce((latest, p) => p.last_seen > latest ? p.last_seen : latest, '')
    : project.created_at;

  const accent = (displayActive || bootInProgress) ? '#3DBA7A' : '#9AA0AA';
  const officeSvg = renderOffice(
    officeIndex(project.name),
    displayActive,
    project.agents.map(a => ({ color: roleColor(a.role) })),
  );

  const badgeKey = bootInProgress ? 'boot' : displayActive ? 'on' : 'off';
  const badgeStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 11, fontWeight: 500,
    textTransform: 'uppercase', letterSpacing: 1.2,
    padding: '5px 12px', borderRadius: 20,
    flexShrink: 0,
    ...(badgeKey === 'on' && { background: '#D4F5E4', color: '#1A7A46' }),
    ...(badgeKey === 'off' && { background: '#E8E5DD', color: '#6B6860' }),
    ...(badgeKey === 'boot' && {
      background: '#FFF3CD', color: '#856404',
      animation: 'acc-bpulse 1.5s ease infinite',
    }),
  };
  const badgeLabel = bootInProgress ? t('dash.starting') : displayActive ? t('dash.active') : t('dash.inactive');

  return (
    <div onClick={onClick} style={{
      display: 'flex', borderRadius: 16, overflow: 'hidden',
      border: '1px solid #DDD5C8', borderLeft: `4px solid ${accent}`,
      background: '#FAF7F1', cursor: 'pointer',
      transition: 'border-color 0.3s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.borderLeftColor = accent; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.borderLeftColor = accent; }}
    >
      {/* Left panel: info */}
      <div style={{
        flex: '1 1 0', padding: '32px 40px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        minWidth: 0, position: 'relative',
        gap: 18,
      }}>
        <div>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
            <span style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(24px, 2.2vw, 34px)',
              color: '#1E2D40', letterSpacing: -0.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {project.name}
            </span>
            <span style={badgeStyle}>{badgeLabel}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title={t('dash.edit')}
              aria-label={t('dash.edit')}
              style={{
                marginLeft: 'auto',
                background: 'none', border: '1px solid #D0C9BE',
                borderRadius: 10, padding: '6px 12px', cursor: 'pointer',
                color: '#5A6272', fontSize: 16, fontFamily: 'var(--font-sans)',
                transition: 'border-color 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0C9BE'; e.currentTarget.style.color = '#5A6272'; }}
            >
              ✎
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title={t('dash.deleteTeam')}
              aria-label={t('dash.deleteTeam')}
              style={{
                background: 'none', border: '1px solid #E8C0B0',
                borderRadius: 10, padding: '6px 12px', cursor: 'pointer',
                color: '#D85A30', fontSize: 16, fontFamily: 'var(--font-sans)',
                transition: 'background 0.15s, border-color 0.15s',
                flexShrink: 0, lineHeight: 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#D85A30'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#D85A30'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#D85A30'; e.currentTarget.style.borderColor = '#E8C0B0'; }}
            >
              ✕
            </button>
          </div>

          {/* Description */}
          {project.description && (
            <p style={{
              fontSize: 'clamp(14px, 1vw, 16px)', color: '#5A6272', margin: '0 0 18px',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {project.description}
            </p>
          )}

          {/* Agents */}
          {project.agents.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                maxHeight: agentsExpanded ? 240 : 'none',
                overflowY: agentsExpanded ? 'auto' : 'visible',
                paddingRight: agentsExpanded ? 6 : 0,
              }}>
                {visibleAgents.map((agent, i) => {
                  const activePeer = project.peers.find(p => p.role === agent.role);
                  const rawName = (activePeer?.name || agent.name || '').trim();
                  const displayName = (!rawName || rawName === agent.role)
                    ? getDefaultName(agent.role)
                    : rawName;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <Avatar
                        avatar={agent.avatar}
                        seed={displayName || agent.role}
                        size={40}
                        background={roleColor(agent.role)}
                        title={`${displayName} (${agent.role})`}
                      />
                      <span style={{
                        fontSize: 'clamp(15px, 1.1vw, 18px)', fontWeight: 500, color: '#1E2D40',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {displayName}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'clamp(12px, 0.85vw, 14px)',
                        color: '#5A6272', marginLeft: 'auto',
                      }}>
                        {agent.role}
                      </span>
                      <span style={{
                        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                        background: displayActive ? '#3DBA7A' : '#C0BDB5',
                        boxShadow: displayActive ? '0 0 8px rgba(61,186,122,0.55)' : 'none',
                      }} title={displayActive ? t('dash.online') : undefined} />
                    </div>
                  );
                })}
              </div>
              {hasOverflow && (() => {
                const extra = project.agents.length - AGENTS_PREVIEW;
                const label = agentsExpanded
                  ? t('dash.collapse')
                  : (extra === 1
                    ? t('dash.moreAgentsSingular', { count: extra })
                    : t('dash.moreAgents', { count: extra }));
                return (
                  <span
                    onClick={(e) => { e.stopPropagation(); setAgentsExpanded(v => !v); }}
                    style={{
                      color: '#E8823A', fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      alignSelf: 'flex-start', padding: '2px 0',
                      transition: 'opacity 0.15s', userSelect: 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                  >
                    {label}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Middle section: boot log or enter button */}
          {showingBootPanel ? (
            <div style={{
              marginTop: 12, fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(12px, 0.9vw, 14px)', lineHeight: 1.9, color: '#1E2D40',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {startLog.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  animation: 'acc-step-in 0.35s ease both',
                }}>
                  {step.done ? (
                    <span style={{ color: '#3DBA7A', fontSize: 15, flexShrink: 0, marginTop: 1 }}>✓</span>
                  ) : (
                    <span style={{
                      display: 'inline-block', width: 15, height: 15,
                      border: '2px solid #DDD5C8', borderTopColor: '#E8823A',
                      borderRadius: '50%', flexShrink: 0, marginTop: 3,
                      animation: 'acc-spin 0.6s linear infinite',
                    }} />
                  )}
                  <span>{step.text}</span>
                </div>
              ))}
              {startLog.every(s => s.done) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClick(); }}
                  style={{
                    marginTop: 14, width: '100%',
                    background: '#3DBA7A', color: '#fff', border: 'none',
                    padding: '14px 16px', borderRadius: 12, fontSize: 15,
                    fontFamily: 'var(--font-mono)', fontWeight: 500,
                    letterSpacing: 0.6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#2EA568'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#3DBA7A'; }}
                >
                  {t('dash.enterOffice')} →
                </button>
              )}
            </div>
          ) : displayActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              style={{
                marginTop: 6, width: '100%',
                background: '#3DBA7A', color: '#fff', border: 'none',
                padding: '14px 16px', borderRadius: 12, fontSize: 15,
                fontFamily: 'var(--font-mono)', fontWeight: 500,
                letterSpacing: 0.6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2EA568'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3DBA7A'; }}
            >
              {t('dash.enterOffice')} →
            </button>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 16, marginTop: 16,
          borderTop: '1px solid #EEE8DD',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(11px, 0.85vw, 13px)', color: '#9AA0AA' }}>
            {t('dash.lastActivity').toLowerCase()}: {timeAgo(lastActivity)}
          </span>
          {showingBootPanel ? null : displayActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onShutdown(); }}
              disabled={stopping}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                letterSpacing: 0.5, padding: '10px 26px', borderRadius: 10,
                background: 'transparent', color: '#D85A30',
                border: '1.5px solid #D85A30',
                cursor: stopping ? 'wait' : 'pointer',
                transition: 'all 0.2s', opacity: stopping ? 0.7 : 1,
              }}
              onMouseEnter={e => { if (!stopping) { e.currentTarget.style.background = '#D85A30'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={e => { if (!stopping) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#D85A30'; } }}
            >
              {stopping ? t('dash.shuttingDown') : t('dash.powerDown')}
            </button>
          ) : project.agents.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onPowerUp(); }}
              disabled={starting}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                letterSpacing: 0.5, padding: '10px 26px', borderRadius: 10,
                background: '#1E2D40', color: '#F0ECE3', border: 'none',
                cursor: starting ? 'wait' : 'pointer',
                transition: 'all 0.2s', opacity: starting ? 0.7 : 1,
              }}
              onMouseEnter={e => { if (!starting) e.currentTarget.style.background = '#E8823A'; }}
              onMouseLeave={e => { if (!starting) e.currentTarget.style.background = '#1E2D40'; }}
            >
              {starting ? t('dash.starting') : t('dash.powerUp')}
            </button>
          )}
        </div>
      </div>

      {/* Right panel: office illustration — proportional width that grows with the card */}
      <div
        style={{
          flex: '0 0 42%', minWidth: 320, alignSelf: 'stretch',
          position: 'relative', overflow: 'hidden',
          borderLeft: '1px solid #E8E3D8',
          display: 'flex', alignItems: 'stretch',
        }}
        dangerouslySetInnerHTML={{ __html: officeSvg }}
      />
    </div>
  );
}

function SidebarItem({ project, selected, onClick }: { project: Project; selected: boolean; onClick: () => void }) {
  const active = project.active_peers > 0 || project.tmux_running === true;
  const count = project.agents.length;
  const countLabel = count === 1 ? '1 agente' : `${count} agentes`;
  const statusLabel = active ? t('dash.active').toLowerCase() : t('dash.inactive').toLowerCase();
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        borderRadius: 8,
        marginBottom: 2,
        cursor: 'pointer',
        background: selected ? '#F0ECE3' : 'transparent',
        borderLeft: selected ? '3px solid #E8823A' : '3px solid transparent',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#F0ECE3'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: active ? '#3DBA7A' : '#C0BDB5',
        boxShadow: active ? '0 0 6px rgba(61,186,122,0.5)' : 'none',
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-serif)', fontSize: 15,
          color: '#1E2D40', lineHeight: 1.25,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: '#9AA0AA', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {countLabel} · {statusLabel}
        </div>
      </div>
    </div>
  );
}

export default function TeamsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [startLog, setStartLog] = useState<Array<{ text: string; done: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<'recent' | 'name' | 'status'>('recent');
  const [switchConfirm, setSwitchConfirm] = useState<{ current: string; next: string } | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const navigate = useNavigate();

  const isProjectActive = (p: Project): boolean =>
    p.active_peers > 0 || p.tmux_running === true;

  const projectLastActivity = (p: Project): number => {
    if (p.peers.length > 0) {
      return p.peers.reduce((max, peer) => Math.max(max, new Date(peer.last_seen).getTime()), 0);
    }
    return new Date(p.created_at).getTime();
  };

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? projects.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q),
        )
      : projects;

    const sorted = [...filtered];
    if (sortMode === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'status') {
      sorted.sort((a, b) => {
        const diff = (isProjectActive(a) ? 0 : 1) - (isProjectActive(b) ? 0 : 1);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else {
      // 'recent' default: active first, then by last activity desc
      sorted.sort((a, b) => {
        const diff = (isProjectActive(a) ? 0 : 1) - (isProjectActive(b) ? 0 : 1);
        return diff !== 0 ? diff : projectLastActivity(b) - projectLastActivity(a);
      });
    }
    return sorted;
  }, [projects, search, sortMode]);

  const reload = () => listProjects().then(setProjects).catch(() => {});

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  // Auto-select the first project once they load, prefer active ones so the
  // user always lands on something live. Re-selects if the current selection
  // disappears after a reload.
  useEffect(() => {
    if (projects.length === 0) {
      if (selectedName !== null) setSelectedName(null);
      return;
    }
    const stillExists = selectedName && projects.some(p => p.name === selectedName);
    if (!stillExists) {
      const active = projects.find(p => isProjectActive(p));
      setSelectedName((active ?? projects[0]).name);
    }
  }, [projects, selectedName]);

  const selectedProject = projects.find(p => p.name === selectedName) ?? null;

  const handlePowerUp = async (name: string) => {
    // Enforce single-active invariant: if another project is already active,
    // ask the user to confirm the switch.
    const currentActive = projects.find(p => p.name !== name && isProjectActive(p));
    if (currentActive) {
      setSwitchConfirm({ current: currentActive.name, next: name });
      return;
    }
    await startProject(name);
  };

  const confirmSwitch = async () => {
    if (!switchConfirm) return;
    const { current, next } = switchConfirm;
    setSwitchConfirm(null);
    try {
      setStopping(current);
      await projectDown(current);
      await reload();
    } catch (e) {
      setError(t('dash.errorShutdown', { name: current, error: e instanceof Error ? e.message : String(e) }));
      setStopping(null);
      return;
    }
    setStopping(null);
    await startProject(next);
  };

  const startProject = async (name: string) => {
    setStarting(name);
    setError(null);
    const log: Array<{ text: string; done: boolean }> = [
      { text: t('dash.registeringMcp'), done: false },
    ];
    setStartLog([...log]);

    try {
      log[0].done = true;
      log.push({ text: t('dash.spawningAgents'), done: false });
      setStartLog([...log]);

      const result = await projectUp(name);

      log[log.length - 1].done = true;
      const roles = (result as any).agent_roles as string[] | undefined;
      const names = (result as any).agent_names as string[] | undefined;
      if (roles && names) {
        for (let i = 0; i < roles.length; i++) {
          log.push({ text: t('dash.agentStarted', { name: names[i], role: roles[i] }), done: true });
        }
      }
      log.push({ text: t('dash.waitingConnect'), done: false });
      setStartLog([...log]);

      // Poll for peers to appear
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        await reload();
        const updated = projects.find(p => p.name === name);
        // Check if peers appeared or we've waited long enough
        if ((updated && updated.active_peers > 0) || attempts >= 10) {
          clearInterval(poll);
          log[log.length - 1].done = true;
          log.push({ text: t('dash.teamUp'), done: true });
          setStartLog([...log]);
          await reload();
          // Keep the log visible + "Enter the office" button until the user
          // clicks through or navigates away. starting stays truthy so the
          // card stays in the startup view.
        }
      }, 2000);
    } catch (e) {
      setError(t('dash.errorPoweringUp', { name, error: e instanceof Error ? e.message : String(e) }));
      setStarting(null);
      setStartLog([]);
    }
  };

  const handleEdit = (project: Project) => {
    if (isProjectActive(project)) {
      setError(t('dash.cannotEditActive'));
      return;
    }
    setEditing(project);
  };

  const handleSaveEdit = async (
    description: string,
    agents: Array<{ role: string; cwd: string; name?: string; instructions?: string }>,
  ) => {
    if (!editing) return;
    setSavingEdit(true);
    setError(null);
    try {
      await updateProject(editing.name, description, agents);
      await reload();
      setEditing(null);
    } catch (e) {
      setError(t('dash.errorSaving', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRequestDelete = (project: Project) => {
    if (isProjectActive(project)) {
      setError(t('dash.cannotEditActive'));
      return;
    }
    setDeletingProject(project);
  };

  const confirmDelete = async () => {
    if (!deletingProject) return;
    const name = deletingProject.name;
    setDeletingProject(null);
    try {
      await deleteProject(name);
      await reload();
    } catch (e) {
      setError(t('dash.errorDeleting', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleShutdown = async (name: string) => {
    setStopping(name);
    setError(null);
    try {
      await projectDown(name);
      await reload();
    } catch (e) {
      setError(t('dash.errorShutdown', { name, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setStopping(null);
    }
  };

  const handleCreate = async (
    name: string,
    description: string,
    agents: Array<{ role: string; cwd: string; name?: string; instructions?: string; model?: string }>,
  ) => {
    setCreating(true);
    setError(null);
    try {
      await createProject(name, description);
      if (agents.length > 0) {
        await updateProject(name, description, agents);
      }
      await reload();
      setShowCreate(false);
    } catch (e) {
      setError(t('dash.errorCreating', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#F0ECE3',
      color: '#1E2D40',
    }}>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
        {/* Page header */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          marginBottom: 28, gap: 16,
        }}>
          <div>
            <h1 style={{
              fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400,
              color: '#1E2D40', margin: 0, marginBottom: 4,
            }}>
              {t('dash.yourTeams')}
            </h1>
            <p style={{ color: '#5A6272', fontSize: 14, margin: 0 }}>
              {t('dash.teamsSubtitle')}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: '#E8823A', color: '#fff', border: 'none',
              padding: '9px 18px', borderRadius: 10, fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              letterSpacing: 0.2, flexShrink: 0,
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#D4732E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#E8823A'; }}
          >
            + {t('dash.newTeam')}
          </button>
        </div>

        {projects.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('dash.searchTeams')}
              style={{
                width: '100%', padding: '10px 32px 10px 36px',
                borderRadius: 10, border: '1px solid #DDD5C8',
                fontSize: 14, fontFamily: 'var(--font-sans)',
                background: '#FAF7F1', color: '#1E2D40', outline: 'none',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#FAF7F1'; }}
            />
            <span style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', fontSize: 14,
              color: '#9AA0AA', pointerEvents: 'none',
            }}>&#9906;</span>
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 8, top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', color: '#9AA0AA', fontSize: 16,
                  cursor: 'pointer', padding: '0 4px', lineHeight: 1,
                }}
                aria-label={t('dash.cancel')}
              >&times;</button>
            )}
          </div>
        )}

        {error && (
          <div style={{
            background: '#FDF0EC', border: '1px solid #E8823A',
            borderRadius: 10, padding: '12px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, color: '#8B3A1A' }}>{error}</span>
            <button onClick={() => setError(null)} style={{
              background: 'none', border: 'none', color: '#8B3A1A',
              fontSize: 16, cursor: 'pointer', padding: '0 4px',
            }}>&times;</button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#8AA8C0' }}>
            {t('dash.loadingProjects')}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 60, color: '#9AA0AA',
            border: '1px dashed #DDD5C8', borderRadius: 12,
            background: '#FAF7F1',
          }}>
            {search ? t('dash.noMatches') : t('ui.noProjects')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {visibleProjects.map(project => (
              <ProjectCard
                key={project.name}
                project={project}
                onClick={() => navigate(`/${encodeURIComponent(project.name)}`)}
                onPowerUp={() => handlePowerUp(project.name)}
                onShutdown={() => handleShutdown(project.name)}
                onEdit={() => handleEdit(project)}
                onDelete={() => handleRequestDelete(project)}
                starting={starting === project.name}
                stopping={stopping === project.name}
                startLog={starting === project.name ? startLog : []}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create project modal */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
          creating={creating}
        />
      )}

      {/* Edit team modal */}
      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleSaveEdit}
          saving={savingEdit}
        />
      )}

      {/* Switch-team confirmation modal */}
      {switchConfirm && (
        <ConfirmModal
          title={t('dash.switchTeamTitle')}
          body={t('dash.switchTeamBody', { current: switchConfirm.current, next: switchConfirm.next })}
          confirmLabel={t('dash.switchTeamConfirm')}
          cancelLabel={t('dash.cancel')}
          onConfirm={confirmSwitch}
          onCancel={() => setSwitchConfirm(null)}
        />
      )}

      {deletingProject && (
        <ConfirmModal
          title={t('dash.deleteTeamTitle', { name: deletingProject.name })}
          body={t('dash.deleteTeamBody')}
          confirmLabel={t('dash.deleteTeamConfirm')}
          cancelLabel={t('dash.cancel')}
          onConfirm={confirmDelete}
          onCancel={() => setDeletingProject(null)}
          danger
        />
      )}
    </div>
  );
}

function EditProjectModal({ project, onClose, onSubmit, saving }: {
  project: Project;
  onClose: () => void;
  onSubmit: (description: string, agents: Array<{ role: string; cwd: string; name?: string; instructions?: string; avatar?: string; model?: string }>) => void;
  saving: boolean;
}) {
  const [description, setDescription] = useState(project.description ?? '');
  const [agents, setAgents] = useState<AgentDraft[]>(() => {
    const mapped = (project.agents ?? []).map((a: AgentConfig) => ({
      role: a.role,
      cwd: a.cwd,
      name: a.name ?? '',
      instructions: a.instructions ?? '',
      avatar: a.avatar ?? '',
      model: a.model ?? '',
    }));
    if (!mapped.some(a => a.role === ARCHITECT_ROLE)) {
      mapped.unshift({
        role: ARCHITECT_ROLE,
        cwd: '(auto)',
        name: 'Da Vinci',
        instructions: ARCHITECT_DEFAULT_INSTRUCTIONS,
        avatar: '',
        model: '',
      });
    }
    return mapped;
  });

  const addCard = () => setAgents(prev => [
    ...prev,
    { role: '', cwd: '', name: '', instructions: '', avatar: '', model: '' },
  ]);
  const removeCard = (i: number) => {
    if (agents[i]?.role === ARCHITECT_ROLE) return;
    setAgents(prev => prev.filter((_, idx) => idx !== i));
  };
  const replaceCard = (i: number, next: AgentDraft) =>
    setAgents(prev => prev.map((a, idx) => idx === i ? next : a));

  const roles = agents.map(a => a.role.trim());
  const hasDuplicate = roles.some((r, i) => r && roles.indexOf(r) !== i);
  const allValid =
    agents.length > 0 &&
    agents.every(a => a.role.trim() && (a.role === ARCHITECT_ROLE || a.cwd.trim())) &&
    !hasDuplicate;
  const canSubmit = allValid && !saving;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 100, padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#F0ECE3', borderRadius: 16, padding: '28px 32px 32px',
          width: '100%', maxWidth: 1000,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        {/* Header */}
        <div>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400,
            color: '#1E2D40', margin: 0,
          }}>
            {t('dash.editTeamTitle', { name: project.name })}
          </h2>
          <p style={{ fontSize: 14, color: '#5A6272', margin: '4px 0 0' }}>
            {t('dash.teamsSubtitle')}
          </p>
        </div>

        {/* Description */}
        <label style={{ display: 'block' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: 1.5,
            color: '#9AA0AA', display: 'block', marginBottom: 6,
          }}>
            {t('dash.description')}
          </span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('dash.descriptionPlaceholder')}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10,
              border: '1px solid #DDD5C8', fontSize: 14, fontFamily: 'var(--font-sans)',
              outline: 'none', background: '#FAF7F1', color: '#1E2D40',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#FAF7F1'; }}
          />
        </label>

        {/* Agent ID cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {agents.map((agent, i) => {
            const isDup = !!agent.avatar && agents.some((other, j) => j !== i && other.avatar === agent.avatar);
            const peer = project.peers.find(p => p.role === agent.role);
            return (
              <AgentIdCard
                key={i}
                draft={agent}
                project={project.name}
                status={peer ? 'online' : 'offline'}
                duplicateAvatar={isDup}
                onChange={next => replaceCard(i, next)}
                onDelete={() => removeCard(i)}
                locked={agent.role === ARCHITECT_ROLE}
                lockedHint={agent.role === ARCHITECT_ROLE ? '🔒 Tech Lead permanente — coordinador del equipo' : undefined}
              />
            );
          })}

          {/* Add agent */}
          <button
            onClick={addCard}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, width: '100%', padding: 16, borderRadius: 16,
              border: '2px dashed #DDD5C8', background: 'transparent',
              fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
              color: '#9AA0AA', cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#E8823A';
              e.currentTarget.style.color = '#E8823A';
              e.currentTarget.style.background = '#FEF9F4';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#DDD5C8';
              e.currentTarget.style.color = '#9AA0AA';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            + {t('dash.addAgent')}
          </button>

          {hasDuplicate && (
            <div style={{ fontSize: 12, color: '#D85A30', marginTop: -4 }}>
              {t('dash.duplicateRoles')}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          paddingTop: 12, borderTop: '1px solid #DDD5C8',
        }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: 'none', border: '1px solid #DDD5C8', borderRadius: 8,
              padding: '10px 22px', color: '#5A6272', cursor: 'pointer',
            }}
          >
            {t('dash.cancel')}
          </button>
          <button
            onClick={() => { if (canSubmit) onSubmit(description.trim(), agents); }}
            disabled={!canSubmit}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: canSubmit ? '#3DBA7A' : '#C0BDB5', color: '#fff', border: 'none',
              padding: '10px 26px', borderRadius: 8,
              fontWeight: 500, cursor: canSubmit ? 'pointer' : 'default',
              transition: 'background 0.2s',
              opacity: saving ? 0.65 : 1,
            }}
          >
            {saving ? t('dash.saving') : t('dash.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title, body, confirmLabel, cancelLabel, onConfirm, onCancel, danger = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const confirmBg = danger ? '#D85A30' : '#E8823A';
  const confirmHover = danger ? '#B6411A' : '#D4732E';
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 28,
          width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400,
          color: '#1E2D40', margin: '0 0 12px',
        }}>
          {title}
        </h2>
        <p style={{
          color: '#5A6272', fontSize: 14, lineHeight: 1.55,
          margin: '0 0 24px',
        }}>
          {body}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none', border: '1px solid #D0C9BE', borderRadius: 10,
              padding: '10px 20px', fontSize: 14, color: '#5A6272',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: confirmBg, color: '#fff', border: 'none',
              padding: '10px 20px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = confirmHover; }}
            onMouseLeave={e => { e.currentTarget.style.background = confirmBg; }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateProjectModal({ onClose, onSubmit, creating }: {
  onClose: () => void;
  onSubmit: (name: string, description: string, agents: Array<{ role: string; cwd: string; name?: string; instructions?: string; model?: string }>) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agents, setAgents] = useState<CompactAgentDraft[]>([
    { role: ARCHITECT_ROLE, name: 'Da Vinci', cwd: '(auto)', instructions: ARCHITECT_DEFAULT_INSTRUCTIONS, model: '' },
    { role: 'backend',  name: '', cwd: '', instructions: '', model: '' },
    { role: 'frontend', name: '', cwd: '', instructions: '', model: '' },
  ]);

  const addAgentRow = () =>
    setAgents(prev => [...prev, { role: '', name: '', cwd: '', instructions: '', model: '' }]);
  const removeAgentRow = (i: number) => {
    if (agents[i]?.role === ARCHITECT_ROLE) return;
    setAgents(prev => prev.filter((_, idx) => idx !== i));
  };
  const replaceRow = (i: number, next: CompactAgentDraft) =>
    setAgents(prev => prev.map((a, idx) => idx === i ? next : a));

  const roles = agents.map(a => a.role.trim());
  const hasDuplicate = roles.some((r, i) => r && roles.indexOf(r) !== i);
  const canSubmit =
    !!name.trim() &&
    agents.length > 0 &&
    agents.every(a => a.role.trim() && (a.role === ARCHITECT_ROLE || a.cwd.trim())) &&
    !hasDuplicate &&
    !creating;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 100, padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#F0ECE3', borderRadius: 16, padding: '28px 32px 32px',
          width: '100%', maxWidth: 820,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        {/* Header */}
        <div>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400,
            color: '#1E2D40', margin: 0,
          }}>
            {t('dash.newTeam')}
          </h2>
        </div>

        {/* Name + description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'block' }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: 1.5,
              color: '#9AA0AA', display: 'block', marginBottom: 6,
            }}>
              {t('dash.projectName')}
            </span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('dash.projectNamePlaceholder')}
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: '1px solid #DDD5C8', fontSize: 14,
                fontFamily: 'var(--font-mono)',
                outline: 'none', background: '#FAF7F1', color: '#1E2D40',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#FAF7F1'; }}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: 1.5,
              color: '#9AA0AA', display: 'block', marginBottom: 6,
            }}>
              {t('dash.description')}
            </span>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('dash.descriptionPlaceholder')}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: '1px solid #DDD5C8', fontSize: 14,
                fontFamily: 'var(--font-sans)',
                outline: 'none', background: '#FAF7F1', color: '#1E2D40',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#4A9FE8'; e.currentTarget.style.background = '#fff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#DDD5C8'; e.currentTarget.style.background = '#FAF7F1'; }}
            />
          </label>
        </div>

        {/* Agents */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: 1.5,
            color: '#9AA0AA',
          }}>
            {t('dash.agents')}
          </div>

          {agents.map((agent, i) => (
            <CompactAgentIdCard
              key={i}
              draft={agent}
              onChange={next => replaceRow(i, next)}
              onDelete={() => removeAgentRow(i)}
              locked={agent.role === ARCHITECT_ROLE}
              lockedHint={agent.role === ARCHITECT_ROLE ? '🔒 Tech Lead permanente' : undefined}
            />
          ))}

          <button
            onClick={addAgentRow}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, width: '100%', padding: 14, borderRadius: 14,
              border: '2px dashed #DDD5C8', background: 'transparent',
              fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
              color: '#9AA0AA', cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#E8823A';
              e.currentTarget.style.color = '#E8823A';
              e.currentTarget.style.background = '#FEF9F4';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#DDD5C8';
              e.currentTarget.style.color = '#9AA0AA';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            + {t('dash.addAgent')}
          </button>

          {hasDuplicate && (
            <div style={{ fontSize: 12, color: '#D85A30' }}>
              {t('dash.duplicateRoles')}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          paddingTop: 12, borderTop: '1px solid #DDD5C8',
        }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: 'none', border: '1px solid #DDD5C8', borderRadius: 8,
              padding: '10px 22px', color: '#5A6272', cursor: 'pointer',
            }}
          >
            {t('dash.cancel')}
          </button>
          <button
            onClick={() => { if (canSubmit) onSubmit(name.trim(), description.trim(), agents); }}
            disabled={!canSubmit}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 0.5,
              background: canSubmit ? '#3DBA7A' : '#C0BDB5', color: '#fff', border: 'none',
              padding: '10px 26px', borderRadius: 8,
              fontWeight: 500, cursor: canSubmit ? 'pointer' : 'default',
              transition: 'background 0.2s',
              opacity: creating ? 0.65 : 1,
            }}
          >
            {creating ? t('dash.creating') : t('dash.createTeam')}
          </button>
        </div>
      </div>
    </div>
  );
}
