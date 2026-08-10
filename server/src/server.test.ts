import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from './room.js';
import {
  createServer,
  HEARTBEAT_INTERVAL_MS,
  type GameServer,
} from './server.js';
import type { ServerMessage } from './protocol.js';
import type { Pack } from './pack.js';
import { REVEAL_TIMER_MS, VOTE_TIMER_MS } from './engine.js';

// Attaches a persistent 'message' listener synchronously at socket creation
// (before any await), so no frame can ever arrive unheard even if the server
// sends multiple messages immediately on connection and they land in the same
// underlying TCP read as the handshake response. Returns a function that
// resolves with the next message, queueing messages that arrive before
// they're asked for.
//
// Why a queue and not artificial delays (setTimeout/setImmediate) on the
// server side: delays only mask the race by giving the OS time to deliver the
// handshake and first frame as separate reads — they don't fix the actual
// problem (a listener attached after the event already fired) and add
// arbitrary latency to the real server for no protocol reason. Attaching the
// listener before any await is the only fix that works regardless of timing.
function collectMessages(ws: WebSocket): () => Promise<ServerMessage> {
  const queue: ServerMessage[] = [];
  const waiters: ((msg: ServerMessage) => void)[] = [];

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
    } else {
      queue.push(message);
    }
  });

  return () =>
    new Promise((resolve) => {
      const next = queue.shift();
      if (next) {
        resolve(next);
      } else {
        waiters.push(resolve);
      }
    });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('open', () => resolve()));
}

