# Выбор пакета через UI — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать ведущему и админ-панели возможность выбрать активный пакет вопросов прямо в
интерфейсе — без перезапуска сервера с другим `PACK_PATH`.

**Architecture:** Новый серверный модуль `packs.ts` сканирует папку `packs/` и валидирует
каждый файл уже существующим `validatePack`. `Room` хранит список найденных пакетов и имя
активного — отдельно от `RoomState`/снапшота (как и LAN-адрес), с отдельной подпиской
`onPackChange`. Два независимых набора протокольных сообщений — от участника (только
ведущий, сервер сам проверяет отправителя) и с админ-панели (без проверки личности) — тем же
паттерном, что уже разделены `skip-to-final`/`admin-skip-to-final` и
`admin-set-lan-address`. `Room.pack` (следующая партия) и `EngineState.pack` (уже идущая)
уже сегодня независимы, поэтому смена активного пакета не требует блокировок.

**Tech Stack:** TypeScript, Node (`node:fs/promises`, `node:path`), React — тот же стек и те
же паттерны, что уже использованы для LAN-адреса (`server/src/lan-host.ts`,
`server/src/network.ts`, `Room.getLanInfo`/`setLanAddress`/`onLanChange`).

## Global Constraints

- Спека: [2026-08-11-pack-picker-design.md](../specs/2026-08-11-pack-picker-design.md).
- `Pack.description` — новое поле, **необязательное**. Старые пакеты без него остаются
  валидными.
- Список пакетов и активный выбор — **не часть `RoomState`/снапшота**.
- Смена активного пакета не влияет на уже идущую партию — `EngineState.pack` захватывается
  один раз при `startGame()` и живёт своей жизнью.
- Список пакетов обновляется **только** по явному действию «Обновить» (или при старте
  процесса) — никакого `fs.watch`/поллинга.
- Директория пакетов — `dirname(PACK_PATH)`, никакой новой переменной окружения.
- Два набора протокольных сообщений: от участника (`refresh-packs`/`select-pack`, сервер
  сверяет отправителя с `hostParticipantId`) и с админ-панели (`admin-refresh-packs`/
  `admin-select-pack`, без проверки личности).
- Неавторизованная попытка выбрать пакет — тихий no-op, без ответа клиенту. Неизвестный файл
  — `select-pack-error`.

---

### Task 1: `Pack.description` — необязательное поле

**Files:**
- Modify: `server/src/pack.ts`
- Test: `server/src/pack.test.ts`

**Interfaces:**
- Produces: `Pack.description?: string`. `validatePack(data: unknown): Pack` принимает поле,
  если оно есть, как строку; поведение при его отсутствии не меняется.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/src/pack.test.ts`, сразу после теста `'accepts a question with an optional
comment'` (строка 47):

```typescript
  it('accepts a pack with an optional description', () => {
    const data = validPackData() as Record<string, unknown>;
    data.description = 'Спорт, кино и музыка для дружеской компании';
    expect(validatePack(data).description).toBe(
      'Спорт, кино и музыка для дружеской компании',
    );
  });

  it('accepts a pack with no description at all', () => {
    const data = validPackData();
    expect(validatePack(data).description).toBeUndefined();
  });

  it('rejects a non-string description when present', () => {
    const data = validPackData() as Record<string, unknown>;
    data.description = 123;
    expect(() => validatePack(data)).toThrow(/description/);
  });
```

- [ ] **Step 2: Прогнать тесты, убедиться, что новые падают**

```bash
cd server
npx vitest run src/pack.test.ts
```

Expected: `'accepts a pack with an optional description'` и `'rejects a non-string
description when present'` падают (поле `description` нигде не обрабатывается, `.description`
всегда `undefined`, а невалидное значение никак не проверяется — 123 сейчас просто
игнорируется, тест "rejects" не бросает).

- [ ] **Step 3: Добавить поле в `Pack` и проверку в `validatePack`**

В `server/src/pack.ts`, интерфейс `Pack` (строки 31-37):

```typescript
export interface Pack {
  title: string;
  author: string;
  createdAt: string;
  description?: string;
  rounds: Round[];
  final?: { themes: FinalTheme[] };
}
```

В `validatePack` (строки 184-199), сразу после строки `const createdAt =
requireString(pack.createdAt, 'пакет.createdAt');`:

```typescript
  if (pack.description !== undefined && typeof pack.description !== 'string') {
    throw new Error('пакет.description: если есть, должно быть строкой');
  }
```

И в возвращаемом объекте (строка 198) добавить поле:

```typescript
  return {
    title,
    author,
    createdAt,
    description: pack.description as string | undefined,
    rounds,
    final,
  };
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/pack.test.ts
```

Expected: все тесты зелёные, включая три новых.

- [ ] **Step 5: Typecheck и commit**

```bash
npx tsc --noEmit
cd ..
git add server/src/pack.ts server/src/pack.test.ts
git commit -m "feat: add an optional description field to Pack"
```

---

### Task 2: `packs.ts` — список пакетов из папки

**Files:**
- Create: `server/src/packs.ts`
- Test: `server/src/packs.test.ts`

**Interfaces:**
- Consumes: `validatePack(data: unknown): Pack` из `server/src/pack.js` (Task 1 — `Pack` уже
  содержит `description?: string`).
- Produces:
  ```typescript
  export interface PackSummary {
    filename: string;
    title: string;
    description: string | null;
  }
  export async function listAvailablePacks(dir: string): Promise<PackSummary[]>;
  ```
  Используется в Task 5 (`index.ts`, начальный скан) и Task 4 (`server.ts`, обработчики
  `refresh-packs`/`admin-refresh-packs`).

- [ ] **Step 1: Написать модуль**

```typescript
// server/src/packs.ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePack } from './pack.js';

export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}

/**
 * Все валидные пакеты в директории `dir` — для списка в интерфейсе (Admin.tsx, Player.tsx),
 * из которого ведущий или админ-панель выбирают активный пакет.
 *
 * Не роняет весь список из-за одного плохого файла: битый JSON или файл, не прошедший
 * validatePack, тихо пропускается — такой файл всё равно нельзя было бы выбрать, но не
 * должен мешать увидеть остальные. console.error — для диагностики на сервере, не для
 * клиента: то, почему конкретного файла нет в списке, не то, что должно решаться в
 * интерфейсе разбором сообщений об ошибках.
 */
export async function listAvailablePacks(dir: string): Promise<PackSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    console.error(`Не удалось прочитать папку с пакетами ${dir}:`, err);
    return [];
  }
  const summaries: PackSummary[] = [];
  for (const filename of entries) {
    if (!filename.endsWith('.json')) continue;
    const path = join(dir, filename);
    try {
      const raw = await readFile(path, 'utf8');
      const pack = validatePack(JSON.parse(raw));
      summaries.push({
        filename,
        title: pack.title,
        description: pack.description ?? null,
      });
    } catch (err) {
      console.error(`Пропускаю невалидный пакет ${path}:`, err);
    }
  }
  return summaries;
}
```

