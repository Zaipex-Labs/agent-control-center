// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState } from 'react';
import Avatar from './Avatar';
import type { LogEntry, Peer } from '../lib/types';
import { t, getLang } from '../../shared/i18n/browser';
import { roleStyle } from '../lib/roles';
import { getDefaultName } from '../../shared/names';

// ── Types ────────────────────────────────────────────────────
//
// A MeetingNode is a single "call" between two agents, potentially
// containing nested sub-calls made by the callee before they responded.
// The tree is built by buildMeetingTree() from a flat list of agent ↔
// agent messages (already filtered — no user messages reach here).

export interface MeetingNode {
  caller: string;      // display name of the agent who initiated
  callee: string;      // display name of the agent who received
  callerRole: string;
  calleeRole: string;
  messages: LogEntry[];
  subCalls: MeetingNode[];
  topic: string;
  firstMessageId: string;
}

// ── Phrases ──────────────────────────────────────────────────
//
// Funny rotating phrases so the meeting header doesn't always say the
// same thing. The phrase is picked deterministically from the id of the
// first message in the block, so it stays stable across re-renders.

type CallPhrase = (a: string, b: string) => string;
const CALL_PHRASES: CallPhrase[] = [
  (a, b) => `${a} llamó a ${b}`,
  (a, b) => `${a} le marcó a ${b}`,
  (a, b) => `${a} le tocó la puerta a ${b}`,
  (a, b) => `${a} le aventó un papelito a ${b}`,
  (a, b) => `${a} le mandó un memo a ${b}`,
  (a, b) => `${a} le gritó a ${b} desde su escritorio`,
  (a, b) => `${a} interceptó a ${b} en el pasillo`,
  (a, b) => `${a} le hizo una seña a ${b}`,
  (a, b) => `${a} citó a ${b} en la sala chica`,
  (a, b) => `${a} le pasó una nota a ${b}`,
  (a, b) => `${a} y ${b} cuchichearon en el pasillo`,
  (a, b) => `${a} y ${b} tuvieron un stand-up de 2`,
  (a, b) => `${a} y ${b} platicaron en el café`,
  (a, b) => `${a} y ${b} intercambiaron notas secretas`,
  (a, b) => `${a} y ${b} hicieron videollamada`,
  (a, b) => `${a} y ${b} se mandaron palomas mensajeras`,
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getCallPhrase(seed: string, a: string, b: string): string {
  const index = hashCode(seed) % CALL_PHRASES.length;
  return CALL_PHRASES[index](a, b);
}

// ── Name resolution ─────────────────────────────────────────

function resolveName(
  role: string,
  fromId: string | undefined,
  agents: Peer[],
): string {
  // First try an exact id match (more reliable when multiple peers share a role)
  if (fromId) {
    const byId = agents.find(p => p.id === fromId);
    if (byId?.name) return byId.name;
  }
  // Fall back to the first peer with this role
  const byRole = agents.find(p => p.role === role);
  if (byRole?.name) return byRole.name;
  // Last resort: scientist-style default derived from the role
  return getDefaultName(role || 'agent');
}

// ── Topic derivation ────────────────────────────────────────

function deriveTopic(messages: LogEntry[]): string {
  for (const m of messages) {
    if (!m.metadata) continue;
    try {
      const parsed = JSON.parse(m.metadata);
      if (parsed && typeof parsed.topic === 'string' && parsed.topic.trim()) {
        return parsed.topic.trim();
      }
    } catch {
      // Not JSON — skip
    }
  }
  const first = messages[0];
  if (!first) return '';
  const clean = first.text.replace(/^\[Hilo:[^\]]*\][^.]*\.\s*/, '').trim();
  const words = clean.split(/\s+/).slice(0, 7);
  let topic = words.join(' ');
  if (clean.split(/\s+/).length > 7) topic += '…';
  return topic;
}

// ── Tree builder ────────────────────────────────────────────
//
// Builds the nested meeting tree from a sequence of agent ↔ agent
// messages. The model is a list of "open calls" — not a strict stack —
// so parallel conversations don't collapse into each other.
//
//   - When a message arrives between agents A and B, we look for an
//     existing call where the pair {caller, callee} matches (in either
//     direction) and append to it. This handles back-and-forth between
//     the same pair even when other calls are running in parallel.
//   - If no existing call matches, we create a new one. The parent is
//     the most recent open call where the speaker (A) is the callee —
//     i.e. A was asked something and is now asking someone else before
//     answering. That nests the new call as a sub-call.
//   - Calls stay open forever within the same feed buffer. That's fine
//     because the buffer is bounded (the chunk of consecutive
//     agent-agent messages passed in by buildFeedItems).

