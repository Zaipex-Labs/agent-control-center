import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

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
