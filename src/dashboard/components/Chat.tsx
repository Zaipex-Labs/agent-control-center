import { useEffect, useRef, useState } from 'react';
import type { LogEntry, Peer } from '../lib/types';
import type { WaitingReply, SendError } from '../hooks/useMessages';
import MessageBubble from './MessageBubble';
import MeetingBlock, { buildMeetingTree, type MeetingNode } from './Meeting';
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

// A feed item is either a user-facing message bubble or a group of
// coordination messages rendered as a (possibly nested) meeting tree.
type FeedItem =
  | { kind: 'message'; message: LogEntry }
  | { kind: 'meetings'; nodes: MeetingNode[]; lastMessage: LogEntry };

function isUserMessage(m: LogEntry): boolean {
  return m.from_role === 'user' || m.from_id === 'user' || m.from_id === 'cli';
}

function isToUser(m: LogEntry): boolean {
  return m.to_role === 'user';
}

// "Filler" agent → user messages like "preguntando a front, espera" should
// be hidden from the feed because they split what is really a single
// meeting into two separate coordination blocks. A message counts as
// filler when it's:
//   - from an agent to the user
//   - short (<= 140 chars after stripping markdown)
//   - contains one of these stalling verbs
// The prompt already forbids them (U4b), but we also drop them visually
// in case an agent slips up.
const FILLER_RE = /\b(preguntando|consultando|verificando|esperando|espera|coordin(ando|aré|aré)|checking|asking|voy a (pregunt|consult|verific)|let me (ask|check))\b/i;

function isFiller(m: LogEntry): boolean {
  if (!isToUser(m)) return false;
  if (isUserMessage(m)) return false;
  const text = m.text.trim();
  if (text.length === 0 || text.length > 160) return false;
  return FILLER_RE.test(text);
}

function buildFeedItems(messages: LogEntry[], agents: Peer[]): FeedItem[] {
  // Drop filler "voy a preguntar a X" messages — they split meetings.
  const filtered = messages.filter(m => !isFiller(m));

  const items: FeedItem[] = [];
  let buffer: LogEntry[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const nodes = buildMeetingTree(buffer, agents);
    items.push({ kind: 'meetings', nodes, lastMessage: buffer[buffer.length - 1] });
    buffer = [];
  };

  for (const m of filtered) {
    const isCoord = !isUserMessage(m) && !isToUser(m);
    if (isCoord) {
      buffer.push(m);
    } else {
      flushBuffer();
      items.push({ kind: 'message', message: m });
    }
  }
  flushBuffer();

  return items;
}

interface ChatProps {
  messages: LogEntry[];
  agents: Peer[];
  loading: boolean;
  waitingFor?: WaitingReply | null;
  sendError?: SendError | null;
  onRetry?: () => void;
  onDismissError?: () => void;
  flashMessageId?: number | null;
}

// How fresh a coordination block has to be to still show the live
// typing indicator (ms).
const LIVE_WINDOW_MS = 20_000;

export default function Chat({ messages, agents, loading, waitingFor, sendError, onRetry, onDismissError, flashMessageId }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
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

  // When the parent asks us to flash a specific message (e.g. the user
  // clicked a file paper in the work desk), scroll to it and kick off the
  // temporary yellow highlight animation.
  useEffect(() => {
    if (flashMessageId == null) return;
    const el = messageRefs.current.get(flashMessageId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [flashMessageId]);

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

  const items = buildFeedItems(messages, agents);
  let lastDay = '';

  // The last meetings block in the feed is "live" if its most recent
  // message arrived within LIVE_WINDOW_MS — that drives the typing dots.
  const lastIdx = items.length - 1;
  const lastItem = items[lastIdx];
  const now = Date.now();
  const isLastMeetingLive =
    lastItem && lastItem.kind === 'meetings' &&
    (now - new Date(lastItem.lastMessage.sent_at).getTime()) < LIVE_WINDOW_MS;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {items.map((item, idx) => {
        const sentAt = item.kind === 'message'
          ? item.message.sent_at
          : item.nodes[0]?.messages[0]?.sent_at ?? item.lastMessage.sent_at;
        const currentDay = dayKey(sentAt);
        const showSeparator = currentDay !== lastDay;
        lastDay = currentDay;
        const itemKey = item.kind === 'message'
          ? `m-${item.message.id}`
          : `t-${item.nodes[0]?.firstMessageId ?? idx}`;
        const isLiveHere = idx === lastIdx && !!isLastMeetingLive;

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
              <MessageBubble
                key={`${item.message.id}-${flashMessageId === item.message.id ? 'flash' : 'normal'}`}
                message={item.message}
                agents={agents}
                flash={flashMessageId === item.message.id}
                ref={el => {
                  if (el) messageRefs.current.set(item.message.id, el);
                  else messageRefs.current.delete(item.message.id);
                }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {item.nodes.map((n, ni) => (
                  <MeetingBlock
                    key={n.firstMessageId}
                    node={n}
                    agents={agents}
                    live={isLiveHere && ni === item.nodes.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {/* Typing indicator */}
      {waitingFor && (
        <TypingIndicator role={waitingFor.toRole} agents={agents} />
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
