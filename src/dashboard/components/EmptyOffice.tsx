import { t } from '../../shared/i18n/browser';

interface EmptyOfficeProps {
  onCreate?: () => void;
}

// Shown in the workspace when no thread is active. Two dark desks, a
// sleepy window with a moon, a few "z" floating above. Optional CTA to
// start a new thread right from here.
export default function EmptyOffice({ onCreate }: EmptyOfficeProps) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 40,
    }}>
      <svg viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg" width={280} height={180}>
        {/* Back wall */}
        <rect x="0" y="0" width="280" height="140" fill="#141f2e" />
        {/* Floor */}
        <rect x="0" y="140" width="280" height="40" fill="#1a2840" />

        {/* Window with moon and stars */}
        <rect x="100" y="16" width="80" height="60" rx="4" fill="#0f1824" stroke="#243d58" strokeWidth="1.5" />
        <line x1="140" y1="16" x2="140" y2="76" stroke="#243d58" strokeWidth="1" />
        <line x1="100" y1="46" x2="180" y2="46" stroke="#243d58" strokeWidth="1" />
        <circle cx="128" cy="38" r="7" fill="#e2ddd4" opacity=".75" />
        <circle cx="132" cy="34" r="5" fill="#0f1824" />
        <circle cx="112" cy="26" r="1" fill="#c8d8e8" opacity=".6" />
        <circle cx="156" cy="30" r="1" fill="#c8d8e8" opacity=".5" />
        <circle cx="166" cy="54" r="1" fill="#c8d8e8" opacity=".4" />

        {/* Left desk */}
        <rect x="18" y="108" width="90" height="5" rx="2" fill="#3a4a5c" />
        <rect x="22" y="113" width="3" height="30" fill="#2a3a4c" />
        <rect x="101" y="113" width="3" height="30" fill="#2a3a4c" />
        {/* Left monitor (off) */}
        <rect x="40" y="76" width="48" height="32" rx="3" fill="#1a2535" />
        <rect x="42" y="78" width="44" height="26" rx="1" fill="#0f1824" />
        <rect x="60" y="108" width="8" height="2" fill="#1a2535" />
        {/* Left chair */}
        <ellipse cx="60" cy="138" rx="14" ry="4" fill="#243d58" opacity=".6" />

        {/* Right desk */}
        <rect x="172" y="108" width="90" height="5" rx="2" fill="#3a4a5c" />
        <rect x="176" y="113" width="3" height="30" fill="#2a3a4c" />
        <rect x="255" y="113" width="3" height="30" fill="#2a3a4c" />
        <rect x="194" y="76" width="48" height="32" rx="3" fill="#1a2535" />
        <rect x="196" y="78" width="44" height="26" rx="1" fill="#0f1824" />
        <rect x="214" y="108" width="8" height="2" fill="#1a2535" />
        <ellipse cx="214" cy="138" rx="14" ry="4" fill="#243d58" opacity=".6" />

        {/* Sleepy "z" floating above */}
        <text x="60" y="66" fontFamily="JetBrains Mono" fontSize="14" fill="#3a6a8a" opacity=".55" fontWeight="500">z</text>
        <text x="70" y="56" fontFamily="JetBrains Mono" fontSize="10" fill="#3a6a8a" opacity=".4" fontWeight="500">z</text>
        <text x="78" y="48" fontFamily="JetBrains Mono" fontSize="8" fill="#3a6a8a" opacity=".3" fontWeight="500">z</text>

        <text x="214" y="64" fontFamily="JetBrains Mono" fontSize="14" fill="#3a6a8a" opacity=".55" fontWeight="500">z</text>
        <text x="224" y="54" fontFamily="JetBrains Mono" fontSize="10" fill="#3a6a8a" opacity=".4" fontWeight="500">z</text>
      </svg>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 12,
        color: 'var(--z-text-muted)', marginTop: 16,
        textAlign: 'center',
      }}>
        {t('dash.emptyOfficeTitle')}
      </div>
      <div style={{
        fontSize: 12, color: '#2a5a7a', marginTop: 4,
        textAlign: 'center',
      }}>
        {t('dash.emptyOfficeSub')}
      </div>
      {onCreate && (
        <button
          onClick={onCreate}
          style={{
            marginTop: 22,
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
            letterSpacing: 0.4,
            padding: '10px 22px', borderRadius: 10,
            background: '#E8823A', color: '#fff', border: 'none',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#D4732E'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#E8823A'; }}
        >
          + {t('dash.createThreadCta')}
        </button>
      )}
    </div>
  );
}