describe('createServer', () => {
  let server: GameServer;
  let url: string;
  let port: number;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-server-'));
    const room = new Room();
    server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    ({ port } = server.httpServer.address() as AddressInfo);
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('sends hello then the current state on connect', async () => {
    const ws = new WebSocket(url);
    const nextMessage = collectMessages(ws);
    await waitForOpen(ws);

    const hello = await nextMessage();
    expect(hello).toEqual({
      type: 'hello',
      lanUrl: 'http://192.168.1.1:8080/',
    });

    const state = await nextMessage();
    expect(state).toEqual({
      type: 'state',
      participants: [],
      hostParticipantId: null,
      game: null,
    });

    ws.close();
  });

  it('lets a client join and broadcasts the new state to everyone connected', async () => {
    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
    await nextBoardMessage();
    await nextBoardMessage();

    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
    await nextPlayerMessage();
    await nextPlayerMessage();

    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));

    const joined = await nextPlayerMessage();
    expect(joined).toMatchObject({ type: 'joined', name: 'Ваня' });

    const boardState = await nextBoardMessage();
    expect(boardState).toEqual({
      type: 'state',
      participants: [
        {
          id: (joined as { participantId: string }).participantId,
          name: 'Ваня',
          connected: true,
        },
      ],
      hostParticipantId: null,
      game: null,
    });

    board.close();
    player.close();
  });

  it('rejects a duplicate name without crashing the connection', async () => {
    const first = new WebSocket(url);
    const nextFirstMessage = collectMessages(first);
    await waitForOpen(first);
    await nextFirstMessage();
    await nextFirstMessage();
    first.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    await nextFirstMessage();

    const second = new WebSocket(url);
    const nextSecondMessage = collectMessages(second);
    await waitForOpen(second);
    await nextSecondMessage();
    await nextSecondMessage();
    second.send(JSON.stringify({ type: 'join', name: 'ваня' }));

    const rejection = await nextSecondMessage();
    expect(rejection).toEqual({ type: 'name-taken' });

    first.close();
    second.close();
  });

  it('marks a participant disconnected when their socket closes, and reconnect restores them', async () => {
    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
    await nextPlayerMessage();
    await nextPlayerMessage();
    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = (await nextPlayerMessage()) as {
      token: string;
      participantId: string;
    };

    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
    await nextBoardMessage();
    await nextBoardMessage();

    player.close();
    const afterDisconnect = await nextBoardMessage();
    expect(afterDisconnect).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: false },
      ],
      hostParticipantId: null,
      game: null,
    });

    const reconnected = new WebSocket(url);
    const nextReconnectedMessage = collectMessages(reconnected);
    await waitForOpen(reconnected);
    await nextReconnectedMessage();
    await nextReconnectedMessage();
    reconnected.send(
      JSON.stringify({ type: 'reconnect', token: joined.token }),
    );
    const reconnectedJoined = await nextReconnectedMessage();
    expect(reconnectedJoined).toEqual({
      type: 'joined',
      participantId: joined.participantId,
      token: joined.token,
      name: 'Ваня',
    });

    const afterReconnect = await nextBoardMessage();
    expect(afterReconnect).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: true },
      ],
      hostParticipantId: null,
      game: null,
    });

    board.close();
    reconnected.close();
  });

  it('reports a busy port through httpServer error instead of throwing from ws', async () => {
    // `ws` переподписывает 'error' httpServer'а на сам WebSocketServer. Пока у
    // wss нет собственного слушателя, EventEmitter превращает это событие в
    // выброшенное исключение — то есть даже с обработчиком на httpServer
    // занятый порт ронял бы процесс сырым стеком. Здесь занимаем порт, уже
    // слушаемый сервером из beforeEach: без слушателя на wss этот тест падает
    // не ассертом, а необработанным исключением.
    const other = createServer({
      room: new Room(),
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });

    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      other.httpServer.once('error', resolve);
      other.httpServer.listen(port);
    });

    expect(err.code).toBe('EADDRINUSE');
    // Этот httpServer так и не перешёл в состояние listening, поэтому его
    // `close()` отвечает ERR_SERVER_NOT_RUNNING — закрывать тут нечего,
    // а wss закрывается тем же вызовом до отказа.
    await other.close().catch((closeErr: NodeJS.ErrnoException) => {
      if (closeErr.code !== 'ERR_SERVER_NOT_RUNNING') throw closeErr;
    });
  });

  it('ignores a malformed join/reconnect message instead of crashing the connection', async () => {
    const ws = new WebSocket(url);
    const nextMessage = collectMessages(ws);
    await waitForOpen(ws);
    await nextMessage(); // hello
    await nextMessage(); // state

    // Missing `name` — an unchecked `room.join(message.name)` would call
    // `.trim()` on `undefined` and throw inside the 'message' handler.
    ws.send(JSON.stringify({ type: 'join' }));
    // Missing `token` — same hazard for `room.reconnect`.
    ws.send(JSON.stringify({ type: 'reconnect' }));

    // Both malformed messages should have been silently ignored (no
    // response sent for either). Prove the connection — and the server
    // process itself — is still alive and responsive by completing a normal,
    // well-formed join on the same socket afterward.
    ws.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = await nextMessage();
    expect(joined).toMatchObject({ type: 'joined', name: 'Ваня' });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it('ignores a start-game message from a socket that never joined', async () => {
    const ws = new WebSocket(url);
    const nextMessage = collectMessages(ws);
    await waitForOpen(ws);
    await nextMessage(); // hello
    await nextMessage(); // state

    // No 'join' sent — this socket is unknown to `connections`. An
    // unguarded `room.startGame()` would still run: with no pack loaded in
    // this room it would return `{ error: 'no-pack' }` without observable
    // effect, but the guard itself (matching every other game-message
    // branch) must still be exercised, so send it and prove the connection
    // stays alive and unaffected by following up with a normal join.
    ws.send(JSON.stringify({ type: 'start-game' }));

    ws.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = await nextMessage();
    expect(joined).toMatchObject({ type: 'joined', name: 'Ваня' });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it("doesn't crash the server when a client sends an invalid WebSocket frame", async () => {
    const attacker = new WebSocket(url);
    const nextAttackerMessage = collectMessages(attacker);
    await waitForOpen(attacker);
    await nextAttackerMessage(); // hello
    await nextAttackerMessage(); // state

    // Write a raw frame with an invalid (reserved) opcode directly to the
    // underlying TCP socket, bypassing ws's own frame encoder (which never
    // produces invalid frames itself). ws's Receiver reports this via the
    // per-connection WebSocket's 'error' event — exactly the case an
    // unguarded socket has no listener for.
    const closed = new Promise<void>((resolve) =>
      attacker.once('close', () => resolve()),
    );
    const rawSocket = (
      attacker as unknown as { _socket: { write(data: Buffer): void } }
    )._socket;
    rawSocket.write(Buffer.from([0x83, 0x80, 0x00, 0x00, 0x00, 0x00]));
    await closed;

    // Prove the server process itself is still alive and responsive: a
    // brand new, unrelated connection should still work normally.
    const other = new WebSocket(url);
    const nextOtherMessage = collectMessages(other);
    await waitForOpen(other);
    const hello = await nextOtherMessage();
    expect(hello).toEqual({
      type: 'hello',
      lanUrl: 'http://192.168.1.1:8080/',
    });

    other.close();
  });

  it("doesn't disconnect a participant when a stale socket closes after they've reconnected elsewhere", async () => {
    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
    await nextPlayerMessage();
    await nextPlayerMessage();
    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = (await nextPlayerMessage()) as {
      token: string;
      participantId: string;
    };

    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
    await nextBoardMessage();
    await nextBoardMessage();

    // Reconnect on a NEW socket WITHOUT closing the original ("stale") one —
    // simulating a phone that dropped Wi-Fi and reconnected before the
    // server noticed the old TCP connection was dead.
    const reconnected = new WebSocket(url);
    const nextReconnectedMessage = collectMessages(reconnected);
    await waitForOpen(reconnected);
    await nextReconnectedMessage();
    await nextReconnectedMessage();
    reconnected.send(
      JSON.stringify({ type: 'reconnect', token: joined.token }),
    );
    const reconnectedJoined = await nextReconnectedMessage();
    expect(reconnectedJoined).toEqual({
      type: 'joined',
      participantId: joined.participantId,
      token: joined.token,
      name: 'Ваня',
    });

    const afterReconnectBroadcast = await nextBoardMessage();
    expect(afterReconnectBroadcast).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: true },
      ],
      hostParticipantId: null,
      game: null,
    });

    // The original socket is still stale (never closed) at this point.
    // Close it now, simulating its underlying TCP connection finally timing
    // out after the participant already reconnected elsewhere.
    const staleClosed = new Promise<void>((resolve) =>
      player.once('close', () => resolve()),
    );
    player.close();
    await staleClosed;

    // If the stale socket's close incorrectly disconnected the participant,
    // the next broadcast would show them as connected: false. Trigger one
    // via an unrelated join and confirm the reconnected participant is
    // still shown as connected.
    const bystander = new WebSocket(url);
    const nextBystanderMessage = collectMessages(bystander);
    await waitForOpen(bystander);
    await nextBystanderMessage();
    await nextBystanderMessage();
    bystander.send(JSON.stringify({ type: 'join', name: 'Оля' }));
    await nextBystanderMessage(); // joined

    const finalBoardState = await nextBoardMessage();
    expect(finalBoardState).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: true },
        { id: expect.any(String), name: 'Оля', connected: true },
      ],
      hostParticipantId: null,
      game: null,
    });

    board.close();
    reconnected.close();
    bystander.close();
  });
});

