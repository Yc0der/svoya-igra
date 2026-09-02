import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { GameHistory, type HistoryRecorder } from './history.js';
import {
  REVEAL_TIMER_MS,
  VOTE_TIMER_MS,
  TEXT_REVEAL_MIN_MS,
  QUESTION_TIMER_MS,
} from './engine.js';

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
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    ({ port } = server.httpServer.address() as AddressInfo);
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the current state, including the LAN url, on connect', async () => {
    const ws = new WebSocket(url);
    const nextMessage = collectMessages(ws);
    await waitForOpen(ws);

    const state = await nextMessage();
    expect(state).toEqual({
      type: 'state',
      participants: [],
      hostParticipantId: null,
      game: null,
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
    });

    ws.close();
  });

  it('lets a client join and broadcasts the new state to everyone connected', async () => {
    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
    await nextBoardMessage();

    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
    });

    board.close();
    player.close();
  });

  it('rejects a duplicate name without crashing the connection', async () => {
    const first = new WebSocket(url);
    const nextFirstMessage = collectMessages(first);
    await waitForOpen(first);
    await nextFirstMessage();
    first.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    await nextFirstMessage();

    const second = new WebSocket(url);
    const nextSecondMessage = collectMessages(second);
    await waitForOpen(second);
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
    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = (await nextPlayerMessage()) as {
      token: string;
      participantId: string;
    };

    const board = new WebSocket(url);
    const nextBoardMessage = collectMessages(board);
    await waitForOpen(board);
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
    });

    const reconnected = new WebSocket(url);
    const nextReconnectedMessage = collectMessages(reconnected);
    await waitForOpen(reconnected);
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
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
      port: 8080,
      packsDir: dir,
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
    const state = await nextOtherMessage();
    expect(state).toEqual({
      type: 'state',
      participants: [],
      hostParticipantId: null,
      game: null,
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
    });

    other.close();
  });

  it("doesn't disconnect a participant when a stale socket closes after they've reconnected elsewhere", async () => {
    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
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

    // Reconnect on a NEW socket WITHOUT closing the original ("stale") one —
    // simulating a phone that dropped Wi-Fi and reconnected before the
    // server noticed the old TCP connection was dead.
    const reconnected = new WebSocket(url);
    const nextReconnectedMessage = collectMessages(reconnected);
    await waitForOpen(reconnected);
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
    });

    board.close();
    reconnected.close();
    bystander.close();
  });

  // ВРЕМЕННО — см. Room.textRevealWordsPerSecond. Тот же паттерн, что
  // admin-set-lan-address: ephemeral-поле Комнаты, не часть RoomState,
  // рассылается отдельным listener'ом (room.onTextRevealRateChange).
  it('admin-set-text-reveal-rate changes the broadcast rate for everyone connected', async () => {
    const admin = await connectAdmin(url);
    const board = await connectAdmin(url); // табло — тоже не 'join'-сокет

    admin.ws.send(
      JSON.stringify({ type: 'admin-set-text-reveal-rate', wordsPerSecond: 4 }),
    );
    const [adminState, boardState] = (await Promise.all([
      admin.nextMessage(),
      board.nextMessage(),
    ])) as { textRevealWordsPerSecond: number }[];
    expect(adminState.textRevealWordsPerSecond).toBe(4);
    expect(boardState.textRevealWordsPerSecond).toBe(4);

    admin.ws.close();
    board.ws.close();
  });

  // ВРЕМЕННО — см. Room.textRevealEnabled. Тот же паттерн, что и тест выше
  // для textRevealWordsPerSecond.
  it('admin-set-text-reveal-enabled changes the broadcast flag for everyone connected', async () => {
    const admin = await connectAdmin(url);
    const board = await connectAdmin(url);

    admin.ws.send(
      JSON.stringify({ type: 'admin-set-text-reveal-enabled', enabled: false }),
    );
    const [adminState, boardState] = (await Promise.all([
      admin.nextMessage(),
      board.nextMessage(),
    ])) as { textRevealEnabled: boolean }[];
    expect(adminState.textRevealEnabled).toBe(false);
    expect(boardState.textRevealEnabled).toBe(false);

    admin.ws.close();
    board.ws.close();
  });

  // ВРЕМЕННО — см. Room.textRevealFadeMs. Тот же паттерн, что и тест выше
  // для textRevealWordsPerSecond.
  it('admin-set-text-reveal-fade-ms changes the broadcast value for everyone connected', async () => {
    const admin = await connectAdmin(url);
    const board = await connectAdmin(url);

    admin.ws.send(
      JSON.stringify({ type: 'admin-set-text-reveal-fade-ms', fadeMs: 500 }),
    );
    const [adminState, boardState] = (await Promise.all([
      admin.nextMessage(),
      board.nextMessage(),
    ])) as { textRevealFadeMs: number }[];
    expect(adminState.textRevealFadeMs).toBe(500);
    expect(boardState.textRevealFadeMs).toBe(500);

    admin.ws.close();
    board.ws.close();
  });

  it('admin-set-history-enabled changes the broadcast flag for everyone connected', async () => {
    const admin = await connectAdmin(url);
    const board = await connectAdmin(url);

    admin.ws.send(
      JSON.stringify({ type: 'admin-set-history-enabled', enabled: false }),
    );
    const [adminState, boardState] = (await Promise.all([
      admin.nextMessage(),
      board.nextMessage(),
    ])) as { historyEnabled: boolean }[];
    expect(adminState.historyEnabled).toBe(false);
    expect(boardState.historyEnabled).toBe(false);

    admin.ws.close();
    board.ws.close();
  });
});

// Отдельный describe — предыдущему нужна идущая партия (historyRecording
// расходится с historyEnabled только пока она идёт, room.ts,
// Room.isHistoryRecording), а комната describe('createServer', ...) выше
// собрана без пакета вопросов и партию завести не может (финальное ревью
// ветки, п. 2).
describe('createServer history recording honesty', () => {
  it('historyRecording остаётся честным false после off→on посреди партии, хотя historyEnabled снова true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-history-honesty-'));
    let nextId = 1;
    const fakeHistory: HistoryRecorder = {
      startGame: () => nextId++,
      recordQuestion: () => {},
      finishGame: () => {},
      discardGame: () => {},
      recordTag: () => {},
      clearTag: () => {},
      recordTagReason: () => false,
      downTagsForReview: () => [],
      createPerson: () => nextId++,
      listPeople: () => [],
    };
    const room = new Room(
      undefined,
      TEST_PACK,
      undefined,
      'test.json',
      fakeHistory,
    );
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    const admin = await connectAdmin(url);

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const [startedAdminState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
    ])) as { historyEnabled: boolean; historyRecording: boolean }[];
    // Партия реально пишется сразу после старта — иначе тест ничего не
    // проверил бы про расхождение off→on ниже.
    expect(startedAdminState.historyRecording).toBe(true);

    // Выключение посреди партии обнуляет historyGameId и потому шлёт ДВЕ
    // рассылки состояния — через onChange (историю обязан пережить снапшот,
    // финальное ревью ветки, п. 1) и через onHistoryEnabledChange (тумблер).
    // Обе несут уже полностью применённое состояние, поэтому просто съедаем
    // обе, не проверяя промежуточную.
    admin.ws.send(
      JSON.stringify({ type: 'admin-set-history-enabled', enabled: false }),
    );
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);

    // Обратное включение не трогает historyGameId (обратной операции нет) —
    // только одна рассылка, через onHistoryEnabledChange.
    admin.ws.send(
      JSON.stringify({ type: 'admin-set-history-enabled', enabled: true }),
    );
    const [adminState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
      b.nextMessage(),
    ])) as { historyEnabled: boolean; historyRecording: boolean }[];

    expect(adminState.historyEnabled).toBe(true);
    expect(adminState.historyRecording).toBe(false);

    a.ws.close();
    b.ws.close();
    admin.ws.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    await rm(dir, { recursive: true, force: true });
  });
});

