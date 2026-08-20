# История партий и антиповтор — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игра записывает сыгранные вопросы в SQLite, а генератор пакетов читает эту историю и перестаёт повторяться.

**Architecture:** Новый модуль `server/src/history.ts` владеет базой (`node:sqlite`) и содержит как запись, так и чистые функции сравнения. `Room` получает узкий интерфейс `HistoryRecorder` через конструктор и вызывает его, обнаруживая закрытие вопроса по росту `answeredQuestionIds` в паре состояний «до/после» внутри `dispatch()`. Движок не меняется. Генератор читает историю двумя тонкими CLI-скриптами поверх того же модуля.

**Tech Stack:** TypeScript, Node 25 (`node:sqlite`, встроенный — новых зависимостей нет), Vitest, React (только админ-панель).

**Спека:** [docs/superpowers/specs/2026-08-20-game-history-design.md](../specs/2026-08-20-game-history-design.md) — при расхождении плана со спекой правит спека, а расхождение выносится человеку.

## Global Constraints

- **Движок (`server/src/engine.ts`) не меняется вообще.** Ни нового типа `Effect`, ни нового поля `EngineState`, ни нового `EngineEvent`. Если какой-то факт не выводится из пары состояний «до/после» — он откладывается, а не добавляется в движок.
- **Новых зависимостей в `package.json` не добавляется.** База — только встроенный `node:sqlite`.
- **Любая ошибка работы с базой логируется через `console.error` и проглатывается.** Партия обязана продолжаться. Ни один метод `GameHistory` не пробрасывает исключение наружу.
- **Файл базы по умолчанию — `./game-history.db`** (переопределяется переменной окружения `HISTORY_PATH`). Уже покрыт `.gitignore` шаблоном `*.db`.
- **Тумблер записи по умолчанию включён** (`historyEnabled = true`), эфемерный — не входит в `RoomState`, сбрасывается при перезапуске сервера.
- **`historyGameId` входит в `RoomState`** и переживает перезапуск через снапшот; в старых снапшотах его нет и он читается как `null`.
- **Окно для генератора — 5 последних партий**, печатаются только ответы, сгруппированные по темам.
- **Правило повторов: «жёстко — вопрос, мягко — ответ».** Совпадение нормализованного текста вопроса → ненулевой код возврата. Совпадение нормализованного ответа → предупреждение, код возврата 0.
- **Комментарии и сообщения в коде — по-русски**, как во всём остальном сервере.
- **`packs/current.json` и формат пакета не трогаются.**

---

## File Structure

| Файл                                              | Ответственность                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `server/src/history.ts` (создать)                 | База: схема, запись, чтение, нормализация, поиск повторов. Единственное место, знающее про SQL. |
| `server/src/history.test.ts` (создать)            | Тесты модуля на базе `:memory:`.                                                                |
| `server/src/room.ts` (менять)                     | Тумблер, `historyGameId`, обнаружение закрытого вопроса, вызовы рекордера.                      |
| `server/src/snapshot.ts` (менять)                 | Дефолт `historyGameId ?? null` при восстановлении.                                              |
| `server/src/protocol.ts` (менять)                 | Сообщение `admin-set-history-enabled`, поле `historyEnabled` в `state`.                         |
| `server/src/server.ts` (менять)                   | Проводка сообщения и подписка на изменение тумблера.                                            |
| `server/src/index.ts` (менять)                    | Создание `GameHistory` и передача его в `Room`.                                                 |
| `server/scripts/history-recent.ts` (создать)      | Шаг 0 генератора: печать окна.                                                                  |
| `server/scripts/history-check.ts` (создать)       | Шаг 6 генератора: сверка пакета со всей историей.                                               |
| `client/src/useAdminConnection.ts` (менять)       | Состояние тумблера и отправка сообщения.                                                        |
| `client/src/Admin.tsx` (менять)                   | Секция с тумблером.                                                                             |
| `.claude/skills/pack-generator/SKILL.md` (менять) | Инвариант 4, Шаг 0, Шаг 6.                                                                      |
| `.claude/skills/svoya-igra-dev/SKILL.md` (менять) | Уточнение инварианта 5.                                                                         |

---

## Task 1: Модуль истории — схема и запись

**Files:**

- Create: `server/src/history.ts`
- Create: `server/src/history.test.ts`

**Interfaces:**

- Consumes: ничего из предыдущих задач.
- Produces: типы `ParticipantRecord`, `StartGameInput`, `PlayedQuestionInput`, `PlayedQuestionRow`, `GameRow`, интерфейс `HistoryRecorder`, класс `GameHistory`, функция `normalizeForCompare(value: string): string`. Задача 2 использует только `HistoryRecorder` и типы его аргументов; задача 3 — конструктор `new GameHistory(path)` и метод `close()`; задача 4 — `allPlayedQuestions()` и `normalizeForCompare`.

**Замечание про типы `node:sqlite`:** `statement.all()` возвращает объекты с `null`-прототипом, а значения типизованы как union (`string | number | bigint | Uint8Array | null`). Читая колонки, приводить их явно (`row.text as string`, `Number(row.round_index)`), иначе `tsc --noEmit` не пройдёт.

- [ ] **Step 1: Написать падающий тест на нормализацию**

Создать `server/src/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeForCompare } from './history.js';

describe('normalizeForCompare', () => {
  it('приводит регистр, ё и пунктуацию к общему виду', () => {
    expect(normalizeForCompare('Кто написал «Ёлки»?')).toBe('кто написал елки');
  });

  it('схлопывает пробелы и обрезает края', () => {
    expect(normalizeForCompare('  Лев   Толстой  ')).toBe('лев толстой');
  });

  it('считает одинаковыми записи, отличающиеся только оформлением', () => {
    expect(normalizeForCompare('Пётр I')).toBe(normalizeForCompare('петр i'));
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `Failed to resolve import "./history.js"`.

- [ ] **Step 3: Написать нормализацию**

Создать `server/src/history.ts`:

```ts
// Хранилище истории сыгранных партий (design.md,
// 2026-08-20-game-history-design.md). Единственное место в сервере, знающее
// про SQL. Игровой движок сюда не заглядывает вообще — пишет только Room.
import { DatabaseSync } from 'node:sqlite';

/**
 * Приводит текст к виду, в котором его можно сравнивать с другим текстом:
 * нижний регистр, `ё` → `е`, пунктуация → пробел, схлопнутые пробелы.
 *
 * Ловит буквальные и почти-буквальные совпадения. Смысловые повторы («тот же
 * факт другими словами») она не ловит и не должна — за них отвечает окно в
 * Шаге 0 генератора, где решает суждение, а не сравнение строк.
 */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Прогнать тест и убедиться, что он проходит**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS, 3 теста.

- [ ] **Step 5: Написать падающий тест на запись партии**

Дописать в `server/src/history.test.ts`:

