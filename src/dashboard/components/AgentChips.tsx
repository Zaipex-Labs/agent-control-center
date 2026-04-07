import type { Peer } from '../lib/types';

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

function Chip({ peer, active, onClick }: { peer: Peer; active: boolean; onClick?: () => void }) {
  const initial = (peer.name || peer.role || '?')[0].toUpperCase();
  const bg = roleColor(peer.role);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: active ? 'rgba(232,130,58,0.1)' : 'var(--z-surface)',
        borderRadius: 10,
        padding: '6px 14px 6px 6px',
        border: active ? '1px solid var(--z-orange)' : '1px solid var(--z-border)',
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: bg, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 600,
      }}>
        {initial}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--z-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {peer.name || peer.role}
        </div>
        <div style={{ fontSize: 11, color: 'var(--z-text-muted)' }}>{peer.role}</div>
      </div>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: 'var(--z-green)',
        marginLeft: 4, flexShrink: 0,
      }} />
    </div>
  );
}

function AddChip() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      borderRadius: 10, padding: '6px 14px 6px 6px',
      border: '1px dashed var(--z-border)',
      cursor: 'pointer', flexShrink: 0,
      transition: 'border-color 0.2s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--z-orange)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '1px dashed var(--z-text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: 'var(--z-text-muted)',
      }}>+</div>
      <span style={{ fontSize: 13, color: 'var(--z-text-muted)' }}>Agente</span>
    </div>
  );
}

interface AgentChipsProps {
  agents: Peer[];
  activeRoles?: Set<string>;
  onChipClick?: (peer: Peer) => void;
}

export default function AgentChips({ agents, activeRoles, onChipClick }: AgentChipsProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 0',
      overflowX: 'auto',
    }}>
      {agents.map((p) => (
        <Chip
          key={p.id}
          peer={p}
          active={activeRoles?.has(p.role) ?? false}
          onClick={onChipClick ? () => onChipClick(p) : undefined}
        />
      ))}
      <AddChip />
    </div>
  );
}