- [ ] **Step 2: Написать тесты**

```typescript
// server/src/packs.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAvailablePacks } from './packs.js';

const VALID_PACK = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            { id: 'q1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
          ],
        },
      ],
    },
  ],
};

describe('listAvailablePacks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list for an empty directory', async () => {
    expect(await listAvailablePacks(dir)).toEqual([]);
  });

  it('returns an empty list and logs when the directory does not exist', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await listAvailablePacks(join(dir, 'nope'));
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('lists a valid pack with its title and description', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify({ ...VALID_PACK, description: 'Про спорт' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: 'Про спорт' },
    ]);
  });

  it('lists a valid pack with description: null when the field is absent', async () => {
    await writeFile(join(dir, 'sport.json'), JSON.stringify(VALID_PACK), 'utf8');
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: null },
    ]);
  });

  it('skips a non-.json file without erroring', async () => {
    await writeFile(join(dir, 'readme.txt'), 'не пак', 'utf8');
    expect(await listAvailablePacks(dir)).toEqual([]);
  });

  it('skips a file with malformed JSON, logs, and still returns the valid ones', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(join(dir, 'broken.json'), '{"title": "об', 'utf8');
    await writeFile(join(dir, 'sport.json'), JSON.stringify(VALID_PACK), 'utf8');
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: null },
    ]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('skips a well-formed JSON file that fails validatePack', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(
      join(dir, 'invalid.json'),
      JSON.stringify({ title: 'Неполный' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Прогнать тесты**

```bash
cd server
npx vitest run src/packs.test.ts
```

Expected: все 7 тестов зелёные.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/packs.ts src/packs.test.ts
cd ..
git add server/src/packs.ts server/src/packs.test.ts
git commit -m "feat: add listAvailablePacks to scan the packs directory"
```

---

### Task 3: `Room` — список пакетов, активный выбор, авторизация

**Files:**
- Modify: `server/src/room.ts`
- Test: `server/src/room.test.ts`

**Interfaces:**
- Consumes: `PackSummary` из `server/src/packs.js` (Task 2), `Pack` из `server/src/pack.js`
  (Task 1).