// Отдельный describe, а не тест внутри предыдущего: интервал хартбита ставится
// внутри `createServer`, поэтому фейковые таймеры должны быть включены ДО его
// вызова — иначе интервал получится настоящий и тест ждал бы пять секунд по
// стенным часам. Держать фейковые таймеры включёнными для всего файла не
// хочется: остальные тесты полагаются на настоящий сетевой ввод-вывод.
describe('createServer heartbeat', () => {
  let server: GameServer;
  let url: string;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-heartbeat-'));
    // shouldAdvanceTime: фейковые часы продолжают идти сами, поэтому реальный
    // ввод-вывод `ws` не голодает, но интервал хартбита при этом можно
    // прокручивать вручную.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = createServer({
      room: new Room(),
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('terminates a client that stopped answering pings and marks them disconnected', async () => {
    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
    await nextBoardMessage(); // hello
    await nextBoardMessage(); // state

    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
    await nextPlayerMessage(); // hello
    await nextPlayerMessage(); // state
    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = (await nextPlayerMessage()) as { participantId: string };
    await nextBoardMessage(); // state с подключённым участником

    // Телефон, у которого умерло Wi-Fi-радио: TCP-соединение формально живо
    // (ни FIN, ни RST сервер не получил), но клиент ничего не читает и, значит,
    // не отвечает на ping автоматическим pong'ом. `pause()` даёт ровно это —
    // в отличие от `_socket.destroy()`, который прислал бы серверу RST и
    // сработал бы обычный обработчик 'close', минуя хартбит.
    player.pause();

    // Первый тик: сокет ещё числится живым — его помечают и пингуют.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    // Второй тик: pong'а не было, сокет добивают terminate().
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    const afterHeartbeat = await nextBoardMessage();
    expect(afterHeartbeat).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: false },
      ],
      hostParticipantId: null,
      game: null,
    });

    board.close();
    player.resume();
    player.terminate();
  });
});

const TEST_PACK: Pack = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            {
              id: 'q1',
              price: 100,
              text: 'Вопрос?',
              answer: 'Ответ',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
};

async function joinPlayer(baseUrl: string, name: string) {
  const ws = new WebSocket(baseUrl);
  const nextMessage = collectMessages(ws);
  await waitForOpen(ws);
  await nextMessage(); // hello
  await nextMessage(); // state
  ws.send(JSON.stringify({ type: 'join', name }));
  const joined = (await nextMessage()) as {
    participantId: string;
    token: string;
  };
  await nextMessage(); // сборос состояния лобби после join, которое видит сам подключившийся
  return {
    ws,
    nextMessage,
    participantId: joined.participantId,
    token: joined.token,
  };
}

