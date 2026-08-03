# Шагающий скелет — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Доказать, что лобби реально работает на физических устройствах в локальной сети — телефон подключается по QR, появляется на табло, а сервер переживает обрыв связи и перезапуск, — до того, как в проекте появится хоть одна игровая механика.

**Architecture:** Один Node-процесс (`server/`) держит `Room` — модель участников в памяти с автоматической персистенцией на диск при каждом изменении — и обслуживает WebSocket (`/ws`) плюс статику собранного клиента (`client/dist`) на одном порту. Клиент (`client/`) — SPA на два маршрута без роутер-библиотеки: `/` (игрок, форма входа) и `/board` (табло, QR + список участников), оба говорят с сервером через один и тот же WS-протокол по общему origin.

**Tech Stack:** TypeScript, Node (`ws`, `sirv`), React 19 + Vite (`qrcode.react`), Vitest (юниты и интеграционные тесты на реальных WS-клиентах), Playwright (e2e).

## Global Constraints

- Имя участника уникально в комнате; сравнение без учёта регистра и пробелов по краям (design.md, «Ход игры» → «Имя уникально в пределах комнаты»).
- Участник, потерявший соединение, не удаляется — помечается `connected: false` и возвращается по токену переподключения (design.md, «Отказы и что мы с ними делаем»).
- Ни одно состояние сервера не должно зависеть от того, жив ли конкретный WS-коннект дольше, чем нужно, — при закрытии сокета участник просто помечается отключённым, комната продолжает жить.
- Каркас проверяется физически, не через `localhost` (docs/lifecycle.md, «Каркас: пустое лобби, которое реально открывается с телефона по QR в локальной Wi-Fi»).
- Устойчивость (переподключение, снапшот, перезапуск процесса) проверяется вживую **на этом же скелете**, пока это лобби, а не полноценная игра (docs/lifecycle.md, «Устойчивость каркаса»).
- Данные (SQLite, история игр) — вне периметра этого плана; пакеты вопросов, БД, генератор — не трогаем (docs/lifecycle.md, п.6 «пропустить»).
- Секретов в этом плане нет — единственный секрет проекта (ключ API генератора) не используется скелетом, поэтому `.env` не заводится; будет добавлен, когда появится генератор.

---

## File Structure

**`server/src/`**

- `room.ts` — модель комнаты в памяти: участники, `join`/`reconnect`/`disconnect`, подписка на изменения.
- `room.test.ts` — юнит-тесты `Room`.
- `snapshot.ts` — сериализация состояния комнаты в JSON и чтение/запись на диск.
- `snapshot.test.ts` — юниты сериализации + интеграционные тесты чтения/записи на реальном временном файле.
- `network.ts` — чистая функция выбора локального IPv4-адреса из `os.networkInterfaces()`.
- `network.test.ts` — юниты `pickLanAddress`.
- `protocol.ts` — типы сообщений WS-протокола (клиент↔сервер).
- `server.ts` — сборка HTTP+WS сервера: раздача статики клиента, приём подключений, обвязка `Room` вокруг реальных сокетов.
- `server.test.ts` — интеграционные тесты на настоящих WS-клиентах: hello, join, broadcast, disconnect, reconnect.
- `index.ts` — точка входа: загрузка снапшота, создание `Room`, запуск сервера, подписка на изменения для записи снапшота.

**`client/src/`**

- `routing.ts` — чистая функция выбора страницы по `pathname`.
- `routing.test.ts` — юниты `pageForPath`.
- `Player.tsx` — страница игрока: форма имени, статусы подключения.
- `Player.test.tsx` — тесты формы с замоканным хуком подключения.
- `Board.tsx` — страница табло: QR-код, LAN-адрes, список участников.
- `Board.test.tsx` — тесты табло с замоканным хуком подключения.
- `useRoomConnection.ts` — хук WS-подключения: join/reconnect, токен в `localStorage`, автопереподключение.
- `useRoomConnection.test.ts` — тесты хука с фейковым WebSocket.
- `main.tsx` — модифицируется: выбор страницы через `pageForPath` вместо всегда-`App`.
- `App.tsx`, `App.test.tsx`, `App.css` — удаляются (были временной заглушкой каркаса, см. коммит `chore: initial project setup`).
- `vite.config.ts` — модифицируется: добавляется dev-прокси `/ws` → `ws://localhost:8080` для параллельной разработки клиента и сервера.

**Корень**

- `package.json` — модифицируется: добавляются скрипты `start` и `test:e2e`.
- `playwright.config.ts` — новый, конфиг e2e.
- `e2e/lobby.spec.ts` — единственный e2e-сценарий: игрок присоединяется, табло его видит.

---

### Task 1: Room — участники, уникальность имени, переподключение по токену

**Files:**

- Create: `server/src/room.ts`
- Test: `server/src/room.test.ts`

**Interfaces:**

- Produces: `Participant { id: string; name: string; token: string; connected: boolean }`, `RoomState { participants: Participant[] }`, `class Room { constructor(initial?: RoomState); join(name: string): { participant: Participant } | { error: 'name-taken' }; reconnect(token: string): { participant: Participant } | { error: 'invalid-token' }; disconnect(participantId: string): void; getState(): RoomState; onChange(listener: (state: RoomState) => void): () => void }`

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/room.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Room } from './room.js';