- Produces:
  ```typescript
  export interface PackInfo {
    available: PackSummary[];
    activeFilename: string | null;
  }
  class Room {
    constructor(
      initial?: RoomState,
      pack?: Pack,
      lan?: LanInfo,
      initialPackFilename?: string,
    );
    getPackInfo(): PackInfo;
    onPackChange(listener: (info: PackInfo) => void): () => void;
    refreshAvailablePacks(requesterId: string | null, packs: PackSummary[]): void;
    selectPack(
      requesterId: string | null,
      filename: string,
      pack: Pack,
    ): { ok: true } | { error: 'not-host' | 'unknown-file' };
  }
  ```
  Используется в Task 4 (`server.ts`) и Task 5 (`index.ts`, начальное имя файла).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/src/room.test.ts`, отдельным блоком сразу после `describe('Room.getLanInfo
/ setLanAddress / onLanChange', ...)` (после строки 56, перед `describe('Room.join', ...)`):

```typescript
describe('Room.getPackInfo / refreshAvailablePacks / selectPack / onPackChange', () => {
  const PACK_A = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              { id: 'a1', price: 100, text: 'В?', answer: 'О', type: 'обычный' as const },
            ],
          },
        ],
      },
    ],
  };
  const PACK_B = {
    ...PACK_A,
    title: 'Пак Б',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              { id: 'b1', price: 100, text: 'В2?', answer: 'О2', type: 'обычный' as const },
            ],
          },
        ],
      },
    ],
  };

  it('defaults to no available packs and no active filename', () => {
    const room = new Room();
    expect(room.getPackInfo()).toEqual({ available: [], activeFilename: null });
  });

  it('exposes the initial pack filename passed at construction', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('refreshAvailablePacks (admin, requesterId null) updates the list and notifies', () => {
    const room = new Room();
    const seen: PackInfo[] = [];
    room.onPackChange((info) => seen.push(info));

    room.refreshAvailablePacks(null, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toEqual([
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);
    expect(seen).toHaveLength(1);
  });

  it('refreshAvailablePacks from the host (matching hostParticipantId) succeeds', () => {
    const room = new Room();
    room.join('Ваня');
    const hostId = room.getState().participants[0].id;
    room.toggleHost(hostId);

    room.refreshAvailablePacks(hostId, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toHaveLength(1);
  });

  it('refreshAvailablePacks from a non-host participant is a silent no-op', () => {
    const room = new Room();
    room.join('Ваня');
    const other = room.join('Катя');
    const otherId = (other as { participant: { id: string } }).participant.id;

    room.refreshAvailablePacks(otherId, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toEqual([]);
  });

  it('selectPack switches the active pack and notifies onPackChange', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.refreshAvailablePacks(null, [
      { filename: 'a.json', title: 'Пак А', description: null },
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);
    const seen: PackInfo[] = [];
    room.onPackChange((info) => seen.push(info));

    const result = room.selectPack(null, 'b.json', PACK_B);

    expect(result).toEqual({ ok: true });
    expect(room.getPackInfo().activeFilename).toBe('b.json');
    expect(seen).toHaveLength(1);
  });

  it('selectPack from the host (matching hostParticipantId) succeeds', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.join('Ваня');
    const hostId = room.getState().participants[0].id;
    room.toggleHost(hostId);
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);

    const result = room.selectPack(hostId, 'b.json', PACK_B);

    expect(result).toEqual({ ok: true });
    expect(room.getPackInfo().activeFilename).toBe('b.json');
  });

  it('selectPack from a non-host participant is a silent no-op returning not-host', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.join('Ваня');
    const other = room.join('Катя');
    const otherId = (other as { participant: { id: string } }).participant.id;
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);

    const result = room.selectPack(otherId, 'b.json', PACK_B);

    expect(result).toEqual({ error: 'not-host' });
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('selectPack with a filename not in the known list returns unknown-file', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');

    const result = room.selectPack(null, 'ghost.json', PACK_B);

    expect(result).toEqual({ error: 'unknown-file' });
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('selecting a pack makes it the pack used by the next startGame()', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);
    room.selectPack(null, 'b.json', PACK_B);
    room.join('Ваня');
    room.join('Катя');

    room.startGame(null);

    expect(room.getState().game?.pack.title).toBe('Пак Б');
  });
});
```

Также добавить импорт типа в начало файла (у `room.test.ts` сейчас нет прямого импорта типов
из `room.js`, кроме `Room`) — добавить `PackInfo` в существующий импорт:

```typescript
import { Room, type PackInfo } from './room.js';
```

(Если в файле уже есть `import { Room } from './room.js';` — заменить эту строку на
приведённую выше; если `PackInfo` ещё не экспортируется из `room.ts`, тест не скомпилируется
— это ожидаемо на этом шаге, поле появится в Step 3.)

- [ ] **Step 2: Прогнать тесты, убедиться, что падают (или не компилируются)**

```bash
cd server
npx vitest run src/room.test.ts
```

Expected: падение компиляции/тестов — `Room` пока не экспортирует `PackInfo`, не имеет
`getPackInfo`/`refreshAvailablePacks`/`selectPack`/`onPackChange`, конструктор не принимает
четвёртый параметр.

- [ ] **Step 3: Реализовать в `room.ts`**

Импорт `PackSummary` — добавить к существующему импорту `LanCandidate` (строка 24):

```typescript
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
```

После интерфейса `LanInfo` (после строки 52, перед `export type JoinResult`):

```typescript
// Тот же принцип, что и LanInfo выше: список пакетов на диске и текущий
// выбор — факт окружения, не игровое состояние, не часть RoomState/снапшота.
export interface PackInfo {
  available: PackSummary[];
  activeFilename: string | null;
}
```

Новые приватные поля класса — рядом с `lanListeners` (после строки 141):

```typescript
  private availablePacks: PackSummary[] = [];
  private activePackFilename: string | null;
  private packListeners = new Set<(info: PackInfo) => void>();
```

Конструктор (строки 143-158) — добавить четвёртый параметр и инициализацию:

```typescript
  constructor(
    initial?: RoomState,
    pack?: Pack,
    lan?: LanInfo,
    initialPackFilename?: string,
  ) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
    this.pack = pack;
    this.game = initial?.game ? { ...initial.game } : null;
    this.hostParticipantId = initial?.hostParticipantId ?? null;
    this.lanCandidates = lan?.candidates ?? [];
    this.lanAddress = lan?.address ?? null;
    this.activePackFilename = initialPackFilename ?? null;
    if (this.game) {
      const restart = PHASE_TIMER[this.game.phase];
      if (restart) {
        this.applyEffects([{ type: 'start-timer', ...restart }]);
      }
    }
  }
```

Новые методы — сразу после `setLanAddress` (после строки 530, перед `toGameStateView`):

```typescript
  getPackInfo(): PackInfo {
    return {
      available: [...this.availablePacks],
      activeFilename: this.activePackFilename,
    };
  }

  private isHostOrAdmin(requesterId: string | null): boolean {
    return requesterId === null || requesterId === this.hostParticipantId;
  }

  // requesterId === null — с админ-панели, без проверки личности (тот же
  // паттерн, что у setLanAddress/startGame). Иначе — только текущий
  // лобби-ведущий (hostParticipantId, не game.hostId: выбор пакета имеет
  // смысл до партии). Неавторизованный вызов — тихий no-op: сама кнопка не
  // должна была быть видна отправителю, осмысленный ответ ему не нужен.
  refreshAvailablePacks(requesterId: string | null, packs: PackSummary[]): void {
    if (!this.isHostOrAdmin(requesterId)) return;
    this.availablePacks = packs;
    this.notifyPackChange();
  }

  // Не трогает диск сама — `pack` уже прочитан и провалидирован вызывающим
  // (server.ts). Проверяет только то, что `filename` входит в уже известный
  // `availablePacks` (тот же принцип, что setLanAddress с lanCandidates) —
  // защита от гонки между обновлением списка и выбором, не источник истины
  // о валидности содержимого файла.
  selectPack(
    requesterId: string | null,
    filename: string,
    pack: Pack,
  ): { ok: true } | { error: 'not-host' | 'unknown-file' } {
    if (!this.isHostOrAdmin(requesterId)) {
      return { error: 'not-host' };
    }
    if (!this.availablePacks.some((p) => p.filename === filename)) {
      return { error: 'unknown-file' };
    }
    this.pack = pack;
    this.activePackFilename = filename;
    this.notifyPackChange();
    return { ok: true };
  }

  private notifyPackChange(): void {
    const info = this.getPackInfo();
    for (const listener of this.packListeners) {
      listener(info);
    }
  }
```

`onPackChange` — сразу после `onLanChange` (после строки 664):

```typescript
  // Отдельно от onChange/onLanChange по той же причине: список пакетов и
  // активный выбор не часть RoomState.
  onPackChange(listener: (info: PackInfo) => void): () => void {
    this.packListeners.add(listener);
    return () => this.packListeners.delete(listener);
  }
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/room.test.ts
```

Expected: все тесты зелёные, включая полный существующий набор (ничего не сломано).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/room.ts src/room.test.ts
cd ..
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: track available packs and the active selection on Room"
```

---

### Task 4: Протокол и `server.ts`

**Files:**
- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Test: `server/src/server.test.ts`

**Interfaces:**
- Consumes: `Room.getPackInfo/refreshAvailablePacks/selectPack/onPackChange` (Task 3),
  `listAvailablePacks` из `server/src/packs.js` (Task 2), `loadPack` из `server/src/pack.js`
  (уже существует).
- Produces: протокольные сообщения ниже; `CreateServerOptions` получает `packsDir: string`
  (директория для сканирования при `refresh-packs`/`admin-refresh-packs`).

- [ ] **Step 1: Расширить протокол**

В `server/src/protocol.ts`, `ClientMessage` (после строки 84, `admin-set-lan-address`,
перед закрывающим `;`):

```typescript
  | { type: 'admin-set-lan-address'; address: string }
  // Выбор пакета — от участника (сервер сверяет отправителя с
  // hostParticipantId) и с админ-панели (без проверки личности), тем же
  // способом, каким уже разделены skip-to-final/admin-skip-to-final.
  | { type: 'refresh-packs' }
  | { type: 'select-pack'; filename: string }
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string };
```

Импорт `PackSummary` — добавить рядом с импортом `LanCandidate` (строка 2):

```typescript
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
```

`ServerMessage['state']` — добавить два поля после `lanCandidates` (после строки 107, перед
закрывающей `}`):

```typescript
      lanUrl: string;
      lanCandidates: LanCandidate[];
      // Живые, как lanUrl/lanCandidates — пересчитываются на каждой
      // рассылке из room.getPackInfo(), видны всем подключённым, но
      // действовать (refresh-packs/select-pack) могут только ведущий и
      // админка.
      availablePacks: PackSummary[];
      activePackFilename: string | null;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  // Попытка select-pack/admin-select-pack на файл, ставший невалидным или
  // исчезнувший между обновлением списка и выбором.
  | { type: 'select-pack-error'; reason: 'unknown-file' };
