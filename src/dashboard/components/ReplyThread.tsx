import type { LogEntry } from '../lib/types';
import MessageBubble from './MessageBubble';

interface ReplyThreadProps {
  replies: LogEntry[];
}

export default function ReplyThread({ replies }: ReplyThreadProps) {
  if (replies.length === 0) return null;

  return (
    <div style={{
      marginLeft: 44,
      borderLeft: '2px solid rgba(232,130,58,0.2)',
      paddingLeft: 12,
      display: 'flex', flexDirection: 'column', gap: 6,
      marginTop: 4,
    }}>
      {replies.map((r) => (
        <MessageBubble key={r.id} message={r} compact />
      ))}
    </div>
  );
}