type Player = Awaited<ReturnType<typeof joinPlayer>>;

// Каждая рассылка состояния уходит на ОБА сокета сразу, поэтому любое
// действие, которое меняет состояние комнаты, оставляет по одному новому
// сообщению в очереди каждого игрока — даже если тест интересует состояние
// только одного из них. Не вычитывать вторую очередь означает, что она будет
// отдана следующему вызову nextMessage() у ТОГО игрока в следующий раз, когда
// тест решит его использовать. `settle` вычитывает сразу обе и возвращает ту
// сторону, которая нужна тесту.
async function settle(
  a: Player,
  b: Player,
  interested: Player,
): Promise<unknown> {
  const [aMsg, bMsg] = await Promise.all([a.nextMessage(), b.nextMessage()]);
  return interested === a ? aMsg : bMsg;
}

describe('createServer game flow', () => {
  it('plays a question from start-game through a correct answer', async () => {
    // Fake timers are needed to resolve judging deterministically (the
    // engine only resolves a vote via its own timer, never on the 'vote'
    // event itself) while keeping real WS network I/O — same
    // shouldAdvanceTime pattern as the heartbeat describe block below, but
    // enabled per-test here since the rest of this describe relies on real
    // wall-clock I/O without any fake timers at all.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-game-'));
      const room = new Room(undefined, TEST_PACK);
      const server = createServer({
        room,
        clientDistPath: dir,
        lanUrl: 'http://192.168.1.1:8080/',
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } =
        server.httpServer.address() as import('node:net').AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const a = await joinPlayer(url, 'Ваня');
      const b = await joinPlayer(url, 'Катя');
      // Присоединение b уже транслировало обновлённый состав лобби всем —
      // эту трансляцию joinPlayer(b) вычитал только из очереди b, не из
      // очереди a.
      await a.nextMessage();

      a.ws.send(JSON.stringify({ type: 'start-game' }));
      const aState = (await settle(a, b, a)) as {
        game: { phase: string; turnParticipantId: string };
      };
      expect(aState.game.phase).toBe('selecting');

      const picker = aState.game.turnParticipantId === a.participantId ? a : b;
      const other = picker === a ? b : a;
      picker.ws.send(
        JSON.stringify({
          type: 'select-question',
          themeIndex: 0,
          questionId: 'q1',
        }),
      );
      const afterSelect = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterSelect.game.phase).toBe('question-open');

      picker.ws.send(JSON.stringify({ type: 'buzz' }));
      const afterBuzz = (await settle(a, b, picker)) as {
        game: { phase: string; buzzedParticipantId: string };
      };
      expect(afterBuzz.game.phase).toBe('buzzed');
      expect(afterBuzz.game.buzzedParticipantId).toBe(picker.participantId);

      picker.ws.send(JSON.stringify({ type: 'said-answer' }));
      const afterSaidAnswer = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterSaidAnswer.game.phase).toBe('judging');

      other.ws.send(JSON.stringify({ type: 'vote', correct: true }));
      // A cast vote alone never resolves judging — it just gets recorded —
      // but it still changes room state and therefore still broadcasts.
      // Consume that broadcast before advancing the vote timer, same as
      // 'does not clear the vote timer when a vote is cast' in room.test.ts.
      const afterVoteCast = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterVoteCast.game.phase).toBe('judging');

      // Advance in HEARTBEAT_INTERVAL_MS-sized steps, not one big jump: a
      // single advanceTimersByTimeAsync(VOTE_TIMER_MS) call fires both
      // pending heartbeat ticks back-to-back without yielding to the real
      // event loop in between, so the real pong frame the (perfectly alive)
      // sockets send in response to the first tick's ping never has a
      // chance to arrive before the second tick checks `alive` — the
      // heartbeat then wrongly terminates both sockets. Stepping through in
      // HEARTBEAT_INTERVAL_MS chunks (same granularity the heartbeat
      // describe block below uses) gives each real pong round-trip room to
      // land between ticks.
      let remaining = VOTE_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterVoteResolved = (await settle(a, b, picker)) as {
        game: {
          phase: string;
          scores: { participantId: string; score: number }[];
        };
      };
      expect(afterVoteResolved.game.phase).toBe('reveal');
      expect(afterVoteResolved.game.scores).toEqual(
        expect.arrayContaining([
          { participantId: picker.participantId, score: 100 },
          { participantId: other.participantId, score: 0 },
        ]),
      );

      a.ws.close();
      b.ws.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('replies falsestart to the offending socket alone, without broadcasting a state change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-falsestart-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage(); // трансляция состава лобби после join b, см. комментарий выше

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    await settle(a, b, a);

    // Сейчас фаза 'selecting' — жать рано. falsestart уходит только b, без
    // широковещательной рассылки — a ничего не получает и его очередь
    // трогать не нужно.
    b.ws.send(JSON.stringify({ type: 'buzz' }));
    const reply = await b.nextMessage();
    expect(reply).toEqual({ type: 'falsestart' });

    a.ws.close();
    b.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  // Дизайн-документ прямо требует «обрыв связи — норма, а не исключение»
  // применительно и к обрыву посреди партии, не только в лобби (единственный
  // сценарий, который был покрыт раньше). Проверяем, что переподключившийся
  // сокет видит текущую игровую (не только лобби) game, а сама партия не
  // потревожена самим фактом обрыва/возврата — фаза и счёт остаются теми же.
  it('sends the in-progress game state to a socket reconnecting mid-game, leaving the game itself undisturbed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-reconnect-mid-game-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage(); // трансляция состава лобби после join b

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    expect(aState.game.phase).toBe('selecting');

    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'q1',
      }),
    );
    const afterSelect = (await settle(a, b, picker)) as {
      game: {
        phase: string;
        scores: { participantId: string; score: number }[];
      };
    };
    expect(afterSelect.game.phase).toBe('question-open');
    const scoresBeforeDisconnect = afterSelect.game.scores;

    // b's socket "drops" mid-game. a is left holding a broadcast showing b
    // disconnected — consume it so a's queue doesn't leak into a later
    // assertion, matching the pattern of the existing lobby reconnect test.
    const bClosed = new Promise<void>((resolve) =>
      b.ws.once('close', () => resolve()),
    );
    b.ws.close();
    await bClosed;
    const afterDisconnect = (await a.nextMessage()) as {
      participants: { id: string; connected: boolean }[];
      game: { phase: string };
    };
    expect(
      afterDisconnect.participants.find((p) => p.id === b.participantId)
        ?.connected,
    ).toBe(false);
    // The disconnect itself must not have touched the game.
    expect(afterDisconnect.game.phase).toBe('question-open');

    const reconnected = new WebSocket(url);
    const nextReconnectedMessage = collectMessages(reconnected);
    await waitForOpen(reconnected);
    await nextReconnectedMessage(); // hello
    const stateOnConnect = (await nextReconnectedMessage()) as {
      game: { phase: string } | null;
    };
    // Even before sending 'reconnect', a freshly connected socket already
    // sees the room's current state — proving it is the real in-progress
    // game, not a lobby-only placeholder.
    expect(stateOnConnect.game?.phase).toBe('question-open');

    reconnected.send(JSON.stringify({ type: 'reconnect', token: b.token }));
    const reconnectedJoined = (await nextReconnectedMessage()) as {
      type: string;
      participantId: string;
    };
    expect(reconnectedJoined).toMatchObject({
      type: 'joined',
      participantId: b.participantId,
    });

    // Broadcast following the reconnect: b shows connected again, and the
    // game is exactly where it was left — same phase, same scores. Goes to
    // both a and the reconnected socket; read from `reconnected`'s queue.
    const afterReconnectBroadcast = (await nextReconnectedMessage()) as {
      participants: { id: string; connected: boolean }[];
      game: {
        phase: string;
        scores: { participantId: string; score: number }[];
      };
    };
    expect(
      afterReconnectBroadcast.participants.find((p) => p.id === b.participantId)
        ?.connected,
    ).toBe(true);
    expect(afterReconnectBroadcast.game.phase).toBe('question-open');
    expect(afterReconnectBroadcast.game.scores).toEqual(scoresBeforeDisconnect);

    await a.nextMessage(); // same broadcast, delivered to a as well

    a.ws.close();
    reconnected.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('createServer host mode', () => {
  it('replies start-game-error to the requester when three join and nobody is host', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-host-required-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage(); // трансляция состава лобби после join b
    const c = await joinPlayer(url, 'Петя');
    await a.nextMessage(); // трансляция состава лобби после join c
    await b.nextMessage();

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const reply = await a.nextMessage();
    expect(reply).toEqual({
      type: 'start-game-error',
      reason: 'host-required',
    });

    a.ws.close();
    b.ws.close();
    c.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('broadcasts hostParticipantId once toggled, and shows the answer during judging only to the host socket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-host-mode-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    const c = await joinPlayer(url, 'Петя');
    await a.nextMessage();
    await b.nextMessage();

    c.ws.send(JSON.stringify({ type: 'toggle-host' }));
    const [aAfterToggle, bAfterToggle, cAfterToggle] = await Promise.all([
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ]);
    expect(
      (aAfterToggle as { hostParticipantId: string }).hostParticipantId,
    ).toBe(c.participantId);
    expect(
      (bAfterToggle as { hostParticipantId: string }).hostParticipantId,
    ).toBe(c.participantId);
    expect(
      (cAfterToggle as { hostParticipantId: string }).hostParticipantId,
    ).toBe(c.participantId);

    c.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    await c.nextMessage(); // same broadcast, delivered to the host too
    expect(aState.game.phase).toBe('selecting');

    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'q1',
      }),
    );
    await settle(a, b, picker);
    await c.nextMessage();

    picker.ws.send(JSON.stringify({ type: 'buzz' }));
    await settle(a, b, picker);
    await c.nextMessage();

    picker.ws.send(JSON.stringify({ type: 'said-answer' }));
    const [aJudging, bJudging, cJudging] = (await Promise.all([
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ])) as { game: { correctAnswer: unknown } }[];
    expect(aJudging.game.correctAnswer).toBeNull();
    expect(bJudging.game.correctAnswer).toBeNull();
    expect(cJudging.game.correctAnswer).not.toBeNull();

    a.ws.close();
    b.ws.close();
    c.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("wires the host admin panel's adjust-score and cancel-question over the real transport", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-host-admin-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    const c = await joinPlayer(url, 'Петя');
    await a.nextMessage();
    await b.nextMessage();

    c.ws.send(JSON.stringify({ type: 'toggle-host' }));
    await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

    c.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { turnParticipantId: string };
    };
    await c.nextMessage();

    // Хочет ли ведущий подправить чужой счёт — можно в любой момент, не
    // дожидаясь конкретной фазы.
    c.ws.send(
      JSON.stringify({
        type: 'adjust-score',
        participantId: b.participantId,
        delta: 50,
      }),
    );
    const [aAdjusted, bAdjusted, cAdjusted] = (await Promise.all([
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ])) as { game: { scores: { participantId: string; score: number }[] } }[];
    for (const view of [aAdjusted, bAdjusted, cAdjusted]) {
      expect(view.game.scores).toContainEqual({
        participantId: b.participantId,
        score: 50,
      });
    }

    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'q1',
      }),
    );
    await settle(a, b, picker);
    await c.nextMessage();

    c.ws.send(JSON.stringify({ type: 'cancel-question' }));
    const [aCancelled, bCancelled, cCancelled] = (await Promise.all([
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ])) as {
      game: {
        phase: string;
        scores: { participantId: string; score: number }[];
      };
    }[];
    for (const view of [aCancelled, bCancelled, cCancelled]) {
      expect(view.game.phase).toBe('reveal');
      // Отменённый вопрос не начисляет очков — предыдущая правка Кати не
      // потревожена, и никто больше не получил/не потерял очков.
      expect(view.game.scores).toContainEqual({
        participantId: b.participantId,
        score: 50,
      });
    }

    a.ws.close();
    b.ws.close();
    c.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