```

(Замените существующий хвост типа `ServerMessage`, строки 108-110, на приведённый выше —
последняя альтернатива `start-game-error` перестаёт быть последней, добавляется
`select-pack-error`.)

- [ ] **Step 2: Расширить `server.ts`**

`CreateServerOptions` (строки 14-18) — новое поле:

```typescript
export interface CreateServerOptions {
  room: Room;
  clientDistPath: string;
  port: number;
  packsDir: string;
}
```

Деструктуризация в `createServer` (строка 58):

```typescript
  const { room, clientDistPath, port, packsDir } = options;
```

Импорт `listAvailablePacks`/`loadPack` — добавить в начало файла:

```typescript
import { listAvailablePacks } from './packs.js';
import { loadPack } from './pack.js';
```

`stateMessageFor` (строки 80-90) — добавить поля из `room.getPackInfo()`:

```typescript
  const stateMessageFor = (viewerId: string | null): ServerMessage => {
    const lan = room.getLanInfo();
    const packInfo = room.getPackInfo();
    return {
      type: 'state',
      participants: toParticipantView(room.getState()),
      hostParticipantId: room.getState().hostParticipantId,
      game: room.toGameStateView(viewerId),
      lanUrl: lanUrlFor(lan.address, port),
      lanCandidates: lan.candidates,
      availablePacks: packInfo.available,
      activePackFilename: packInfo.activeFilename,
    };
  };
```

Подписка на `onPackChange` — рядом с `room.onLanChange(broadcastState)` (строка 120):

```typescript
  room.onChange(broadcastState);
  room.onLanChange(broadcastState);
  room.onPackChange(broadcastState);
```

Обработчик `ws.on('message', ...)` — сделать колбэк `async` (сейчас синхронный, строка 142:
`ws.on('message', (data) => {`), поскольку обработка `refresh-packs`/`select-pack` требует
`await` на чтение файлов:

```typescript
    ws.on('message', (data) => {
```

заменить на:

```typescript
    ws.on('message', (data) => {
      void handleMessage(data);
    });

    async function handleMessage(data: WebSocket.RawData): Promise<void> {
```

(Аккуратно: тело существующего обработчика, строки 143-345, целиком становится телом
`handleMessage` — просто меняется обрамляющая функция и добавляется `void handleMessage(data)`
как синхронный вызов асинхронной функции из синхронного колбэка `ws.on('message', ...)`;
`ws.on('error', ...)` и `ws.on('close', ...)` ниже (строки 347-358) остаются вне
`handleMessage`, на прежнем месте, как отдельные обработчики того же сокета.)

Новые обработчики сообщений — добавить в конец `handleMessage`, после блока
`admin-set-lan-address` (после строки 344, перед закрывающей `});` обработчика `'message'`):

```typescript
      if (message.type === 'refresh-packs') {
        const participantId = connections.get(ws);
        if (participantId) {
          const packs = await listAvailablePacks(packsDir);
          room.refreshAvailablePacks(participantId, packs);
        }
      }

      if (message.type === 'admin-refresh-packs') {
        const packs = await listAvailablePacks(packsDir);
        room.refreshAvailablePacks(null, packs);
      }

      if (
        message.type === 'select-pack' &&
        typeof message.filename === 'string'
      ) {
        const participantId = connections.get(ws);
        if (participantId) {
          await handleSelectPack(participantId, message.filename);
        }
      }

      if (
        message.type === 'admin-select-pack' &&
        typeof message.filename === 'string'
      ) {
        await handleSelectPack(null, message.filename);
      }

      async function handleSelectPack(
        requesterId: string | null,
        filename: string,
      ): Promise<void> {
        let pack;
        try {
          pack = await loadPack(join(packsDir, filename));
        } catch {
          send(ws, { type: 'select-pack-error', reason: 'unknown-file' });
          return;
        }
        const result = room.selectPack(requesterId, filename, pack);
        if ('error' in result && result.error === 'unknown-file') {
          send(ws, { type: 'select-pack-error', reason: 'unknown-file' });
        }
        // result.error === 'not-host' — тихий no-op, без ответа (см. Task 3).
      }
```

Добавить импорт `join` из `node:path` в начало файла:

```typescript
import { join } from 'node:path';
```

- [ ] **Step 3: Написать тесты**

Добавить в `server/src/server.test.ts`, новый `describe` в конце файла (после
`describe('createServer admin panel', ...)`, после закрывающей `});` этого блока):

```typescript
describe('createServer pack picker', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  const PACK_A = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              { id: 'a1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
            ],
          },
        ],
      },
    ],
  };
  const PACK_B = {
    ...PACK_A,
    title: 'Пак Б',
    description: 'Второй пак',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              { id: 'b1', price: 100, text: 'В2?', answer: 'О2', type: 'обычный' },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-picker-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-picker-packs-'));
    await writeFile(
      join(packsDir, 'a.json'),
      JSON.stringify(PACK_A),
      'utf8',
    );
    await writeFile(
      join(packsDir, 'b.json'),
      JSON.stringify(PACK_B),
      'utf8',
    );
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
    const admin = await connectAdmin(baseUrl);
    const state = (await admin.nextMessage()) as {
      activePackFilename: string;
      availablePacks: unknown[];
    };
    expect(state.activePackFilename).toBe('a.json');
    expect(state.availablePacks).toEqual([]);
    admin.ws.close();
  });

  it('admin-refresh-packs populates availablePacks with titles and descriptions', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    const state = (await admin.nextMessage()) as {
      availablePacks: { filename: string; title: string; description: string | null }[];
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
    await admin.nextMessage();

    admin.ws.send(JSON.stringify({ type: 'admin-select-pack', filename: 'b.json' }));
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
    await Promise.all([admin.nextMessage(), host.nextMessage(), other.nextMessage()]);

    admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
    await admin.nextMessage();

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

  it('select-pack-error on an unknown filename', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-select-pack', filename: 'ghost.json' }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toEqual({ type: 'select-pack-error', reason: 'unknown-file' });
    admin.ws.close();
  });
});
```

- [ ] **Step 4: Прогнать тесты**

```bash
cd server
npx vitest run src/server.test.ts
```

Expected: все тесты зелёные, включая весь существующий набор (ничего не сломано сменой
синхронного обработчика на асинхронный).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/protocol.ts src/server.ts src/server.test.ts
cd ..
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: wire pack selection into the protocol and server"
```

