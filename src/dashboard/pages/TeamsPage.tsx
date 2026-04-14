import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects, projectUp, projectDown, createProject, addAgent, updateProject } from '../lib/api';
import type { Project, AgentConfig } from '../lib/types';
import FolderPicker from '../components/FolderPicker';
import { t } from '../../shared/i18n/browser';

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

function Avatar({ name, role }: { name: string; role: string }) {
  const initial = (name || role || '?')[0].toUpperCase();
  const bg = roleColor(role);
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
      flexShrink: 0,
    }} title={`${name} (${role})`}>
      {initial}
    </div>
  );
}

function ProjectCard({ project, onClick, onPowerUp, onShutdown, onEdit, starting, stopping }: { project: Project; onClick: () => void; onPowerUp: () => void; onShutdown: () => void; onEdit: () => void; starting: boolean; stopping: boolean }) {
  const isActive = project.active_peers > 0 || project.tmux_running === true;
  const lastActivity = project.peers.length > 0
    ? project.peers.reduce((latest, p) => p.last_seen > latest ? p.last_seen : latest, '')
    : project.created_at;

  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 16, padding: 28,
      cursor: 'pointer', transition: 'box-shadow 0.2s, transform 0.2s',
      border: '1px solid #E2DDD4',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 32px rgba(30,45,64,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{
          fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400,
          color: '#1E2D40', margin: 0, flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </h3>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title={t('dash.edit')}
          aria-label={t('dash.edit')}
          style={{
            background: 'none', border: '1px solid #D0C9BE',
            borderRadius: 8, padding: '4px 8px', cursor: 'pointer',
            color: '#5A6272', fontSize: 13, fontFamily: 'var(--font-sans)',
            transition: 'border-color 0.15s, color 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.color = '#E8823A'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0C9BE'; e.currentTarget.style.color = '#5A6272'; }}
        >
          ✎
        </button>
        <span style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: isActive ? '#E8F7EF' : '#F0F0F0',
          color: isActive ? '#2A8B5A' : '#8A8A8A',
          letterSpacing: 0.3, flexShrink: 0,
        }}>
          {isActive ? t('dash.active') : t('dash.inactive')}
        </span>
      </div>

      {project.description && (
        <p style={{ color: '#5A6272', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          {project.description}
        </p>
      )}

      {project.agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {project.agents.map((agent, i) => {
            const activePeer = project.peers.find(p => p.role === agent.role);
            const name = activePeer?.name ?? agent.name ?? agent.role;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={name} role={agent.role} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1E2D40' }}>{name}</div>
                  <div style={{ fontSize: 12, color: '#8AA8C0' }}>{agent.role}</div>
                </div>
                {activePeer && (
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', background: '#3DBA7A',
                    marginLeft: 'auto', flexShrink: 0,
                  }} title={t('dash.online')} />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span style={{ fontSize: 12, color: '#8AA8C0' }}>
          {t('dash.lastActivity')}: {timeAgo(lastActivity)}
        </span>
        {isActive ? (
          <button
            onClick={(e) => { e.stopPropagation(); onShutdown(); }}
            disabled={stopping}
            style={{
              background: stopping ? '#8AA8C0' : 'rgba(220,60,60,0.12)',
              color: stopping ? '#fff' : '#DC3C3C',
              border: stopping ? 'none' : '1px solid rgba(220,60,60,0.3)',
              padding: '6px 14px', borderRadius: 8, fontSize: 12,
              fontWeight: 600, cursor: stopping ? 'wait' : 'pointer',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
              opacity: stopping ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!stopping) e.currentTarget.style.background = 'rgba(220,60,60,0.2)'; }}
            onMouseLeave={e => { if (!stopping) e.currentTarget.style.background = 'rgba(220,60,60,0.12)'; }}
          >
            {stopping ? t('dash.shuttingDown') : t('dash.powerDown')}
          </button>
        ) : project.agents.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onPowerUp(); }}
            disabled={starting}
            style={{
              background: starting ? '#8AA8C0' : '#3DBA7A', color: '#fff', border: 'none',
              padding: '6px 14px', borderRadius: 8, fontSize: 12,
              fontWeight: 600, cursor: starting ? 'wait' : 'pointer',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
              opacity: starting ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!starting) e.currentTarget.style.background = '#2FA068'; }}
            onMouseLeave={e => { e.currentTarget.style.background = starting ? '#8AA8C0' : '#3DBA7A'; }}
          >
            {starting ? t('dash.starting') : t('dash.powerUp')}
          </button>
        )}
      </div>
    </div>
  );
}

function NewTeamCard({ onClick }: { onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: 'transparent', borderRadius: 16, padding: 28,
      cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s',
      border: '2px dashed #D0C9BE',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, minHeight: 200,
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8823A'; e.currentTarget.style.background = 'rgba(232,130,58,0.04)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = '#D0C9BE'; e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: '2px dashed #D0C9BE', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 24, color: '#8AA8C0',
      }}>+</div>
      <span style={{ fontSize: 14, color: '#8AA8C0', fontWeight: 500 }}>{t('dash.createNewTeam')}</span>
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
          setTimeout(() => { setStarting(null); setStartLog([]); }, 2000);
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

  const handleCreate = async (name: string, description: string, agents: Array<{ role: string; cwd: string }>) => {
    setCreating(true);
    setError(null);
    try {
      await createProject(name, description);
      for (const agent of agents) {
        await addAgent(name, agent.role, agent.cwd);
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
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 40px',
        borderBottom: '1px solid #E2DDD4',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: '#1E2D40', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#E8823A', fontWeight: 700, fontSize: 16,
            fontFamily: 'var(--font-sans)',
          }}>Z</div>
          <span style={{
            fontSize: 16, fontWeight: 600, color: '#1E2D40',
            fontFamily: 'var(--font-sans)', letterSpacing: -0.3,
          }}>
            {t('dash.teamsTitle')}
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: '#E8823A', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: 10, fontSize: 14,
            fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#D4732E'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#E8823A'; }}
        >
          {t('dash.newTeam')}
        </button>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 40px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{
            fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 400,
            color: '#1E2D40', margin: 0, marginBottom: 8,
          }}>
            {t('dash.yourTeams')}
          </h1>
          <p style={{ color: '#5A6272', fontSize: 16, margin: 0 }}>
            {t('dash.teamsSubtitle')}
          </p>
        </div>

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

        {startLog.length > 0 && (
          <div style={{
            background: '#fff', border: '1px solid #E2DDD4', borderRadius: 12,
            padding: 20, marginBottom: 20,
          }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: '#1E2D40', marginBottom: 12,
              fontFamily: 'var(--font-sans)',
            }}>
              {t('dash.poweringUp', { name: starting ?? '' })}
            </div>
            {startLog.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 0', fontSize: 13,
                color: step.done ? '#2A8B5A' : '#5A6272',
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: step.done ? '#E8F7EF' : '#F5F3EF',
                  color: step.done ? '#2A8B5A' : '#8AA8C0',
                }}>
                  {step.done ? '✓' : '⋯'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{step.text}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#8AA8C0' }}>
            {t('dash.loadingProjects')}
          </div>
        ) : (
          <>
            {/* Search + sort toolbar */}
            {projects.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                marginBottom: 20,
              }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('dash.searchTeams')}
                    style={{
                      width: '100%', padding: '10px 14px 10px 36px',
                      borderRadius: 10, border: '1px solid #D0C9BE',
                      fontSize: 14, fontFamily: 'var(--font-sans)',
                      background: '#fff', color: '#1E2D40', outline: 'none',
                      transition: 'border-color 0.15s',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#E8823A'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D0C9BE'; }}
                  />
                  <span style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', fontSize: 14,
                    color: '#8AA8C0', pointerEvents: 'none',
                  }}>&#9906;</span>
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      style={{
                        position: 'absolute', right: 8, top: '50%',
                        transform: 'translateY(-50%)', background: 'none',
                        border: 'none', color: '#8AA8C0', fontSize: 16,
                        cursor: 'pointer', padding: '0 4px', lineHeight: 1,
                      }}
                      aria-label={t('dash.cancel')}
                    >&times;</button>
                  )}
                </div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                  fontSize: 13, color: '#5A6272', fontFamily: 'var(--font-sans)',
                }}>
                  <span>{t('dash.sortBy')}:</span>
                  <select
                    value={sortMode}
                    onChange={e => setSortMode(e.target.value as 'recent' | 'name' | 'status')}
                    style={{
                      padding: '9px 12px', borderRadius: 10,
                      border: '1px solid #D0C9BE', background: '#fff',
                      color: '#1E2D40', fontSize: 14, fontFamily: 'var(--font-sans)',
                      cursor: 'pointer', outline: 'none',
                    }}
                  >
                    <option value="recent">{t('dash.sortRecent')}</option>
                    <option value="name">{t('dash.sortName')}</option>
                    <option value="status">{t('dash.sortStatus')}</option>
                  </select>
                </label>
              </div>
            )}

            {visibleProjects.length === 0 && search ? (
              <div style={{
                textAlign: 'center', padding: 60, color: '#8AA8C0',
                border: '1px dashed #D0C9BE', borderRadius: 12,
              }}>
                {t('dash.noMatches')}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 24,
              }}>
                {visibleProjects.map((project) => (
                  <ProjectCard
                    key={project.name}
                    project={project}
                    onClick={() => navigate(`/${encodeURIComponent(project.name)}`)}
                    onPowerUp={() => handlePowerUp(project.name)}
                    onShutdown={() => handleShutdown(project.name)}
                    onEdit={() => handleEdit(project)}
                    starting={starting === project.name}
                    stopping={stopping === project.name}
                  />
                ))}
                {!search && <NewTeamCard onClick={() => setShowCreate(true)} />}
              </div>
            )}
          </>
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
    </div>
  );
}