// Отдельный describe по той же причине, что и history recording honesty
// выше: тесту нужен рекордер, который знает конкретного человека (id 7 =
// «Ваня») — комната describe('createServer', ...) выше собрана вообще без
// рекордера, room.getPeople() у неё всегда пуст.
describe('createServer join-as', () => {
  it('входит человеком из списка и отклоняет второго под тем же человеком', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-join-as-'));
    const history: HistoryRecorder = {
      startGame: () => null,
      recordQuestion: () => {},
      finishGame: () => {},
      discardGame: () => {},
      recordTag: () => {},
      clearTag: () => {},
      recordTagReason: () => false,
      downTagsForReview: () => [],
      createPerson: () => null,
      listPeople: () => [{ id: 7, name: 'Ваня', games: 3 }],
    };
    const room = new Room(undefined, undefined, undefined, undefined, history);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const first = new WebSocket(url);
    const nextFirstMessage = collectMessages(first);
    await waitForOpen(first);
    await nextFirstMessage(); // стартовое state

    first.send(JSON.stringify({ type: 'join-as', personId: 7 }));
    const joined = await nextFirstMessage();
    expect(joined).toMatchObject({ type: 'joined', name: 'Ваня' });

    const second = new WebSocket(url);
    const nextSecondMessage = collectMessages(second);
    await waitForOpen(second);
    await nextSecondMessage(); // стартовое state

    second.send(JSON.stringify({ type: 'join-as', personId: 7 }));
    const rejection = await nextSecondMessage();
    expect(rejection).toEqual({ type: 'person-taken' });

    first.close();
    second.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    await rm(dir, { recursive: true, force: true });
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
      port: 8080,
      packsDir: dir,
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
    await nextBoardMessage(); // state

    const player = new WebSocket(url);
    const nextPlayerMessage = collectMessages(player);
    await waitForOpen(player);
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
      people: [],
      lanUrl: 'http://localhost:8080/',
      lanCandidates: [],
      availablePacks: [],
      activePackFilename: null,
      textRevealWordsPerSecond: 2.5,
      textRevealFadeMs: 270,
      textRevealEnabled: true,
      historyEnabled: true,
      historyRecording: false,
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

const TEST_PACK_WITH_VIDEO: Pack = {
  ...TEST_PACK,
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
              video: { youtubeId: 'abc', startSeconds: 0, durationSeconds: 8 },
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

// Тот же протокол, что и joinPlayer, но 'join-as' вместо 'join' — заходит
// уже опознанным человеком (задача 5, sdd/2026-08-26-player-identity): нужно
// там, где тест проверяет playerStats(), а она строится из game_people, куда
// участник без personId никогда не попадает (history.ts, startGame).
async function joinPlayerAs(baseUrl: string, personId: number) {
  const ws = new WebSocket(baseUrl);
  const nextMessage = collectMessages(ws);
  await waitForOpen(ws);
  await nextMessage(); // state
  ws.send(JSON.stringify({ type: 'join-as', personId }));
  const joined = (await nextMessage()) as {
    participantId: string;
    token: string;
    name: string;
  };
  await nextMessage(); // сборос состояния лобби после join, которое видит сам подключившийся
  return {
    ws,
    nextMessage,
    participantId: joined.participantId,
    token: joined.token,
    name: joined.name,
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

// tag-reason не отвечает подтверждением (в отличие от admin-report-question,
// у которого клиент дожидается admin-report-ack и ТЕМ САМЫМ знает, что запись
// в файл уже случилась) — рассылка state после room.submitTagReason() уходит
// независимо от асинхронного пересчёта refreshAutoSection() (server.ts) в
// файл, и settle() на неё никакой гарантии не даёт. Поэтому здесь опрашиваем
// сам файл, а не полагаемся на порядок доставки двух независимых
// async-цепочек.
async function waitForFileContent(
  path: string,
  substring: string,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const content = await readFile(path, 'utf8');
    if (content.includes(substring)) return content;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`"${path}" never contained: ${substring}`);
}

describe('createServer media-finished', () => {
  // Табло — не участник партии: оно никогда не шлёт 'join', поэтому сигнал об
  // окончании клипа проходит тем же путём, что админские сообщения, без
  // поиска отправителя в connections. Здесь проверяется именно проводка
  // сообщения насквозь; правило «та ли фаза, тот ли вопрос» живёт в движке и
  // покрыто отдельно (engine.test.ts, room.test.ts).
  it('lets a board socket that never joined open the question once the clip ends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-'));
    const room = new Room(undefined, TEST_PACK_WITH_VIDEO);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    const board = await connectAdmin(url);

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const started = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    await board.nextMessage();

    const picker = started.game.turnParticipantId === a.participantId ? a : b;
    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'q1',
      }),
    );
    const onClip = (await settle(a, b, picker)) as { game: { phase: string } };
    await board.nextMessage();
    expect(onClip.game.phase).toBe('question-media');

    board.ws.send(JSON.stringify({ type: 'media-finished', questionId: 'q1' }));
    const afterClip = (await settle(a, b, picker)) as {
      game: { phase: string };
    };
    expect(afterClip.game.phase).toBe('question-open');

    a.ws.close();
    b.ws.close();
    board.ws.close();
    await new Promise<void>((resolve) =>
      server.httpServer.close(() => resolve()),
    );
    await rm(dir, { recursive: true, force: true });
  });
});

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
        port: 8080,
        packsDir: dir,
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
      const onReveal = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(onReveal.game.phase).toBe('question-reveal');
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
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

  it('tag-question доносит оценку игрока до комнаты', async () => {
    // Тем же способом, каким соседний тест выше доводит партию до 'reveal',
    // но проще: вопрос доигрывается до таймаута (никто не нажал), а не через
    // buzz/said-answer/vote — questionTags открывается в reveal независимо
    // от того, как вопрос туда пришёл.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-tag-question-'));
      const room = new Room(undefined, TEST_PACK);
      const server = createServer({
        room,
        clientDistPath: dir,
        port: 8080,
        packsDir: dir,
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } =
        server.httpServer.address() as import('node:net').AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const first = await joinPlayer(url, 'Ваня');
      const second = await joinPlayer(url, 'Катя');
      await first.nextMessage(); // трансляция лобби после join второго

      first.ws.send(JSON.stringify({ type: 'start-game' }));
      const aState = (await settle(first, second, first)) as {
        game: { phase: string; turnParticipantId: string };
      };
      expect(aState.game.phase).toBe('selecting');

      const picker =
        aState.game.turnParticipantId === first.participantId ? first : second;
      picker.ws.send(
        JSON.stringify({
          type: 'select-question',
          themeIndex: 0,
          questionId: 'q1',
        }),
      );
      await settle(first, second, picker);
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
      const afterSelect = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterSelect.game.phase).toBe('question-open');

      // Никто не жмёт — таймер вопроса истекает сам, той же гранулярностью
      // HEARTBEAT_INTERVAL_MS-шагов, что и соседний тест выше (см. его
      // комментарий про живые пинги/понги во время advanceTimersByTimeAsync).
      let remaining = QUESTION_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterTimeout = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterTimeout.game.phase).toBe('reveal');

      first.ws.send(JSON.stringify({ type: 'tag-question', thumb: 'down' }));
      await settle(first, second, picker);

      expect(room.toGameStateView(first.participantId)?.questionTags).toEqual({
        up: 0,
        down: 1,
        mine: 'down',
      });

      first.ws.close();
      second.ws.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  // Финальное ревью ветки, п. 5: единственное непокрытое звено на пути,
  // который мутирует долгоживущий артефакт — docs/pack-generator-profile.md.
  // Проводит tag-reason через настоящий websocket-сервер (не напрямую через
  // Room, как в room.test.ts) и проверяет, что запись реально доезжает до
  // профиля генератора, а не только до памяти комнаты.
  it('tag-reason доносит причину до комнаты и пересчитывает «Автособранное»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-tag-reason-'));
      const profilePath = join(dir, 'profile.md');
      await writeFile(
        profilePath,
        '# Профиль компании\n\nВступление.\n\n---\n\n## Автособранное\n\nПока пусто.\n',
        'utf8',
      );
      // Настоящая история (не фейк) — запись в профиль генератора теперь
      // идёт пересчётом всего раздела «Автособранное» из
      // history.profileAggregate() (design.md, 2026-08-25), а не сборкой
      // одной жалобы из контекста конкретного вопроса, поэтому тест обязан
      // пройти через настоящую запись/чтение, а не через заглушку, которая
      // повторяла бы ту же логику своими руками.
      const history = new GameHistory(':memory:');
      const room = new Room(
        undefined,
        TEST_PACK,
        undefined,
        'test.json',
        history,
      );
      const server = createServer({
        room,
        clientDistPath: dir,
        port: 8080,
        packsDir: dir,
        profilePath,
        history,
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } =
        server.httpServer.address() as import('node:net').AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const first = await joinPlayer(url, 'Ваня');
      const second = await joinPlayer(url, 'Катя');
      await first.nextMessage(); // трансляция лобби после join второго

      first.ws.send(JSON.stringify({ type: 'start-game' }));
      const aState = (await settle(first, second, first)) as {
        game: { phase: string; turnParticipantId: string };
      };
      expect(aState.game.phase).toBe('selecting');

      const picker =
        aState.game.turnParticipantId === first.participantId ? first : second;
      picker.ws.send(
        JSON.stringify({
          type: 'select-question',
          themeIndex: 0,
          questionId: 'q1',
        }),
      );
      await settle(first, second, picker);
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
      const afterSelect = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterSelect.game.phase).toBe('question-open');

      let remaining = QUESTION_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterTimeout = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterTimeout.game.phase).toBe('reveal');

      first.ws.send(JSON.stringify({ type: 'tag-question', thumb: 'down' }));
      await settle(first, second, picker);

      // TEST_PACK — единственный раунд с единственным вопросом, без финала:
      // reveal доигрывает прямо в game-end, минуя round-end/selecting.
      remaining = REVEAL_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterReveal = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterReveal.game.phase).toBe('game-end');

      first.ws.send(
        JSON.stringify({
          type: 'tag-reason',
          questionId: 'q1',
          reason: 'Слишком сложный',
          text: 'вообще не слышал про такое',
        }),
      );
      await settle(first, second, first);

      // Сообщение доехало до комнаты: разбор по этому вопросу для first
      // пуст (единственная запись только что разобрана).
      expect(room.toGameStateView(first.participantId)?.tagReview).toEqual([]);

      // Оценка доезжает до долгоживущего артефакта — ради этого тест и
      // существует. Но теперь пересчётом, а не дописыванием: то же самое от
      // шестерых игроков даст одну запись «×6», а не шесть буллетов (живая
      // партия 2026-08-21).
      const profileContent = await waitForFileContent(
        profilePath,
        'вообще не слышал про такое',
      );
      expect(profileContent).toContain('## Автособранное');
      expect(profileContent).toContain('### Вопросы, помеченные пальцем вниз');
      expect(profileContent).toContain('- **test.json#q1 · «Тема» · 100** —');
      expect(profileContent).toContain('«Вопрос?» (ответ: «Ответ»)');
      expect(profileContent).toContain('👎 1 · причины: «Слишком сложный» ×1');
      // Раздела жалоб разбор больше не касается вовсе.
      expect(profileContent).not.toContain('## Жалобы и оценки игроков');

      first.ws.close();
      second.ws.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  // Финальное ревью ветки, п. 8: только что покрытый тест выше проходит
  // через game-end на пути к tag-reason, но проверяет исключительно
  // содержимое, которое дописывает разбор причины (👎/причины). Числа по
  // ценам, которые обновляет ИМЕННО точка game-end (design.md, 2026-08-25,
  // «Когда пересчитывается», пункт 1 — «обновляет таблицу цен даже если
  // никто ничего не разбирал»), тем тестом не проверялись и держались
  // только на чтении кода. Здесь партия доигрывается до game-end БЕЗ единого
  // tag-question/tag-reason — если бы пересчёт на game-end не сработал, файл
  // остался бы «Пока пусто» навсегда.
  it('game-end пересчитывает «Автособранное» сам по себе, без единого разбора причины', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-game-end-'));
      const profilePath = join(dir, 'profile.md');
      await writeFile(
        profilePath,
        '# Профиль компании\n\nВступление.\n\n---\n\n## Автособранное\n\nПока пусто.\n',
        'utf8',
      );
      const history = new GameHistory(':memory:');
      const room = new Room(
        undefined,
        TEST_PACK,
        undefined,
        'test.json',
        history,
      );
      const server = createServer({
        room,
        clientDistPath: dir,
        port: 8080,
        packsDir: dir,
        profilePath,
        history,
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } =
        server.httpServer.address() as import('node:net').AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const first = await joinPlayer(url, 'Ваня');
      const second = await joinPlayer(url, 'Катя');
      await first.nextMessage(); // трансляция лобби после join второго

      first.ws.send(JSON.stringify({ type: 'start-game' }));
      const aState = (await settle(first, second, first)) as {
        game: { phase: string; turnParticipantId: string };
      };
      expect(aState.game.phase).toBe('selecting');

      const picker =
        aState.game.turnParticipantId === first.participantId ? first : second;
      picker.ws.send(
        JSON.stringify({
          type: 'select-question',
          themeIndex: 0,
          questionId: 'q1',
        }),
      );
      await settle(first, second, picker);
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
      const afterSelect = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterSelect.game.phase).toBe('question-open');

      // Никто не жмёт — вопрос истекает сам, никто пальцем его не помечает.
      let remaining = QUESTION_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterTimeout = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterTimeout.game.phase).toBe('reveal');

      // TEST_PACK — единственный раунд с единственным вопросом, без финала:
      // reveal доигрывает прямо в game-end, минуя round-end/selecting.
      remaining = REVEAL_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterReveal = (await settle(first, second, picker)) as {
        game: { phase: string };
      };
      expect(afterReveal.game.phase).toBe('game-end');

      // Никакого tag-question/tag-reason — ровно то, чего не хватало
      // существующему покрытию.
      const profileContent = await waitForFileContent(
        profilePath,
        '### Как берутся вопросы по ценам',
      );
      expect(profileContent).toContain('## Автособранное');
      expect(profileContent).toContain(
        '- **100** — верно 0, неверно 0, не взял никто 1, без вердикта 0',
      );
      expect(profileContent).not.toContain('Пока пусто');

      first.ws.close();
      second.ws.close();
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
      port: 8080,
      packsDir: dir,
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
      port: 8080,
      packsDir: dir,
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
    const onReveal = (await settle(a, b, picker)) as {
      game: { phase: string };
    };
    expect(onReveal.game.phase).toBe('question-reveal');
    await new Promise((r) => setTimeout(r, TEXT_REVEAL_MIN_MS + 50));
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

