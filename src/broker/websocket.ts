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
  | 'agent:status';

interface WsClient {
  ws: WebSocket;
  projectId: string | null;
}

const clients = new Set<WsClient>();

const wss = new WebSocketServer({ noServer: true });

export function handleEventsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, projectId: string | null): void {
  if (!isAllowedOrigin(req)) {
    console.error(`[broker:ws] rejecting /ws upgrade from origin=${JSON.stringify(req.headers.origin)} remote=${req.socket.remoteAddress}`);
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client: WsClient = { ws, projectId };
    clients.add(client);

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });
}

export function broadcast(event: BrokerEvent, data: unknown, projectId?: string): void {
  const payload = JSON.stringify({ event, data });

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!projectId || !client.projectId || client.projectId === projectId) {
      client.ws.send(payload);
    }
  }
}