```ts
import { GameHistory } from './history.js';

function makeHistory(): GameHistory {
  return new GameHistory(':memory:');
}

const QUESTION = {
  questionId: 'r1-geo-100',
  roundIndex: 0,
  themeName: 'География',
  price: 100,
  type: 'обычный',
  text: 'Столица Австралии?',
  answer: 'Канберра',
  answeredBy: 'Ваня',
  correct: true,
  contested: false,
};

describe('GameHistory', () => {
  it('заводит партию и возвращает её id', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'sport-kino.json',
      packTitle: 'Спорт и кино',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    });
    expect(id).not.toBeNull();
    expect(history.allGames()).toEqual([
      {
        id,
        startedAt: '2026-08-20T18:00:00.000Z',
        packFilename: 'sport-kino.json',
        packTitle: 'Спорт и кино',
        participants: [{ counterId: 'p1', name: 'Ваня' }],
        finalScores: null,
      },
    ]);
  });

  it('записывает сыгранный вопрос со всеми полями', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'sport-kino.json',
      packTitle: 'Спорт и кино',
      participants: [],
    })!;
    history.recordQuestion(id, QUESTION);
    expect(history.allPlayedQuestions()).toEqual([{ gameId: id, ...QUESTION }]);
  });

  it('сохраняет null-поля вопроса, который никто не взял', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, {
      ...QUESTION,
      answeredBy: null,
      correct: null,
      contested: null,
    });
    const [row] = history.allPlayedQuestions();
    expect(row.answeredBy).toBeNull();
    expect(row.correct).toBeNull();
    expect(row.contested).toBeNull();
  });

  it('проставляет итоговый счёт при завершении партии', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.finishGame(id, { p1: 700, p2: 300 });
    expect(history.allGames()[0].finalScores).toEqual({ p1: 700, p2: 300 });
  });

  it('удаляет партию вместе с её вопросами', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, QUESTION);
    history.discardGame(id);
    expect(history.allGames()).toEqual([]);
    expect(history.allPlayedQuestions()).toEqual([]);
  });

  it('не роняет партию, когда база недоступна', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.close();
    expect(() => history.recordQuestion(id, QUESTION)).not.toThrow();
    expect(() =>
      history.startGame({
        startedAt: '2026-08-20T18:00:00.000Z',
        packFilename: 'p.json',
        packTitle: 'П',
        participants: [],
      }),
    ).not.toThrow();
    expect(() => history.finishGame(id, {})).not.toThrow();
    expect(() => history.discardGame(id)).not.toThrow();
    expect(history.allPlayedQuestions()).toEqual([]);
  });
});
```

- [ ] **Step 6: Прогнать тесты и убедиться, что новые падают**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `GameHistory is not exported` / `is not a constructor`.

- [ ] **Step 7: Написать схему, типы и класс**

Дописать в `server/src/history.ts`:

```ts
const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  pack_filename TEXT NOT NULL,
  pack_title    TEXT NOT NULL,
  participants  TEXT NOT NULL,
  final_scores  TEXT
);
CREATE TABLE IF NOT EXISTS played_questions (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  question_id TEXT NOT NULL,
  round_index INTEGER NOT NULL,
  theme_name  TEXT NOT NULL,
  price       INTEGER NOT NULL,
  type        TEXT NOT NULL,
  text        TEXT NOT NULL,
  answer      TEXT NOT NULL,
  answered_by TEXT,
  correct     INTEGER,
  contested   INTEGER
);
`;

export interface ParticipantRecord {
  counterId: string;
  name: string;
}

export interface StartGameInput {
  startedAt: string;
  packFilename: string;
  packTitle: string;
  participants: ParticipantRecord[];
}

export interface PlayedQuestionInput {
  questionId: string;
  // -1 у финального вопроса: он не принадлежит ни одному раунду сетки.
  roundIndex: number;
  themeName: string;
  // 0 у финального вопроса: цены у него нет, ставки делаются каждым отдельно.
  price: number;
  // 'обычный' | 'кот' | 'аукцион' из пакета, либо 'финал' — четвёртое
  // значение нашей колонки, в формате пакета его нет.
  type: string;
  text: string;
  answer: string;
  answeredBy: string | null;
  correct: boolean | null;
  contested: boolean | null;
}

export interface PlayedQuestionRow extends PlayedQuestionInput {
  gameId: number;
}

export interface GameRow {
  id: number;
  startedAt: string;
  packFilename: string;
  packTitle: string;
  participants: ParticipantRecord[];
  finalScores: Record<string, number> | null;
}

/**
 * Узкий интерфейс, который видит Room. Специально не класс: в тестах комнаты
 * подставляется фейк, и ни один тест Room не открывает настоящую базу.
 */
export interface HistoryRecorder {
  startGame(input: StartGameInput): number | null;
  recordQuestion(gameId: number, row: PlayedQuestionInput): void;
  finishGame(gameId: number, finalScores: Record<string, number>): void;
  discardGame(gameId: number): void;
}

