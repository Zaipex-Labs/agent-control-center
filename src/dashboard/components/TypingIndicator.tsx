import Avatar from './Avatar';
import type { Peer } from '../lib/types';
import { getDefaultName } from '../../shared/names';

const ROLE_COLORS: Record<string, string> = {
  backend: '#4A9FE8',
  frontend: '#E8823A',
  qa: '#534AB7',
  devops: '#3DBA7A',
};

interface TypingIndicatorProps {
  role: string;
  agents?: Peer[];
}

export default function TypingIndicator({ role, agents = [] }: TypingIndicatorProps) {
  const bg = ROLE_COLORS[role.toLowerCase()] ?? '#5A6272';
  const peer = agents.find(a => a.role === role);
  const displayName = peer?.name || role || '?';
  const seed = peer?.name || getDefaultName(role || 'agent');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
      <Avatar
        avatar={peer?.avatar ?? null}
        seed={seed}
        size={32}
        background={bg}
        title={displayName}
      />
      <div style={{
        background: 'var(--z-surface)',
        border: '1px solid var(--z-border)',
        borderRadius: '4px 14px 14px 14px',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{ ...dotStyle, animationDelay: '0s' }} />
        <span style={{ ...dotStyle, animationDelay: '0.2s' }} />
        <span style={{ ...dotStyle, animationDelay: '0.4s' }} />
      </div>
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--z-text-secondary)',
  animation: 'typing-bounce 1.2s infinite',
  display: 'inline-block',
};
