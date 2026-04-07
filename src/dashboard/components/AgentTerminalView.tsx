import { useState } from 'react';
import Terminal from './Terminal';

interface TerminalTab {
  role: string;
  name: string;
}

interface AgentTerminalViewProps {
  projectId: string;
  tabs: TerminalTab[];
  onClose: () => void;
}

export default function AgentTerminalView({ projectId, tabs, onClose }: AgentTerminalViewProps) {
  const [activeTab, setActiveTab] = useState(0);

  if (tabs.length === 0) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderTop: '1px solid var(--z-border)',
      height: '50%', minHeight: 200,
      background: '#141F2E',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid var(--z-border)',
        padding: '0 8px', height: 36, flexShrink: 0,
        background: 'var(--z-navy-dark)',
        gap: 2,
      }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.role}
            onClick={() => setActiveTab(i)}
            style={{
              background: i === activeTab ? '#141F2E' : 'transparent',
              border: 'none',
              borderBottom: i === activeTab ? '2px solid var(--z-orange)' : '2px solid transparent',
              color: i === activeTab ? 'var(--z-text)' : 'var(--z-text-muted)',
              fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)',
              padding: '6px 14px', cursor: 'pointer',
              transition: 'color 0.1s',
            }}
          >
            {tab.name} <span style={{ color: 'var(--z-text-muted)', fontSize: 10 }}>({tab.role})</span>
          </button>
        ))}

        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: 'var(--z-text-muted)', fontSize: 16, cursor: 'pointer',
            padding: '4px 8px', lineHeight: 1,
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--z-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--z-text-muted)'; }}
          title="Cerrar terminales"
        >
          &times;
        </button>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, position: 'relative' }}>
        {tabs.map((tab, i) => (
          <div
            key={tab.role}
            style={{
              position: 'absolute', inset: 0,
              padding: 4,
              display: i === activeTab ? 'block' : 'none',
            }}
          >
            <Terminal
              projectId={projectId}
              role={tab.role}
              visible={i === activeTab}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
