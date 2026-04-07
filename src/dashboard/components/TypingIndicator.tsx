const ROLE_COLORS: Record<string, string> = {
  backend: '#4A9FE8',
  frontend: '#E8823A',
  qa: '#534AB7',
  devops: '#3DBA7A',
};

interface TypingIndicatorProps {
  role: string;
}

export default function TypingIndicator({ role }: TypingIndicatorProps) {
  const bg = ROLE_COLORS[role.toLowerCase()] ?? '#5A6272';
  const initial = (role || '?')[0].toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: bg, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 600,
      }}>
        {initial}
      </div>
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