---

### Task 5: `index.ts` — начальный скан и имя загруженного пакета

**Files:**
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `listAvailablePacks` (Task 2), `Room`'s четвёртый параметр конструктора (Task 3),
  `CreateServerOptions.packsDir` (Task 4).
- Produces: ничего нового наружу — только связывает уже готовые части при старте процесса.
  Нет отдельного теста (как и остальная часть `index.ts` — проверяется вручную, см. Step 3).

- [ ] **Step 1: Добавить импорт и вычисление `PACKS_DIR`**

В `server/src/index.ts`, импорты (после строки 9, `import { loadPack } from './pack.js';`):

```typescript
import { listAvailablePacks } from './packs.js';
```

`dirname` уже импортирован (строка 2, `import { dirname, join } from 'node:path';`) — новых
импортов из `node:path` не требуется, но нужен `basename`:

```typescript
import { basename, dirname, join } from 'node:path';
```

После блока констант (после строки 30, `const CLIENT_DIST_PATH = ...`):

```typescript
const PACKS_DIR = dirname(PACK_PATH);
```

- [ ] **Step 2: Начальный скан и передача в `Room`/`createServer`**

После блока LAN-адреса и перед `const room = new Room(...)` (строка 121) — начальный скан:

```typescript
  const initialAvailablePacks = await listAvailablePacks(PACKS_DIR);
```

Строку создания `Room` (строки 121-124) заменить на:

```typescript
  const room = new Room(
    initial ?? undefined,
    pack,
    { candidates, address: lanAddress },
    basename(PACK_PATH),
  );
  room.refreshAvailablePacks(null, initialAvailablePacks);
```

(`refreshAvailablePacks(null, ...)` вызывается сразу после конструктора, а не передаётся
через него — конструктор просто фиксирует НАЧАЛЬНОЕ имя активного файла, `available` заполняется
тем же методом, что и обычное «Обновить», чтобы не заводить пятый параметр конструктора
ради того, что и так есть готовым публичным методом.)

`createServer(...)` (строки 147-151) — добавить `packsDir`:

```typescript
  const { httpServer } = createServer({
    room,
    clientDistPath: CLIENT_DIST_PATH,
    port: PORT,
    packsDir: PACKS_DIR,
  });
```

- [ ] **Step 3: Ручная проверка**

```bash
cd server
npx tsc --noEmit
cd ..
```

Запустить сервер и убедиться в логе, что процесс поднимается без ошибок (сам список пакетов
в консоль не печатается — это не требование спеки, только видно через `/admin`):

```bash
cd server
PACK_PATH=../packs/current.json npx tsx watch src/index.ts
```

Expected: `Своя игра слушает на http://...` — сервер стартует, как и раньше. Остановить
(Ctrl+C) после проверки.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: scan the packs directory and pass the boot pack's filename at startup"
```

---

### Task 6: `Admin.tsx` + `useAdminConnection.ts` — секция «Пакет»

**Files:**
- Modify: `client/src/useAdminConnection.ts`
- Modify: `client/src/Admin.tsx`
- Test: `client/src/useAdminConnection.test.ts`
- Test: `client/src/Admin.test.tsx`

**Interfaces:**
- Consumes: `availablePacks`/`activePackFilename` из `'state'` (Task 4), `admin-refresh-packs`/
  `admin-select-pack` (Task 4), `select-pack-error` (Task 4).
- Produces: `AdminConnection` получает `availablePacks: PackSummary[]`,
  `activePackFilename: string | null`, `selectPackError: 'unknown-file' | null`,
  `refreshPacks(): void`, `selectPack(filename: string): void`.

- [ ] **Step 1: Расширить `useAdminConnection.ts`**

Новый тип `PackSummary` — рядом с `LanCandidate` (после строки 14):

```typescript
export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}
```

`ServerMessage` (строки 22-31) — добавить поля к `'state'` и новый тип сообщения:

```typescript
type ServerMessage =
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      lanUrl: string;
      lanCandidates: LanCandidate[];
      availablePacks: PackSummary[];
      activePackFilename: string | null;
    }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  | { type: 'select-pack-error'; reason: 'unknown-file' };
```

`ClientMessage` (строки 33-41) — добавить два сообщения:

```typescript
type ClientMessage =
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в server/src/engine.ts.
  | { type: 'admin-skip-to-final' }
  | { type: 'admin-set-lan-address'; address: string }
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string };
```

`AdminConnection` (строки 43-62) — добавить поля перед закрывающей `}`:

```typescript
  setLanAddress(address: string): void;
  availablePacks: PackSummary[];
  activePackFilename: string | null;
  selectPackError: 'unknown-file' | null;
  refreshPacks(): void;
  selectPack(filename: string): void;
}
```

Состояние — рядом с `lanCandidates` (после строки 75):

```typescript
  const [lanCandidates, setLanCandidates] = useState<LanCandidate[]>([]);
  const [availablePacks, setAvailablePacks] = useState<PackSummary[]>([]);
  const [activePackFilename, setActivePackFilename] = useState<string | null>(
    null,
  );
  const [selectPackError, setSelectPackError] = useState<
    'unknown-file' | null
  >(null);
```

Обработка `'state'` (строки 103-110) — добавить два поля и сброс ошибки:

```typescript
        if (message.type === 'state') {
          setParticipants(message.participants);
          setHostParticipantId(message.hostParticipantId);
          setGame(message.game);
          setLanUrl(message.lanUrl);
          setLanCandidates(message.lanCandidates);
          setAvailablePacks(message.availablePacks);
          setActivePackFilename(message.activePackFilename);
          setSelectPackError(null);
          setStartGameError(null);
        }
        if (message.type === 'start-game-error') {
          setStartGameError(message.reason);
        }
        if (message.type === 'select-pack-error') {
          setSelectPackError(message.reason);
        }
