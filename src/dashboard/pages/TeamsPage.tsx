import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects, projectUp, createProject, addAgent } from '../lib/api';
import type { Project } from '../lib/types';

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
  if (mins < 1) return 'justo ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
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

function ProjectCard({ project, onClick, onPowerUp, starting }: { project: Project; onClick: () => void; onPowerUp: () => void; starting: boolean }) {
  const isActive = project.active_peers > 0;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{
          fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400,
          color: '#1E2D40', margin: 0,
        }}>
          {project.name}
        </h3>
        <span style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
          background: isActive ? '#E8F7EF' : '#F0F0F0',
          color: isActive ? '#2A8B5A' : '#8A8A8A',
          letterSpacing: 0.3,
        }}>
          {isActive ? 'Activo' : 'Inactivo'}
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
                  }} title="Online" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span style={{ fontSize: 12, color: '#8AA8C0' }}>
          Ultima actividad: {timeAgo(lastActivity)}
        </span>
        {!isActive && project.agents.length > 0 && (
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
            {starting ? 'Encendiendo...' : 'Encender'}
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
      <span style={{ fontSize: 14, color: '#8AA8C0', fontWeight: 500 }}>Crear nuevo equipo</span>
    </div>
  );
}

export default function TeamsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = () => listProjects().then(setProjects).catch(() => {});

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  const handlePowerUp = async (name: string) => {
    setStarting(name);
    setError(null);
    try {
      await projectUp(name);
      // Wait for agents to register, then reload
      setTimeout(reload, 3000);
      setTimeout(() => setStarting(null), 4000);
    } catch (e) {
      setError(`Error al encender ${name}: ${e instanceof Error ? e.message : String(e)}`);
      setStarting(null);
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
      setError(`Error al crear: ${e instanceof Error ? e.message : String(e)}`);
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
            Agents Command Center
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
          Nuevo equipo
        </button>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 40px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{
            fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 400,
            color: '#1E2D40', margin: 0, marginBottom: 8,
          }}>
            Tus equipos
          </h1>
          <p style={{ color: '#5A6272', fontSize: 16, margin: 0 }}>
            Gestiona tus equipos de agentes y sus proyectos.
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

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#8AA8C0' }}>
            Cargando proyectos...
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 24,
          }}>
            {projects.map((project) => (
              <ProjectCard
                key={project.name}
                project={project}
                onClick={() => navigate(`/${encodeURIComponent(project.name)}`)}
                onPowerUp={() => handlePowerUp(project.name)}
                starting={starting === project.name}
              />
            ))}
            <NewTeamCard onClick={() => setShowCreate(true)} />
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
          Nuevo equipo
        </h2>

        {/* Name */}
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272', display: 'block', marginBottom: 6 }}>
            Nombre del proyecto
          </span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="mi-proyecto"
            style={inputStyle}
            autoFocus
          />
        </label>

        {/* Description */}
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272', display: 'block', marginBottom: 6 }}>
            Descripcion
          </span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Descripcion del proyecto (opcional)"
            style={inputStyle}
          />
        </label>

        {/* Agents */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#5A6272' }}>Agentes</span>
            <button
              onClick={addAgent}
              style={{
                background: 'none', border: '1px solid #D0C9BE', borderRadius: 6,
                padding: '3px 10px', fontSize: 12, color: '#5A6272',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              + Agregar
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agents.map((agent, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={agent.role}
                  onChange={e => updateAgent(i, 'role', e.target.value)}
                  placeholder="Rol (backend, frontend...)"
                  style={{ ...inputStyle, width: '40%' }}
                />
                <input
                  value={agent.cwd}
                  onChange={e => updateAgent(i, 'cwd', e.target.value)}
                  placeholder="Directorio de trabajo (/home/user/app)"
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
            Cancelar
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
            {creating ? 'Creando...' : 'Crear equipo'}
          </button>
        </div>
      </div>
    </div>
  );
}
