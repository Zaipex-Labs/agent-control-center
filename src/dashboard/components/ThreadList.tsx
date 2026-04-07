import { useState } from 'react';
import type { Thread } from '../lib/types';
import SearchBar from './SearchBar';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

interface ThreadCardProps {
  thread: Thread;
  active: boolean;
  onClick: () => void;
}

function ThreadCard({ thread, active, onClick }: ThreadCardProps) {
  const preview = thread.summary
    ? thread.summary.split('\n').pop() ?? ''
    : '';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        cursor: 'pointer',
        background: active ? 'rgba(232,130,58,0.08)' : 'transparent',
        borderLeft: active ? '3px solid var(--z-orange)' : '3px solid transparent',
        transition: 'background 0.15s',
        opacity: thread.status === 'archived' ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{
          fontSize: 14, fontWeight: 500, color: 'var(--z-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: '70%',
        }}>
          {thread.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--z-text-muted)', flexShrink: 0 }}>
          {timeAgo(thread.updated_at)}
        </span>
      </div>

      {preview && (
        <div style={{
          fontSize: 12, color: 'var(--z-text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          lineHeight: 1.4,
        }}>
          {preview}
        </div>
      )}
    </div>
  );
}

interface ThreadListProps {
  threads: Thread[];
  activeThread: Thread | null;
  onSelect: (thread: Thread) => void;
  onCreate: () => void;
  projectId: string;
}

export default function ThreadList({ threads, activeThread, onSelect, onCreate, projectId }: ThreadListProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [searchResults, setSearchResults] = useState<Thread[] | null>(null);

  const displayThreads = searchResults ?? threads;
  const active = displayThreads
    .filter(t => t.status === 'active')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const archived = displayThreads
    .filter(t => t.status === 'archived')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <div data-panel="threads" style={{
      width: 300, flexShrink: 0,
      borderRight: '1px solid var(--z-border)',
      display: 'flex', flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 16px 12px',
        borderBottom: '1px solid var(--z-border)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--z-text)', letterSpacing: -0.2 }}>
          Conversaciones
        </span>
        <button
          onClick={onCreate}
          style={{
            background: 'none', border: '1px solid var(--z-border)',
            color: 'var(--z-text-secondary)', fontSize: 12, fontWeight: 500,
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--z-orange)'; e.currentTarget.style.color = 'var(--z-orange)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--z-border)'; e.currentTarget.style.color = 'var(--z-text-secondary)'; }}
        >
          + Nuevo
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <SearchBar projectId={projectId} onResults={setSearchResults} />
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        {active.length === 0 && archived.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--z-text-muted)', fontSize: 13 }}>
            Sin conversaciones aun.
          </div>
        )}

        {active.map(t => (
          <ThreadCard
            key={t.id}
            thread={t}
            active={activeThread?.id === t.id}
            onClick={() => onSelect(t)}
          />
        ))}

        {/* Archived section */}
        {archived.length > 0 && (
          <>
            <div
              onClick={() => setShowArchived(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '12px 16px 6px', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, color: 'var(--z-text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.8,
                userSelect: 'none',
              }}
            >
              <span style={{
                display: 'inline-block', transform: showArchived ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s', fontSize: 10,
              }}>&#9654;</span>
              Archivadas ({archived.length})
            </div>
            {showArchived && archived.map(t => (
              <ThreadCard
                key={t.id}
                thread={t}
                active={activeThread?.id === t.id}
                onClick={() => onSelect(t)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