const CAT_TEST_PACK: Pack = {
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
              id: 'cat1',
              price: 100,
              text: 'Вопрос-кот?',
              answer: 'ответ кота',
              type: 'кот',
            },
          ],
        },
      ],
    },
  ],
};

describe('createServer cat-in-the-bag', () => {
  it('hides the question text during cat-handoff and reveals it after assign-cat, only for the recipient to buzz', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-cat-'));
    const room = new Room(undefined, CAT_TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    const other = picker === a ? b : a;

    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'cat1',
      }),
    );
    const afterSelect = (await settle(a, b, picker)) as {
      game: { phase: string; currentQuestion: unknown };
    };
    expect(afterSelect.game.phase).toBe('cat-handoff');
    expect(afterSelect.game.currentQuestion).toEqual({
      id: 'cat1',
      text: null,
      price: 100,
      themeName: 'Тема',
      image: null,
      video: null,
      revealMs: null,
      fadeMs: 270,
    });

    picker.ws.send(
      JSON.stringify({
        type: 'assign-cat',
        recipientParticipantId: other.participantId,
      }),
    );
    // «Кот» тоже проходит через openQuestion() — тот же вход в question-reveal,
    // что и обычный выбор вопроса (design.md, «Область действия»). Этот
    // describe не включает фейковые таймеры, поэтому пауза здесь настоящая —
    // тот же паттерн, что уже используется для onClip/afterClip в
    // 'createServer media-finished'.
    const onReveal = (await settle(a, b, picker)) as {
      game: { phase: string };
    };
    expect(onReveal.game.phase).toBe('question-reveal');
    await new Promise((r) => setTimeout(r, TEXT_REVEAL_MIN_MS + 50));
    const afterAssign = (await settle(a, b, picker)) as {
      game: {
        phase: string;
        currentQuestion: { text: string };
        exclusiveAnswererParticipantId: string;
      };
    };
    expect(afterAssign.game.phase).toBe('question-open');
    expect(afterAssign.game.currentQuestion).toEqual({
      id: 'cat1',
      text: 'Вопрос-кот?',
      price: 100,
      themeName: 'Тема',
      image: null,
      video: null,
      revealMs: null,
      fadeMs: 270,
    });
    expect(afterAssign.game.exclusiveAnswererParticipantId).toBe(
      other.participantId,
    );

    // Отдавший — не получатель, попытка нажать ничего не меняет (сервер
    // молча игнорирует на уровне движка — falsestart здесь не при чём, это
    // не про фазу, а про то, кто именно жмёт).
    picker.ws.send(JSON.stringify({ type: 'buzz' }));
    // Отклонённый нажатием не того игрока буз всё равно триггерит рассылку
    // (Room.dispatch() рассылает безусловно, даже когда движок вернул
    // unchanged state) — вычитываем её отдельно, прежде чем читать реальный
    // переход ниже. Тот же паттерн, что уже используется в этом файле для
    // холостого голоса в 'createServer game flow'.
    await settle(a, b, picker);

    other.ws.send(JSON.stringify({ type: 'buzz' }));
    const afterBuzz = (await settle(a, b, other)) as {
      game: { phase: string; buzzedParticipantId: string };
    };
    expect(afterBuzz.game.phase).toBe('buzzed');
    expect(afterBuzz.game.buzzedParticipantId).toBe(other.participantId);

    server.close();
  });

  it('replies select-question-error to the picker alone when nobody else is online to receive the cat, without broadcasting anything', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-cat-no-recipient-'));
    const room = new Room(undefined, CAT_TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    const other = picker === a ? b : a;

    other.ws.close();
    await picker.nextMessage(); // трансляция отключения other

    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'cat1',
      }),
    );
    const reply = await picker.nextMessage();
    expect(reply).toEqual({
      type: 'select-question-error',
      reason: 'no-recipient',
    });

    server.close();
    await rm(dir, { recursive: true, force: true });
  });
});