```

Возвращаемый объект (строки 139-155) — добавить поля перед закрывающей `};`:

```typescript
    setLanAddress: (address) =>
      send({ type: 'admin-set-lan-address', address }),
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks: () => send({ type: 'admin-refresh-packs' }),
    selectPack: (filename) => send({ type: 'admin-select-pack', filename }),
  };
```

- [ ] **Step 2: Написать тесты для `useAdminConnection.ts`**

Добавить в `client/src/useAdminConnection.test.ts`, после теста `'sends admin-set-lan-address
with the chosen address'`:

```typescript
  it('picks up availablePacks and activePackFilename from state broadcasts', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [],
        hostParticipantId: null,
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        lanCandidates: [],
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Описание' },
        ],
        activePackFilename: 'a.json',
      }),
    );

    expect(result.current.availablePacks).toEqual([
      { filename: 'a.json', title: 'Пак А', description: 'Описание' },
    ]);
    expect(result.current.activePackFilename).toBe('a.json');
  });

  it('sends admin-refresh-packs and admin-select-pack', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.refreshPacks());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-refresh-packs' }),
    );

    act(() => result.current.selectPack('b.json'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-select-pack', filename: 'b.json' }),
    );
  });

  it('surfaces a select-pack-error reason from the server', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'select-pack-error', reason: 'unknown-file' }),
    );

    expect(result.current.selectPackError).toBe('unknown-file');
  });
```

- [ ] **Step 3: Прогнать тесты, убедиться, что новые падают**

```bash
cd client
npx vitest run src/useAdminConnection.test.ts
```

Expected: три новых теста падают (поля/методы ещё не существуют — этот шаг уже после Step 1,
которая их добавляет, так что на самом деле тесты должны быть УЖЕ зелёными; если что-то
красное — сверить Step 1 построчно, а не переходить дальше).

- [ ] **Step 4: Добавить секцию «Пакет» в `Admin.tsx`**

Деструктуризация (строки 20-35) — добавить новые поля:

```typescript
  const {
    connected,
    lanUrl,
    lanCandidates,
    participants,
    hostParticipantId,
    game,
    startGameError,
    startGame,
    resetGame,
    resetRoom,
    kick,
    setHost,
    skipToFinal,
    setLanAddress,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks,
    selectPack,
  } = useAdminConnection();
```

Новая секция — между секцией «Сеть» и секцией «Партия» (после строки 111, закрывающего
`</section>` секции «Сеть», перед строкой 113, `<section className="admin-section">` секции
«Партия»):

```typescript
      <section className="admin-section">
        <h2>Пакет</h2>
        {selectPackError && (
          <p className="player-alert" role="alert">
            Не удалось выбрать пакет — файл стал невалиден или исчез.
          </p>
        )}
        <div className="admin-actions">
          <button className="button" onClick={refreshPacks}>
            Обновить
          </button>
        </div>
        {availablePacks.length === 0 ? (
          <p>Пакеты не найдены — положите файлы в packs/ и нажмите «Обновить».</p>
        ) : (
          <ul className="admin-packs">
            {availablePacks.map((p) => {
              const selected = p.filename === activePackFilename;
              return (
                <li key={p.filename}>
                  <button
                    className={`button${selected ? ' is-selected' : ''}`}
                    onClick={() => selectPack(p.filename)}
                    disabled={selected}
                  >
                    <span className="admin-pack-title">{p.title}</span>
                    {p.description && (
                      <span className="admin-pack-description">
                        {p.description}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
```

- [ ] **Step 5: Написать тесты для `Admin.tsx`**

`connection()` в `client/src/Admin.test.tsx` — добавить поля перед `...overrides`:

```typescript
    setLanAddress: vi.fn(),
    availablePacks: [],
    activePackFilename: null,
    selectPackError: null,
    refreshPacks: vi.fn(),
    selectPack: vi.fn(),
    ...overrides,
```

Новые тесты — после блока тестов про «Сеть» (после теста `'calls setLanAddress when picking a
different candidate'`, перед `'shows "нет партии" и предлагает начать одну...'`):

```typescript
  it('shows a message instead of a pack list when none were found', () => {
    mockedUseAdminConnection.mockReturnValue(connection({ availablePacks: [] }));
    render(<Admin />);
    expect(screen.getByText(/пакеты не найдены/i)).toBeInTheDocument();
  });

  it('lists packs with titles and descriptions, marking the active one', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Про спорт' },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
      }),
    );
    render(<Admin />);
    expect(screen.getByText('Пак А')).toBeInTheDocument();
    expect(screen.getByText('Про спорт')).toBeInTheDocument();
    const active = screen.getByRole('button', { name: /Пак А/ });
    const other = screen.getByRole('button', { name: /Пак Б/ });
    expect(active).toBeDisabled();
    expect(other).toBeEnabled();
  });

  it('calls selectPack when picking a different pack', async () => {
    const selectPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        activePackFilename: 'a.json',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
        selectPack,
      }),
    );
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: /Пак Б/ }));
    expect(selectPack).toHaveBeenCalledWith('b.json');
  });

  it('calls refreshPacks when clicking "Обновить"', async () => {
    const refreshPacks = vi.fn();
    mockedUseAdminConnection.mockReturnValue(connection({ refreshPacks }));
    render(<Admin />);
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(refreshPacks).toHaveBeenCalledOnce();
  });

  it('shows an alert when selectPackError is set', () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({ selectPackError: 'unknown-file' }),
    );
    render(<Admin />);
    expect(screen.getByRole('alert')).toHaveTextContent(/не удалось выбрать/i);
  });
```

- [ ] **Step 6: Прогнать все клиентские тесты**

```bash
npx vitest run src/useAdminConnection.test.ts src/Admin.test.tsx
```

Expected: всё зелёное.

- [ ] **Step 7: typecheck, lint, commit**

```bash
npx tsc -b
npx oxlint src/useAdminConnection.ts src/Admin.tsx
cd ..
git add client/src/useAdminConnection.ts client/src/useAdminConnection.test.ts client/src/Admin.tsx client/src/Admin.test.tsx
git commit -m "feat: add a pack picker section to the admin panel"
```

---

### Task 7: `Player.tsx` + `useRoomConnection.ts` — выбор пакета в лобби ведущего

