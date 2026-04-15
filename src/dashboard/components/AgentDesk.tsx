import { roleStyle } from '../lib/roles';

// A 56×48 pixel-style mini-desk SVG. Replaces the plain circular avatar
// in the workspace sidebar. Three states drive the look:
//
//   - working  → monitor on with role-specific content, pulsing orange
//                status light, chair tinted with the role color
//   - waiting  → monitor with static content, no animation, dimmer chair
//   - offline  → monitor dark, "z" floating above, everything desaturated
//
// Role picks a different content style for the monitor so each desk feels
// like a different workstation.

export type DeskState = 'working' | 'waiting' | 'offline';

interface AgentDeskProps {
  role: string;
  state: DeskState;
  size?: number;
}

function MonitorContent({ role, on }: { role: string; on: boolean }) {
  if (!on) return null;
  const r = role.toLowerCase();
  if (r === 'backend' || r === 'data' || r === 'ml' || r === 'devops') {
    return (
      <g>
        <line x1="18" y1="18" x2="32" y2="18" stroke="#3DBA7A" strokeWidth="1" opacity=".8" />
        <line x1="18" y1="21" x2="30" y2="21" stroke="#4A9FE8" strokeWidth=".8" opacity=".5" />
        <line x1="18" y1="24" x2="27" y2="24" stroke="#534AB7" strokeWidth=".8" opacity=".3" />
      </g>
    );
  }
  if (r === 'frontend' || r === 'ui' || r === 'design') {
    return (
      <g>
        <rect x="18" y="16" width="8" height="5" rx="1" fill="#E8823A" opacity=".3" />
        <rect x="28" y="16" width="6" height="5" rx="1" fill="#4A9FE8" opacity=".25" />
        <rect x="18" y="22" width="16" height="2" rx=".5" fill="#3DBA7A" opacity=".2" />
      </g>
    );
  }
  if (r === 'qa' || r === 'test' || r === 'tests') {
    return (
      <g>
        <rect x="18" y="16" width="3" height="3" rx=".5" fill="#3DBA7A" opacity=".6" />
        <line x1="23" y1="18" x2="32" y2="18" stroke="#8aa8c0" strokeWidth="1" opacity=".5" />
        <rect x="18" y="21" width="3" height="3" rx=".5" fill="#3DBA7A" opacity=".6" />
        <line x1="23" y1="23" x2="30" y2="23" stroke="#8aa8c0" strokeWidth="1" opacity=".5" />
      </g>
    );
  }
  if (r === 'arquitectura' || r === 'architect' || r === 'architecture') {
    return (
      <g>
        <rect x="18" y="16" width="5" height="4" rx="1" fill="none" stroke="#4A9FE8" strokeWidth=".8" opacity=".6" />
        <rect x="29" y="16" width="5" height="4" rx="1" fill="none" stroke="#4A9FE8" strokeWidth=".8" opacity=".6" />
        <line x1="23" y1="18" x2="29" y2="18" stroke="#E8823A" strokeWidth=".8" opacity=".5" />
        <rect x="22" y="22" width="10" height="3" rx=".5" fill="none" stroke="#3DBA7A" strokeWidth=".8" opacity=".5" />
      </g>
    );
  }
  // Generic fallback
  return (
    <g>
      <line x1="18" y1="18" x2="32" y2="18" stroke="#8aa8c0" strokeWidth="1" opacity=".5" />
      <line x1="18" y1="21" x2="28" y2="21" stroke="#8aa8c0" strokeWidth=".8" opacity=".3" />
    </g>
  );
}

export default function AgentDesk({ role, state, size = 56 }: AgentDeskProps) {
  const style = roleStyle(role);
  const height = Math.round(size * (48 / 56));
  const on = state !== 'offline';
  const working = state === 'working';

  return (
    <svg
      viewBox="0 0 56 48"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={height}
      style={{ flexShrink: 0, display: 'block' }}
    >
      {/* Floor shadow */}
      <rect x="0" y="38" width="56" height="10" fill="#1a2840" />

      {/* Desk top */}
      <rect
        x="8" y="28" width="40" height="4" rx="1"
        fill="#8aa8c0"
        opacity={on ? 0.3 : 0.15}
      />
      {/* Desk legs */}
      {on && (
        <>
          <rect x="10" y="30" width="2" height="8" fill="#5a6272" opacity=".4" />
          <rect x="44" y="30" width="2" height="8" fill="#5a6272" opacity=".4" />
        </>
      )}

      {/* Monitor bezel */}
      <rect
        x="14" y="12" width="24" height="16" rx="2"
        fill={on ? '#1E2D40' : '#1a2535'}
      />
      {/* Monitor screen */}
      <rect
        x="16" y="14" width="20" height="12" rx="1"
        fill={on ? '#141f2e' : '#111a28'}
      />

      {/* Monitor content varies by role, only when on */}
      <MonitorContent role={role} on={on} />

      {/* Monitor stand */}
      <rect x="24" y="28" width="4" height="1" fill={on ? '#1E2D40' : '#1a2535'} />

      {/* Working dot (pulse) */}
      {working && (
        <>
          <circle cx="44" cy="20" r="1.5" fill="#E8823A" opacity=".7">
            <animate attributeName="opacity" values=".7;.2;.7" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <rect x="40" y="24" width="7" height="5" rx="1.5" fill="#E8823A" opacity=".25" />
        </>
      )}

      {/* Chair — colored with the role accent */}
      {on && (
        <ellipse
          cx="26" cy="36" rx="9" ry="3"
          fill={style.avatar}
          opacity={working ? 0.22 : 0.14}
        />
      )}

      {/* Offline: Z's floating above the desk */}
      {!on && (
        <>
          <text x="30" y="10" fontFamily="JetBrains Mono" fontSize="7" fill="#3a6a8a" opacity=".4" textAnchor="middle" fontWeight="500">z</text>
          <text x="36" y="6" fontFamily="JetBrains Mono" fontSize="5" fill="#3a6a8a" opacity=".3" fontWeight="500">z</text>
        </>
      )}
    </svg>
  );
}