const TEST_PACK_WITH_FINAL: Pack = {
  ...TEST_PACK,
  final: {
    themes: [
      {
        name: 'Финал A',
        question: { id: 'f1', text: 'F1?', answer: 'ответ f1' },
      },
      {
        name: 'Финал B',
        question: { id: 'f2', text: 'F2?', answer: 'ответ f2' },
      },
    ],
  },
};

describe('createServer final round', () => {
  it('wires elimination, wagers, answers and host judging over the real transport', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-final-'));
      const room = new Room(undefined, TEST_PACK_WITH_FINAL);
      const server = createServer({
        room,
        clientDistPath: dir,
        lanUrl: 'http://192.168.1.1:8080/',
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } =
        server.httpServer.address() as import('node:net').AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const a = await joinPlayer(url, 'Ваня');
      const b = await joinPlayer(url, 'Катя');
      await a.nextMessage();
      const c = await joinPlayer(url, 'Петя');
      await a.nextMessage();
      await b.nextMessage();

      c.ws.send(JSON.stringify({ type: 'toggle-host' }));
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

      c.ws.send(JSON.stringify({ type: 'start-game' }));
      const aState = (await settle(a, b, a)) as {
        game: { turnParticipantId: string };
      };
      await c.nextMessage();

      const picker = aState.game.turnParticipantId === a.participantId ? a : b;
      const other = picker === a ? b : a;

      picker.ws.send(
        JSON.stringify({
          type: 'select-question',
          themeIndex: 0,
          questionId: 'q1',
        }),
      );
      await settle(a, b, picker);
      await c.nextMessage();

      picker.ws.send(JSON.stringify({ type: 'buzz' }));
      await settle(a, b, picker);
      await c.nextMessage();

      picker.ws.send(JSON.stringify({ type: 'said-answer' }));
      await settle(a, b, picker);
      await c.nextMessage();

      // Судейство с ведущим (c) — решает сразу, без ожидания таймера.
      // 'vote' по протоколу не несёт participantId — сервер берёт настоящего
      // отправителя сам из connections.get(ws) (тот же паттерн, что и у
      // adjust-score/cancel-question).
      c.ws.send(JSON.stringify({ type: 'vote', correct: true }));
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

      // Reveal-таймер должен истечь, чтобы партия перешла в final-elim —
      // единственный раунд пакета исчерпан на этом единственном вопросе.
      let remaining = REVEAL_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterFinalStart = (await Promise.all([
        a.nextMessage(),
        b.nextMessage(),
        c.nextMessage(),
      ])) as { game: { phase: string; finalElimParticipantId: string } }[];
      expect(afterFinalStart[0].game.phase).toBe('final-elim');
      // other ответил 0 раз/меньше очков, чем picker (получил +100) — ходит первым.
      expect(afterFinalStart[0].game.finalElimParticipantId).toBe(
        other.participantId,
      );

      other.ws.send(
        JSON.stringify({ type: 'eliminate-final-theme', themeIndex: 0 }),
      );
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

      // other пришёл к финалу с 0 очков (не ответил в базовом раунде) — движок
      // зажимает ставку до max(0, score) (engine.ts, handleSubmitWager), так
      // что ставка больше 0 без этого была бы молча обнулена, а не
      // содержательным тестом проигрыша. Панель ведущего (adjust-score) уже
      // проверена в базовом раунде — переиспользуем её, чтобы задать other
      // очки, на которые реально можно поставить.
      c.ws.send(
        JSON.stringify({
          type: 'adjust-score',
          participantId: other.participantId,
          delta: 100,
        }),
      );
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

      picker.ws.send(JSON.stringify({ type: 'submit-wager', amount: 50 }));
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);
      other.ws.send(JSON.stringify({ type: 'submit-wager', amount: 30 }));
      const afterWagers = (await Promise.all([
        a.nextMessage(),
        b.nextMessage(),
        c.nextMessage(),
      ])) as { game: { phase: string } }[];
      expect(afterWagers[0].game.phase).toBe('final-answer');

      picker.ws.send(
        JSON.stringify({ type: 'submit-final-answer', text: 'ответ picker' }),
      );
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);
      other.ws.send(
        JSON.stringify({ type: 'submit-final-answer', text: 'ответ other' }),
      );
      const afterAnswers = (await Promise.all([
        a.nextMessage(),
        b.nextMessage(),
        c.nextMessage(),
      ])) as { game: { phase: string } }[];
      expect(afterAnswers[0].game.phase).toBe('final-judging');

      c.ws.send(
        JSON.stringify({
          type: 'final-vote',
          participantId: picker.participantId,
          correct: true,
        }),
      );
      await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);
      c.ws.send(
        JSON.stringify({
          type: 'final-vote',
          participantId: other.participantId,
          correct: false,
        }),
      );
      const afterReveal = (await Promise.all([
        a.nextMessage(),
        b.nextMessage(),
        c.nextMessage(),
      ])) as {
        game: {
          phase: string;
          scores: { participantId: string; score: number }[];
        };
      }[];
      expect(afterReveal[0].game.phase).toBe('final-reveal');
      expect(afterReveal[0].game.scores).toEqual(
        expect.arrayContaining([
          { participantId: picker.participantId, score: 150 },
          { participantId: other.participantId, score: 70 },
        ]),
      );

      a.ws.close();
      b.ws.close();
      c.ws.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

// Админ-панель (design.md, «Админ-панель») — сокет никогда не шлёт 'join',
// поэтому в отличие от joinPlayer() выше здесь только 'hello' и стартовое
// 'state', без 'joined'.
async function connectAdmin(baseUrl: string) {
  const ws = new WebSocket(baseUrl);
  const nextMessage = collectMessages(ws);
  await waitForOpen(ws);
  await nextMessage(); // hello
  await nextMessage(); // стартовое state
  return { ws, nextMessage };
}

describe('createServer admin panel', () => {
  let server: GameServer;
  let dir: string;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-admin-'));
    const room = new Room(undefined, TEST_PACK);
    server = createServer({
      room,
      clientDistPath: dir,
      lanUrl: 'http://192.168.1.1:8080/',
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('never appears in the participants list — the admin socket is not a player', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage(); // рассылка после join

    admin.ws.send(JSON.stringify({ type: 'admin-reset-room' }));
    const state = (await admin.nextMessage()) as {
      participants: unknown[];
    };
    expect(state.participants).toEqual([]);

    admin.ws.close();
    a.ws.close();
  });

  it('admin-start-game starts the game with whoever is actually present, bypassing host-only', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();
    const b = await joinPlayer(baseUrl, 'Катя');
    await admin.nextMessage();
    await a.nextMessage();
    const c = await joinPlayer(baseUrl, 'Петя');
    await admin.nextMessage();
    await a.nextMessage();
    await b.nextMessage();

    // Петя — назначенный ведущий; обычным путём стартовать могла бы только
    // она, но у админ-панели нет понятия «не тот отправитель».
    c.ws.send(JSON.stringify({ type: 'toggle-host' }));
    await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ]);

    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    const [adminState, aState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ])) as { game: { phase: string } }[];
    expect(adminState.game.phase).toBe('selecting');
    expect(aState.game.phase).toBe('selecting');

    admin.ws.close();
    a.ws.close();
    b.ws.close();
    c.ws.close();
  });

  it('admin-start-game reports the same start-game-error reasons as a normal start, when the room genuinely cannot start', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня'); // only one player — not enough
    await admin.nextMessage();

    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    const err = (await admin.nextMessage()) as { reason: string };
    expect(err).toEqual({
      type: 'start-game-error',
      reason: 'not-enough-players',
    });

    admin.ws.close();
    a.ws.close();
  });

  it('admin-reset-game ends the current game and returns to the lobby, keeping participants', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();
    const b = await joinPlayer(baseUrl, 'Катя');
    await admin.nextMessage();
    await a.nextMessage();

    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);

    admin.ws.send(JSON.stringify({ type: 'admin-reset-game' }));
    const [adminState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
    ])) as { game: null; participants: unknown[] }[];
    expect(adminState.game).toBeNull();
    expect(adminState.participants).toHaveLength(2);

    admin.ws.close();
    a.ws.close();
    b.ws.close();
  });

  it('admin-kick removes the participant and forcibly disconnects their live socket', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();

    const aClosed = new Promise<void>((resolve) => a.ws.once('close', resolve));
    admin.ws.send(
      JSON.stringify({ type: 'admin-kick', participantId: a.participantId }),
    );
    const state = (await admin.nextMessage()) as { participants: unknown[] };
    expect(state.participants).toEqual([]);
    await aClosed;

    admin.ws.close();
  });

  it('admin-kick invalidates the token — a kicked participant cannot reconnect', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();

    admin.ws.send(
      JSON.stringify({ type: 'admin-kick', participantId: a.participantId }),
    );
    await admin.nextMessage();

    const retry = new WebSocket(baseUrl);
    const nextMessage = collectMessages(retry);
    await waitForOpen(retry);
    await nextMessage(); // hello
    await nextMessage(); // state
    retry.send(JSON.stringify({ type: 'reconnect', token: a.token }));
    const result = await nextMessage();
    expect(result).toEqual({ type: 'invalid-token' });

    admin.ws.close();
    retry.close();
  });

  it('admin-set-host assigns and clears the lobby host flag directly', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();

    admin.ws.send(
      JSON.stringify({
        type: 'admin-set-host',
        participantId: a.participantId,
      }),
    );
    const [assigned] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
    ])) as { hostParticipantId: string | null }[];
    expect(assigned.hostParticipantId).toBe(a.participantId);

    admin.ws.send(
      JSON.stringify({ type: 'admin-set-host', participantId: null }),
    );
    const [cleared] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
    ])) as { hostParticipantId: string | null }[];
    expect(cleared.hostParticipantId).toBeNull();

    admin.ws.close();
    a.ws.close();
  });

  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  it('admin-skip-to-final forces the phase forward — game-end here since TEST_PACK has no final block', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();
    const b = await joinPlayer(baseUrl, 'Катя');
    await admin.nextMessage();
    await a.nextMessage();
    const c = await joinPlayer(baseUrl, 'Петя');
    await admin.nextMessage();
    await a.nextMessage();
    await b.nextMessage();

    // Петя — ведущий, Ваня и Катя — счётчики: skip-to-final требует ведущего,
    // как и естественный переход в финал (engine.ts, startFinalOrEnd).
    c.ws.send(JSON.stringify({ type: 'toggle-host' }));
    await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ]);

    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ]);

    admin.ws.send(JSON.stringify({ type: 'admin-skip-to-final' }));
    const [adminState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
      c.nextMessage(),
    ])) as { game: { phase: string } }[];
    expect(adminState.game.phase).toBe('game-end');

    admin.ws.close();
    a.ws.close();
    b.ws.close();
    c.ws.close();
  });
});
