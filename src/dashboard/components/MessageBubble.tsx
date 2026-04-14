import ReactMarkdown from 'react-markdown';
import type { LogEntry } from '../lib/types';
import { t, getLang } from '../../shared/i18n/browser';

const ROLE_COLORS: Record<string, string> = {
  backend: '#4A9FE8',
  frontend: '#E8823A',
  qa: '#534AB7',
  data: '#534AB7',
  devops: '#3DBA7A',
};

const TYPE_TAGS: Record<string, { key: string; color: string }> = {
  question: { key: 'dash.type.question', color: '#4A9FE8' },
  response: { key: 'dash.type.response', color: '#3DBA7A' },
  contract_update: { key: 'dash.type.contractUpdate', color: '#E8823A' },
  notification: { key: 'dash.type.notification', color: '#E8823A' },
  task_request: { key: 'dash.type.taskRequest', color: '#534AB7' },
  task_complete: { key: 'dash.type.taskComplete', color: '#3DBA7A' },
  message: { key: 'dash.type.message', color: '#534AB7' },
};

function roleColor(role: string): string {
  return ROLE_COLORS[role.toLowerCase()] ?? '#5A6272';
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
}

function isJson(text: string): boolean {
  const t = text.trimStart();
  return (t.startsWith('{') || t.startsWith('[')) && t.length > 2;
}

// useMessages prepends a thread-context line when the user sends a message
// so the target agent knows which thread to reply in. That wrapper is saved
// to message_log, so when the session reloads the stored text looks like
// `[Hilo: X | thread_id: Y] Responde usando send_message con thread_id="Y". <original>`.
// Strip that prefix here so the user only ever sees the clean text they typed.
const THREAD_PREFIX_RE =
  /^\[Hilo:[^\]]*\]\s*Responde usando send_message con thread_id="[^"]*"\.\s*/;

function stripThreadPrefix(text: string): string {
  return text.replace(THREAD_PREFIX_RE, '');
}

interface MessageBubbleProps {
  message: LogEntry;
  compact?: boolean;
}

export default function MessageBubble({ message, compact = false }: MessageBubbleProps) {
  const isUser = message.from_id === 'user' || message.from_id === 'cli' || message.from_role === 'user';
  const avatarSize = compact ? 22 : 32;
  const initial = isUser
    ? 'JM'
    : (message.from_role || '?')[0].toUpperCase();
  const avatarBg = isUser ? '#3DBA7A' : roleColor(message.from_role);
  const tag = TYPE_TAGS[message.type] ?? TYPE_TAGS.message;
  const tagLabel = t(tag.key);
  const cleanText = isUser ? stripThreadPrefix(message.text) : message.text;
  const jsonContent = isJson(cleanText);

  return (
    <div style={{
      display: 'flex', gap: compact ? 8 : 12,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      ...(compact && {
        marginLeft: isUser ? 0 : 44,
        marginRight: isUser ? 44 : 0,
        borderLeft: isUser ? 'none' : '2px solid rgba(232,130,58,0.2)',
        paddingLeft: isUser ? 0 : 12,
        background: isUser ? 'transparent' : 'rgba(232,130,58,0.05)',
        borderRadius: compact ? 10 : 0,
        padding: compact ? '8px 12px' : undefined,
      }),
    }}>
      {/* Avatar */}
      <div style={{
        width: avatarSize, height: avatarSize, borderRadius: '50%',
        background: avatarBg, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: compact ? 9 : 13, fontWeight: 600,
        flexShrink: 0, fontFamily: 'var(--font-sans)',
      }}>
        {initial}
      </div>

      <div style={{ minWidth: 0, maxWidth: '75%' }}>
        {/* Header */}
        {!compact && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 4, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--z-text)' }}>
              {isUser ? t('dash.you') : (message.from_role || message.from_id)}
            </span>
            {message.to_role && (
              <span style={{ fontSize: 12, color: 'var(--z-text-muted)' }}>
                &rarr; {message.to_role}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px',
              borderRadius: 4, background: `${tag.color}18`,
              color: tag.color, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {tagLabel}
            </span>
            <span style={{
              fontSize: 11, color: 'var(--z-text-muted)',
              fontFamily: 'var(--font-mono)', marginLeft: 'auto',
            }}>
              {formatTime(message.sent_at)}
            </span>
          </div>
        )}

        {/* Bubble */}
        <div className="msg-bubble" style={{
          background: isUser ? 'rgba(74,159,232,0.09)' : 'var(--z-surface)',
          border: `1px solid ${isUser ? 'rgba(74,159,232,0.15)' : 'var(--z-border)'}`,
          borderRadius: isUser
            ? '14px 4px 14px 14px'
            : '4px 14px 14px 14px',
          padding: compact ? '6px 10px' : '10px 14px',
          fontSize: compact ? 12 : 14,
          lineHeight: 1.55,
          color: jsonContent ? '#3DBA7A' : 'var(--z-text)',
          fontFamily: jsonContent ? 'var(--font-mono)' : 'var(--font-sans)',
          wordBreak: 'break-word',
        }}>
          {jsonContent ? (
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{cleanText}</pre>
          ) : (
            <ReactMarkdown>{cleanText}</ReactMarkdown>
          )}
        </div>

        {/* Compact time */}
        {compact && (
          <div style={{
            fontSize: 10, color: 'var(--z-text-muted)',
            fontFamily: 'var(--font-mono)', marginTop: 2,
          }}>
            {formatTime(message.sent_at)}
          </div>
        )}
      </div>
    </div>
  );
}
