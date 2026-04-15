import { useState } from 'react';
import type { Thread, Peer } from '../lib/types';
import SearchBar from './SearchBar';
import Avatar from './Avatar';
import { t } from '../../shared/i18n/browser';
import { getDefaultName } from '../../shared/names';
import { roleStyle } from '../lib/roles';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('dash.now');
  if (mins < 60) return t('dash.mins', { mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('dash.hrs', { hrs });
  const days = Math.floor(hrs / 24);
  return t('dash.days', { days });
}

interface ThreadCardProps {
  thread: Thread;
  active: boolean;
  agents: Peer[];
  onClick: () => void;
}

function ThreadCard({ thread, active, agents, onClick }: ThreadCardProps) {
  const preview = thread.summary
    ? thread.summary.split('\n').pop() ?? ''
    : '';

  const participantRoles = thread.participants ?? [];
  // Cap at 4 avatars visible — extra get "+N" chip.
  const visible = participantRoles.slice(0, 4);
  const extra = participantRoles.length - visible.length;

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
          marginBottom: visible.length > 0 ? 8 : 0,
        }}>
          {preview}
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: preview ? 0 : 6 }}>
          {visible.map((role, i) => {
            const peer = agents.find(a => a.role === role);
            const seed = peer?.name || getDefaultName(role);
            const bg = roleStyle(role).avatar;
            return (
              <div
                key={role}
                title={peer?.name || role}
                style={{
                  marginLeft: i === 0 ? 0 : -8,
                  border: '2px solid var(--z-navy-deep)',
                  borderRadius: '50%',
                  display: 'inline-block',
                }}
              >
                <Avatar
                  avatar={peer?.avatar ?? null}
                  seed={seed}
                  size={22}
                  background={bg}
                />
              </div>
            );
          })}
          {extra > 0 && (
            <span style={{
              marginLeft: -6,
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--z-text-muted)',
              background: 'var(--z-surface)',
              border: '2px solid var(--z-navy-deep)',
              borderRadius: '50%',
              width: 22, height: 22,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              +{extra}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface ThreadListProps {
  threads: Thread[];
  activeThread: Thread | null;
  agents: Peer[];
  onSelect: (thread: Thread) => void;
  onCreate: () => void;
  projectId: string;
}

export default function ThreadList({ threads, activeThread, agents, onSelect, onCreate, projectId }: ThreadListProps) {
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
          {t('dash.conversations')}
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
          {t('dash.new')}
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
            {t('dash.noConversations')}
          </div>
        )}

        {active.map(t => (
          <ThreadCard
            key={t.id}
            thread={t}
            agents={agents}
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
              {t('dash.archived', { count: archived.length })}
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