const AUCTION_TEST_PACK: Pack = {
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
              id: 'auc1',
              price: 100,
              text: 'Вопрос-аукцион?',
              answer: 'ответ аукциона',
              type: 'аукцион',
            },
          ],
        },
      ],
    },
  ],
};

describe('createServer auction', () => {
  it('drives a full auction from selection through the winner buzzing in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-auction-'));
    const room = new Room(undefined, AUCTION_TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } =
      server.httpServer.address() as import('node:net').AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    // Ведущий здесь не для судейства (тест до голосования не доходит) — это
    // единственный способ зафандить счёт picker'а перед торгами через
    // настоящий протокол, а не напрямую в состоянии: handlePlaceBid
    // отклоняет ставку выше собственного счёта (design.md, «ва-банк» —
    // потолок, не пол), а у только что созданной партии у всех 0 (тот же
    // паттерн уже потребовался в engine.test.ts/room.test.ts выше).
    const c = await joinPlayer(url, 'Ведущий');
    await a.nextMessage();
    await b.nextMessage();

    c.ws.send(JSON.stringify({ type: 'toggle-host' }));
    await Promise.all([a.nextMessage(), b.nextMessage(), c.nextMessage()]);

    c.ws.send(JSON.stringify({ type: 'start-game' }));
    const aState = (await settle(a, b, a)) as {
      game: { phase: string; turnParticipantId: string };
    };
    await c.nextMessage(); // тот же бродкаст, доходит и до ведущего
    const picker = aState.game.turnParticipantId === a.participantId ? a : b;
    const other = picker === a ? b : a;

    c.ws.send(
      JSON.stringify({
        type: 'adjust-score',
        participantId: picker.participantId,
        delta: 200,
      }),
    );
    await settle(a, b, picker);
    await c.nextMessage();

    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'auc1',
      }),
    );
    const afterSelect = (await settle(a, b, picker)) as {
      game: { phase: string; auctionTurnParticipantId: string };
    };
    await c.nextMessage();
    expect(afterSelect.game.phase).toBe('auction-bidding');
    expect(afterSelect.game.auctionTurnParticipantId).toBe(
      picker.participantId,
    );

    picker.ws.send(JSON.stringify({ type: 'place-bid', amount: 150 }));
    const afterBid = (await settle(a, b, picker)) as {
      game: {
        auctionHighestBid: number;
        auctionHighestBidderParticipantId: string;
        auctionTurnParticipantId: string;
      };
    };
    await c.nextMessage();
    expect(afterBid.game.auctionHighestBid).toBe(150);
    expect(afterBid.game.auctionHighestBidderParticipantId).toBe(
      picker.participantId,
    );
    expect(afterBid.game.auctionTurnParticipantId).toBe(other.participantId);

    other.ws.send(JSON.stringify({ type: 'pass-bid' }));
    // Победа в торгах тоже идёт через openQuestion() — question-reveal перед
    // question-open, тот же паттерн, что и в 'createServer cat-in-the-bag'
    // (этот describe тоже без фейковых таймеров — пауза здесь настоящая).
    const onReveal = (await settle(a, b, other)) as {
      game: { phase: string };
    };
    expect(onReveal.game.phase).toBe('question-reveal');
    await c.nextMessage();
    await new Promise((r) => setTimeout(r, TEXT_REVEAL_MIN_MS + 50));
    const afterPass = (await settle(a, b, other)) as {
      game: { phase: string; exclusiveAnswererParticipantId: string };
    };
    await c.nextMessage();
    expect(afterPass.game.phase).toBe('question-open');
    expect(afterPass.game.exclusiveAnswererParticipantId).toBe(
      picker.participantId,
    );

    // Раздающий (не победитель торгов) — не может нажать; проигрышный
    // нажим всё равно вызывает рассылку (Room.dispatch() безусловен), её
    // нужно вычитать отдельно, прежде чем читать реальный переход ниже —
    // тот же паттерн, что уже используется в 'createServer cat-in-the-bag'.
    other.ws.send(JSON.stringify({ type: 'buzz' }));
    await settle(a, b, other);
    await c.nextMessage();

    picker.ws.send(JSON.stringify({ type: 'buzz' }));
    const afterBuzz = (await settle(a, b, picker)) as {
      game: { phase: string; buzzedParticipantId: string };
    };
    await c.nextMessage();
    expect(afterBuzz.game.phase).toBe('buzzed');
    expect(afterBuzz.game.buzzedParticipantId).toBe(picker.participantId);

    server.close();
  });
});