describe('Room.join', () => {
  it('adds a new participant', () => {
    const room = new Room();
    const result = room.join('Ваня');
    expect(result).toMatchObject({
      participant: { name: 'Ваня', connected: true },
    });
  });

  it('rejects a case-insensitive, whitespace-insensitive duplicate name', () => {
    const room = new Room();
    room.join('Ваня');
    const result = room.join('  ваня ');
    expect(result).toEqual({ error: 'name-taken' });
  });

  it('allows two different names', () => {
    const room = new Room();
    room.join('Ваня');
    const result = room.join('Катя');
    expect('participant' in result).toBe(true);
  });

  it('notifies listeners on successful join', () => {
    const room = new Room();
    const listener = vi.fn();
    room.onChange(listener);
    room.join('Ваня');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      participants: [expect.objectContaining({ name: 'Ваня' })],
    });
  });

  it('does not notify listeners on a rejected join', () => {
    const room = new Room();
    room.join('Ваня');
    const listener = vi.fn();
    room.onChange(listener);
    room.join('ваня');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Room.reconnect', () => {
  it('marks a disconnected participant as connected again, keeping id and name', () => {
    const room = new Room();
    const joined = room.join('Ваня');
    if (!('participant' in joined)) throw new Error('expected join to succeed');
    room.disconnect(joined.participant.id);

    const result = room.reconnect(joined.participant.token);

    expect(result).toEqual({
      participant: { ...joined.participant, connected: true },
    });
  });

  it('rejects an unknown token', () => {
    const room = new Room();
    const result = room.reconnect('not-a-real-token');
    expect(result).toEqual({ error: 'invalid-token' });
  });
});

