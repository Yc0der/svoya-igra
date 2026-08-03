import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import sirv from 'sirv';
import type { Room, RoomState } from './room.js';
import type {
  ClientMessage,
  ParticipantView,
  ServerMessage,
} from './protocol.js';

export interface CreateServerOptions {
  room: Room;
  clientDistPath: string;
  lanUrl: string;
}

export interface GameServer {
  httpServer: HttpServer;
  close(): Promise<void>;
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function toParticipantView(state: RoomState): ParticipantView[] {
  return state.participants.map(({ id, name, connected }) => ({
    id,
    name,
    connected,
  }));
}

export function createServer(options: CreateServerOptions): GameServer {
  const { room, clientDistPath, lanUrl } = options;
  const assets = sirv(clientDistPath, { single: true });

  const httpServer = createHttpServer((req, res) => {
    assets(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const connections = new Map<WebSocket, string>();

  const broadcastState = (): void => {
    const message: ServerMessage = {
      type: 'state',
      participants: toParticipantView(room.getState()),
    };
    const payload = JSON.stringify(message);
    // Deferred to a microtask so that a direct, synchronous reply to the
    // triggering client (e.g. the 'joined' confirmation sent right after
    // room.join()/room.reconnect() returns, later in the same 'message'
    // handler) is written to that client's socket before this broadcast
    // reaches it. room.join()/room.reconnect() call this synchronously as
    // part of their own execution, before the handler gets a chance to send
    // its direct reply; without the defer, the client would see its own
    // broadcasted 'state' before its 'joined' confirmation.
    queueMicrotask(() => {
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    });
  };

  room.onChange(broadcastState);

  wss.on('connection', (ws) => {
    send(ws, { type: 'hello', lanUrl });
    send(ws, {
      type: 'state',
      participants: toParticipantView(room.getState()),
    });

    ws.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (message.type === 'join') {
        const result = room.join(message.name);
        if ('error' in result) {
          send(ws, { type: 'name-taken' });
          return;
        }
        connections.set(ws, result.participant.id);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'reconnect') {
        const result = room.reconnect(message.token);
        if ('error' in result) {
          send(ws, { type: 'invalid-token' });
          return;
        }
        connections.set(ws, result.participant.id);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }
    });

    ws.on('close', () => {
      const participantId = connections.get(ws);
      if (participantId) {
        connections.delete(ws);
        room.disconnect(participantId);
      }
    });
  });

  return {
    httpServer,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