describe('createServer host mode', () => {
  it('replies start-game-error to the requester when three join and nobody is host', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-host-required-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
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
      port: 8080,
      packsDir: dir,
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
    // Этот describe тоже без фейковых таймеров — та же настоящая пауза, что
    // уже используется в 'createServer cat-in-the-bag'/'createServer
    // auction' выше: буз во время question-reveal — фальстарт (Room.buzz),
    // а не игровое действие, поэтому его нужно дождаться, не пропустить.
    const onReveal = (await settle(a, b, picker)) as {
      game: { phase: string };
    };
    expect(onReveal.game.phase).toBe('question-reveal');
    await c.nextMessage();
    await new Promise((r) => setTimeout(r, TEXT_REVEAL_MIN_MS + 50));
    const afterSelect = (await settle(a, b, picker)) as {
      game: { phase: string };
    };
    expect(afterSelect.game.phase).toBe('question-open');
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
      port: 8080,
      packsDir: dir,
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
        port: 8080,
        packsDir: dir,
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
      const onReveal = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(onReveal.game.phase).toBe('question-reveal');
      await c.nextMessage();
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
      const afterSelect = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterSelect.game.phase).toBe('question-open');
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
// поэтому в отличие от joinPlayer() выше здесь только стартовое 'state',
// без 'joined'.
async function connectAdmin(baseUrl: string) {
  const ws = new WebSocket(baseUrl);
  const nextMessage = collectMessages(ws);
  await waitForOpen(ws);
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
      port: 8080,
      packsDir: dir,
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

  // Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — своя
  // комната с кандидатами, а не общая из beforeEach (там их нет), и своя
  // рассылка проверяется у обоих сокетов сразу: смена адреса должна дойти
  // до уже подключённых табло/игроков, не только до новых подключений.
  it('admin-set-lan-address switches the LAN url broadcast to everyone connected', async () => {
    const lanDir = await mkdtemp(join(tmpdir(), 'svoya-igra-admin-lan-'));
    const lanRoom = new Room(undefined, TEST_PACK, {
      candidates: [
        { address: '192.168.56.1', interfaceName: 'Ethernet 2' },
        { address: '192.168.31.179', interfaceName: 'Беспроводная сеть' },
      ],
      address: '192.168.56.1',
    });
    const lanServer = createServer({
      room: lanRoom,
      clientDistPath: lanDir,
      port: 8080,
      packsDir: lanDir,
    });
    await new Promise<void>((resolve) =>
      lanServer.httpServer.listen(0, resolve),
    );
    const { port: lanPort } = lanServer.httpServer.address() as AddressInfo;
    const lanBaseUrl = `ws://127.0.0.1:${lanPort}/ws`;

    const admin = await connectAdmin(lanBaseUrl);
    const board = await connectAdmin(lanBaseUrl); // табло — тоже не 'join'-сокет

    admin.ws.send(
      JSON.stringify({
        type: 'admin-set-lan-address',
        address: '192.168.31.179',
      }),
    );
    const [adminState, boardState] = (await Promise.all([
      admin.nextMessage(),
      board.nextMessage(),
    ])) as { lanUrl: string }[];
    expect(adminState.lanUrl).toBe('http://192.168.31.179:8080/');
    expect(boardState.lanUrl).toBe('http://192.168.31.179:8080/');

    admin.ws.close();
    board.ws.close();
    await lanServer.close();
    await rm(lanDir, { recursive: true, force: true });
  });

  it('admin-set-lan-address ignores an address that is not a known candidate', async () => {
    const lanDir = await mkdtemp(join(tmpdir(), 'svoya-igra-admin-lan-bad-'));
    const lanRoom = new Room(undefined, TEST_PACK, {
      candidates: [{ address: '192.168.56.1', interfaceName: 'Ethernet 2' }],
      address: '192.168.56.1',
    });
    const lanServer = createServer({
      room: lanRoom,
      clientDistPath: lanDir,
      port: 8080,
      packsDir: lanDir,
    });
    await new Promise<void>((resolve) =>
      lanServer.httpServer.listen(0, resolve),
    );
    const { port: lanPort } = lanServer.httpServer.address() as AddressInfo;
    const lanBaseUrl = `ws://127.0.0.1:${lanPort}/ws`;

    const admin = await connectAdmin(lanBaseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-set-lan-address', address: '9.9.9.9' }),
    );
    // Невалидный адрес не меняет состояние — оно не рассылается заново,
    // значит и ждать здесь больше нечего. Прогоняем безобидное admin-действие
    // следом и проверяем по его рассылке, что lanUrl остался прежним.
    admin.ws.send(JSON.stringify({ type: 'admin-reset-room' }));
    const state = (await admin.nextMessage()) as { lanUrl: string };
    expect(state.lanUrl).toBe('http://192.168.56.1:8080/');

    admin.ws.close();
    await lanServer.close();
    await rm(lanDir, { recursive: true, force: true });
  });
});

describe('createServer pack picker', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  const PACK_A: Pack = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'В?',
                answer: 'О',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
  };
  const PACK_B: Pack = {
    ...PACK_A,
    title: 'Пак Б',
    description: 'Второй пак',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'b1',
                price: 100,
                text: 'В2?',
                answer: 'О2',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-picker-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-picker-packs-'));
    await writeFile(join(packsDir, 'a.json'), JSON.stringify(PACK_A), 'utf8');
    await writeFile(join(packsDir, 'b.json'), JSON.stringify(PACK_B), 'utf8');
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(packsDir, { recursive: true, force: true });
  });

  it('sends the initial active pack filename and an empty available list before any refresh', async () => {
    // Не connectAdmin() — та сама вычитывает единственное стартовое 'state'
    // из очереди, а этому тесту нужно посмотреть именно на него.
    const ws = new WebSocket(baseUrl);
    const nextMessage = collectMessages(ws);
    await waitForOpen(ws);
    const state = (await nextMessage()) as {
      activePackFilename: string;
      availablePacks: unknown[];
    };
    expect(state.activePackFilename).toBe('a.json');
    expect(state.availablePacks).toEqual([]);
    ws.close();
  });

  it('admin-refresh-packs populates availablePacks with titles and descriptions', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    const state = (await admin.nextMessage()) as {
      availablePacks: {
        filename: string;
        title: string;
        description: string | null;
      }[];
    };
    expect(state.availablePacks).toEqual(
      expect.arrayContaining([
        { filename: 'a.json', title: 'Пак А', description: null },
        { filename: 'b.json', title: 'Пак Б', description: 'Второй пак' },
      ]),
    );
    admin.ws.close();
  });

  it('admin-select-pack switches the active pack and broadcasts to everyone connected', async () => {
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage(); // рассылка после join

    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    // Рассылка после admin-refresh-packs идёт ВСЕМ подключённым, включая
    // уже подключённого игрока `a` — если не вычитать её здесь и у него, она
    // осталась бы в очереди и следующий a.nextMessage() ниже вернул бы её
    // вместо рассылки после admin-select-pack.
    await Promise.all([admin.nextMessage(), a.nextMessage()]);

    admin.ws.send(
      JSON.stringify({ type: 'admin-select-pack', filename: 'b.json' }),
    );
    const [adminState, aState] = (await Promise.all([
      admin.nextMessage(),
      a.nextMessage(),
    ])) as { activePackFilename: string }[];
    expect(adminState.activePackFilename).toBe('b.json');
    expect(aState.activePackFilename).toBe('b.json');

    admin.ws.close();
    a.ws.close();
  });

  it('select-pack from the host succeeds; from a non-host is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    const host = await joinPlayer(baseUrl, 'Ваня');
    await admin.nextMessage();
    const other = await joinPlayer(baseUrl, 'Катя');
    await admin.nextMessage();
    await host.nextMessage();

    host.ws.send(JSON.stringify({ type: 'toggle-host' }));
    await Promise.all([
      admin.nextMessage(),
      host.nextMessage(),
      other.nextMessage(),
    ]);

    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    // Та же рассылка-всем ловушка, что и в предыдущем тесте: host и other
    // тоже подключены и получают эту рассылку, иначе она осталась бы в их
    // очереди и всплыла бы вместо ответа на следующее действие.
    await Promise.all([
      admin.nextMessage(),
      host.nextMessage(),
      other.nextMessage(),
    ]);

    // Не ведущий — тихий no-op, ничего не приходит, доказываем последующим
    // легитимным действием, что сокет и процесс живы как обычно.
    other.ws.send(JSON.stringify({ type: 'select-pack', filename: 'b.json' }));
    other.ws.send(JSON.stringify({ type: 'buzz' }));
    const reply = await other.nextMessage();
    expect(reply).toEqual({ type: 'falsestart' });

    host.ws.send(JSON.stringify({ type: 'select-pack', filename: 'b.json' }));
    const [adminState] = (await Promise.all([
      admin.nextMessage(),
      host.nextMessage(),
      other.nextMessage(),
    ])) as { activePackFilename: string }[];
    expect(adminState.activePackFilename).toBe('b.json');

    admin.ws.close();
    host.ws.close();
    other.ws.close();
  });

  it('admin-select-pack with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);

    // Room знает о b.json только после refresh — иначе admin-select-pack
    // ниже сам получил бы unknown-file, независимо от проверяемой защиты.
    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    await admin.nextMessage();

    // Сначала легитимно переключаемся на b.json, чтобы отличить "ничего не
    // произошло" от "и так был активен a.json".
    admin.ws.send(
      JSON.stringify({ type: 'admin-select-pack', filename: 'b.json' }),
    );
    const switched = (await admin.nextMessage()) as {
      activePackFilename: string;
    };
    expect(switched.activePackFilename).toBe('b.json');

    // Тихий no-op отличить от смены пака (или от select-pack-error) иначе,
    // чем последующим легитимным действием — та же техника, что и в тесте
    // выше на 'не ведущий': если бы это сообщение дало какой-то ответ, он
    // пришёл бы раньше ответа на admin-refresh-packs и тест бы упал.
    admin.ws.send(
      JSON.stringify({ type: 'admin-select-pack', filename: '../a.json' }),
    );
    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    const state = (await admin.nextMessage()) as {
      activePackFilename: string;
    };
    expect(state.activePackFilename).toBe('b.json');

    admin.ws.close();
  });

  it('select-pack-error on an unknown filename', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-select-pack', filename: 'ghost.json' }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toEqual({
      type: 'select-pack-error',
      reason: 'unknown-file',
    });
    admin.ws.close();
  });
});

