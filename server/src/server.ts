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

/**
 * Как часто сервер пингует клиентов. Умерший сокет обнаруживается на втором
 * тике, то есть в худшем случае через два интервала.
 *
 * Зачем вообще: когда на телефоне падает Wi-Fi, радио просто перестаёт
 * отвечать — ни FIN, ни RST до сервера не доходит. Клиент видит `close`
 * мгновенно и начинает переподключаться, а сервер без пингов узнал бы о смерти
 * сокета только по таймауту TCP-ретрансмиссии, а это минуты. Всё это время
 * участник висел бы на табло как подключённый, и обещанное дизайном
 * «(отключён)» не появлялось бы вовсе.
 */
export const HEARTBEAT_INTERVAL_MS = 5000;

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
  // Tracks which socket currently "owns" each participant, so a stale
  // socket's 'close' event can't disconnect a participant who has already
  // reconnected on a different socket in the meantime.
  const owners = new Map<string, WebSocket>();

  // Не один общий payload на всех: `correctAnswer` на judging в режиме с
  // ведущим обязан дойти только до сокета ведущего (protocol.ts,
  // GameStateView.correctAnswer) — остальным, включая табло, строится
  // отдельное сообщение с viewerId = null/чужой id, и Room.toGameStateView
  // сама скрывает в нём ответ.
  const stateMessageFor = (viewerId: string | null): ServerMessage => ({
    type: 'state',
    participants: toParticipantView(room.getState()),
    hostParticipantId: room.getState().hostParticipantId,
    game: room.toGameStateView(viewerId),
  });

  const broadcastState = (): void => {
    // Deferred to a microtask so that a direct, synchronous reply to the
    // triggering client (e.g. the 'joined' confirmation sent right after
    // room.join()/room.reconnect() returns, later in the same 'message'
    // handler) is written to that client's socket before this broadcast
    // reaches it. room.join()/room.reconnect() call this synchronously as
    // part of their own execution, before the handler gets a chance to send
    // its direct reply; without the defer, the client would deterministically
    // see its own broadcasted 'state' before its 'joined' confirmation, since
    // both are written to the same TCP stream in that order.
    //
    // Why here and not elsewhere: reordering the handler to send 'joined'
    // before calling room.join() is impossible — the confirmation needs the
    // data join() produces. Deferring inside Room itself was rejected to keep
    // Room synchronous and free of transport-timing concerns (it doesn't know
    // about sockets or delivery order, and shouldn't have to). This defers
    // only the broadcast side, at the one place two writes to the same socket
    // actually interleave.
    queueMicrotask(() => {
      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          send(ws, stateMessageFor(connections.get(ws) ?? null));
        }
      }
    });
  };

  room.onChange(broadcastState);

  // `ws`, будучи прицепленным к готовому httpServer, переподписывает его
  // 'error' на себя. Без слушателя здесь EventEmitter на 'error' бросает
  // исключение — то есть даже обработанная ошибка httpServer (тот же
  // EADDRINUSE) всё равно ронял бы процесс сырым стеком, уже через wss.
  // Осмысленное сообщение печатает владелец порта (index.ts), тут только
  // не даём событию превратиться в исключение и оставляем след для диагностики.
  wss.on('error', (err) => {
    console.error('Ошибка WebSocket-сервера:', err);
  });

  // Сокеты, ответившие на последний пинг (или только что подключившиеся).
  // WeakSet, чтобы закрытые сокеты не удерживались в памяти.
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    send(ws, { type: 'hello', lanUrl });
    send(ws, stateMessageFor(connections.get(ws) ?? null));

    ws.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (message.type === 'join' && typeof message.name === 'string') {
        const result = room.join(message.name);
        if ('error' in result) {
          send(ws, { type: 'name-taken' });
          return;
        }
        connections.set(ws, result.participant.id);
        owners.set(result.participant.id, ws);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'reconnect' && typeof message.token === 'string') {
        const result = room.reconnect(message.token);
        if ('error' in result) {
          send(ws, { type: 'invalid-token' });
          return;
        }
        connections.set(ws, result.participant.id);
        owners.set(result.participant.id, ws);
        send(ws, {
          type: 'joined',
          participantId: result.participant.id,
          token: result.participant.token,
          name: result.participant.name,
        });
      }

      if (message.type === 'start-game') {
        const participantId = connections.get(ws);
        if (participantId) {
          const result = room.startGame();
          if ('error' in result) {
            send(ws, { type: 'start-game-error', reason: result.error });
          }
        }
      }

      if (message.type === 'toggle-host') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.toggleHost(participantId);
        }
      }

      if (message.type === 'select-question') {
        const participantId = connections.get(ws);
        if (
          participantId &&
          typeof message.themeIndex === 'number' &&
          typeof message.questionId === 'string'
        ) {
          room.selectQuestion(
            participantId,
            message.themeIndex,
            message.questionId,
          );
        }
      }

      if (message.type === 'buzz') {
        const participantId = connections.get(ws);
        if (participantId && room.buzz(participantId) === 'falsestart') {
          send(ws, { type: 'falsestart' });
        }
      }

      if (message.type === 'said-answer') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.saidAnswer(participantId);
        }
      }

      if (message.type === 'vote') {
        const participantId = connections.get(ws);
        if (participantId && typeof message.correct === 'boolean') {
          room.vote(participantId, message.correct);
        }
      }

      if (message.type === 'adjust-score') {
        const participantId = connections.get(ws);
        if (
          participantId &&
          typeof message.participantId === 'string' &&
          typeof message.delta === 'number'
        ) {
          room.adjustScore(participantId, message.participantId, message.delta);
        }
      }

      if (message.type === 'cancel-question') {
        const participantId = connections.get(ws);
        if (participantId) {
          room.cancelQuestion(participantId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('Ошибка WebSocket-соединения:', err);
    });

    ws.on('close', () => {
      const participantId = connections.get(ws);
      connections.delete(ws);
      if (participantId && owners.get(participantId) === ws) {
        owners.delete(participantId);
        room.disconnect(participantId);
      }
    });
  });

  // Стандартный для `ws` хартбит: на каждом тике добиваем тех, кто не ответил
  // на пинг предыдущего тика, остальных помечаем «не ответившими» и пингуем.
  // `terminate()` рвёт сокет и вызывает штатный обработчик 'close' — то есть
  // участник помечается отключённым тем же путём (через защиту `owners`),
  // что и при обычном закрытии вкладки.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Unref'd so this interval alone can't keep the event loop alive. On a
  // successful start the listening httpServer (and any open WS connections)
  // already hold their own refs, so the process still stays up normally.
  // The reason this matters: when httpServer.listen() fails (e.g. EADDRINUSE
  // in index.ts), createServer() has already run and this interval is
  // ticking, but close() — the only thing that clearInterval()s it — never
  // gets called, because the caller never got a server to close. A ref'd
  // timer in that state keeps the process running forever despite
  // process.exitCode being set, which is exactly the busy-port hang this
  // fixes.
  heartbeat.unref();

  return {
    httpServer,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(heartbeat);
        wss.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