describe('Room.disconnect', () => {
  it('marks a participant as disconnected without removing them', () => {
    const room = new Room();
    const joined = room.join('Ваня');
    if (!('participant' in joined)) throw new Error('expected join to succeed');

    room.disconnect(joined.participant.id);

    expect(room.getState().participants).toEqual([
      { ...joined.participant, connected: false },
    ]);
  });

  it('does nothing for an unknown participant id', () => {
    const room = new Room();
    const listener = vi.fn();
    room.onChange(listener);
    room.disconnect('unknown-id');
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `room.ts` не существует.

- [ ] **Step 3: Реализовать `Room`**

```ts
// server/src/room.ts
import { randomUUID } from 'node:crypto';

export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
}

export interface RoomState {
  participants: Participant[];
}

export type JoinResult = { participant: Participant } | { error: 'name-taken' };
export type ReconnectResult =
  { participant: Participant } | { error: 'invalid-token' };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export class Room {
  private participants: Participant[];
  private listeners = new Set<(state: RoomState) => void>();

  constructor(initial?: RoomState) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
  }

  join(name: string): JoinResult {
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    const taken = this.participants.some(
      (p) => normalizeName(p.name) === normalized,
    );
    if (taken) {
      return { error: 'name-taken' };
    }
    const participant: Participant = {
      id: randomUUID(),
      name: trimmed,
      token: randomUUID(),
      connected: true,
    };
    this.participants.push(participant);
    this.notify();
    return { participant };
  }

  reconnect(token: string): ReconnectResult {
    const participant = this.participants.find((p) => p.token === token);
    if (!participant) {
      return { error: 'invalid-token' };
    }
    participant.connected = true;
    this.notify();
    return { participant };
  }

  disconnect(participantId: string): void {
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant || !participant.connected) {
      return;
    }
    participant.connected = false;
    this.notify();
  }

  getState(): RoomState {
    return { participants: this.participants.map((p) => ({ ...p })) };
  }

  onChange(listener: (state: RoomState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS, все тесты `room.test.ts` зелёные.

- [ ] **Step 5: Коммит**

```bash
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: add Room model with join, reconnect, disconnect"
```

---

### Task 2: Снапшот комнаты — сериализация и диск

**Files:**

- Create: `server/src/snapshot.ts`
- Test: `server/src/snapshot.test.ts`

**Interfaces:**

- Consumes: `RoomState` из `room.ts`.
- Produces: `serializeSnapshot(state: RoomState): string`, `deserializeSnapshot(json: string): RoomState`, `writeSnapshot(path: string, state: RoomState): Promise<void>`, `readSnapshot(path: string): Promise<RoomState | null>`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/snapshot.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deserializeSnapshot,
  readSnapshot,
  serializeSnapshot,
  writeSnapshot,
} from './snapshot.js';
import type { RoomState } from './room.js';

describe('serializeSnapshot / deserializeSnapshot', () => {
  it('round-trips a room state, forcing all participants to disconnected', () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: false },
      ],
    };

    const restored = deserializeSnapshot(serializeSnapshot(state));

    expect(restored).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
        { id: '2', name: 'Катя', token: 'tok-2', connected: false },
      ],
    });
  });
});

describe('writeSnapshot / readSnapshot', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-snapshot-'));
    path = join(dir, 'room-snapshot.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist yet', async () => {
    const result = await readSnapshot(path);
    expect(result).toBeNull();
  });

  it('writes and reads back the same state', async () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
      ],
    };

    await writeSnapshot(path, state);
    const result = await readSnapshot(path);

    expect(result).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
    });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `snapshot.ts` не существует.

- [ ] **Step 3: Реализовать `snapshot.ts`**

```ts
// server/src/snapshot.ts
import { readFile, writeFile } from 'node:fs/promises';
import type { RoomState } from './room.js';

export function serializeSnapshot(state: RoomState): string {
  return JSON.stringify(state);
}

export function deserializeSnapshot(json: string): RoomState {
  const parsed = JSON.parse(json) as RoomState;
  return {
    participants: parsed.participants.map((p) => ({ ...p, connected: false })),
  };
}

export async function writeSnapshot(
  path: string,
  state: RoomState,
): Promise<void> {
  await writeFile(path, serializeSnapshot(state), 'utf8');
}

export async function readSnapshot(path: string): Promise<RoomState | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return deserializeSnapshot(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src/snapshot.ts server/src/snapshot.test.ts
git commit -m "feat: add room snapshot serialization and disk persistence"
```

---

### Task 3: Определение локального IPv4-адреса

**Files:**

- Create: `server/src/network.ts`
- Test: `server/src/network.test.ts`

**Interfaces:**

- Produces: `pickLanAddress(interfaces: Record<string, NetworkInterfaceInfo[] | undefined>): string | null`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/network.test.ts
import { describe, expect, it } from 'vitest';
import { pickLanAddress } from './network.js';
import type { NetworkInterfaceInfo } from 'node:os';

function ipv4(address: string, internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

describe('pickLanAddress', () => {
  it('picks the first non-internal IPv4 address', () => {
    const interfaces = {
      lo: [ipv4('127.0.0.1', true)],
      'Wi-Fi': [ipv4('192.168.1.42', false)],
    };
    expect(pickLanAddress(interfaces)).toBe('192.168.1.42');
  });

  it('skips internal-only interfaces', () => {
    const interfaces = { lo: [ipv4('127.0.0.1', true)] };
    expect(pickLanAddress(interfaces)).toBeNull();
  });

  it('returns null when there are no interfaces at all', () => {
    expect(pickLanAddress({})).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `network.ts` не существует.

- [ ] **Step 3: Реализовать `network.ts`**

```ts
// server/src/network.ts
import type { NetworkInterfaceInfo } from 'node:os';

export function pickLanAddress(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): string | null {
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/src/network.ts server/src/network.test.ts
git commit -m "feat: add LAN address detection"
```

---

### Task 4: HTTP+WS сервер — протокол, транспорт, точка входа

**Files:**

- Create: `server/src/protocol.ts`
- Create: `server/src/server.ts`
- Test: `server/src/server.test.ts`
- Create: `server/src/index.ts`
- Modify: `package.json` (корень) — добавить скрипт `start`
- Modify: `client/vite.config.ts` — dev-прокси на `/ws`

**Interfaces:**

- Consumes: `Room` из `room.ts`, `writeSnapshot`/`readSnapshot` из `snapshot.ts`, `pickLanAddress` из `network.ts`.
- Produces: `ParticipantView { id: string; name: string; connected: boolean }`, `ClientMessage`, `ServerMessage` (в `protocol.ts`), `createServer(options: { room: Room; clientDistPath: string; lanUrl: string }): { httpServer: import('node:http').Server; close(): Promise<void> }`.

- [ ] **Step 1: Поставить зависимости**

```bash
pnpm --filter server add ws sirv
pnpm --filter server add -D @types/ws
```

- [ ] **Step 2: Написать протокол**

```ts
// server/src/protocol.ts
export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export type ClientMessage =
  { type: 'join'; name: string } | { type: 'reconnect'; token: string };

export type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | { type: 'state'; participants: ParticipantView[] };
```

- [ ] **Step 3: Написать падающие тесты сервера**

```ts
// server/src/server.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Room } from './room.js';
import { createServer, type GameServer } from './server.js';
import type { ServerMessage } from './protocol.js';

function waitForMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) =>
      resolve(JSON.parse(data.toString()) as ServerMessage),
    );
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('open', () => resolve()));
}

describe('createServer', () => {
  let server: GameServer;
  let url: string;
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
    const { port } = server.httpServer.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('sends hello then the current state on connect', async () => {
    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const hello = await waitForMessage(ws);
    expect(hello).toEqual({
      type: 'hello',
      lanUrl: 'http://192.168.1.1:8080/',
    });

    const state = await waitForMessage(ws);
    expect(state).toEqual({ type: 'state', participants: [] });

    ws.close();
  });

  it('lets a client join and broadcasts the new state to everyone connected', async () => {
    const board = new WebSocket(url);
    await waitForOpen(board);
    await waitForMessage(board);
    await waitForMessage(board);

    const player = new WebSocket(url);
    await waitForOpen(player);
    await waitForMessage(player);
    await waitForMessage(player);

    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));

    const joined = await waitForMessage(player);
    expect(joined).toMatchObject({ type: 'joined', name: 'Ваня' });

    const boardState = await waitForMessage(board);
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
    await waitForOpen(first);
    await waitForMessage(first);
    await waitForMessage(first);
    first.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    await waitForMessage(first);

    const second = new WebSocket(url);
    await waitForOpen(second);
    await waitForMessage(second);
    await waitForMessage(second);
    second.send(JSON.stringify({ type: 'join', name: 'ваня' }));

    const rejection = await waitForMessage(second);
    expect(rejection).toEqual({ type: 'name-taken' });

    first.close();
    second.close();
  });

  it('marks a participant disconnected when their socket closes, and reconnect restores them', async () => {
    const player = new WebSocket(url);
    await waitForOpen(player);
    await waitForMessage(player);
    await waitForMessage(player);
    player.send(JSON.stringify({ type: 'join', name: 'Ваня' }));
    const joined = (await waitForMessage(player)) as {
      token: string;
      participantId: string;
    };

    const board = new WebSocket(url);
    await waitForOpen(board);
    await waitForMessage(board);
    await waitForMessage(board);

    player.close();
    const afterDisconnect = await waitForMessage(board);
    expect(afterDisconnect).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: false },
      ],
    });

    const reconnected = new WebSocket(url);
    await waitForOpen(reconnected);
    await waitForMessage(reconnected);
    await waitForMessage(reconnected);
    reconnected.send(
      JSON.stringify({ type: 'reconnect', token: joined.token }),
    );
    const reconnectedJoined = await waitForMessage(reconnected);
    expect(reconnectedJoined).toEqual({
      type: 'joined',
      participantId: joined.participantId,
      token: joined.token,
      name: 'Ваня',
    });

    const afterReconnect = await waitForMessage(board);
    expect(afterReconnect).toEqual({
      type: 'state',
      participants: [
        { id: joined.participantId, name: 'Ваня', connected: true },
      ],
    });

    board.close();
    reconnected.close();
  });
});
```

- [ ] **Step 4: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `server.ts` не существует.

- [ ] **Step 5: Реализовать `server.ts`**

```ts
// server/src/server.ts
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
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
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
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS, все тесты `server.test.ts` зелёные.