describe('createServer pack editor', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  const PACK_A: Pack = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'В?',
                answer: 'О',
                type: 'обычный',
              },
              {
                id: 'a2',
                price: 200,
                text: 'В2?',
                answer: 'О2',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
  };

  let profilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-packs-'));
    await writeFile(join(packsDir, 'a.json'), JSON.stringify(PACK_A), 'utf8');
    profilePath = join(dir, 'profile.md');
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir,
      profilePath,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(packsDir, { recursive: true, force: true });
  });

  it('admin-get-pack returns the full pack content', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    expect(reply.pack.title).toBe('Пак А');
    expect(reply.pack.rounds[0].themes[0].questions).toHaveLength(2);
    admin.ws.close();
  });

  it('admin-get-pack on an unknown file returns admin-pack-error with a short Russian reason, not a raw fs error', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'ghost.json' }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toEqual({
      type: 'admin-pack-error',
      filename: 'ghost.json',
      reason: 'файл не найден',
    });
    admin.ws.close();
  });

  it('admin-get-pack with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    // Тот же приём, что уже используется в 'admin-select-pack with a
    // path-traversal filename' — легитимное действие после подозрительного
    // доказывает, что сокет жив и молчание не было случайностью.
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: '../a.json' }),
    );
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string };
    expect(reply.type).toBe('admin-pack');
    admin.ws.close();
  });

  it('admin-update-question with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    // Тот же приём, что и в 'admin-get-pack with a path-traversal filename'
    // — легитимное действие после подозрительного доказывает, что сокет жив
    // и молчание не было случайностью.
    admin.ws.send(
      JSON.stringify({
        type: 'admin-update-question',
        filename: '../a.json',
        questionId: 'a1',
        price: 300,
        text: 'Новый текст?',
        answer: 'Новый ответ',
        questionType: 'обычный',
      }),
    );
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string };
    expect(reply.type).toBe('admin-pack');
    admin.ws.close();
  });

  it('admin-delete-question with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    // Тот же приём, что и в 'admin-get-pack with a path-traversal filename'
    // — легитимное действие после подозрительного доказывает, что сокет жив
    // и молчание не было случайностью.
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: '../a.json',
        questionId: 'a1',
      }),
    );
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string };
    expect(reply.type).toBe('admin-pack');
    admin.ws.close();
  });

  it('admin-update-question changes the question and returns the updated pack', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-update-question',
        filename: 'a.json',
        questionId: 'a1',
        price: 300,
        text: 'Новый текст?',
        answer: 'Новый ответ',
        questionType: 'обычный',
      }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    const updated = reply.pack.rounds[0].themes[0].questions.find(
      (q) => q.id === 'a1',
    );
    expect(updated).toMatchObject({ price: 300, text: 'Новый текст?' });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(
      onDisk.rounds[0].themes[0].questions.find((q) => q.id === 'a1')?.price,
    ).toBe(300);
    admin.ws.close();
  });

  it('admin-update-question with an invalid price returns admin-pack-error and does not write', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-update-question',
        filename: 'a.json',
        questionId: 'a1',
        price: 0,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toMatchObject({
      type: 'admin-pack-error',
      filename: 'a.json',
    });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(
      onDisk.rounds[0].themes[0].questions.find((q) => q.id === 'a1')?.price,
    ).toBe(100);
    admin.ws.close();
  });

  it('admin-delete-question removes the question and returns the updated pack', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a2',
      }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    expect(reply.pack.rounds[0].themes[0].questions).toHaveLength(1);

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
    admin.ws.close();
  });

  it('admin-delete-question on the last question in a theme returns admin-pack-error and does not write', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a1',
      }),
    );
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a2',
      }),
    );
    // Первое удаление (a1) проходит нормально — из двух вопросов остаётся
    // один. Второе (a2) оставило бы тему пустой и должно быть отклонено.
    await admin.nextMessage(); // ответ на первое удаление
    const reply = await admin.nextMessage(); // ответ на второе
    expect(reply).toMatchObject({
      type: 'admin-pack-error',
      filename: 'a.json',
    });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
    expect(onDisk.rounds[0].themes[0].questions[0].id).toBe('a2');
    admin.ws.close();
  });

  it('admin-report-question appends a complaint to the profile file and acks', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'a1',
        complaint: 'непонятная формулировка',
      }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toEqual({
      type: 'admin-report-ack',
      filename: 'a.json',
      questionId: 'a1',
    });

    const profileContent = await readFile(profilePath, 'utf8');
    expect(profileContent).toContain('## Жалобы и оценки игроков');
    expect(profileContent).toContain('«Пак А» (a.json)');
    expect(profileContent).toContain('тема «Тема», вопрос за 100');
    expect(profileContent).toContain(
      '«В?» (ответ: «О») — непонятная формулировка',
    );
    admin.ws.close();
  });

  it('admin-report-question on an unknown question id returns admin-report-error and does not write', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'ghost',
        complaint: 'жалоба',
      }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toMatchObject({
      type: 'admin-report-error',
      filename: 'a.json',
      questionId: 'ghost',
    });

    const profileContent = await readFile(profilePath, 'utf8');
    expect(profileContent).not.toContain('## Жалобы и оценки игроков');
    admin.ws.close();
  });

  it('admin-report-question with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: '../a.json',
        questionId: 'a1',
        complaint: 'жалоба',
      }),
    );
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string };
    expect(reply.type).toBe('admin-pack');
    admin.ws.close();
  });

  it('two admin-report-question calls in a row both land in the profile file (write-lock)', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'a1',
        complaint: 'первая жалоба',
      }),
    );
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'a2',
        complaint: 'вторая жалоба',
      }),
    );
    await admin.nextMessage();
    await admin.nextMessage();

    const profileContent = await readFile(profilePath, 'utf8');
    expect(profileContent).toContain('первая жалоба');
    expect(profileContent).toContain('вторая жалоба');
    const headingCount =
      profileContent.split('## Жалобы и оценки игроков').length - 1;
    expect(headingCount).toBe(1);
    admin.ws.close();
  });

  it('admin-report-question with a missing profile file returns a distinct reason from a missing pack file', async () => {
    // Fix 7 (финальное ревью) — ENOENT из appendComplaint (файл профиля
    // пропал) не должен звучать как ENOENT из loadPack (файл пакета
    // пропал) — иначе непонятно, какой из двух файлов на самом деле не
    // найден.
    await rm(profilePath, { force: true });
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'a1',
        complaint: 'жалоба',
      }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toEqual({
      type: 'admin-report-error',
      filename: 'a.json',
      questionId: 'a1',
      reason: 'не удалось сохранить жалобу — файл профиля не найден',
    });
    admin.ws.close();
  });
});

describe('createServer player questionnaire', () => {
  let server: GameServer;
  let dir: string;
  let baseUrl: string;
  let playersPath: string;

  const VANYA_CODE = JSON.stringify({
    version: 1,
    name: 'Ваня',
    interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
    boring: [],
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-players-'));
    playersPath = join(dir, 'players.md');
    await writeFile(
      playersPath,
      '# Анкеты игроков\n\nВводный текст.\n',
      'utf8',
    );
    const room = new Room(undefined, TEST_PACK);
    server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
      playersPath,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('admin-get-players на пустом файле отдаёт пустой список', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(JSON.stringify({ type: 'admin-get-players' }));
    const reply = await admin.nextMessage();
    expect(reply).toEqual({ type: 'admin-players', players: [] });
    admin.ws.close();
  });

  it('admin-save-player пишет анкету и отдаёт обновлённый список', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-players',
      players: [{ name: 'Ваня', date: expect.any(String) }],
    });
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('- **Спорт:** Формула-1');
    admin.ws.close();
  });

  it('повторное имя без подтверждения ничего не пишет', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();

    const newCode = JSON.stringify({
      version: 1,
      name: 'Ваня',
      interests: [{ area: 'Кино', examples: ['новое'] }],
      boring: [],
    });
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: newCode,
        replace: false,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({ type: 'admin-player-exists', name: 'Ваня' });
    const content = await readFile(playersPath, 'utf8');
    expect(content).not.toContain('новое'); // старая анкета на месте
    admin.ws.close();
  });

  it('replace: true заменяет анкету', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();

    const newCode = JSON.stringify({
      version: 1,
      name: 'Ваня',
      interests: [{ area: 'Кино', examples: ['новое'] }],
      boring: [],
    });
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: newCode,
        replace: true,
      }),
    );
    await admin.nextMessage();
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('новое');
    expect(content).not.toContain('Формула-1');
    admin.ws.close();
  });

  it('битый код отдаёт причину, а не молчание', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: 'привет',
        replace: false,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-player-error',
      reason: expect.stringContaining('не похоже на код анкеты'),
    });
    admin.ws.close();
  });

  it('admin-save-player с отсутствующим файлом анкет отдаёт внятную причину', async () => {
    await rm(playersPath, { force: true });
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-player-error',
      reason: 'файл анкет не найден',
    });
    admin.ws.close();
  });

  // Комментарий у withPlayersWriteLock в server.ts обещает, что проверка
  // существования и запись идут внутри одной блокировки. Держится это только
  // на комментарии, пока такой тест не написан. Важно: два РАЗНЫХ имени,
  // отправленных подряд БЕЗ ожидания ответа между отправками — обе операции
  // без блокировки читают один и тот же файл, и та, что запишет позже,
  // затирает результат первой. Одно и то же имя дважды ничего не доказывало
  // бы: вторая отправка упёрлась бы в конфликт имён и без всякой блокировки.
  it('две анкеты с разными именами, отправленные подряд без ожидания ответа между отправками, не теряют друг друга', async () => {
    const admin = await connectAdmin(baseUrl);
    const katyaCode = JSON.stringify({
      version: 1,
      name: 'Катя',
      interests: [{ area: 'Музыка', examples: ['джаз'] }],
      boring: [],
    });

    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: katyaCode,
        replace: false,
      }),
    );

    await admin.nextMessage();
    await admin.nextMessage();

    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('## Ваня');
    expect(content).toContain('## Катя');
    admin.ws.close();
  });
  it('admin-get-player отдаёт анкету и ручные строки раздела', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();
    const withNote = (await readFile(playersPath, 'utf8')).replace(
      '- **Спорт:** Формула-1',
      '- **Спорт:** Формула-1\nПометка ведущего.',
    );
    await writeFile(playersPath, withNote, 'utf8');

    admin.ws.send(JSON.stringify({ type: 'admin-get-player', name: 'ваня' }));
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-player',
      card: {
        name: 'Ваня',
        interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
        boring: [],
      },
      extraLines: ['Пометка ведущего.'],
    });
    admin.ws.close();
  });

  it('admin-get-player на незнакомое имя отдаёт ошибку, а не пустую анкету', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(JSON.stringify({ type: 'admin-get-player', name: 'Пётр' }));
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-player-error',
      reason: 'такой анкеты уже нет — обнови список',
    });
    admin.ws.close();
  });

  it('правка с тем же именем заменяет раздел, а не заводит второй', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();

    const edited = JSON.stringify({
      version: 1,
      name: 'Ваня',
      interests: [{ area: 'Спорт', examples: ['хоккей'] }],
      boring: ['Мода'],
    });
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: edited,
        replace: true,
        originalName: 'Ваня',
      }),
    );
    const message = (await admin.nextMessage()) as {
      players: { name: string }[];
    };
    expect(message.players).toHaveLength(1);
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('- **Спорт:** хоккей');
    expect(content).not.toContain('Формула-1');
    admin.ws.close();
  });

  it('смена имени в форме переименовывает, а не заводит вторую анкету', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();

    const renamed = JSON.stringify({
      version: 1,
      name: 'Иван',
      interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
      boring: [],
    });
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: renamed,
        replace: true,
        originalName: 'Ваня',
      }),
    );
    const message = (await admin.nextMessage()) as {
      players: { name: string }[];
    };
    expect(message.players).toEqual([
      { name: 'Иван', date: expect.any(String) },
    ]);
    const content = await readFile(playersPath, 'utf8');
    expect(content).not.toContain('## Ваня');
    admin.ws.close();
  });

  it('переименование в занятое имя без подтверждения не трогает файл', async () => {
    const admin = await connectAdmin(baseUrl);
    for (const name of ['Ваня', 'Катя']) {
      admin.ws.send(
        JSON.stringify({
          type: 'admin-save-player',
          code: JSON.stringify({
            version: 1,
            name,
            interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
            boring: [],
          }),
          replace: false,
        }),
      );
      await admin.nextMessage();
    }
    const before = await readFile(playersPath, 'utf8');

    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: JSON.stringify({
          version: 1,
          name: 'Катя',
          interests: [{ area: 'Игры', examples: ['дота'] }],
          boring: [],
        }),
        replace: false,
        originalName: 'Ваня',
      }),
    );
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-player-exists',
      name: 'Катя',
    });
    expect(await readFile(playersPath, 'utf8')).toBe(before);
    admin.ws.close();
  });

  it('admin-delete-player-card убирает анкету и отдаёт обновлённый список', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-save-player',
        code: VANYA_CODE,
        replace: false,
      }),
    );
    await admin.nextMessage();

    admin.ws.send(
      JSON.stringify({ type: 'admin-delete-player-card', name: 'ваня' }),
    );
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-players',
      players: [],
    });
    const content = await readFile(playersPath, 'utf8');
    expect(content).not.toContain('## Ваня');
    expect(content).toContain('Вводный текст.');
    admin.ws.close();
  });
});

