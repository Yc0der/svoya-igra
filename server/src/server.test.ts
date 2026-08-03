import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from './room.js';
import { createServer, type GameServer } from './server.js';
import type { ServerMessage } from './protocol.js';

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
    expect(state).toEqual({ type: 'state', participants: [] });

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
    });

    board.close();
    reconnected.close();
    bystander.close();
  });
});