- [ ] **Step 7: Написать точку входа**

```ts
// server/src/index.ts
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import { pickLanAddress } from './network.js';
import { createServer } from './server.js';

const PORT = 8080;
const SNAPSHOT_PATH = './room-snapshot.json';
const CLIENT_DIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../client/dist',
);

async function main(): Promise<void> {
  const initial = await readSnapshot(SNAPSHOT_PATH);
  const room = new Room(initial ?? undefined);

  // Записи снапшота сериализуются в очередь, чтобы более медленная запись
  // не перезаписала диск устаревшим состоянием после более быстрой поздней записи.
  let writeQueue: Promise<void> = Promise.resolve();
  room.onChange((state) => {
    writeQueue = writeQueue.then(() =>
      writeSnapshot(SNAPSHOT_PATH, state).catch((err: unknown) => {
        console.error('Не удалось записать снапшот:', err);
      }),
    );
  });

  const lanAddress = pickLanAddress(networkInterfaces());
  const lanUrl = lanAddress
    ? `http://${lanAddress}:${PORT}/`
    : `http://localhost:${PORT}/`;

  const { httpServer } = createServer({
    room,
    clientDistPath: CLIENT_DIST_PATH,
    lanUrl,
  });

  httpServer.listen(PORT, () => {
    console.log(`Своя игра слушает на ${lanUrl}`);
  });
}

void main();
```

- [ ] **Step 8: Добавить корневой скрипт запуска**

В `package.json` (корень) добавить в `"scripts"`:

```json
"start": "node server/dist/index.js"
```

- [ ] **Step 9: Прокси для параллельной разработки**

В `client/vite.config.ts` добавить `server.proxy`, сохранив существующий блок `test`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
});
```

- [ ] **Step 10: Ручная проверка сборки**

```bash
pnpm run build
pnpm run start
```

Открыть `http://localhost:8080/board` в браузере — должен вернуться собранный клиент (пока ещё заглушка `App.tsx`, это нормально, страницы игрока/табло появятся в задачах 5–8). Остановить сервер (`Ctrl+C`).

- [ ] **Step 11: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts server/src/index.ts package.json client/vite.config.ts
git commit -m "feat: assemble HTTP+WS server with static client serving and snapshot persistence"
```

---

### Task 5: Маршрутизация клиента — страница игрока и табло

**Files:**

- Create: `client/src/routing.ts`
- Test: `client/src/routing.test.ts`
- Create: `client/src/Player.tsx` (пустая заглушка, наполняется в задаче 7)
- Create: `client/src/Board.tsx` (пустая заглушка, наполняется в задаче 8)
- Modify: `client/src/main.tsx`
- Delete: `client/src/App.tsx`, `client/src/App.test.tsx`

**Interfaces:**

- Produces: `pageForPath(pathname: string): 'board' | 'player'`.

- [ ] **Step 1: Написать падающий тест**

```ts
// client/src/routing.test.ts
import { describe, expect, it } from 'vitest';
import { pageForPath } from './routing';