export function buildMeetingTree(coordMessages: LogEntry[], agents: Peer[]): MeetingNode[] {
  const roots: MeetingNode[] = [];
  const openCalls: MeetingNode[] = [];

  const findExistingCall = (a: string, b: string): MeetingNode | undefined => {
    for (let i = openCalls.length - 1; i >= 0; i--) {
      const c = openCalls[i];
      if ((c.caller === a && c.callee === b) || (c.caller === b && c.callee === a)) {
        return c;
      }
    }
    return undefined;
  };

  const findParentFor = (speaker: string): MeetingNode | undefined => {
    // A is making a new outgoing call. If A was the callee of some open
    // call, the new call is a sub-call of that one.
    for (let i = openCalls.length - 1; i >= 0; i--) {
      if (openCalls[i].callee === speaker) return openCalls[i];
    }
    return undefined;
  };

  for (const msg of coordMessages) {
    const fromName = resolveName(msg.from_role, msg.from_id, agents);
    const toName = resolveName(msg.to_role, msg.to_id, agents);

    // Does this message belong to an already-open conversation between
    // the same pair? (Matches either direction.)
    const existing = findExistingCall(fromName, toName);
    if (existing) {
      existing.messages.push(msg);
      continue;
    }

    // New call. Figure out if it's nested inside another one.
    const parentCall = findParentFor(fromName);
    const newCall: MeetingNode = {
      caller: fromName,
      callee: toName,
      callerRole: msg.from_role,
      calleeRole: msg.to_role || '',
      messages: [msg],
      subCalls: [],
      topic: deriveTopic([msg]),
      firstMessageId: String(msg.id ?? msg.sent_at),
    };

    if (parentCall) {
      parentCall.subCalls.push(newCall);
    } else {
      roots.push(newCall);
    }
    openCalls.push(newCall);
  }

  // Post-pass: refresh topic so it can pick up metadata from later messages.
  const refresh = (n: MeetingNode): void => {
    n.topic = deriveTopic(n.messages);
    n.subCalls.forEach(refresh);
  };
  roots.forEach(refresh);

  return roots;
}

function countAllMessages(node: MeetingNode): number {
  let total = node.messages.length;
  for (const sub of node.subCalls) total += countAllMessages(sub);
  return total;
}

// ── Rendering ───────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
}

function MeetingScene({ callerColor, calleeColor, size = 'normal' }: {
  callerColor: string;
  calleeColor: string;
  size?: 'normal' | 'small';
}) {
  const w = size === 'small' ? 44 : 64;
  const h = size === 'small' ? 34 : 48;
  return (
    <svg viewBox="0 0 44 34" xmlns="http://www.w3.org/2000/svg" width={w} height={h} style={{ flexShrink: 0, display: 'block' }}>
      <rect x="0" y="28" width="44" height="6" fill="#0f1824" />
      <rect x="2" y="18" width="16" height="10" rx="1.5" fill="#243d58" />
      <rect x="4" y="20" width="12" height="6" rx="1" fill={callerColor} opacity=".45" />
      <rect x="26" y="18" width="16" height="10" rx="1.5" fill="#243d58" />
      <rect x="28" y="20" width="12" height="6" rx="1" fill={calleeColor} opacity=".45" />
      <line x1="18" y1="23" x2="26" y2="23" stroke="#3DBA7A" strokeWidth="1.5" strokeDasharray="2 1.5" opacity=".75" />
      <circle cx="22" cy="23" r="3" fill="none" stroke="#3DBA7A" strokeWidth="1" opacity=".55" />
    </svg>
  );
}

// Circular "token" for an agent: first initial on a colored background.
// Used in meeting headers next to the names.
function AgentToken({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.42), fontWeight: 600,
      flexShrink: 0,
      boxShadow: '0 0 0 2px rgba(26,40,64,0.95)',
    }}>
      {initial}
    </div>
  );
}

function InlineTypingDots() {
  const dot: React.CSSProperties = {
    width: 5, height: 5, borderRadius: '50%',
    background: 'var(--z-text-secondary)',
    animation: 'typing-bounce 1.2s infinite',
    display: 'inline-block',
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 10,
      background: 'rgba(74,159,232,0.08)',
      border: '1px solid rgba(74,159,232,0.2)',
    }}>
      <span style={{ ...dot, animationDelay: '0s' }} />
      <span style={{ ...dot, animationDelay: '0.2s' }} />
      <span style={{ ...dot, animationDelay: '0.4s' }} />
    </span>
  );
}