function EditProjectModal({ project, onClose, onSubmit, saving }: {
  project: Project;
  onClose: () => void;
  onSubmit: (description: string, agents: Array<{ role: string; cwd: string; name?: string; instructions?: string }>) => void;
  saving: boolean;
}) {
  const [description, setDescription] = useState(project.description ?? '');
  const [agents, setAgents] = useState<Array<{ role: string; cwd: string; name: string; instructions: string }>>(
    (project.agents ?? []).map((a: AgentConfig) => ({
      role: a.role,
      cwd: a.cwd,
      name: a.name ?? '',
      instructions: a.instructions ?? '',
    })),
  );

  const addRow = () => setAgents(prev => [...prev, { role: '', cwd: '', name: '', instructions: '' }]);
  const removeRow = (i: number) => setAgents(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: 'role' | 'cwd' | 'name' | 'instructions', value: string) => {
    setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };

  const roles = agents.map(a => a.role.trim());
  const hasDuplicate = roles.some((r, i) => r && roles.indexOf(r) !== i);
  const allValid = agents.length > 0 && agents.every(a => a.role.trim() && a.cwd.trim()) && !hasDuplicate;
  const canSubmit = allValid && !saving;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid #D0C9BE', fontSize: 14, fontFamily: 'var(--font-sans)',
    outline: 'none', background: '#fff', color: '#1E2D40',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 32,
          width: 620, maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 400,
          color: '#1E2D40', margin: '0 0 24px',
        }}>
          {t('dash.editTeamTitle', { name: project.name })}
        </h2>

        {/* Description */}
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272', display: 'block', marginBottom: 6 }}>
            {t('dash.description')}
          </span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('dash.descriptionPlaceholder')}
            style={inputStyle}
          />
        </label>

        {/* Agents */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272' }}>{t('dash.agents')}</span>
            <button
              onClick={addRow}
              style={{
                background: 'none', border: '1px solid #D0C9BE', borderRadius: 6,
                padding: '3px 10px', fontSize: 12, color: '#5A6272',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {t('dash.addAgent')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {agents.map((agent, i) => (
              <div key={i} style={{
                border: '1px solid #E2DDD4', borderRadius: 10, padding: 14,
                display: 'flex', flexDirection: 'column', gap: 8,
                background: '#FAFAF8',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={agent.role}
                    onChange={e => updateRow(i, 'role', e.target.value)}
                    placeholder={t('dash.agentRolePlaceholder')}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    value={agent.name}
                    onChange={e => updateRow(i, 'name', e.target.value)}
                    placeholder={t('dash.agentNamePlaceholder')}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => removeRow(i)}
                    title={t('dash.removeAgent')}
                    aria-label={t('dash.removeAgent')}
                    style={{
                      background: 'none', border: '1px solid #E8C0B0', borderRadius: 8,
                      padding: '8px 10px', cursor: 'pointer', color: '#DC3C3C',
                      fontSize: 14, flexShrink: 0, lineHeight: 1,
                    }}
                  >&times;</button>
                </div>
                <FolderPicker
                  value={agent.cwd}
                  onChange={(path) => updateRow(i, 'cwd', path)}
                />
                <textarea
                  value={agent.instructions}
                  onChange={e => updateRow(i, 'instructions', e.target.value)}
                  placeholder={t('dash.instructions')}
                  rows={2}
                  style={{
                    ...inputStyle,
                    resize: 'vertical', minHeight: 48,
                    fontFamily: 'var(--font-sans)', lineHeight: 1.45,
                  }}
                />
              </div>
            ))}
          </div>
          {hasDuplicate && (
            <div style={{ fontSize: 12, color: '#DC3C3C', marginTop: 8 }}>
              Duplicate roles are not allowed.
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #D0C9BE', borderRadius: 10,
              padding: '10px 20px', fontSize: 14, color: '#5A6272',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            {t('dash.cancel')}
          </button>
          <button
            onClick={() => { if (canSubmit) onSubmit(description.trim(), agents); }}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? '#E8823A' : '#D0C9BE', color: '#fff', border: 'none',
              padding: '10px 24px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
              opacity: saving ? 0.6 : 1,
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
  title, body, confirmLabel, cancelLabel, onConfirm, onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
              background: '#E8823A', color: '#fff', border: 'none',
              padding: '10px 20px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#D4732E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#E8823A'; }}
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
  onSubmit: (name: string, description: string, agents: Array<{ role: string; cwd: string }>) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agents, setAgents] = useState<Array<{ role: string; cwd: string }>>([
    { role: 'backend', cwd: '' },
  ]);

  const addAgent = () => setAgents(prev => [...prev, { role: '', cwd: '' }]);
  const removeAgent = (i: number) => setAgents(prev => prev.filter((_, idx) => idx !== i));
  const updateAgent = (i: number, field: 'role' | 'cwd', value: string) => {
    setAgents(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  };

  const canSubmit = name.trim() && agents.every(a => a.role.trim() && a.cwd.trim()) && !creating;

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid #D0C9BE', fontSize: 14, fontFamily: 'var(--font-sans)',
    outline: 'none', background: '#fff', color: '#1E2D40',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,24,36,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 32,
          width: 520, maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 400,
          color: '#1E2D40', margin: '0 0 24px',
        }}>
          {t('dash.newTeam')}
        </h2>

        {/* Name */}
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272', display: 'block', marginBottom: 6 }}>
            {t('dash.projectName')}
          </span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('dash.projectNamePlaceholder')}
            style={inputStyle}
            autoFocus
          />
        </label>

        {/* Description */}
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272', display: 'block', marginBottom: 6 }}>
            {t('dash.description')}
          </span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('dash.descriptionPlaceholder')}
            style={inputStyle}
          />
        </label>

        {/* Agents */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272' }}>{t('dash.agents')}</span>
            <button
              onClick={addAgent}
              style={{
                background: 'none', border: '1px solid #D0C9BE', borderRadius: 6,
                padding: '3px 10px', fontSize: 12, color: '#5A6272',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              {t('dash.addAgent')}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {agents.map((agent, i) => (
              <div key={i} style={{
                border: '1px solid #E2DDD4', borderRadius: 10, padding: 12,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={agent.role}
                    onChange={e => updateAgent(i, 'role', e.target.value)}
                    placeholder={t('dash.agentRolePlaceholder')}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {agents.length > 1 && (
                    <button
                      onClick={() => removeAgent(i)}
                      style={{
                        background: 'none', border: 'none', color: '#8AA8C0',
                        fontSize: 18, cursor: 'pointer', padding: '0 4px', flexShrink: 0,
                      }}
                    >
                      &times;
                    </button>
                  )}
                </div>
                <FolderPicker
                  value={agent.cwd}
                  onChange={(path) => updateAgent(i, 'cwd', path)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #D0C9BE', borderRadius: 10,
              padding: '10px 20px', fontSize: 14, color: '#5A6272',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            {t('dash.cancel')}
          </button>
          <button
            onClick={() => { if (canSubmit) onSubmit(name.trim(), description.trim(), agents); }}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? '#E8823A' : '#D0C9BE', color: '#fff', border: 'none',
              padding: '10px 24px', borderRadius: 10, fontSize: 14,
              fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? t('dash.creating') : t('dash.createTeam')}
          </button>
        </div>
      </div>
    </div>
  );
}
