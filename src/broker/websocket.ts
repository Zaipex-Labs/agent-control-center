import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';

export type BrokerEvent =
  | 'peer:connected'
  | 'peer:disconnected'
  | 'message:new'
  | 'shared:updated'
  | 'thread:created'
  | 'thread:updated';

interface WsClient {
  ws: WebSocket;
  projectId: string | null;
}

const clients = new Set<WsClient>();

let wss: WebSocketServer | null = null;

export function createWebSocketServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      const projectId = url.searchParams.get('project_id');
      const client: WsClient = { ws, projectId };
      clients.add(client);

      ws.on('close', () => {
        clients.delete(client);
      });

      ws.on('error', () => {
        clients.delete(client);
      });
    });
  });

  return wss;
}

export function broadcast(event: BrokerEvent, data: unknown, projectId?: string): void {
  const payload = JSON.stringify({ event, data });

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    // Send to all if no projectId filter, or if client subscribed to this project, or client has no filter
    if (!projectId || !client.projectId || client.projectId === projectId) {
      client.ws.send(payload);
    }
  }
}