**Files:**
- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/Player.tsx`
- Test: `client/src/useRoomConnection.test.ts`
- Test: `client/src/Player.test.tsx`

**Interfaces:**
- Consumes: то же, что Task 6, но через участническую пару `refresh-packs`/`select-pack`
  (Task 4), не `admin-*`.
- Produces: `RoomConnection` получает те же пять полей/методов, что `AdminConnection` в
  Task 6, но отправляет немаркированные (не `admin-`) сообщения.

- [ ] **Step 1: Расширить `useRoomConnection.ts`**

Новый тип — после `GameStateView` (после строки 47), тот же, что в Task 6:

```typescript
export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}
```

`ServerMessage` (строки 56-68) — добавить поля и новый тип:

```typescript
type ServerMessage =
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      lanUrl: string;
      availablePacks: PackSummary[];
      activePackFilename: string | null;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  | { type: 'select-pack-error'; reason: 'unknown-file' };
```

`ClientMessage` (строки 70-85) — добавить два сообщения перед закрывающей `;`:

```typescript
  | { type: 'final-vote'; participantId: string; correct: boolean }
  | { type: 'refresh-packs' }
  | { type: 'select-pack'; filename: string };
```

`RoomConnection` (строки 90-114) — добавить поля перед закрывающей `}`:

```typescript
  finalVote(participantId: string, correct: boolean): void;
  availablePacks: PackSummary[];
  activePackFilename: string | null;
  selectPackError: 'unknown-file' | null;
  refreshPacks(): void;
  selectPack(filename: string): void;
}
```

Состояние — рядом с `lanUrl` (после строки 130):

```typescript
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [availablePacks, setAvailablePacks] = useState<PackSummary[]>([]);
  const [activePackFilename, setActivePackFilename] = useState<string | null>(
    null,
  );
  const [selectPackError, setSelectPackError] = useState<
    'unknown-file' | null
  >(null);
```

Обработка `'state'` (строки 192-202) — добавить два поля и сброс ошибки:

```typescript
        if (message.type === 'state') {
          setParticipants(message.participants);
          setHostParticipantId(message.hostParticipantId);
          setGame(message.game);
          setLanUrl(message.lanUrl);
          setAvailablePacks(message.availablePacks);
          setActivePackFilename(message.activePackFilename);
          setSelectPackError(null);
          // Любое изменение в комнате (кто-то присоединился, кто-то стал
          // ведущим, партия реально началась) делает старую ошибку запуска
          // неактуальной — пользователь либо чинит проблему прямо сейчас,
          // либо она уже больше не про то, что показано на экране.
          setStartGameError(null);
        }
        if (message.type === 'start-game-error') {
          setStartGameError(message.reason);
        }
        if (message.type === 'select-pack-error') {
          setSelectPackError(message.reason);
        }
```

Возвращаемый объект (строки 249-278) — добавить поля перед закрывающей `};`:

```typescript
    finalVote: (participantId, correct) =>
      send({ type: 'final-vote', participantId, correct }),
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks: () => send({ type: 'refresh-packs' }),
    selectPack: (filename) => send({ type: 'select-pack', filename }),
  };
```

- [ ] **Step 2: Написать тесты для `useRoomConnection.ts`**

Найти существующий тестовый файл `client/src/useRoomConnection.test.ts`, определить его
`FakeWebSocket`/`factory`/паттерн эмиссии сообщений (тот же, что в
`useAdminConnection.test.ts`, но без токена/join-специфики) и добавить, тем же стилем, что
Task 6 Step 2:

```typescript
  it('picks up availablePacks and activePackFilename from state broadcasts', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [],
        hostParticipantId: null,
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        activePackFilename: 'a.json',
      }),
    );

    expect(result.current.availablePacks).toEqual([
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);
    expect(result.current.activePackFilename).toBe('a.json');
  });

  it('sends refresh-packs and select-pack', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.refreshPacks());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'refresh-packs' }),
    );

    act(() => result.current.selectPack('b.json'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'select-pack', filename: 'b.json' }),
    );
  });

  it('surfaces a select-pack-error reason from the server', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'select-pack-error', reason: 'unknown-file' }),
    );

    expect(result.current.selectPackError).toBe('unknown-file');
  });
```

(Место вставки — рядом с уже существующими тестами на `lanUrl`/`state`-обработку в этом
файле; если такого раздела нет явно, добавить в конец основного `describe`.)

- [ ] **Step 3: Прогнать тесты**

```bash
cd client
npx vitest run src/useRoomConnection.test.ts
```

Expected: все тесты зелёные (новые + существующие).

- [ ] **Step 4: Добавить пикер в лобби-блок `Player.tsx`**

Деструктуризация (строки 14-37) — добавить новые поля:

```typescript
  const {
    status,
    join,
    game,
    selfId,
    participants,
    falsestart,
    hostParticipantId,
    isHost,
    startGameError,
    startGame,
    toggleHost,
    selectQuestion,
    buzz,
    saidAnswer,
    vote,
    adjustScore,
    cancelQuestion,
    resetGame,
    eliminateFinalTheme,
    submitWager,
    submitFinalAnswer,
    finalVote,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks,
    selectPack,
  } = useRoomConnection();