function CoordMessage({ entry, agents }: { entry: LogEntry; agents: Peer[] }) {
  const style = roleStyle(entry.from_role);
  const peer = agents.find(a => a.id === entry.from_id) ?? agents.find(a => a.role === entry.from_role);
  const displayName = peer?.name || entry.from_role || entry.from_id || '?';
  const seed = peer?.name || getDefaultName(entry.from_role || 'agent');
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 0',
      borderBottom: '1px solid rgba(36,61,88,0.5)',
    }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <Avatar
          avatar={peer?.avatar ?? null}
          seed={seed}
          size={20}
          background={style.avatar}
          title={displayName}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--z-text-muted)', marginBottom: 2,
        }}>
          {displayName} → {entry.to_role} · {formatTime(entry.sent_at)}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--z-text-secondary)',
          lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {entry.text}
        </div>
      </div>
    </div>
  );
}

interface MeetingBlockProps {
  node: MeetingNode;
  depth?: number;
  live?: boolean;
  agents?: Peer[];
}

export default function MeetingBlock({ node, depth = 0, live = false, agents = [] }: MeetingBlockProps) {
  // All meetings start collapsed — the user expands what they care about.
  const [open, setOpen] = useState(false);

  const callerColor = roleStyle(node.callerRole).avatar;
  const calleeColor = roleStyle(node.calleeRole).avatar;
  const phrase = getCallPhrase(node.firstMessageId, node.caller, node.callee);
  const total = countAllMessages(node);
  const countLabel = total === 1
    ? t('dash.messagesSingular', { count: total })
    : t('dash.messagesPlural', { count: total });

  const nested = depth > 0;

  return (
    <div style={{
      marginLeft: nested ? 16 : 0,
      marginTop: nested ? 6 : 0,
      marginBottom: nested ? 6 : 0,
      borderLeft: nested ? `2px solid ${callerColor}` : 'none',
      paddingLeft: nested ? 12 : 0,
    }}>
      <div style={{
        borderRadius: 12,
        border: '1px solid var(--z-border)',
        borderLeft: `3px solid ${callerColor}`,
        overflow: 'hidden',
        background: 'var(--z-surface)',
      }}>
        <div
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: nested ? 8 : 10,
            padding: nested ? '6px 10px' : '8px 12px',
            cursor: 'pointer',
            transition: 'background 0.15s',
            userSelect: 'none',
            backgroundImage: `linear-gradient(90deg, ${callerColor}12 0%, transparent 40%, ${calleeColor}10 100%)`,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(90deg, ${callerColor}22 0%, #1E3048 45%, ${calleeColor}20 100%)`; }}
          onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(90deg, ${callerColor}12 0%, transparent 40%, ${calleeColor}10 100%)`; }}
        >
          <MeetingScene callerColor={callerColor} calleeColor={calleeColor} size="small" />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <AgentToken name={node.caller} color={callerColor} size={18} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: 'var(--z-text)' }}>
              {node.caller}
            </span>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="var(--z-text-muted)" strokeWidth={2} style={{ flexShrink: 0 }}>
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            <AgentToken name={node.callee} color={calleeColor} size={18} />
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: 'var(--z-text)' }}>
              {node.callee}
            </span>
            <span style={{
              fontFamily: 'var(--font-serif)', fontSize: 12, fontStyle: 'italic',
              color: 'var(--z-text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: '1 1 auto', minWidth: 0,
            }}>
              {phrase}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--z-text-muted)', flexShrink: 0,
            }}>
              {countLabel}{node.topic ? ` · ${node.topic}` : ''}
            </span>
            {live && !nested && <InlineTypingDots />}
          </div>

          <svg
            width={20} height={20}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            style={{
              color: 'var(--z-text-muted)', flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>

        {open && (
          <div style={{
            padding: '0 14px 10px',
            background: 'var(--z-navy-dark)',
            borderTop: '1px solid var(--z-border)',
          }}>
            <NodeBody node={node} live={live && !nested} agents={agents} />
          </div>
        )}
      </div>
    </div>
  );
}

// Renders direct messages and nested sub-calls in chronological order.
function NodeBody({ node, live, agents }: { node: MeetingNode; live: boolean; agents: Peer[] }) {
  type Item =
    | { kind: 'msg'; entry: LogEntry; at: number }
    | { kind: 'sub'; node: MeetingNode; at: number };

  const items: Item[] = [];
  for (const m of node.messages) {
    items.push({ kind: 'msg', entry: m, at: new Date(m.sent_at).getTime() });
  }
  for (const s of node.subCalls) {
    const at = s.messages[0] ? new Date(s.messages[0].sent_at).getTime() : 0;
    items.push({ kind: 'sub', node: s, at });
  }
  items.sort((a, b) => a.at - b.at);

  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'msg') return <CoordMessage key={`m-${i}`} entry={it.entry} agents={agents} />;
        return <MeetingBlock key={`s-${i}`} node={it.node} depth={1} agents={agents} />;
      })}
      {live && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--z-surface)', border: '1px dashed var(--z-border)',
          }} />
          <InlineTypingDots />
        </div>
      )}
    </>
  );
}