describe('createServer game-end player stats', () => {
  it('game-end пересчитывает «Показывает в игре» реальными числами партии', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-player-stats-'));
      const playersPath = join(dir, 'players.md');
      await writeFile(
        playersPath,
        '# Анкеты игроков\n\nВводный текст.\n',
        'utf8',
      );
      const history = new GameHistory(':memory:');
      const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
      const katyaId = history.createPerson('Катя', '2026-08-02')!;
      const room = new Room(
        undefined,
        TEST_PACK,
        undefined,
        'test.json',
        history,
      );
      const server = createServer({
        room,
        clientDistPath: dir,
        port: 8080,
        packsDir: dir,
        playersPath,
        history,
      });
      await new Promise<void>((resolve) =>
        server.httpServer.listen(0, resolve),
      );
      const { port } = server.httpServer.address() as AddressInfo;
      const url = `ws://127.0.0.1:${port}/ws`;

      const a = await joinPlayerAs(url, vanyaId);
      const b = await joinPlayerAs(url, katyaId);
      await a.nextMessage(); // трансляция лобби после join второго

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
      await settle(a, b, picker); // question-reveal
      await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
      await settle(a, b, picker); // question-open

      picker.ws.send(JSON.stringify({ type: 'buzz' }));
      await settle(a, b, picker); // buzzed
      picker.ws.send(JSON.stringify({ type: 'said-answer' }));
      await settle(a, b, picker); // judging

      other.ws.send(JSON.stringify({ type: 'vote', correct: true }));
      await settle(a, b, picker); // голос учтён, вердикт ещё не подведён

      let remaining = VOTE_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterVote = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterVote.game.phase).toBe('reveal');

      // TEST_PACK — единственный раунд с единственным вопросом, без финала:
      // reveal доигрывает прямо в game-end, минуя round-end/selecting.
      remaining = REVEAL_TIMER_MS;
      while (remaining > 0) {
        const step = Math.min(HEARTBEAT_INTERVAL_MS, remaining);
        await vi.advanceTimersByTimeAsync(step);
        remaining -= step;
      }
      const afterReveal = (await settle(a, b, picker)) as {
        game: { phase: string };
      };
      expect(afterReveal.game.phase).toBe('game-end');

      const content = await waitForFileContent(
        playersPath,
        '## Показывает в игре',
      );
      expect(content).toContain('Вводный текст.'); // анкеты выше не тронуты
      expect(content).toContain(`### ${picker.name}`);
      expect(content).toContain(
        'Всего: нажимал 1 из 1 сыгранных при нём вопросов, верно 1.',
      );
      expect(content).toContain(
        '- **Тема** — нажимал 1 из 1 вопросов темы, верно 1',
      );
      // Второй участник тоже сыграл вопрос, но не нажимал и не отвечал —
      // это разные числа для одного и того же вопроса, и раздел обязан
      // показывать их по каждому человеку отдельно, а не одной общей строкой.
      expect(content).toContain(`### ${other.name}`);
      expect(content).toContain(
        'Всего: нажимал 0 из 1 сыгранных при нём вопросов, верно 0.',
      );

      a.ws.close();
      b.ws.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

// Слияние расщепившихся профилей (задача 4, sdd/2026-08-26-player-identity,
// design.md «Слияние профилей»). Собственный history — GameHistory(':memory:'),
// а не заглушка: mergePeople/listPeople реально трогают SQLite, и тест обязан
// проверять настоящую перепривязку, а не то, что заглушка была вызвана.
describe('createServer admin merge people', () => {
  let server: GameServer;
  let dir: string;
  let baseUrl: string;
  let history: GameHistory;
  let playersPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-merge-people-'));
    history = new GameHistory(':memory:');
    // playersPath — для задачи 3 (финальное ревью ветки, Important): слияние
    // обязано пересчитывать «Показывает в игре», не только базу.
    playersPath = join(dir, 'players.md');
    await writeFile(
      playersPath,
      '# Анкеты игроков\n\nВводный текст.\n',
      'utf8',
    );
    // Тот же history — и в Room (откуда room.getPeople() берёт список для
    // обычной рассылки state), и в createServer (откуда его берёт прямой
    // обработчик admin-merge-people). В реальной сборке (index.ts) это один
    // и тот же объект; развести их здесь — значит проверять не ту схему
    // подключения, что работает на самом деле (тот же паттерн, что и в
    // остальных тестах файла с настоящим GameHistory, например
    // «tag-reason доносит причину до комнаты…» выше).
    const room = new Room(
      undefined,
      TEST_PACK,
      undefined,
      'test.json',
      history,
    );
    server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
      history,
      playersPath,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('сливает двух людей и отдаёт обновлённый список', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    const admin = await connectAdmin(baseUrl);

    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: katyaId,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-people',
      people: [{ id: katyaId, name: 'Катя', games: 0 }],
    });
    expect(history.listPeople()).toEqual([
      { id: katyaId, name: 'Катя', games: 0 },
    ]);
    admin.ws.close();
  });

  it('во время идущей партии отдаёт ошибку и ничего не меняет', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    const admin = await connectAdmin(baseUrl);
    const a = await joinPlayer(baseUrl, 'Игрок 1');
    await admin.nextMessage(); // рассылка после join a
    const b = await joinPlayer(baseUrl, 'Игрок 2');
    await admin.nextMessage(); // рассылка после join b
    await a.nextMessage(); // та же рассылка, но у a

    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);

    // Снимок списка людей ДО попытки слияния — join() двух игроков в этом
    // тесте сам заводит им записи людей (Room делит history с сервером — см.
    // beforeEach), так что в базе есть и другие записи, к делу не
    // относящиеся, и перечислять их поимённо незачем (финальное ревью ветки,
    // п. 9): снимок и точное сравнение с ним после дают полную гарантию
    // «ничего не изменилось» без arrayContaining, который проверял бы только
    // отсутствие пропажи, но не появление лишнего и не смену состава.
    const before = history.listPeople();

    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: katyaId,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-people-error',
      reason: 'нельзя сливать игроков, пока идёт партия',
    });
    expect(history.listPeople()).toEqual(before);

    admin.ws.close();
    a.ws.close();
    b.ws.close();
  });

  it('слияние человека с самим собой отдаёт ошибку', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const admin = await connectAdmin(baseUrl);

    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: vanyaId,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-people-error',
      reason: 'не удалось слить — выбраны один и тот же игрок?',
    });
    expect(history.listPeople()).toEqual([
      { id: vanyaId, name: 'Ваня', games: 0 },
    ]);
    admin.ws.close();
  });

  // Ревью задачи 4, Important 1: сообщение об отказе не должно утверждать
  // неправду. Гонка — кого-то из двоих уже слили с другого устройства между
  // тем, как ведущий открыл диалог подтверждения (там ещё стояли два разных
  // имени), и тем, как подтвердил его. mergePeople(fromId, intoId) в этом
  // случае тоже вернёт false, но «выбран один и тот же игрок» была бы
  // неправдой — ведущий видел два разных имени, а не одно.
  it('если fromId уже слили с кем-то третьим до подтверждения, причина — что его больше нет, а не «один и тот же»', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    const petyaId = history.createPerson('Петя', '2026-08-03')!;
    // С другого устройства уже слили Ваню в Петю — Вани больше нет.
    expect(history.mergePeople(vanyaId, petyaId)).toBe(true);

    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: katyaId,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-people-error',
      reason: 'такого игрока уже нет — обнови список',
    });
    admin.ws.close();
  });

  it('то же самое, если исчез intoId, а не fromId', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    const petyaId = history.createPerson('Петя', '2026-08-03')!;
    // С другого устройства уже слили Катю в Петю — Кати больше нет.
    expect(history.mergePeople(katyaId, petyaId)).toBe(true);

    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: katyaId,
      }),
    );
    const message = await admin.nextMessage();
    expect(message).toEqual({
      type: 'admin-people-error',
      reason: 'такого игрока уже нет — обнови список',
    });
    admin.ws.close();
  });

  // Ревью задачи 4, Important 2: список приходит и в прямом ответе
  // инициатору, и в обычном состоянии комнаты (stateMessageFor кладёт
  // room.getPeople() → history.listPeople()) — значит после успешного
  // слияния свежий список обязан уйти ВСЕМ открытым сокетам, не только
  // тому, кто его запросил. Второй сокет здесь стоит и за «вторую открытую
  // админку», и за «лобби на телефоне игрока» — до join() это один и тот же
  // путь: обычный сокет получает 'state' наравне с админкой.
  it('после успешного слияния свежий список уходит и остальным открытым сокетам, не только инициатору', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    const admin = await connectAdmin(baseUrl);
    const bystander = await connectAdmin(baseUrl);

    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: vanyaId,
        intoId: katyaId,
      }),
    );
    const direct = await admin.nextMessage();
    expect(direct).toEqual({
      type: 'admin-people',
      people: [{ id: katyaId, name: 'Катя', games: 0 }],
    });

    const broadcast = await bystander.nextMessage();
    expect(broadcast).toMatchObject({
      type: 'state',
      people: [{ id: katyaId, name: 'Катя', games: 0 }],
    });

    admin.ws.close();
    bystander.ws.close();
  });

  // Финальное ревью ветки, п. 3 (Important): refreshPlayerStats() раньше
  // вызывалась только из точки game-end — ведущий сливает расщепившиеся
  // профили именно затем, чтобы числа в «Показывает в игре» сошлись, а файл
  // до конца следующей партии продолжал бы показывать два раздела со старыми
  // числами, один из которых принадлежит уже удалённому из базы человеку.
  it('после успешного слияния пересчитывает «Показывает в игре» в файле анкет', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const katyaId = history.createPerson('Катя', '2026-08-02')!;
    // Партия и сыгранный вопрос заводятся прямо через history (минуя
    // реальную партию через Room) — это тот же приём, что и в
    // history.test.ts (playerStats seed()): playerStats() читает game_people
    // и played_questions, ей всё равно, как они появились.
    const gameId = history.startGame({
      startedAt: '2026-08-01T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanyaId }],
    })!;
    history.recordQuestion(gameId, {
      questionId: 'q1',
      roundIndex: 0,
      themeName: 'История',
      price: 100,
      type: 'обычный',
      text: 'Вопрос',
      answer: 'Ответ',
      answeredBy: 'Ваня',
      answeredByCounterId: 'c1',
      correct: true,
      contested: false,
    });

    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-merge-people',
        fromId: katyaId,
        intoId: vanyaId,
      }),
    );
    await admin.nextMessage(); // admin-people

    const content = await waitForFileContent(
      playersPath,
      '## Показывает в игре',
    );
    expect(content).toContain('### Ваня');
    // Катя не сыграла ни одной партии и была слита без следа — второго
    // раздела в файле быть не должно.
    expect(content).not.toContain('### Катя');
    expect(content).toContain(
      'Всего: нажимал 1 из 1 сыгранных при нём вопросов, верно 1.',
    );

    admin.ws.close();
  });
});