describe('pageForPath', () => {
  it('picks board for /board', () => {
    expect(pageForPath('/board')).toBe('board');
  });

  it('picks player for /', () => {
    expect(pageForPath('/')).toBe('player');
  });

  it('picks player for any other unknown path', () => {
    expect(pageForPath('/whatever')).toBe('player');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter client test`
Expected: FAIL — `routing.ts` не существует.

- [ ] **Step 3: Реализовать `routing.ts`**

```ts
// client/src/routing.ts
export function pageForPath(pathname: string): 'board' | 'player' {
  return pathname === '/board' ? 'board' : 'player';
}
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 5: Удалить заглушку каркаса и создать пустые страницы**

```bash
rm client/src/App.tsx client/src/App.test.tsx
```

```tsx
// client/src/Player.tsx
export function Player() {
  return <p>Игрок</p>;
}
```

```tsx
// client/src/Board.tsx
export function Board() {
  return <p>Табло</p>;
}
```

- [ ] **Step 6: Подключить маршрутизацию в `main.tsx`**

```tsx
// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Board } from './Board';
import { Player } from './Player';
import { pageForPath } from './routing';

const page =
  pageForPath(window.location.pathname) === 'board' ? <Board /> : <Player />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
);
```

- [ ] **Step 7: Проверить, что клиент собирается и тесты проходят**

Run: `pnpm --filter client run typecheck && pnpm --filter client test && pnpm --filter client run build`
Expected: всё PASS.

- [ ] **Step 8: Коммит**

```bash
git add client/src/routing.ts client/src/routing.test.ts client/src/Player.tsx client/src/Board.tsx client/src/main.tsx
git rm client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: route to player or board page by path"
```

---

### Task 6: Хук подключения к комнате

**Files:**

- Create: `client/src/useRoomConnection.ts`
- Test: `client/src/useRoomConnection.test.ts`

**Interfaces:**

- Produces: `ParticipantView { id: string; name: string; connected: boolean }`, `ConnectionStatus = 'connecting' | 'joining' | 'joined' | 'name-taken' | 'disconnected'`, `RoomConnection { status: ConnectionStatus; participants: ParticipantView[]; selfId: string | null; lanUrl: string | null; join(name: string): void }`, `useRoomConnection(wsFactory?: (url: string) => WebSocket): RoomConnection`.

**Дублирование протокола — намеренное.** `ClientMessage`/`ServerMessage` объявлены здесь заново, локально, с той же формой, что и в `server/src/protocol.ts` (Task 4) — не импортируются оттуда. У `server/` и `client/` пока нет общего пакета типов (два pnpm-воркспейса, каждый со своим `tsconfig`), а заводить его ради пяти вариантов сообщения — по этому плану overkill. Цена решения: если протокол поменяется, поменять нужно **оба** места, и ничего не подсветит рассинхрон само — компилятор одной стороны не знает о другой. Если это начнёт болеть на следующей вехе (появится больше типов сообщений с игровой логикой), стоит завести `packages/protocol` как общий воркспейс — но не в этом плане.

- [ ] **Step 1: Написать падающие тесты**

```ts
// client/src/useRoomConnection.test.ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomConnection } from './useRoomConnection';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close', {});
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

describe('useRoomConnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function factory(url: string): WebSocket {
    return new FakeWebSocket(url) as unknown as WebSocket;
  }

  it('starts in connecting status with no participants', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    expect(result.current.status).toBe('connecting');
    expect(result.current.participants).toEqual([]);
  });

  it('sends a join message when join() is called after the socket opens', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'join', name: 'Ваня' }),
    );
    expect(result.current.status).toBe('joining');
  });

  it('stores the token and moves to joined on a joined message', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));
    act(() =>
      socket.emitMessage({
        type: 'joined',
        participantId: 'p1',
        token: 'tok-1',
        name: 'Ваня',
      }),
    );

    expect(result.current.status).toBe('joined');
    expect(result.current.selfId).toBe('p1');
    expect(localStorage.getItem('svoya-igra-token')).toBe('tok-1');
  });

  it('moves to name-taken status without touching localStorage', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));
    act(() => socket.emitMessage({ type: 'name-taken' }));

    expect(result.current.status).toBe('name-taken');
    expect(localStorage.getItem('svoya-igra-token')).toBeNull();
  });

  it('sends a reconnect message on open when a token is already stored', () => {
    localStorage.setItem('svoya-igra-token', 'tok-1');
    renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'reconnect', token: 'tok-1' }),
    );
  });

  it('updates participants on a state message', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
      }),
    );

    expect(result.current.participants).toEqual([
      { id: 'p1', name: 'Ваня', connected: true },
    ]);
  });

  it('reconnects automatically after the socket closes', () => {
    vi.useFakeTimers();
    renderHook(() => useRoomConnection(factory));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].close());
    act(() => vi.advanceTimersByTime(2000));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — `useRoomConnection.ts` не существует.

- [ ] **Step 3: Реализовать хук**

```ts
// client/src/useRoomConnection.ts
import { useEffect, useRef, useState } from 'react';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | { type: 'state'; participants: ParticipantView[] };

type ClientMessage =
  { type: 'join'; name: string } | { type: 'reconnect'; token: string };

export type ConnectionStatus =
  'connecting' | 'joining' | 'joined' | 'name-taken' | 'disconnected';

export interface RoomConnection {
  status: ConnectionStatus;
  participants: ParticipantView[];
  selfId: string | null;
  lanUrl: string | null;
  join(name: string): void;
}

const TOKEN_KEY = 'svoya-igra-token';
const RECONNECT_DELAY_MS = 2000;

type WebSocketFactory = (url: string) => WebSocket;

export function useRoomConnection(
  wsFactory: WebSocketFactory = (url) => new WebSocket(url),
): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = wsFactory(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          setStatus('joining');
          const message: ClientMessage = { type: 'reconnect', token };
          ws.send(JSON.stringify(message));
        } else if (pendingNameRef.current) {
          setStatus('joining');
          const message: ClientMessage = {
            type: 'join',
            name: pendingNameRef.current,
          };
          ws.send(JSON.stringify(message));
        }
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ServerMessage;

        if (message.type === 'hello') {
          setLanUrl(message.lanUrl);
        }
        if (message.type === 'joined') {
          localStorage.setItem(TOKEN_KEY, message.token);
          setSelfId(message.participantId);
          setStatus('joined');
        }
        if (message.type === 'name-taken') {
          setStatus('name-taken');
        }
        if (message.type === 'invalid-token') {
          localStorage.removeItem(TOKEN_KEY);
          setStatus('connecting');
        }
        if (message.type === 'state') {
          setParticipants(message.participants);
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        setStatus('disconnected');
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsFactory]);

  function join(name: string): void {
    pendingNameRef.current = name;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus('joining');
      const message: ClientMessage = { type: 'join', name };
      ws.send(JSON.stringify(message));
    }
  }

  return { status, participants, selfId, lanUrl, join };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS, все тесты `useRoomConnection.test.ts` зелёные.

- [ ] **Step 5: Коммит**

```bash
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts
git commit -m "feat: add room connection hook with token reconnect"
```

---

### Task 7: Страница игрока

**Files:**

- Modify: `client/src/Player.tsx`
- Create: `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `useRoomConnection` из `useRoomConnection.ts`.

- [ ] **Step 1: Поставить `@testing-library/user-event`**

```bash
pnpm --filter client add -D @testing-library/user-event
```

- [ ] **Step 2: Написать падающие тесты**

```tsx
// client/src/Player.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Player } from './Player';
import { useRoomConnection } from './useRoomConnection';

vi.mock('./useRoomConnection', () => ({
  useRoomConnection: vi.fn(),
}));

const mockedUseRoomConnection = vi.mocked(useRoomConnection);

describe('Player', () => {
  it('calls join with the entered name on submit', async () => {
    const join = vi.fn();
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: null,
      join,
    });

    const user = userEvent.setup();
    render(<Player />);
    await user.type(screen.getByLabelText('Имя'), 'Ваня');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(join).toHaveBeenCalledWith('Ваня');
  });

  it('shows a message once joined instead of the form', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'joined',
      participants: [],
      selfId: 'p1',
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Player />);

    expect(screen.getByText('Ты в игре. Жди начала.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument();
  });

  it('shows an error when the name is taken', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'name-taken',
      participants: [],
      selfId: null,
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Player />);

    expect(screen.getByRole('alert')).toHaveTextContent('уже занято');
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — `Player` пока рендерит только `<p>Игрок</p>`.

- [ ] **Step 4: Реализовать `Player.tsx`**

```tsx
// client/src/Player.tsx
import { useState, type FormEvent } from 'react';
import { useRoomConnection } from './useRoomConnection';

export function Player() {
  const { status, join } = useRoomConnection();
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) {
      join(name.trim());
    }
  }

  if (status === 'joined') {
    return <p>Ты в игре. Жди начала.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="name">Имя</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={status === 'joining'}>
        Войти
      </button>
      {status === 'name-taken' && (
        <p role="alert">Это имя уже занято, выбери другое</p>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add client/src/Player.tsx client/src/Player.test.tsx client/package.json pnpm-lock.yaml
git commit -m "feat: implement player join form"
```

---

### Task 8: Страница табло

**Files:**

- Modify: `client/src/Board.tsx`
- Create: `client/src/Board.test.tsx`

**Interfaces:**

- Consumes: `useRoomConnection` из `useRoomConnection.ts`.

- [ ] **Step 1: Поставить `qrcode.react`**

```bash
pnpm --filter client add qrcode.react
```

- [ ] **Step 2: Написать падающие тесты**

```tsx
// client/src/Board.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from './Board';
import { useRoomConnection } from './useRoomConnection';

vi.mock('./useRoomConnection', () => ({
  useRoomConnection: vi.fn(),
}));

const mockedUseRoomConnection = vi.mocked(useRoomConnection);

describe('Board', () => {
  it('lists connected and disconnected participants', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [
        { id: '1', name: 'Ваня', connected: true },
        { id: '2', name: 'Катя', connected: false },
      ],
      selfId: null,
      lanUrl: 'http://192.168.1.42:8080/',
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.getByText('Ваня')).toBeInTheDocument();
    expect(screen.getByText(/Катя/)).toHaveTextContent('отключён');
  });

  it('shows the LAN url as text and a QR code once known', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: 'http://192.168.1.42:8080/',
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.getByText('http://192.168.1.42:8080/')).toBeInTheDocument();
    expect(screen.getByTitle('QR-код для входа')).toBeInTheDocument();
  });

  it('renders neither URL nor QR code before the LAN url is known', () => {
    mockedUseRoomConnection.mockReturnValue({
      status: 'connecting',
      participants: [],
      selfId: null,
      lanUrl: null,
      join: vi.fn(),
    });

    render(<Board />);

    expect(screen.queryByTitle('QR-код для входа')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — `Board` пока рендерит только `<p>Табло</p>`.

- [ ] **Step 4: Реализовать `Board.tsx`**

```tsx
// client/src/Board.tsx
import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';

export function Board() {
  const { participants, lanUrl } = useRoomConnection();

  return (
    <div>
      <h1>Своя игра</h1>
      {lanUrl && (
        <>
          <QRCodeSVG value={lanUrl} size={200} title="QR-код для входа" />
          <p>{lanUrl}</p>
        </>
      )}
      <ul>
        {participants.map((p) => (
          <li key={p.id}>
            {p.name} {p.connected ? '' : '(отключён)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add client/src/Board.tsx client/src/Board.test.tsx client/package.json pnpm-lock.yaml
git commit -m "feat: implement board page with QR code and participant list"
```

---

### Task 9: E2E — игрок присоединяется, табло его видит

**Files:**

- Create: `playwright.config.ts` (корень)
- Create: `e2e/lobby.spec.ts`
- Modify: `package.json` (корень) — добавить скрипт `test:e2e`

**Interfaces:**

- Consumes: собранные `client/dist` и `server/dist` через `pnpm run build` + `pnpm run start`.

- [ ] **Step 1: Поставить Playwright**

```bash
pnpm add -D -w @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Добавить скрипт e2e**

В `package.json` (корень) добавить в `"scripts"`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 3: Написать конфиг Playwright**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'pnpm run build && pnpm run start',
    port: 8080,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:8080',
  },
});
```

- [ ] **Step 4: Написать сценарий**

```ts
// e2e/lobby.spec.ts
import { test, expect } from '@playwright/test';

test('a player joining shows up on the board', async ({ page, context }) => {
  const board = await context.newPage();
  await board.goto('/board');

  await page.goto('/');
  await page.getByLabel('Имя').fill('Ваня');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
  await expect(board.getByText('Ваня')).toBeVisible();
});
```

- [ ] **Step 5: Запустить и убедиться, что сценарий проходит**

Run: `pnpm run test:e2e`
Expected: PASS. Playwright сам соберёт проект, поднимет сервер на 8080 и остановит его после теста.

Сознательно не добавляем этот прогон в `ci.yml` этим планом — установка браузеров Playwright в CI требует отдельного решения (время, кэш) и не блокирует эту веху.

- [ ] **Step 6: Коммит**

```bash
git add playwright.config.ts e2e/lobby.spec.ts package.json pnpm-lock.yaml
git commit -m "test: add e2e lobby scenario"
```

---

### Task 10: Живая проверка на реальных устройствах

Без этого шага веха не считается сделанной — design.md прямо называет живую партию единственным настоящим критерием готовности, и здесь тот же принцип применён к скелету.

**Files:** нет — только команды и физические устройства.

- [ ] **Step 1: Собрать и запустить прод-режим**

```bash
pnpm run build
pnpm run start
```

Ноутбук и телефон должны быть в одной Wi-Fi сети.

- [ ] **Step 2: Открыть табло**

На ноутбуке (или подключённом ТВ) открыть `http://localhost:8080/board`. Должны появиться QR-код и текстовый LAN-адрес.

- [ ] **Step 3: Подключить первого игрока**

На телефоне отсканировать QR (или вручную набрать LAN-адрес из шага 2). Должна открыться форма входа. Ввести имя, отправить — телефон должен показать «Ты в игре. Жди начала.», а имя должно появиться на табло в течение секунды.

- [ ] **Step 4: Подключить второго игрока**

Повторить шаг 3 со второго устройства другим именем. Табло должно показывать оба имени.

- [ ] **Step 5: Проверить восстановление по отключению телефона**

Выключить Wi-Fi на одном из телефонов на несколько секунд. Табло должно пометить участника как «(отключён)», не убирая его из списка. Включить Wi-Fi обратно — телефон должен переподключиться сам (без перезахода на страницу), а табло — показать того же участника снова подключённым, **под тем же именем, без дубликата**.

- [ ] **Step 6: Проверить восстановление по перезапуску сервера**

Остановить сервер (`Ctrl+C`), запустить заново (`pnpm run start`). Обновить страницу табло вручную — оба участника должны быть в списке (помечены отключёнными, пока их телефоны не переподключатся сами) — это подтверждает, что снапшот пережил перезапуск.

- [ ] **Step 7: Проверить отклонение занятого имени**

С третьего устройства попробовать войти именем, отличающимся от уже занятого только регистром или пробелами (например, «ВАНЯ» при уже занятом «Ваня»). Должно появиться сообщение «Это имя уже занято, выбери другое», подключение не должно оборваться.

- [ ] **Step 8: Зафиксировать результат**

Если все шаги 2–7 прошли — веха «шагающий скелет» закрыта. Если что-то не сработало — завести задачу с точным описанием сценария (какой шаг, что ожидалось, что произошло) прежде чем переходить к вехе 2 (финал со ставками) по [design.md](../specs/2026-08-03-svoya-igra-design.md).

---

## Отклонения от плана

Записывается по ходу выполнения — каждый случай, где код разошёлся с буквальным текстом
плана, с причиной и рассмотренными альтернативами. Ledger в `.superpowers/sdd/` удаляется
по завершении процесса, поэтому решения живут здесь, а не только там.

### Task 1 — `Room.join`/`Room.reconnect` возвращают копию, а не ссылку

**Что изменилось.** Код в брифе Task 1 (`return { participant };`) возвращал ту же ссылку,
что лежит в `this.participants`. Ревью задачи нашло это как plan-mandated находку: любой
код, держащий возвращённый объект, мог бы мутировать внутреннее состояние `Room` напрямую,
в обход `notify()`, и подписчики никогда бы не узнали об изменении.

**Почему так.** Изменено на `return { participant: { ...participant } };` в обоих методах —
тот же приём, что уже использует `getState()`.

**Что ещё рассматривалось и почему отклонено.**

- Оставить как есть — отклонено: это реальный баг на будущее, просто ещё не выстреливший
  в текущем плане (задача 4 только читает поля, не мутирует объект).
- `Object.freeze()` на возвращаемом участнике — отклонено: технически тоже решает проблему
  (мутация упадёт в strict mode), но заводит второй механизм защиты инварианта рядом
  с уже существующим copy-based подходом `getState()`. Один приём на весь класс проще
  читать и поддерживать, чем два разных, решающих одну и ту же задачу.

### Task 4 — `server.test.ts`: очередь сообщений вместо реактивного `once('message')`

**Что изменилось.** Буквальный код брифа вешал `ws.once('message', ...)` внутри
`waitForMessage(ws)`, вызываемого **после** `await waitForOpen(ws)`. На локальной петле
ответ на апгрейд и первые кадры сервера нередко приходят в одном TCP-чтении; `ws` разбирает
все кадры из этого чтения синхронно, эмитируя `'open'`, а следом сразу `'message'` — до того,
как очередь микрозадач (где висит продолжение `await waitForOpen`) успевает выполниться
и повесить слушателя. Сообщение уходит впустую, `waitForMessage` виснет навсегда.

**Почему так.** Заменено на `collectMessages(ws)` — очередь, слушатель которой вешается
синхронно сразу при создании сокета, до какого-либо `await`. Функция `nextMessage()`
отдаёт сообщение из очереди или ждёт следующего.

**Что ещё рассматривалось и почему отклонено.**

- Искусственные задержки на сервере (`setTimeout`/`setImmediate` перед отправкой) — это
  был первый инстинкт реализатора. Отклонено: задержки лишь дают ОС время доставить
  рукопожатие и первый кадр отдельными чтениями, маскируя гонку везде, где по счастливой
  случайности успевает сработать таймаут, а не устраняя её причину — и вносят
  надуманную задержку в настоящий сервер без протокольной необходимости.
- Разовый `once('message')`, повешенный синхронно только для первого сообщения — отклонено:
  не масштабируется на второе и последующие сообщения в том же тесте, для которых пришлось
  бы городить ту же защиту заново; очередь решает это единообразно для любого числа
  сообщений.

### Task 4 — `server.ts`: `broadcastState` откладывается через `queueMicrotask`

**Что изменилось.** Буквальный код брифа: `room.join()`/`room.reconnect()` синхронно
вызывают `notify()` до того, как обработчик успевает явно отправить `{type: 'joined'}`.
`notify()` вызывает `broadcastState`, который шлёт `state` всем сокетам в `wss.clients`,
включая только что присоединившийся — раньше явного `send(ws, {type: 'joined'})`. TCP
гарантирует порядок на одном соединении, так что `state` **детерминированно** приходит
раньше `joined` для присоединившегося клиента — это не гонка, а гарантированный порядок,
воспроизводимый на любой платформе. Проверено отдельно от отчёта реализатора.

**Почему так.** Цикл рассылки в `broadcastState` обёрнут в `queueMicrotask`, так что прямой
синхронный ответ клиенту (`joined`), отправленный чуть позже в том же обработчике, уходит
в сокет первым.

**Что ещё рассматривалось и почему отклонено.**

- Переставить код так, чтобы `joined` отправлялся до вызова `room.join()` — невозможно:
  подтверждение нуждается в данных (`id`, `token`), которые как раз производит `join()`.
- Отложить сам `notify()` внутри `Room` — отклонено: это протащило бы заботу о порядке
  доставки в транспортном слое внутрь `Room`, которая по архитектуре проекта должна
  оставаться синхронной и не знать о сокетах или сети (design.md: «Комната... не знает
  ни про сеть»). Откладывать нужно именно и только в той точке, где два сообщения одному
  сокету реально пересекаются — то есть в `server.ts`.
- Не рассылать `state` тому сокету, который только что присоединился, отдельной веткой
  условия — отклонено: усложняет форму протокола ради частного случая и не решает ту же
  проблему для `reconnect`, которой нужна идентичная защита.

`room.ts` и `server.ts`/`server.test.ts` содержат те же объяснения инлайн-комментариями
рядом с кодом — здесь причины собраны в одном месте для тех, кто читает план, а не диффы.