```

Лобби-блок (строки 141-166, `if (!game) { ... }`) — добавить секцию выбора пакета, видимую
только ведущему, между блоком «Стать/перестать ведущим» и кнопкой «Начать игру»:

```typescript
  if (!game) {
    const hostName = hostParticipantId ? nameOf(hostParticipantId) : null;
    return (
      <div className="player">
        <p>Ты в игре. Жди начала.</p>
        {hostName && (
          <p>
            Ведущий: {hostName}
            {isHost && ' (ты)'}
          </p>
        )}
        <button className="button" onClick={toggleHost}>
          {isHost ? 'Перестать быть ведущим' : 'Стать ведущим'}
        </button>
        {isHost && (
          <div className="player-pack-picker">
            <h3>Пакет</h3>
            {selectPackError && (
              <p className="player-alert" role="alert">
                Не удалось выбрать пакет — файл стал невалиден или исчез.
              </p>
            )}
            <button className="button" onClick={refreshPacks}>
              Обновить
            </button>
            {availablePacks.length === 0 ? (
              <p>Пакеты не найдены — положите файлы в packs/ и обновите список.</p>
            ) : (
              <ul className="player-packs">
                {availablePacks.map((p) => {
                  const selected = p.filename === activePackFilename;
                  return (
                    <li key={p.filename}>
                      <button
                        className={`button${selected ? ' is-selected' : ''}`}
                        onClick={() => selectPack(p.filename)}
                        disabled={selected}
                      >
                        <span className="admin-pack-title">{p.title}</span>
                        {p.description && (
                          <span className="admin-pack-description">
                            {p.description}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {startGameError && (
          <p className="player-alert" role="alert">
            {START_GAME_ERROR_TEXT[startGameError]}
          </p>
        )}
        {(!hostParticipantId || isHost) && (
          <button className="button button--primary" onClick={startGame}>
            Начать игру
          </button>
        )}
      </div>
    );
  }
```

- [ ] **Step 5: Написать тесты для `Player.tsx`**

`connection()` в `client/src/Player.test.tsx` — добавить поля перед `...overrides`:

```typescript
    finalVote: vi.fn(),
    availablePacks: [],
    activePackFilename: null,
    selectPackError: null,
    refreshPacks: vi.fn(),
    selectPack: vi.fn(),
    ...overrides,
```

Новые тесты — рядом с существующими тестами лобби-блока (`'shows whose turn it is by name
when it isn't mine'` и соседние — искать по `isHost`/`toggleHost` в файле):

```typescript
  it('does not show the pack picker in the lobby when not the host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: null,
        availablePacks: [{ filename: 'a.json', title: 'Пак А', description: null }],
      }),
    );
    render(<Player />);
    expect(screen.queryByText('Пак А')).not.toBeInTheDocument();
  });

  it('shows the pack picker in the lobby when the host', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        hostParticipantId: 'host-id',
        game: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Описание' },
        ],
        activePackFilename: 'a.json',
      }),
    );
    render(<Player />);
    expect(screen.getByText('Пак А')).toBeInTheDocument();
    expect(screen.getByText('Описание')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Пак А/ })).toBeDisabled();
  });

  it('calls selectPack when the host picks a different pack', async () => {
    const selectPack = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        hostParticipantId: 'host-id',
        game: null,
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
          { filename: 'b.json', title: 'Пак Б', description: null },
        ],
        activePackFilename: 'a.json',
        selectPack,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: /Пак Б/ }));
    expect(selectPack).toHaveBeenCalledWith('b.json');
  });

  it('calls refreshPacks when the host clicks "Обновить" in the lobby', async () => {
    const refreshPacks = vi.fn();
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'host-id',
        hostParticipantId: 'host-id',
        game: null,
        refreshPacks,
      }),
    );
    render(<Player />);
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(refreshPacks).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 6: Прогнать все клиентские тесты**

```bash
npx vitest run src/useRoomConnection.test.ts src/Player.test.tsx
```

Expected: всё зелёное.

- [ ] **Step 7: typecheck, lint, commit**

```bash
npx tsc -b
npx oxlint src/useRoomConnection.ts src/Player.tsx
cd ..
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts client/src/Player.tsx client/src/Player.test.tsx
git commit -m "feat: let the host pick a pack from their own lobby screen"
```

---

### Task 8: CSS и `pack-generator` — описание в новых пакетах

**Files:**
- Modify: `client/src/index.css`
- Modify: `.claude/skills/pack-generator/SKILL.md`

**Interfaces:**
- Не вводит новых интерфейсов — оформление списка (переиспользует `.button`/`.is-selected`,
  добавляет только раскладку списка и стиль подписи) и обновление промпта генератора под уже
  готовое поле `Pack.description` из Task 1.

- [ ] **Step 1: Добавить CSS для списка пакетов**

В `client/src/index.css`, рядом с `.admin-lan-candidates`/`.admin-lan-candidates .button.is-
selected` (искать по этим классам — они появились вместе с LAN-пикером):

```css
.admin-packs,
.player-packs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-packs .button,
.player-packs .button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 4px;
}

.admin-pack-title {
  font-weight: 600;
}

.admin-pack-description {
  font-size: 14px;
  color: var(--text);
  font-weight: 400;
}

.admin-packs .button.is-selected,
.player-packs .button.is-selected {
  outline: 4px solid var(--text-h);
  outline-offset: 2px;
}

.player-pack-picker {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 16px;
  width: 100%;
}

.player-pack-picker h3 {
  font-size: 16px;
  margin: 0 0 12px;
}
```

- [ ] **Step 2: Обновить `pack-generator` SKILL.md**

В `.claude/skills/pack-generator/SKILL.md`, Шаг 6 («Запись и проверка»), пункт 1 (сборка
объекта пакета) — добавить `description` в перечисление полей и инструкцию, что писать:

Найти текст:

```
1. Собрать всё в объект, соответствующий `Pack` из `server/src/pack.ts`:
   `{ title, author, createdAt, rounds: [...], final: { themes: [...] } }`.
   - `title`: короткое название по смыслу тем (не «Пакет 1», а что-то содержательное).
   - `author`: `'сгенерировано pack-generator'`.
   - `createdAt`: дата генерации в формате `YYYY-MM-DD`.
```

Заменить на:

```
1. Собрать всё в объект, соответствующий `Pack` из `server/src/pack.ts`:
   `{ title, author, createdAt, description, rounds: [...], final: { themes: [...] } }`.
   - `title`: короткое название по смыслу тем (не «Пакет 1», а что-то содержательное).
   - `author`: `'сгенерировано pack-generator'`.
   - `createdAt`: дата генерации в формате `YYYY-MM-DD`.
   - `description`: одно предложение по темам пакета — то, по чему человек быстро узнает
     этот пак в списке при выборе (Admin.tsx/Player.tsx), не повторяя `title` дословно.
     Пример: при `title: "Спорт, кино и музыка"` — `description: "Футбол, супергеройское
     кино и поп-музыка 80-х — для широкой компании"`.
```

- [ ] **Step 3: Полная проверка проекта**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: всё зелёное — эта задача не меняет протокол/логику, только оформление и текст
промпта, но полный прогон подтверждает, что ничего по пути не сломано.

- [ ] **Step 4: Commit**

```bash
git add client/src/index.css .claude/skills/pack-generator/SKILL.md
git commit -m "feat: style the pack picker and teach pack-generator to write a description"
```

---

## После плана

Живая партия — обязательное условие закрытия (`svoya-igra-dev`, шаг 7): переключить пакет и
через `/admin`, и через лобби ведущего до реального старта партии, убедиться, что список
обновляется по кнопке и что выбор ничего не портит в уже идущей (на другом паке) партии.