describe('createServer admin delete player', () => {
  let server: GameServer;
  let dir: string;
  let baseUrl: string;
  let history: GameHistory;
  let playersPath: string;

  const CODE = JSON.stringify({
    version: 1,
    name: 'Ваня',
    interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
    boring: [],
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-delete-player-'));
    history = new GameHistory(':memory:');
    playersPath = join(dir, 'players.md');
    await writeFile(
      playersPath,
      `# Анкеты игроков\n\nВводный текст.\n`,
      'utf8',
    );
    const room = new Room(
      undefined,
      TEST_PACK,
      undefined,
      'test.json',
      history,
    );
    server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
      playersPath,
      history,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    history.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function saveVanya(admin: {
    ws: WebSocket;
    nextMessage: () => Promise<unknown>;
  }): Promise<void> {
    admin.ws.send(
      JSON.stringify({ type: 'admin-save-player', code: CODE, replace: false }),
    );
    await admin.nextMessage();
  }

  it('удаление анкеты не трогает человека в истории', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'test.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanyaId }],
    });
    const admin = await connectAdmin(baseUrl);
    await saveVanya(admin);

    admin.ws.send(
      JSON.stringify({ type: 'admin-delete-player-card', name: 'Ваня' }),
    );
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-players',
      players: [],
    });
    // Человек и его партия на месте: их убирает admin-forget-person, а не эта
    // кнопка (спека анкет, «Удаление анкеты — это удаление анкеты»).
    expect(history.listPeople()).toEqual([
      { id: vanyaId, name: 'Ваня', games: 1 },
    ]);
    expect(await readFile(playersPath, 'utf8')).not.toMatch(/^## Ваня$/m);
    admin.ws.close();
  });

  it('во время идущей партии удаление анкеты разрешено — оно трогает файл, а не игру', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const admin = await connectAdmin(baseUrl);
    await saveVanya(admin);

    const a = await joinPlayer(baseUrl, 'Игрок 1');
    await admin.nextMessage();
    const b = await joinPlayer(baseUrl, 'Игрок 2');
    await admin.nextMessage();
    await a.nextMessage();
    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);

    admin.ws.send(
      JSON.stringify({ type: 'admin-delete-player-card', name: 'Ваня' }),
    );
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-players',
      players: [],
    });
    expect(history.listPeople().map((person) => person.id)).toContain(vanyaId);

    admin.ws.close();
    a.ws.close();
    b.ws.close();
  });

  it('admin-forget-person убирает человека и его блок, но не анкету', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'test.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanyaId }],
    });
    const admin = await connectAdmin(baseUrl);
    await saveVanya(admin);

    admin.ws.send(JSON.stringify({ type: 'admin-forget-person', id: vanyaId }));
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-people',
      people: [],
    });
    expect(history.listPeople()).toEqual([]);
    // Анкета осталась: это отдельное действие с отдельной кнопкой.
    expect(await readFile(playersPath, 'utf8')).toMatch(/^## Ваня$/m);
    admin.ws.close();
  });

  it('admin-forget-person на несуществующем id отвечает «обнови список»', async () => {
    const admin = await connectAdmin(baseUrl);

    admin.ws.send(JSON.stringify({ type: 'admin-forget-person', id: 404 }));
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-people-error',
      reason: 'такого игрока уже нет — обнови список',
    });
    admin.ws.close();
  });

  it('admin-forget-person во время партии отказывает и никого не забывает', async () => {
    const vanyaId = history.createPerson('Ваня', '2026-08-01')!;
    const admin = await connectAdmin(baseUrl);

    const a = await joinPlayer(baseUrl, 'Игрок 1');
    await admin.nextMessage();
    const b = await joinPlayer(baseUrl, 'Игрок 2');
    await admin.nextMessage();
    await a.nextMessage();
    admin.ws.send(JSON.stringify({ type: 'admin-start-game' }));
    await Promise.all([admin.nextMessage(), a.nextMessage(), b.nextMessage()]);

    admin.ws.send(JSON.stringify({ type: 'admin-forget-person', id: vanyaId }));
    expect(await admin.nextMessage()).toEqual({
      type: 'admin-people-error',
      reason: 'нельзя удалять человека, пока идёт партия',
    });
    expect(history.listPeople().map((person) => person.id)).toContain(vanyaId);

    admin.ws.close();
    a.ws.close();
    b.ws.close();
  });
});

describe('createServer media static route', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-route-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-route-packs-'));
    const mediaDir = join(packsDir, 'media', 'sport');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'photo.jpg'), 'fake image bytes', 'utf8');
    const room = new Room();
    server = createServer({ room, clientDistPath: dir, port: 8080, packsDir });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(packsDir, { recursive: true, force: true });
  });

  it('serves a file under packs/media/ at /media/', async () => {
    const res = await fetch(`${baseUrl}/media/sport/photo.jpg`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('fake image bytes');
  });

  it('returns 404 for a media path that does not exist, not the client SPA fallback', async () => {
    const res = await fetch(`${baseUrl}/media/sport/ghost.jpg`);
    expect(res.status).toBe(404);
  });
});
