import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../lib/types';
import type { WaitingReply, SendError } from '../hooks/useMessages';
import MessageBubble from './MessageBubble';
import CoordinationBlock from './CoordinationBlock';
import TypingIndicator from './TypingIndicator';
import { t, getLang } from '../../shared/i18n/browser';

function formatDateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const locale = getLang();

  if (d.toDateString() === today.toDateString()) {
    return `${t('dash.today')}, ${d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `${t('dash.yesterday')}, ${d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}`;
  }
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

// A chat item is either a single message (user or agent-to-user) or a coordination block
type ChatItem =
  | { kind: 'message'; message: LogEntry }
  | { kind: 'coordination'; messages: LogEntry[] };

function isUserMessage(m: LogEntry): boolean {
  return m.from_role === 'user' || m.from_id === 'user' || m.from_id === 'cli';
}

function isToUser(m: LogEntry): boolean {
  return m.to_role === 'user';
}

function buildChatItems(messages: LogEntry[]): ChatItem[] {
  const items: ChatItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];

    // User messages and agent-to-user messages show as full bubbles
    if (isUserMessage(m) || isToUser(m)) {
      items.push({ kind: 'message', message: m });
      i++;
      continue;
    }

    // Agent-to-agent: collect consecutive coordination messages
    const block: LogEntry[] = [m];
    let j = i + 1;
    while (j < messages.length && !isUserMessage(messages[j]) && !isToUser(messages[j])) {
      block.push(messages[j]);
      j++;
    }
    items.push({ kind: 'coordination', messages: block });
    i = j;
  }

  return items;
}

interface ChatProps {
  messages: LogEntry[];
  loading: boolean;
  waitingFor?: WaitingReply | null;
  sendError?: SendError | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}

// How fresh a coordination block has to be to still show the live
// typing indicator (ms).
const LIVE_WINDOW_MS = 20_000;

export default function Chat({ messages, loading, waitingFor, sendError, onRetry, onDismissError }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // Force a re-render periodically so the "live" check against current time
  // updates and the typing indicator fades out once the block has gone quiet.
  const [, setNowTick] = useState(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(n => n + 1), 4_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--z-text-muted)', fontSize: 14,
      }}>
        {t('dash.loadingMessages')}
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
        <div style={{ fontSize: 14 }}>{t('dash.noMessagesInThread')}</div>
      </div>
    );
  }

  const items = buildChatItems(messages);
  let lastDay = '';

  // A coordination block is "live" if it's the last item in the chat AND its
  // most recent message arrived within LIVE_WINDOW_MS.
  const lastIdx = items.length - 1;
  const lastItem = items[lastIdx];
  const now = Date.now();
  const isLastCoordLive =
    lastItem && lastItem.kind === 'coordination' &&
    (now - new Date(lastItem.messages[lastItem.messages.length - 1].sent_at).getTime()) < LIVE_WINDOW_MS;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {items.map((item, idx) => {
        const sentAt = item.kind === 'message' ? item.message.sent_at : item.messages[0].sent_at;
        const currentDay = dayKey(sentAt);
        const showSeparator = currentDay !== lastDay;
        lastDay = currentDay;
        const itemKey = item.kind === 'message' ? item.message.id : `coord-${item.messages[0].id}`;

        return (
          <div key={itemKey}>
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
                  {formatDateSeparator(sentAt)}
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--z-border)' }} />
              </div>
            )}
            {item.kind === 'message' ? (
              <MessageBubble message={item.message} />
            ) : (
              <CoordinationBlock messages={item.messages} live={idx === lastIdx && isLastCoordLive} />
            )}
          </div>
        );
      })}
      {/* Typing indicator */}
      {waitingFor && (
        <TypingIndicator role={waitingFor.toRole} />
      )}

      {/* Send error toast */}
      {sendError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(220,60,60,0.1)', border: '1px solid rgba(220,60,60,0.25)',
          borderRadius: 10, padding: '10px 14px',
        }}>
          <span style={{ fontSize: 13, color: '#DC3C3C', flex: 1 }}>
            {t('dash.sendFailed', { role: sendError.toRole })}
          </span>
          {onRetry && (
            <button onClick={onRetry} style={{
              background: 'var(--z-orange)', color: '#fff', border: 'none',
              padding: '5px 12px', borderRadius: 6, fontSize: 12,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
              {t('dash.retry')}
            </button>
          )}
          {onDismissError && (
            <button onClick={onDismissError} style={{
              background: 'none', border: 'none', color: 'var(--z-text-muted)',
              fontSize: 16, cursor: 'pointer', padding: '0 4px',
            }}>
              &times;
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