function toInt(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function toBool(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Number(value) === 1;
}

export class GameHistory implements HistoryRecorder {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      console.error('История: не удалось закрыть базу —', err);
    }
  }

  startGame(input: StartGameInput): number | null {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO games (started_at, pack_filename, pack_title, participants)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          input.startedAt,
          input.packFilename,
          input.packTitle,
          JSON.stringify(input.participants),
        );
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('История: не удалось начать запись партии —', err);
      return null;
    }
  }

  recordQuestion(gameId: number, row: PlayedQuestionInput): void {
    try {
      this.db
        .prepare(
          `INSERT INTO played_questions
             (game_id, question_id, round_index, theme_name, price, type,
              text, answer, answered_by, correct, contested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gameId,
          row.questionId,
          row.roundIndex,
          row.themeName,
          row.price,
          row.type,
          row.text,
          row.answer,
          row.answeredBy,
          toInt(row.correct),
          toInt(row.contested),
        );
    } catch (err) {
      console.error('История: не удалось записать вопрос —', err);
    }
  }

  finishGame(gameId: number, finalScores: Record<string, number>): void {
    try {
      this.db
        .prepare(`UPDATE games SET final_scores = ? WHERE id = ?`)
        .run(JSON.stringify(finalScores), gameId);
    } catch (err) {
      console.error('История: не удалось записать итог партии —', err);
    }
  }

  discardGame(gameId: number): void {
    try {
      this.db
        .prepare(`DELETE FROM played_questions WHERE game_id = ?`)
        .run(gameId);
      this.db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
    } catch (err) {
      console.error('История: не удалось выбросить партию —', err);
    }
  }

  allGames(): GameRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM games ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        id: Number(row.id),
        startedAt: row.started_at as string,
        packFilename: row.pack_filename as string,
        packTitle: row.pack_title as string,
        participants: JSON.parse(
          row.participants as string,
        ) as ParticipantRecord[],
        finalScores:
          row.final_scores === null
            ? null
            : (JSON.parse(row.final_scores as string) as Record<
                string,
                number
              >),
      }));
    } catch (err) {
      console.error('История: не удалось прочитать список партий —', err);
      return [];
    }
  }

  allPlayedQuestions(): PlayedQuestionRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM played_questions ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        gameId: Number(row.game_id),
        questionId: row.question_id as string,
        roundIndex: Number(row.round_index),
        themeName: row.theme_name as string,
        price: Number(row.price),
        type: row.type as string,
        text: row.text as string,
        answer: row.answer as string,
        answeredBy: (row.answered_by as string | null) ?? null,
        correct: toBool(row.correct),
        contested: toBool(row.contested),
      }));
    } catch (err) {
      console.error('История: не удалось прочитать сыгранные вопросы —', err);
      return [];
    }
  }
}
```

- [ ] **Step 8: Прогнать тесты и убедиться, что они проходят**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS, 9 тестов.

- [ ] **Step 9: Прогнать типы и линтер**

Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`

Expected: обе команды без ошибок.

- [ ] **Step 10: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts
git commit -m "feat: модуль истории партий на node:sqlite — схема и запись"
```

---

## Task 2: Room пишет историю

**Files:**

- Modify: `server/src/room.ts`
- Modify: `server/src/snapshot.ts`
- Test: `server/src/room.test.ts`
- Test: `server/src/snapshot.test.ts`

**Interfaces:**

- Consumes: `HistoryRecorder`, `StartGameInput`, `PlayedQuestionInput` из `server/src/history.ts` (Task 1).
- Produces: пятый необязательный параметр конструктора `new Room(initial?, pack?, lan?, initialPackFilename?, history?)`; поле `historyGameId: number | null` в `RoomState`; методы `getHistoryEnabled(): boolean`, `setHistoryEnabled(enabled: boolean): void`, `onHistoryEnabledChange(listener: (enabled: boolean) => void): () => void`. Задача 3 использует ровно эти три метода и пятый параметр конструктора.

**Как определяются поля записи (вывод только из пары состояний, движок не трогаем):**

- `answeredBy` — `buzzedCounterId` из состояния «до»: тот, кто отвечал в момент закрытия вопроса. `null`, если вопрос закрылся по таймауту.
- `correct` — по знаку изменения счёта отвечавшего между «до» и «после». Ноль означает «вердикта не было» (ведущий отменил вопрос) и даёт `null`.
- `contested` — по голосам. `null`, если судил ведущий (`hostId !== null`) или голосов не было вовсе. Голоса берутся из состояния «до» **плюс текущее событие, если это `vote`**: последний голос, который и запускает подсчёт, в состоянии «до» ещё не лежит, а в состоянии «после» уже стёрт.

- [ ] **Step 1: Написать падающие тесты записи**

Дописать в `server/src/room.test.ts`:

```ts
import type {
  HistoryRecorder,
  PlayedQuestionInput,
  StartGameInput,
} from './history.js';

interface FakeHistory extends HistoryRecorder {
  games: StartGameInput[];
  questions: { gameId: number; row: PlayedQuestionInput }[];
  finished: { gameId: number; scores: Record<string, number> }[];
  discarded: number[];
}

function fakeHistory(): FakeHistory {
  const fake: FakeHistory = {
    games: [],
    questions: [],
    finished: [],
    discarded: [],
    startGame(input) {
      fake.games.push(input);
      return fake.games.length;
    },
    recordQuestion(gameId, row) {
      fake.questions.push({ gameId, row });
    },
    finishGame(gameId, scores) {
      fake.finished.push({ gameId, scores });
    },
    discardGame(gameId) {
      fake.discarded.push(gameId);
    },
  };
  return fake;
}
```

Затем свои хелперы и тесты. `TEST_PACK` и `joinedId()` уже есть в этом файле — переиспользовать их, не заводя своих копий. Вопрос `'q1'` в `TEST_PACK` — первый вопрос темы `'Тема'`, цена 100, текст `'Вопрос 1?'`.

```ts
function roomWithHistory(history?: HistoryRecorder): Room {
  const room = new Room(undefined, TEST_PACK, undefined, 'test.json', history);
  joinedId(room, 'Ваня');
  joinedId(room, 'Катя');
  return room;
}

function pickerOf(room: Room): string {
  return room.toGameStateView()!.turnParticipantId!;
}

// Выбрать вопрос и дать ему истечь по таймауту — самый короткий путь до
// закрытия вопроса, не требующий ни нажатия, ни судейства.
function playQuestionToTimeout(room: Room): void {
  vi.useFakeTimers();
  try {
    room.selectQuestion(pickerOf(room), 0, 'q1');
    vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS);
    vi.advanceTimersByTime(QUESTION_TIMER_MS);
  } finally {
    vi.useRealTimers();
  }
}

describe('Room: история партий', () => {
  it('заводит партию в истории при старте', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    expect(history.games).toHaveLength(1);
    expect(history.games[0].packFilename).toBe('test.json');
    expect(history.games[0].participants).toHaveLength(2);
    expect(room.getState().historyGameId).toBe(1);
  });

  it('не пишет ничего, пока тумблер выключен', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.setHistoryEnabled(false);
    room.startGame('requester');
    playQuestionToTimeout(room);
    expect(history.games).toEqual([]);
    expect(history.questions).toEqual([]);
    expect(room.getState().historyGameId).toBeNull();
  });

  it('записывает закрывшийся вопрос', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    playQuestionToTimeout(room);
    expect(history.questions).toHaveLength(1);
    expect(history.questions[0].gameId).toBe(1);
    expect(history.questions[0].row).toMatchObject({
      questionId: 'q1',
      roundIndex: 0,
      themeName: 'Тема',
      price: 100,
      text: 'Вопрос 1?',
      // Никто не нажал — вердикта не было, спора тоже.
      answeredBy: null,
      correct: null,
      contested: null,
    });
  });

  it('выбрасывает партию, когда тумблер выключают посреди неё', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    playQuestionToTimeout(room);
    room.setHistoryEnabled(false);
    expect(history.discarded).toEqual([1]);
    expect(room.getState().historyGameId).toBeNull();
  });

  it('не начинает запись заново, если тумблер включить обратно в той же партии', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    room.setHistoryEnabled(false);
    room.setHistoryEnabled(true);
    playQuestionToTimeout(room);
    expect(history.games).toHaveLength(1);
    expect(history.questions).toEqual([]);
    expect(room.getState().historyGameId).toBeNull();
  });

  it('работает без рекордера вообще', () => {
    const room = roomWithHistory(undefined);
    room.startGame('requester');
    expect(() => playQuestionToTimeout(room)).not.toThrow();
    expect(room.getState().historyGameId).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тесты и убедиться, что они падают**

Run: `pnpm -C server exec vitest run src/room.test.ts`

Expected: FAIL — `room.setHistoryEnabled is not a function`.

- [ ] **Step 3: Добавить поле в `RoomState` и в снапшот**

В `server/src/room.ts`, в `interface RoomState`:

```ts
// Id строки этой партии в истории (history.ts). Часть RoomState, а не
// эфемерное поле, именно потому, что снапшот переживает перезапуск
// сервера: без этого после перезапуска посреди партии в базе появилась бы
// ВТОРАЯ строка games для той же самой партии. null означает «эта партия
// не пишется» — в том числе для снапшотов, записанных до появления фичи.
historyGameId: number | null;
```

В `getState()`:

```ts
      historyGameId: this.historyGameId,
```

В `server/src/snapshot.ts`, рядом с `hostParticipantId`:

```ts
    // История партий (2026-08-20) появилась позже — снапшоты, записанные до
    // неё, этого поля не содержат.
    historyGameId: parsed.historyGameId ?? null,
```

- [ ] **Step 4: Добавить поля, тумблер и конструктор в Room**

В `server/src/room.ts` рядом с прочими эфемерными настройками:

```ts
  // Писать ли эту партию в историю (design.md,
  // 2026-08-20-game-history-design.md, «Тумблер»). Эфемерный, как
  // textRevealEnabled: не часть RoomState, после перезапуска сервера
  // возвращается во «включено». Значит «эта партия в истории?», а не «пишем
  // ли прямо сейчас» — выключение выбрасывает уже записанное.
  private historyEnabled = true;
  private historyEnabledListeners = new Set<(enabled: boolean) => void>();
  private history?: HistoryRecorder;
  private historyGameId: number | null;
```

Импорт в шапке файла:

```ts
import type { HistoryRecorder, PlayedQuestionInput } from './history.js';
```

Конструктор — пятый необязательный параметр и инициализация поля:

```ts
  constructor(
    initial?: RoomState,
    pack?: Pack,
    lan?: LanInfo,
    initialPackFilename?: string,
    history?: HistoryRecorder,
  ) {
```

и в теле, рядом с `this.hostParticipantId = ...`:

```ts
this.history = history;
this.historyGameId = initial?.historyGameId ?? null;
```

Методы тумблера — рядом с `getTextRevealEnabled`/`setTextRevealEnabled`:

```ts
  getHistoryEnabled(): boolean {
    return this.historyEnabled;
  }

  // Выключение не просто останавливает запись, а выбрасывает уже записанное
  // этой партией: тумблер отвечает на вопрос «эта партия в истории?».
  // Обратной операции нет — historyGameId обнуляется вместе с удалением, так
  // что повторное включение в той же партии записи не возобновляет. Это
  // намеренно (design.md, «Тумблер»), а не недосмотр.
  setHistoryEnabled(enabled: boolean): void {
    this.historyEnabled = enabled;
    if (!enabled && this.historyGameId !== null) {
      this.history?.discardGame(this.historyGameId);
      this.historyGameId = null;
    }
    for (const listener of this.historyEnabledListeners) {
      listener(this.historyEnabled);
    }
  }

  onHistoryEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.historyEnabledListeners.add(listener);
    return () => this.historyEnabledListeners.delete(listener);
  }
```

- [ ] **Step 5: Заводить партию в истории при старте**

В `startGame()`, сразу после `this.game = createInitialState(this.pack, counterIds, hostId);`:

```ts
this.historyGameId =
  this.historyEnabled && this.history
    ? this.history.startGame({
        startedAt: new Date().toISOString(),
        packFilename: this.activePackFilename ?? 'неизвестный-пакет',
        packTitle: this.pack.title,
        participants: counters.map((p) => ({
          counterId: p.id,
          name: p.name,
        })),
      })
    : null;
```

В `resetGame()` и `resetRoom()`, рядом с `this.game = null;`:

```ts
// Партия брошена, но её вопросы игроки видели — из истории они не
// удаляются. Обнуляем только ссылку, чтобы следующая партия завела свою
// строку, а не дописывалась в брошенную.
this.historyGameId = null;
```

- [ ] **Step 6: Записывать закрывшийся вопрос из `dispatch()`**

В `dispatch()` дописать захват «до» рядом с уже существующими `buzzedBefore`/`phaseBefore`:

```ts
const answeredCountBefore = this.game.answeredQuestionIds.length;
const questionBefore = this.game.currentQuestion;
const roundIndexBefore = this.game.roundIndex;
const scoresBefore = this.game.scores;
const hostIdBefore = this.game.hostId;
// Голоса из состояния «до» ПЛЮС текущее событие, если это голос:
// последний голос, который и запускает подсчёт, в «до» ещё не лежит, а в
// «после» уже стёрт revealQuestion. Через таймер голосования события
// 'vote' нет, и тогда состояние «до» уже полное.
const votesAtResolution =
  event.type === 'vote'
    ? { ...this.game.votes, [event.counterId]: event.correct }
    : this.game.votes;
```

После `this.applyEffects(...)` и перед `this.notify()`:

```ts
if (state.answeredQuestionIds.length > answeredCountBefore) {
  this.recordPlayedQuestion(
    state,
    questionBefore,
    roundIndexBefore,
    scoresBefore,
    hostIdBefore,
    votesAtResolution,
    buzzedBefore,
  );
}
if (phaseBefore !== 'final-reveal' && state.phase === 'final-reveal') {
  this.recordFinalQuestion(state);
}
if (phaseBefore !== 'game-end' && state.phase === 'game-end') {
  if (this.historyGameId !== null) {
    this.history?.finishGame(this.historyGameId, state.scores);
  }
}
```

И сами методы — рядом с `computeTextRevealMs`:

```ts
  private recordPlayedQuestion(
    state: EngineState,
    questionBefore: EngineState['currentQuestion'],
    roundIndexBefore: number,
    scoresBefore: Record<string, number>,
    hostIdBefore: string | null,
    votes: Record<string, boolean>,
    buzzedBefore: string | null,
  ): void {
    if (this.historyGameId === null || !this.history || !questionBefore) return;
    const question = findQuestion(
      state.pack,
      roundIndexBefore,
      questionBefore.themeIndex,
      questionBefore.questionId,
    );
    if (!question) return;
    const themeName =
      state.pack.rounds[roundIndexBefore]?.themes[questionBefore.themeIndex]
        ?.name ?? '';
    // Верность выводится по знаку изменения счёта отвечавшего: верный ответ
    // добавляет цену (у аукциона — ставку), неверный вычитает её. Ровно ноль
    // означает, что вердикта не было вовсе — ведущий отменил вопрос.
    const delta =
      buzzedBefore === null
        ? 0
        : (state.scores[buzzedBefore] ?? 0) - (scoresBefore[buzzedBefore] ?? 0);
    const voteValues = Object.values(votes);
    const row: PlayedQuestionInput = {
      questionId: question.id,
      roundIndex: roundIndexBefore,
      themeName,
      price: question.price,
      type: question.type,
      text: question.text,
      answer: question.answer,
      answeredBy: buzzedBefore === null ? null : this.nameOf(buzzedBefore),
      correct: buzzedBefore === null || delta === 0 ? null : delta > 0,
      // Спорным считается несогласие голосующих между собой. При ведущем
      // голосования нет вовсе — тогда null, а не false: «не было спора» и
      // «не было голосования» это разные вещи, и слайс B не должен их путать.
      contested:
        hostIdBefore !== null || voteValues.length === 0
          ? null
          : voteValues.some((v) => v !== voteValues[0]),
    };
    this.history.recordQuestion(this.historyGameId, row);
  }

  // Финальный вопрос не проходит через answeredQuestionIds — он вообще не из
  // сетки раундов. Отвечают его все сразу и каждый со своей ставкой, поэтому
  // персональных полей у строки нет: для антиповтора важны текст и ответ, а
  // разбор вердиктов по игрокам — это уже слайс B/D.
  private recordFinalQuestion(state: EngineState): void {
    if (this.historyGameId === null || !this.history) return;
    const themeIndex = state.finalThemeIndex;
    if (themeIndex === null) return;
    const theme = state.pack.final?.themes[themeIndex];
    if (!theme) return;
    this.history.recordQuestion(this.historyGameId, {
      questionId: theme.question.id,
      roundIndex: -1,
      themeName: theme.name,
      price: 0,
      type: 'финал',
      text: theme.question.text,
      answer: theme.question.answer,
      answeredBy: null,
      correct: null,
      contested: null,
    });
  }
```

`nameOf(counterId)` — если в `room.ts` уже есть способ получить имя участника по id, использовать его; если нет, добавить приватный метод:

```ts
  private nameOf(participantId: string): string | null {
    return this.participants.find((p) => p.id === participantId)?.name ?? null;
  }
```

- [ ] **Step 7: Прогнать тесты Room и снапшота**

Run: `pnpm -C server exec vitest run src/room.test.ts src/snapshot.test.ts`

Expected: PASS — новые тесты истории зелёные, все существующие тесты по-прежнему зелёные.

- [ ] **Step 8: Добавить тест снапшота на дефолт**

Дописать в `server/src/snapshot.test.ts`:

```ts
it('восстанавливает historyGameId как null в снапшоте без этого поля', () => {
  const state = deserializeSnapshot(
    JSON.stringify({ participants: [], game: null }),
  );
  expect(state.historyGameId).toBeNull();
});
```

- [ ] **Step 9: Прогнать весь серверный набор**

Run: `pnpm -C server exec vitest run`
Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`

Expected: все три без ошибок.

- [ ] **Step 10: Коммит**

```bash
git add server/src/room.ts server/src/room.test.ts server/src/snapshot.ts server/src/snapshot.test.ts
git commit -m "feat: комната пишет сыгранные вопросы в историю"
```

---

## Task 3: Тумблер в админке и подключение настоящей базы

**Files:**

- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/index.ts`
- Modify: `client/src/useAdminConnection.ts`
- Modify: `client/src/Admin.tsx`
- Test: `server/src/server.test.ts`
- Test: `client/src/Admin.test.tsx`

**Interfaces:**

- Consumes: `GameHistory` (конструктор `new GameHistory(path)`, метод `close()`) из Task 1; `getHistoryEnabled()`, `setHistoryEnabled()`, `onHistoryEnabledChange()` и пятый параметр конструктора `Room` из Task 2.
- Produces: сообщение `{ type: 'admin-set-history-enabled'; enabled: boolean }` и поле `historyEnabled: boolean` в сообщении `state`. Задача 4 ничего отсюда не использует.

- [ ] **Step 1: Написать падающий серверный тест**

Дописать в `server/src/server.test.ts` рядом с существующим тестом `admin-set-text-reveal-enabled ...`, в том же `describe` и с тем же хелпером `connectAdmin(url)`:

```ts
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
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/server.test.ts`

Expected: FAIL — `room.getHistoryEnabled()` вернёт `true`, `message.historyEnabled` будет `undefined`.

- [ ] **Step 3: Расширить протокол**

В `server/src/protocol.ts`, в union `ClientMessage` рядом с `admin-set-text-reveal-enabled`:

```ts
  | { type: 'admin-set-history-enabled'; enabled: boolean }
```

В варианте `state` сообщения `StateMessage`, рядом с `textRevealEnabled`:

```ts
// Пишется ли текущая партия в историю (room.ts, Room.historyEnabled).
historyEnabled: boolean;
```

- [ ] **Step 4: Провести сообщение через сервер**

В `server/src/server.ts`, в `stateMessageFor`, рядом с `textRevealEnabled`:

```ts
      historyEnabled: room.getHistoryEnabled(),
```

Рядом с подписками:

```ts
room.onHistoryEnabledChange(broadcastState);
```

В обработчике сообщений, рядом с веткой `admin-set-text-reveal-enabled`:

```ts
if (
  message.type === 'admin-set-history-enabled' &&
  typeof message.enabled === 'boolean'
) {
  room.setHistoryEnabled(message.enabled);
}
```

- [ ] **Step 5: Прогнать серверный тест**

Run: `pnpm -C server exec vitest run src/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Подключить настоящую базу в `index.ts`**

В `server/src/index.ts`, рядом с прочими константами путей:

```ts
const HISTORY_PATH = process.env.HISTORY_PATH ?? './game-history.db';
```

Импорт:

```ts
import { GameHistory } from './history.js';
```

Перед `new Room(...)`:

```ts
// Битая или недоступная база не должна мешать серверу подняться — история
// побочная функция, партия важнее её всегда (design.md,
// 2026-08-20-game-history-design.md, «Отказы не ломают партию»).
let history: GameHistory | undefined;
try {
  history = new GameHistory(HISTORY_PATH);
} catch (err) {
  console.error(
    `Не удалось открыть историю партий ${HISTORY_PATH}, играем без записи:`,
    err,
  );
}
```

И пятым аргументом в конструктор `new Room(...)` — `history`.

- [ ] **Step 7: Написать падающий тест админки**

Дописать в `client/src/Admin.test.tsx`. В этом файле `useAdminConnection` замокан, а хелпер `connection(overrides)` собирает объект соединения целиком — в него нужно добавить два новых поля (`historyEnabled: true`, `setHistoryEnabled: vi.fn()`) рядом с `textRevealEnabled`/`setTextRevealEnabled`, иначе `tsc` не пропустит.

```ts
it('переключение записи истории вызывает setHistoryEnabled', async () => {
  const setHistoryEnabled = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({ historyEnabled: true, setHistoryEnabled }),
  );
  render(<Admin />);

  await userEvent.click(
    screen.getByLabelText('Записывать эту партию в историю'),
  );

  expect(setHistoryEnabled).toHaveBeenCalledWith(false);
});
```

Если в файле уже принят другой способ вызывать клики (`user` из `userEvent.setup()` вместо прямого `userEvent.click`) — использовать тот, который там уже применяется, а не вводить второй.

- [ ] **Step 8: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/Admin.test.tsx`

Expected: FAIL — элемента с такой подписью нет.

- [ ] **Step 9: Расширить `useAdminConnection`**

В `client/src/useAdminConnection.ts` добавить, повторяя всё, что уже сделано для `textRevealEnabled`, во всех пяти местах:

```ts
// 1) в типе входящего сообщения state:
      historyEnabled: boolean;

// 2) в union ClientMessage:
  | { type: 'admin-set-history-enabled'; enabled: boolean }

// 3) в интерфейсе AdminConnection:
  historyEnabled: boolean;
  setHistoryEnabled: (enabled: boolean) => void;

// 4) рядом с прочим локальным состоянием:
  const [historyEnabled, setHistoryEnabledState] = useState(true);

// 5) в обработчике сообщения state:
          setHistoryEnabledState(message.historyEnabled);

// 6) в возвращаемом объекте:
    historyEnabled,
    setHistoryEnabled: (enabled: boolean) =>
      send({ type: 'admin-set-history-enabled', enabled }),
```

- [ ] **Step 10: Добавить секцию в `Admin.tsx`**

В `client/src/Admin.tsx` добавить секцию (взять `historyEnabled` и `setHistoryEnabled` из `useAdminConnection`, там же, где берутся `textRevealEnabled`/`setTextRevealEnabled`):

```tsx
<section className="admin-section">
  <h2>История партий</h2>
  <p>
    <label>
      <input
        type="checkbox"
        checked={historyEnabled}
        onChange={(e) => setHistoryEnabled(e.target.checked)}
      />{' '}
      Записывать эту партию в историю
    </label>
  </p>
  <p>
    Сыгранные вопросы попадают в историю, и генератор пакетов перестаёт их
    повторять. Выключить стоит перед тестовым прогоном: выключение не просто
    останавливает запись, а выбрасывает всё, что эта партия уже успела записать.
    Обратно включить в той же партии нельзя — она уже выброшена.
  </p>
</section>
```

- [ ] **Step 11: Прогнать клиентские тесты**

Run: `pnpm -C client exec vitest run`
Run: `pnpm -C client typecheck`
Run: `pnpm -C client lint`

Expected: все три без ошибок.

- [ ] **Step 12: Прогнать серверные тесты**

Run: `pnpm -C server exec vitest run`
Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`

Expected: все три без ошибок.

- [ ] **Step 13: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts server/src/index.ts client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Admin.test.tsx
git commit -m "feat: тумблер записи истории в админке и подключение базы"
```

---

## Task 4: Чтение истории генератором

**Files:**

- Modify: `server/src/history.ts`
- Modify: `server/src/history.test.ts`
- Create: `server/scripts/history-recent.ts`
- Create: `server/scripts/history-check.ts`
- Modify: `.claude/skills/pack-generator/SKILL.md`
- Modify: `.claude/skills/svoya-igra-dev/SKILL.md`

**Interfaces:**

- Consumes: `GameHistory`, `PlayedQuestionRow`, `normalizeForCompare` из Task 1; тип `Pack` из `server/src/pack.ts`.
- Produces: `recentPlayed(gameLimit: number): PlayedQuestionRow[]` на классе `GameHistory`, чистые функции `formatRecentWindow(rows: PlayedQuestionRow[]): string` и `findRepeats(pack: Pack, history: PlayedQuestionRow[]): RepeatReport`. Дальнейших задач нет.

- [ ] **Step 1: Написать падающий тест окна**

Дописать в `server/src/history.test.ts`:

```ts
import { formatRecentWindow, type PlayedQuestionRow } from './history.js';

const row = (
  themeName: string,
  answer: string,
  gameId = 1,
): PlayedQuestionRow => ({
  gameId,
  questionId: 'q',
  roundIndex: 0,
  themeName,
  price: 100,
  type: 'обычный',
  text: 'вопрос',
  answer,
  answeredBy: null,
  correct: null,
  contested: null,
});

describe('formatRecentWindow', () => {
  it('группирует ответы по темам, по строке на тему', () => {
    const text = formatRecentWindow([
      row('Кино 90-х', 'Тарантино'),
      row('География', 'Канберра'),
      row('Кино 90-х', 'Матрица'),
    ]);
    expect(text).toBe('Кино 90-х: Тарантино, Матрица\nГеография: Канберра');
  });

  it('не повторяет один и тот же ответ внутри темы', () => {
    const text = formatRecentWindow([
      row('Кино 90-х', 'Тарантино'),
      row('Кино 90-х', 'Тарантино', 2),
    ]);
    expect(text).toBe('Кино 90-х: Тарантино');
  });

  it('на пустой истории возвращает пустую строку', () => {
    expect(formatRecentWindow([])).toBe('');
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `formatRecentWindow is not exported`.

- [ ] **Step 3: Написать `formatRecentWindow` и `recentPlayed`**

Дописать в `server/src/history.ts`:

```ts
/**
 * Окно для Шага 0 генератора: только ответы, сгруппированные по темам.
 *
 * Текст вопроса сюда намеренно не попадает — увидев «Тарантино» в теме про
 * кино, генератор и так не станет писать про Тарантино второй раз, а полный
 * текст стоил бы примерно вшестеро больше токенов без выигрыша в результате
 * (design.md, 2026-08-20-game-history-design.md, «Окно»).
 */
export function formatRecentWindow(rows: PlayedQuestionRow[]): string {
  const byTheme = new Map<string, string[]>();
  for (const row of rows) {
    const answers = byTheme.get(row.themeName) ?? [];
    if (!answers.includes(row.answer)) answers.push(row.answer);
    byTheme.set(row.themeName, answers);
  }
  return [...byTheme.entries()]
    .map(([theme, answers]) => `${theme}: ${answers.join(', ')}`)
    .join('\n');
}
```

И метод на классе `GameHistory`:

```ts
  /**
   * Вопросы последних `gameLimit` партий. Ограничение по партиям, а не по
   * числу строк: окно не должно расти вместе с базой.
   */
  recentPlayed(gameLimit: number): PlayedQuestionRow[] {
    try {
      const ids = this.db
        .prepare(`SELECT id FROM games ORDER BY id DESC LIMIT ?`)
        .all(gameLimit) as Record<string, unknown>[];
      const recent = new Set(ids.map((row) => Number(row.id)));
      return this.allPlayedQuestions().filter((row) => recent.has(row.gameId));
    } catch (err) {
      console.error('История: не удалось прочитать последние партии —', err);
      return [];
    }
  }
```

- [ ] **Step 4: Прогнать и убедиться, что проходит**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS.

- [ ] **Step 5: Написать падающий тест поиска повторов**

Дописать в `server/src/history.test.ts`:

```ts
import { findRepeats } from './history.js';
import type { Pack } from './pack.js';

const packWith = (text: string, answer: string): Pack => ({
  title: 'Т',
  author: 'а',
  createdAt: '2026-08-20',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            { id: 'r1-t-100', price: 100, text, answer, type: 'обычный' },
          ],
        },
      ],
    },
  ],
});

describe('findRepeats', () => {
  it('находит буквально тот же вопрос', () => {
    const report = findRepeats(packWith('Столица Австралии?', 'Канберра'), [
      { ...row('География', 'Канберра'), text: 'столица австралии' },
    ]);
    expect(report.sameQuestion).toHaveLength(1);
    expect(report.sameQuestion[0].questionId).toBe('r1-t-100');
    expect(report.sameAnswer).toHaveLength(0);
  });

  it('находит тот же ответ при другом вопросе', () => {
    const report = findRepeats(
      packWith('Какой город стал столицей Австралии в 1913 году?', 'Канберра'),
      [{ ...row('География', 'Канберра'), text: 'столица австралии' }],
    );
    expect(report.sameQuestion).toHaveLength(0);
    expect(report.sameAnswer).toHaveLength(1);
    expect(report.sameAnswer[0].previous.answer).toBe('Канберра');
  });

  it('проверяет и финальные вопросы пакета', () => {
    const pack = packWith('Новый вопрос', 'Новый ответ');
    pack.final = {
      themes: [
        {
          name: 'Финал',
          question: { id: 'final-x', text: 'Ф', answer: 'Канберра' },
        },
      ],
    };
    const report = findRepeats(pack, [row('География', 'Канберра')]);
    expect(report.sameAnswer.map((f) => f.questionId)).toEqual(['final-x']);
  });

  it('на чистом пакете не находит ничего', () => {
    const report = findRepeats(packWith('Совсем новое?', 'Новое'), [
      row('География', 'Канберра'),
    ]);
    expect(report.sameQuestion).toEqual([]);
    expect(report.sameAnswer).toEqual([]);
  });
});
```

- [ ] **Step 6: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `findRepeats is not exported`.

- [ ] **Step 7: Написать `findRepeats`**

Дописать в `server/src/history.ts` (импорт типа `Pack` — `import type { Pack } from './pack.js';`):

```ts
export interface RepeatFinding {
  questionId: string;
  text: string;
  answer: string;
  previous: { text: string; answer: string };
}

export interface RepeatReport {
  sameQuestion: RepeatFinding[];
  sameAnswer: RepeatFinding[];
}

interface PackQuestion {
  id: string;
  text: string;
  answer: string;
}

// Все вопросы пакета одним списком — и сетка раундов, и финальные темы.
// Финал проверяется наравне с остальными: это самый памятный вопрос вечера,
// и повторить его было бы обиднее всего.
function eachQuestion(pack: Pack): PackQuestion[] {
  const questions: PackQuestion[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        questions.push({
          id: question.id,
          text: question.text,
          answer: question.answer,
        });
      }
    }
  }
  for (const theme of pack.final?.themes ?? []) {
    questions.push({
      id: theme.question.id,
      text: theme.question.text,
      answer: theme.question.answer,
    });
  }
  return questions;
}

/**
 * Сверяет пакет со ВСЕЙ переданной историей.
 *
 * Правило «жёстко — вопрос, мягко — ответ» (design.md,
 * 2026-08-20-game-history-design.md, «Сверка»): совпадение вопроса —
 * безусловный брак, совпадение ответа — предупреждение. Жёсткий запрет на
 * повтор ответа не годится: 50 вопросов за партию, через двадцать партий
 * тысяча фактов оказалась бы выкошена, и генератор начал бы писать всё более
 * натянутые вопросы.
 *
 * Вопрос, попавший в sameQuestion, в sameAnswer уже не повторяется: одно и то
 * же место чинится один раз, а два сообщения про него только запутали бы.
 */
export function findRepeats(
  pack: Pack,
  history: PlayedQuestionRow[],
): RepeatReport {
  const byText = new Map<string, PlayedQuestionRow>();
  const byAnswer = new Map<string, PlayedQuestionRow>();
  for (const row of history) {
    const text = normalizeForCompare(row.text);
    const answer = normalizeForCompare(row.answer);
    if (!byText.has(text)) byText.set(text, row);
    if (!byAnswer.has(answer)) byAnswer.set(answer, row);
  }
  const report: RepeatReport = { sameQuestion: [], sameAnswer: [] };
  for (const question of eachQuestion(pack)) {
    const previousByText = byText.get(normalizeForCompare(question.text));
    if (previousByText) {
      report.sameQuestion.push({
        questionId: question.id,
        text: question.text,
        answer: question.answer,
        previous: {
          text: previousByText.text,
          answer: previousByText.answer,
        },
      });
      continue;
    }
    const previousByAnswer = byAnswer.get(normalizeForCompare(question.answer));
    if (previousByAnswer) {
      report.sameAnswer.push({
        questionId: question.id,
        text: question.text,
        answer: question.answer,
        previous: {
          text: previousByAnswer.text,
          answer: previousByAnswer.answer,
        },
      });
    }
  }
  return report;
}
```

- [ ] **Step 8: Прогнать тесты модуля**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS, все тесты файла.

- [ ] **Step 9: Написать скрипт окна**

Создать `server/scripts/history-recent.ts`:

```ts
// Тонкая CLI-обёртка над GameHistory.recentPlayed()/formatRecentWindow() —
// Шаг 0 генератора пакетов (.claude/skills/pack-generator/). Отдельного теста
// нет по той же причине, что и у validate-pack.ts: здесь только argv/IO
// вокруг уже протестированных функций.
import { GameHistory, formatRecentWindow } from '../src/history.js';

const RECENT_GAMES = 5;

const path = process.env.HISTORY_PATH ?? '../game-history.db';

let history: GameHistory;
try {
  history = new GameHistory(path);
} catch (err) {
  console.error(
    `${path}: не удалось открыть историю — ${(err as Error).message}`,
  );
  process.exit(1);
}

const rows = history.recentPlayed(RECENT_GAMES);
history.close();

if (rows.length === 0) {
  console.log(
    'История пуста — сыгранных партий ещё нет, повторяться пока не с чем.',
  );
} else {
  console.log(
    `Уже игралось за последние ${RECENT_GAMES} партий (${rows.length} вопрос(ов)) — не повторять эти факты:`,
  );
  console.log(formatRecentWindow(rows));
}
```

- [ ] **Step 10: Написать скрипт сверки**

Создать `server/scripts/history-check.ts`:

```ts
// Тонкая CLI-обёртка над findRepeats() — Шаг 6 генератора пакетов
// (.claude/skills/pack-generator/). Отдельного теста нет по той же причине,
// что и у validate-pack.ts: здесь только argv/IO вокруг уже протестированной
// функции.
//
// Намеренно отдельный скрипт, а не флаг внутри validate-pack.ts: валидатор
// проверяет ФОРМАТ, а пакет с повтором формально валиден — и валидатор должен
// оставаться пригодным на машине, где базы истории нет вовсе.
import { readFile } from 'node:fs/promises';
import { GameHistory, findRepeats } from '../src/history.js';
import { validatePack } from '../src/pack.js';

const path = process.argv[2];
if (!path) {
  console.error(
    'Использование (из директории server/): npx tsx scripts/history-check.ts <путь-к-файлу>',
  );
  process.exit(1);
}

let pack;
try {
  pack = validatePack(JSON.parse(await readFile(path, 'utf-8')));
} catch (err) {
  console.error(
    `${path}: не удалось прочитать пакет — ${(err as Error).message}`,
  );
  process.exit(1);
}

const historyPath = process.env.HISTORY_PATH ?? '../game-history.db';
let history: GameHistory;
try {
  history = new GameHistory(historyPath);
} catch (err) {
  console.error(
    `${historyPath}: не удалось открыть историю — ${(err as Error).message}`,
  );
  process.exit(1);
}

const report = findRepeats(pack, history.allPlayedQuestions());
history.close();

for (const finding of report.sameAnswer) {
  console.warn(
    `⚠ ${finding.questionId}: ответ «${finding.answer}» уже был — ` +
      `тогда спрашивали «${finding.previous.text}». Переписать вопрос или ` +
      `явно объяснить, почему он остаётся.`,
  );
}

for (const finding of report.sameQuestion) {
  console.error(
    `✗ ${finding.questionId}: этот вопрос уже игрался — «${finding.previous.text}» ` +
      `(ответ «${finding.previous.answer}»). Переписать обязательно.`,
  );
}

if (report.sameQuestion.length > 0) {
  process.exit(1);
}

console.log(
  `OK: ${path} — повторов сыгранных вопросов нет` +
    (report.sameAnswer.length > 0
      ? `, но ${report.sameAnswer.length} предупреждени(й) по повторам ответов выше`
      : ''),
);
```

- [ ] **Step 11: Проверить скрипты вручную**

Run: `pnpm -C server exec tsx scripts/history-recent.ts`

Expected: `История пуста — сыгранных партий ещё нет, повторяться пока не с чем.` (базы ещё нет, она создастся пустой).

Run: `pnpm -C server exec tsx scripts/history-check.ts ../packs/current.json`

Expected: `OK: ../packs/current.json — повторов сыгранных вопросов нет`, код возврата 0.

- [ ] **Step 12: Переписать инвариант 4 в SKILL генератора**

В `.claude/skills/pack-generator/SKILL.md` заменить пункт 4 в «Пяти инвариантах» на:

```markdown
4. **История прошлых партий теперь есть — и её обязательно надо учитывать.** Раньше здесь
   стоял ровно обратный запрет («никакой памяти о прошлых партиях»), и он снят с появлением
   базы истории (`docs/superpowers/specs/2026-08-20-game-history-design.md`). Что нужно знать:
   генератор **обязан** прочитать окно последних партий (Шаг 0) и **обязан** прогнать сверку
   готового пакета (Шаг 6). Чего по-прежнему нельзя — **выдумывать** историю, которой нет в
   базе: если скрипт сказал «история пуста», значит она пуста, и подстраиваться не под что.
```

- [ ] **Step 13: Дополнить Шаг 0 и Шаг 6 в SKILL генератора**

В `.claude/skills/pack-generator/SKILL.md` дописать в конец «Шаг 0»:

```markdown
### Шаг 0б. Прочитать, что уже игралось

Прогнать (из корня репозитория):

    pnpm -C server exec tsx scripts/history-recent.ts

Скрипт печатает ответы последних пяти сыгранных партий, сгруппированные по темам. Эти факты
**не повторять** — ни тем же вопросом, ни другим вопросом про то же самое. Печатаются только
ответы, а не тексты вопросов: этого достаточно, чтобы понять, о чём уже спрашивали.

Если напечатано «История пуста» — партий ещё не было, ограничений с этой стороны нет.
```

И дописать в «Шаг 6» новым подпунктом после прогона `validate-pack.ts`:

```markdown
4. Прогнать сверку с историей (из корня репозитория):
   `pnpm -C server exec tsx scripts/history-check.ts ../packs/<slug>.json`
   - Строка `✗` — **вопрос уже игрался**, переписать обязательно, затем прогнать сверку снова.
     Скрипт при этом возвращает ненулевой код — пакет не готов.
   - Строка `⚠` — **уже игрался тот же ответ** при другом вопросе. Это не брак автоматически:
     разобрать каждое предупреждение и либо переписать вопрос, либо явно сказать человеку в
     отчёте (Шаг 7), почему этот повтор ответа допустим. Молча проигнорировать — нельзя.
   - Пусто/`OK` — идти дальше.
```

- [ ] **Step 14: Уточнить инвариант 5 в SKILL проекта**

В `.claude/skills/svoya-igra-dev/SKILL.md`, в конец раздела «5. Генератор и игра связаны только форматом файла», дописать:

```markdown
**Уточнение (2026-08-20, история партий).** У связи появилось обратное направление: игра
пишет историю сыгранного, генератор её читает. Инвариант это не нарушает и остаётся в силе —
сервер по-прежнему ничего не импортирует из генератора, а генератор ничего не импортирует из
сервера: он запускает скрипт и читает его вывод, ровно как уже делает с `validate-pack.ts`.
См. `docs/superpowers/specs/2026-08-20-game-history-design.md`.
```

- [ ] **Step 15: Прогнать всё**

Run: `pnpm -C server exec vitest run`
Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`
Run: `pnpm -C server build`

Expected: все четыре без ошибок.

- [ ] **Step 16: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts server/scripts/history-recent.ts server/scripts/history-check.ts .claude/skills/pack-generator/SKILL.md .claude/skills/svoya-igra-dev/SKILL.md
git commit -m "feat: генератор читает историю — окно в контекст и сверка повторов"
```

---

## После всех задач

- Прогнать полный набор обоих пакетов: `pnpm -C server exec vitest run` и `pnpm -C client exec vitest run`, плюс `typecheck`, `lint`, `build` в обоих.
- **Живая проверка** (Шаг 7 в `svoya-igra-dev/SKILL.md`): удалить `game-history.db`, сыграть настоящую партию с включённым тумблером, затем сгенерировать новый пакет и убедиться, что окно в Шаге 0 напечаталось и сверка отработала. Это единственная проверка того, что генератор действительно чему-то научился, — тестами она не заменяется.
- Отметить в `docs/ideas.md` слайс A как `сделано` (сейчас `в работе`).
- Записать наблюдения живой партии в «Проверено вживую» в `svoya-igra-dev/SKILL.md`.
- Закрыть ветку через `superpowers:finishing-a-development-branch`.
