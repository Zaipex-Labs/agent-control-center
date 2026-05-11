// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isAllowedOrigin, rejectUpgrade } from './origin.js';

export type BrokerEvent =
  | 'peer:connected'
  | 'peer:disconnected'
  | 'message:new'
  | 'shared:updated'
  | 'thread:created'
  | 'thread:updated'
  | 'thread:deleted'
  | 'agent:status'
  // FASE C-1 (v0.3.2). Three-phase spawn progress: pty_ready when the
  // claude child process spawns; mcp_ready when its banner appears
  // (claude has loaded its MCP servers); registered when the in-agent
  // MCP server hits /api/register. Payload: { role, phase }. Dashboard
  // listens via useSpawnPhases to render a per-agent checklist during
  // the "Encender" flow.
  | 'agent:spawning';

interface WsClient {
  ws: WebSocket;
  projectId: string | null;
  // [P-4] flipped to true on every server-sent ping; flipped to false
  // on the corresponding 'pong'. If a heartbeat tick finds it still
  // true, the peer never replied → terminate the socket.
  alive: boolean;
}

const clients = new Set<WsClient>();

const wss = new WebSocketServer({ noServer: true });

// [P-4] backpressure threshold + heartbeat cadence. 1 MB matches the
// terminal-side limit so a slow tab can't accumulate broadcast frames
// indefinitely; 30s is shorter than any common reverse-proxy idle
// timeout (60s+) and still cheap.
const BROADCAST_BUFFER_LIMIT = 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (!client.alive) {
        // No pong since the previous tick — half-open connection.
        // terminate() drops the socket immediately, the 'close' handler
        // removes it from the Set.
        try { client.ws.terminate(); } catch { /* ignore */ }
        clients.delete(client);
        continue;
      }
      client.alive = false;
      try { client.ws.ping(); } catch { /* ignore — close handler cleans up */ }
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the event loop alive just for the heartbeat — broker
  // shutdown wants a clean exit.
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function handleEventsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, projectId: string | null): void {
  if (!isAllowedOrigin(req)) {
    console.error(`[broker:ws] rejecting /ws upgrade from origin=${JSON.stringify(req.headers.origin)} remote=${req.socket.remoteAddress}`);
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client: WsClient = { ws, projectId, alive: true };
    clients.add(client);
    ensureHeartbeat();

    // [P-4] reset liveness flag on every pong; the heartbeat tick uses
    // it to detect half-open TCP sockets that close()/error() never
    // fire on (e.g. laptop closes lid mid-session).
    ws.on('pong', () => { client.alive = true; });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });
}

// Close every connected dashboard client. Called from the broker
// shutdown path so browsers see a clean 1001 instead of a TCP RST.
export function closeAllEventsClients(): void {
  for (const client of clients) {
    try { client.ws.close(1001, 'Broker shutting down'); } catch { /* ignore */ }
  }
  clients.clear();
  // [P-4] tear the heartbeat down so the broker process can exit
  // cleanly on shutdown.
  stopHeartbeat();
}

export function broadcast(event: BrokerEvent, data: unknown, projectId?: string): void {
  const payload = JSON.stringify({ event, data });

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (projectId && client.projectId && client.projectId !== projectId) continue;
    // [P-4] drop the frame if the per-client send buffer is already
    // saturated. A slow client must not be allowed to balloon the
    // broker's heap — they'll see the next event after the OS drains
    // the socket. This is a feature-event stream, not a transport;
    // missing one update is recoverable from the next /api/* read.
    if (client.ws.bufferedAmount > BROADCAST_BUFFER_LIMIT) continue;
    try { client.ws.send(payload); } catch { /* ignore — close handler cleans up */ }
  }
}
