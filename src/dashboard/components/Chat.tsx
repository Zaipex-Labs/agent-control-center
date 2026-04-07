import { useEffect, useRef } from 'react';
import type { LogEntry } from '../lib/types';
import MessageBubble from './MessageBubble';
import ReplyThread from './ReplyThread';

function formatDateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return `Hoy, ${d.toLocaleDateString('es', { day: 'numeric', month: 'long' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Ayer, ${d.toLocaleDateString('es', { day: 'numeric', month: 'long' })}`;
  }
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

interface MessageGroup {
  parent: LogEntry;
  replies: LogEntry[];
}

function groupMessages(messages: LogEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const parent = messages[i];
    const replies: LogEntry[] = [];
    let j = i + 1;

    // Collect replies: messages where to_id matches the parent's from_id
    while (j < messages.length && messages[j].to_id === parent.from_id) {
      replies.push(messages[j]);
      j++;
    }

    groups.push({ parent, replies });
    i = j;
  }

  return groups;
}

interface ChatProps {
  messages: LogEntry[];
  loading: boolean;
}

export default function Chat({ messages, loading }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--z-text-muted)', fontSize: 14,
      }}>
        Cargando mensajes...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--z-text-muted)',
      }}>
        <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>&#9993;</div>
        <div style={{ fontSize: 14 }}>Sin mensajes en este hilo.</div>
      </div>
    );
  }

  const groups = groupMessages(messages);
  let lastDay = '';

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {groups.map((group) => {
        const currentDay = dayKey(group.parent.sent_at);
        const showSeparator = currentDay !== lastDay;
        lastDay = currentDay;

        return (
          <div key={group.parent.id}>
            {showSeparator && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                margin: '8px 0 12px',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--z-border)' }} />
                <span style={{
                  fontSize: 11, color: 'var(--z-text-muted)', fontWeight: 500,
                  whiteSpace: 'nowrap', textTransform: 'capitalize',
                }}>
                  {formatDateSeparator(group.parent.sent_at)}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--z-border)' }} />
              </div>
            )}
            <MessageBubble message={group.parent} />
            <ReplyThread replies={group.replies} />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
