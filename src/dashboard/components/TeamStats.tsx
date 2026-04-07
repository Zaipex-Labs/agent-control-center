import type { Peer, LogEntry } from '../lib/types';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatDuration(ms: number): string {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0',
    }}>
      <span style={{ fontSize: 12, color: 'var(--z-text-secondary)' }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 600, color: 'var(--z-text)',
        fontFamily: 'var(--font-mono)',
      }}>
        {value}
      </span>
    </div>
  );
}

interface TeamStatsProps {
  agents: Peer[];
  messages: LogEntry[];
}

export default function TeamStats({ agents, messages }: TeamStatsProps) {
  const today = new Date().toDateString();
  const todayMessages = messages.filter(m => new Date(m.sent_at).toDateString() === today).length;

  const contractMessages = messages.filter(m => m.type === 'contract_update').length;

  const latestActivity = agents.length > 0
    ? agents.reduce((latest, p) => p.last_seen > latest ? p.last_seen : latest, agents[0].last_seen)
    : null;

  const earliestRegistered = agents.length > 0
    ? agents.reduce((earliest, p) => p.registered_at < earliest ? p.registered_at : earliest, agents[0].registered_at)
    : null;

  const activeTime = earliestRegistered
    ? Date.now() - new Date(earliestRegistered).getTime()
    : 0;

  return (
    <div>
      <h3 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--z-text)',
        marginBottom: 12, letterSpacing: -0.2,
      }}>
        Actividad del equipo
      </h3>
      <div style={{
        border: '1px solid var(--z-border)', borderRadius: 8,
        padding: '4px 12px',
        display: 'flex', flexDirection: 'column',
      }}>
        <Stat label="Mensajes hoy" value={String(todayMessages)} />
        <div style={{ height: 1, background: 'var(--z-border)' }} />
        <Stat label="Contratos" value={String(contractMessages)} />
        <div style={{ height: 1, background: 'var(--z-border)' }} />
        <Stat label="Tiempo activo" value={activeTime > 0 ? formatDuration(activeTime) : '--'} />
        <div style={{ height: 1, background: 'var(--z-border)' }} />
        <Stat label="Ultima actividad" value={latestActivity ? timeAgo(latestActivity) : '--'} />
      </div>
    </div>
  );
}
