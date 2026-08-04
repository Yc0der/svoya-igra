# Базовый игровой раунд — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Доиграть Веху 1 до конца — из уже реализованного лобби (`docs/superpowers/plans/2026-08-03-walking-skeleton.md`) собрать полноценный играбельный раунд: сетка вопросов, выбор, кнопка, судейство, счёт, переход между раундами и итог, — чтобы можно было сыграть настоящую партию с живыми людьми от начала до конца.

**Architecture:** Чистый движок-редьюсер (`server/src/engine.ts`) без сети/диска/часов держит состояние раунда и на каждое событие отдаёт новое состояние плюс список эффектов (`start-timer`/`cancel-timer`). `Room` (уже существует) расширяется, а не дублируется отдельным классом: она превращает клиентские WS-сообщения в события движка, владеет настоящими `setTimeout` для эффектов и рассылает получившееся состояние тем же механизмом `onChange`, что и раньше. Пакет вопросов читается один раз при старте сервера из `packs/current.json`.

**Tech Stack:** То же, что в скелете — TypeScript, Node (`ws`, `sirv`), React 19 + Vite, Vitest, Playwright. Новых зависимостей не добавляется.

## Global Constraints

- Дизайн раунда зафиксирован в `docs/superpowers/specs/2026-08-04-base-round-design.md`, которая опирается на `docs/superpowers/specs/2026-08-03-svoya-igra-design.md` — при любом сомнении в правиле сверяться с этими двумя файлами, не додумывать.
- Таймеры: вопрос-открыт 25000мс, сказать-ответ 10000мс, голосование 10000мс, раскрытие 4000мс, конец-раунда 5000мс, блокировка фальстарта на клиенте 2000мс (design.md «Отклонения» + исходная спека «Таймеры»).
- Движок не читает часы, диск и сеть — время приходит только как событие `timer-expired` (design.md «Движок»).
- Счёт — на отдельной сущности «счётчик», не на участнике; в Вехе 1 `Counter.id === Participant.id` (design.md «Счётчик»).
- Пакет вопросов — файлы на диске, без базы; для Вехи 1 один фиксированный путь `packs/current.json`, без UI выбора (design.md «Формат пакета»).
- Звук на табло — вне области этой вехи (design.md «Отклонения»).
- Каждое состояние с ожиданием человека имеет таймаут, снапшот на диск переживает падение сервера, обрыв связи участника не роняет его счёт (исходная спека «Отказы»).

---

## File Structure

**`server/src/`**

- `pack.ts` — новый. Типы `Pack`/`Round`/`Theme`/`Question`, `validatePack(data: unknown): Pack`, `loadPack(path: string): Promise<Pack>`.
- `pack.test.ts` — новый.
- `engine.ts` — новый. Чистая машина состояний раунда: `EngineState`, `EngineEvent`, `Effect`, `createInitialState`, `reduce`.
- `engine.test.ts` — новый.
- `protocol.ts` — модифицируется: новые клиентские сообщения (`select-question`, `buzz`, `said-answer`, `vote`, `start-game`), `GameStateView`, `falsestart`, `state` получает поле `game`.
- `room.ts` — модифицируется: `Room` получает опциональный `pack` в конструкторе, методы `startGame`/`selectQuestion`/`buzz`/`saidAnswer`/`vote`, внутренний таймер игры, `RoomState` получает поле `game`.
- `room.test.ts` — модифицируется: новые тесты игровых методов `Room`.
- `snapshot.ts` — модифицируется: `serializeSnapshot`/`deserializeSnapshot` переживают поле `game`.
- `snapshot.test.ts` — модифицируется: тесты на восстановление игры из снапшота.
- `server.ts` — модифицируется: диспетчеризация новых типов сообщений, ответ `falsestart` одному сокету.
- `server.test.ts` — модифицируется: интеграционные тесты полного раунда через настоящие WS-клиенты.
- `index.ts` — модифицируется: грузит пакет при старте, при ошибке — понятное сообщение и контролируемый выход (как уже сделано для занятого порта), передаёт пакет в `Room`.

**`packs/`**

- `current.json` — уже написан во время брейнсторминга/планирования (тема «Общая эрудиция», 2 раунда по 4 темы по 4 вопроса). Ничего пересоздавать не нужно, только грузить.

**`client/src/`**

- `useRoomConnection.ts` — модифицируется: хук отдаёт `game: GameStateView | null`, `falsestart: boolean` (с автосбросом через 2с), действия `startGame`/`selectQuestion`/`buzz`/`saidAnswer`/`vote`.
- `useRoomConnection.test.ts` — модифицируется.
- `Player.tsx` — модифицируется: экран определяется фазой игры (таблица из design.md «Клиенты»).
- `Player.test.tsx` — модифицируется.
- `Board.tsx` — модифицируется: сетка, вопрос, раскрытие, итог.
- `Board.test.tsx` — модифицируется.

**`e2e/`**

- `round.spec.ts` — новый. Табло + два игрока разыгрывают два вопроса (исходная спека «Как проверяем»).

---

### Task 1: Пакет вопросов — типы, валидация, загрузка

**Files:**

- Create: `server/src/pack.ts`
- Test: `server/src/pack.test.ts`

**Interfaces:**

- Produces: `interface Question { id: string; price: number; text: string; answer: string; comment?: string; type: 'обычный' | 'кот' | 'аукцион' }`, `interface Theme { name: string; questions: Question[] }`, `interface Round { themes: Theme[] }`, `interface Pack { title: string; author: string; createdAt: string; rounds: Round[] }`, `function validatePack(data: unknown): Pack` (бросает `Error` с понятным сообщением на первой невалидности), `function loadPack(path: string): Promise<Pack>`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/pack.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPack, validatePack } from './pack.js';

function validPackData() {
  return {
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
}

describe('validatePack', () => {
  it('accepts well-formed data and returns it typed', () => {
    const data = validPackData();
    expect(validatePack(data)).toEqual(data);
  });

  it('accepts a question with an optional comment', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { comment?: string }).comment =
      'Комментарий';
    expect(validatePack(data).rounds[0].themes[0].questions[0].comment).toBe(
      'Комментарий',
    );
  });

  it.each([
    ['title', 123],
    ['author', 123],
    ['createdAt', 123],
  ])('rejects a non-string top-level field %s', (field, value) => {
    const data = validPackData() as Record<string, unknown>;
    data[field] = value;
    expect(() => validatePack(data)).toThrow();
  });

  it('rejects an empty rounds array', () => {
    const data = validPackData();
    data.rounds = [];
    expect(() => validatePack(data)).toThrow(/rounds/);
  });

  it('rejects a round with no themes', () => {
    const data = validPackData();
    data.rounds[0].themes = [];
    expect(() => validatePack(data)).toThrow(/themes/);
  });

  it('rejects a theme with an empty name', () => {
    const data = validPackData();
    data.rounds[0].themes[0].name = '';
    expect(() => validatePack(data)).toThrow(/name/);
  });

  it('rejects a theme with no questions', () => {
    const data = validPackData();
    data.rounds[0].themes[0].questions = [];
    expect(() => validatePack(data)).toThrow(/questions/);
  });

  it.each([
    ['id', 123],
    ['price', 'сто'],
    ['text', 123],
    ['answer', 123],
  ])('rejects a question with a bad field %s', (field, value) => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as Record<string, unknown>)[field] =
      value;
    expect(() => validatePack(data)).toThrow();
  });

  it('rejects a non-positive price', () => {
    const data = validPackData();
    data.rounds[0].themes[0].questions[0].price = 0;
    expect(() => validatePack(data)).toThrow(/price/);
  });

  it('rejects an unknown question type', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { type: string }).type =
      'неизвестный';
    expect(() => validatePack(data)).toThrow(/type/);
  });

  it('rejects a non-string comment when present', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as Record<string, unknown>)[
      'comment'
    ] = 123;
    expect(() => validatePack(data)).toThrow(/comment/);
  });

  it('rejects data that is not an object', () => {
    expect(() => validatePack('строка')).toThrow();
    expect(() => validatePack(null)).toThrow();
  });
});

describe('loadPack', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads and validates a real file from disk', async () => {
    const path = join(dir, 'pack.json');
    await writeFile(path, JSON.stringify(validPackData()), 'utf8');
    const pack = await loadPack(path);
    expect(pack.title).toBe('Тест');
  });

  it('throws a readable error on invalid JSON', async () => {
    const path = join(dir, 'pack.json');
    await writeFile(path, '{not json', 'utf8');
    await expect(loadPack(path)).rejects.toThrow(/JSON/);
  });

  it('throws when the file does not exist', async () => {
    await expect(loadPack(join(dir, 'missing.json'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `pack.ts` не существует.

- [ ] **Step 3: Реализовать `pack.ts`**

```ts
// server/src/pack.ts
import { readFile } from 'node:fs/promises';

export interface Question {
  id: string;
  price: number;
  text: string;
  answer: string;
  comment?: string;
  type: 'обычный' | 'кот' | 'аукцион';
}

export interface Theme {
  name: string;
  questions: Question[];
}

export interface Round {
  themes: Theme[];
}

export interface Pack {
  title: string;
  author: string;
  createdAt: string;
  rounds: Round[];
}

const QUESTION_TYPES = new Set(['обычный', 'кот', 'аукцион']);

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${where}: должно быть строкой`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, where: string): string {
  const str = requireString(value, where);
  if (str.length === 0) {
    throw new Error(`${where}: не должно быть пустой строкой`);
  }
  return str;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: должно быть непустым массивом`);
  }
  return value;
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where}: должно быть объектом`);
  }
  return value as Record<string, unknown>;
}

function validateQuestion(data: unknown, where: string): Question {
  const question = requireRecord(data, where);
  const id = requireNonEmptyString(question.id, `${where}.id`);
  const price = question.price;
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`${where}.price: должно быть положительным числом`);
  }
  const text = requireNonEmptyString(question.text, `${where}.text`);
  const answer = requireNonEmptyString(question.answer, `${where}.answer`);
  if (question.comment !== undefined && typeof question.comment !== 'string') {
    throw new Error(`${where}.comment: если есть, должно быть строкой`);
  }
  const type = question.type;
  if (typeof type !== 'string' || !QUESTION_TYPES.has(type)) {
    throw new Error(
      `${where}.type: должно быть одним из: обычный, кот, аукцион`,
    );
  }
  return {
    id,
    price,
    text,
    answer,
    comment: question.comment as string | undefined,
    type: type as Question['type'],
  };
}

function validateTheme(data: unknown, where: string): Theme {
  const theme = requireRecord(data, where);
  const name = requireNonEmptyString(theme.name, `${where}.name`);
  const questionsData = requireArray(theme.questions, `${where}.questions`);
  const questions = questionsData.map((q, i) =>
    validateQuestion(q, `${where}.questions[${i}]`),
  );
  return { name, questions };
}

function validateRound(data: unknown, where: string): Round {
  const round = requireRecord(data, where);
  const themesData = requireArray(round.themes, `${where}.themes`);
  const themes = themesData.map((t, i) =>
    validateTheme(t, `${where}.themes[${i}]`),
  );
  return { themes };
}

export function validatePack(data: unknown): Pack {
  const pack = requireRecord(data, 'пакет');
  const title = requireString(pack.title, 'пакет.title');
  const author = requireString(pack.author, 'пакет.author');
  const createdAt = requireString(pack.createdAt, 'пакет.createdAt');
  const roundsData = requireArray(pack.rounds, 'пакет.rounds');
  const rounds = roundsData.map((r, i) =>
    validateRound(r, `пакет.rounds[${i}]`),
  );
  return { title, author, createdAt, rounds };
}

export async function loadPack(path: string): Promise<Pack> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Пакет ${path} — невалидный JSON: ${(err as Error).message}`,
    );
  }
  return validatePack(parsed);
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: Проверить реальный пакет `packs/current.json` этим же валидатором**

Он уже лежит в репозитории. Добавить последний тест, доказывающий, что реальный игровой файл проходит валидацию — иначе несостыковка между тестовыми фикстурами и настоящим файлом обнаружится только на живой игре.

```ts
// добавить в server/src/pack.test.ts, в конец файла
describe('the real packs/current.json', () => {
  it('is a valid pack', async () => {
    const pack = await loadPack(
      new URL('../../packs/current.json', import.meta.url).pathname,
    );
    expect(pack.rounds.length).toBeGreaterThan(0);
  });
});
```

Run: `pnpm --filter server test`
Expected: PASS. Если падает — значит в `packs/current.json` опечатка в структуре; исправить сам файл, не тест.

- [ ] **Step 6: Commit**

```bash
git add server/src/pack.ts server/src/pack.test.ts packs/current.json
git commit -m "feat: add question pack types, validation, and loader"
```

---

### Task 2: Движок — чистая машина состояний раунда

**Files:**

- Create: `server/src/engine.ts`
- Test: `server/src/engine.test.ts`

**Interfaces:**

- Consumes: `Pack`, `Question`, `Theme`, `Round` из `server/src/pack.ts`.
- Produces: `type Phase`, `type TimerName`, `interface EngineState`, `type EngineEvent`, `type Effect`, `function createInitialState(pack: Pack, counterIds: string[]): EngineState`, `function reduce(state: EngineState, event: EngineEvent): { state: EngineState; effects: Effect[] }`. Константы `QUESTION_TIMER_MS`, `SAID_ANSWER_TIMER_MS`, `VOTE_TIMER_MS`, `REVEAL_TIMER_MS`, `ROUND_END_TIMER_MS` — их использует `Room` в Task 3 для восстановления таймера после перезапуска.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/engine.test.ts
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  type EngineState,
} from './engine.js';
import type { Pack } from './pack.js';

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    title: 'Тест',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема A',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'A1?',
                answer: 'ответ a1',
                type: 'обычный',
              },
              {
                id: 'a2',
                price: 200,
                text: 'A2?',
                answer: 'ответ a2',
                type: 'обычный',
              },
            ],
          },
        ],
      },
      {
        themes: [
          {
            name: 'Тема B',
            questions: [
              {
                id: 'b1',
                price: 100,
                text: 'B1?',
                answer: 'ответ b1',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

const PACK = makePack();

function selectFirst(state: EngineState) {
  return reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
}

describe('createInitialState', () => {
  it('starts in selecting phase with zeroed scores for every counter', () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    expect(state.phase).toBe('selecting');
    expect(state.roundIndex).toBe(0);
    expect(state.scores).toEqual({ p1: 0, p2: 0 });
    expect(['p1', 'p2']).toContain(state.turnCounterId);
    expect(state.answeredQuestionIds).toEqual([]);
  });
});

describe('select-question', () => {
  it("opens the question and starts the question timer when it is the picker's turn", () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = selectFirst(state);
    expect(next.phase).toBe('question-open');
    expect(next.currentQuestion).toEqual({ themeIndex: 0, questionId: 'a1' });
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it("is a no-op when it is not that counter's turn", () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const otherId = state.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(state, {
      type: 'select-question',
      counterId: otherId,
      themeIndex: 0,
      questionId: 'a1',
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op for an already-answered question', () => {
    const state = {
      ...createInitialState(PACK, ['p1', 'p2']),
      answeredQuestionIds: ['a1'],
    };
    const { state: next } = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    });
    expect(next.phase).toBe('selecting');
  });

  it('is a no-op for an unknown question id', () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const { state: next } = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'not-a-real-id',
    });
    expect(next.phase).toBe('selecting');
  });
});

describe('buzz', () => {
  it('locks the question to the first counter and starts the said-answer timer', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: buzzed, effects } = reduce(opened, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(buzzed.phase).toBe('buzzed');
    expect(buzzed.buzzedCounterId).toBe('p1');
    expect(effects).toEqual([
      { type: 'cancel-timer', timer: 'question' },
      { type: 'start-timer', timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
    ]);
  });

  it('ignores a second buzz once someone already buzzed (race resolved by arrival order)', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: firstBuzz } = reduce(opened, {
      type: 'buzz',
      counterId: 'p1',
    });
    const { state: secondBuzz, effects } = reduce(firstBuzz, {
      type: 'buzz',
      counterId: 'p2',
    });
    expect(secondBuzz).toEqual(firstBuzz);
    expect(effects).toEqual([]);
  });

  it('ignores a buzz from an unknown counter id', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: next } = reduce(opened, {
      type: 'buzz',
      counterId: 'ghost',
    });
    expect(next.phase).toBe('question-open');
  });

  it('ignores a buzz outside question-open (falsestart), even though Room is expected to filter this earlier', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = reduce(initial, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(next).toEqual(initial);
    expect(effects).toEqual([]);
  });
});

function buzzP1(state: EngineState) {
  return reduce(state, { type: 'buzz', counterId: 'p1' }).state;
}

describe('said-answer', () => {
  it('moves to judging and starts the vote timer', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: judging, effects } = reduce(buzzed, {
      type: 'said-answer',
      counterId: 'p1',
    });
    expect(judging.phase).toBe('judging');
    expect(judging.votes).toEqual({});
    expect(effects).toEqual([
      { type: 'cancel-timer', timer: 'said-answer' },
      { type: 'start-timer', timer: 'vote', ms: VOTE_TIMER_MS },
    ]);
  });

  it('is a no-op from someone other than the buzzed counter', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: next } = reduce(buzzed, {
      type: 'said-answer',
      counterId: 'p2',
    });
    expect(next.phase).toBe('buzzed');
  });
});

describe('timer-expired: said-answer', () => {
  it('advances to judging exactly like an explicit said-answer, so bystanders can still judge what was said aloud', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: next } = reduce(buzzed, {
      type: 'timer-expired',
      timer: 'said-answer',
    });
    expect(next.phase).toBe('judging');
  });
});

function toJudging(state: EngineState) {
  const opened = selectFirst(state).state;
  const buzzed = buzzP1(opened);
  return reduce(buzzed, { type: 'said-answer', counterId: 'p1' }).state;
}

describe('vote', () => {
  it('records a vote from an eligible counter without resolving yet', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    });
    expect(next.phase).toBe('judging');
    expect(next.votes).toEqual({ p2: true });
    expect(effects).toEqual([]);
  });

  it('ignores a vote from the counter who answered', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'p1',
      correct: true,
    });
    expect(next.votes).toEqual({});
  });

  it('ignores a vote from outside the game', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'ghost',
      correct: true,
    });
    expect(next.votes).toEqual({});
  });
});

describe('timer-expired: vote — correct', () => {
  it('awards the price, advances the turn to the answerer, marks the question answered, and reveals', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: voted } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    });
    const { state: next, effects } = reduce(voted, {
      type: 'timer-expired',
      timer: 'vote',
    });

    expect(next.phase).toBe('reveal');
    expect(next.scores.p1).toBe(100);
    expect(next.turnCounterId).toBe('p1');
    expect(next.lastCorrectCounterId).toBe('p1');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.buzzedCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });

  it('treats a tie as correct — the benefit of the doubt goes to the answerer', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2', 'p3']));
    const withVotes = [
      { counterId: 'p2', correct: true },
      { counterId: 'p3', correct: false },
    ].reduce((s, v) => reduce(s, { type: 'vote', ...v }).state, judging);
    const { state: next } = reduce(withVotes, {
      type: 'timer-expired',
      timer: 'vote',
    });
    expect(next.scores.p1).toBe(100);
  });

  it('treats no votes at all as correct', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'timer-expired',
      timer: 'vote',
    });
    expect(next.scores.p1).toBe(100);
  });
});

describe('timer-expired: vote — incorrect', () => {
  it('penalizes the answerer, reopens the same question with a fresh timer, and does not mark it answered', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: voted } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: false,
    });
    const { state: next, effects } = reduce(voted, {
      type: 'timer-expired',
      timer: 'vote',
    });

    expect(next.phase).toBe('question-open');
    expect(next.scores.p1).toBe(-100);
    expect(next.answeredQuestionIds).toEqual([]);
    expect(next.buzzedCounterId).toBeNull();
    expect(next.triedCounterIds).toEqual(['p1']);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('does not let a counter who already answered wrong buzz again on the same question', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: voted } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: false,
    });
    const { state: reopened } = reduce(voted, {
      type: 'timer-expired',
      timer: 'vote',
    });
    const { state: next, effects } = reduce(reopened, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([]);
  });
});

describe('timer-expired: question — nobody buzzed', () => {
  it('reveals with no score change and keeps the same picker', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const opened = selectFirst(initial).state;
    const { state: next, effects } = reduce(opened, {
      type: 'timer-expired',
      timer: 'question',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.scores).toEqual(initial.scores);
    expect(next.turnCounterId).toBe(initial.turnCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });
});

describe('timer-expired: reveal', () => {
  it('returns to selecting when the round still has unanswered questions', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const opened = selectFirst(initial).state;
    const revealed = reduce(opened, {
      type: 'timer-expired',
      timer: 'question',
    }).state;
    const { state: next, effects } = reduce(revealed, {
      type: 'timer-expired',
      timer: 'reveal',
    });
    expect(next.phase).toBe('selecting');
    expect(next.currentQuestion).toBeNull();
    expect(effects).toEqual([]);
  });

  it('moves to round-end when the round is complete and more rounds remain', () => {
    let state = createInitialState(PACK, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('round-end');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'round-end', ms: ROUND_END_TIMER_MS },
    ]);
  });

  it('ends the game when the last round is complete', () => {
    const onlyRoundPack = makePack({
      rounds: [
        {
          themes: [
            {
              name: 'Тема A',
              questions: [
                {
                  id: 'a1',
                  price: 100,
                  text: 'A1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
      ],
    });
    let state = createInitialState(onlyRoundPack, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
    expect(effects).toEqual([]);
  });
});

describe('timer-expired: round-end', () => {
  it('advances to the next round in selecting phase', () => {
    let state = createInitialState(PACK, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'round-end',
    });

    expect(next.phase).toBe('selecting');
    expect(next.roundIndex).toBe(1);
  });
});

describe('a full two-question game, played end to end', () => {
  it('produces the expected final scores and reaches game-end', () => {
    const twoQuestionPack = makePack({
      rounds: [
        {
          themes: [
            {
              name: 'Тема A',
              questions: [
                {
                  id: 'a1',
                  price: 100,
                  text: 'A1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
        {
          themes: [
            {
              name: 'Тема B',
              questions: [
                {
                  id: 'b1',
                  price: 200,
                  text: 'B1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
      ],
    });
    let state = createInitialState(twoQuestionPack, ['p1', 'p2']);
    const firstPicker = state.turnCounterId;

    // Раунд 1: p1 берёт вопрос верно.
    state = reduce(state, {
      type: 'select-question',
      counterId: firstPicker,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'buzz', counterId: 'p1' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p1' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    expect(state.scores).toEqual({ p1: 100, p2: 0 });
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    expect(state.phase).toBe('round-end');
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    expect(state.phase).toBe('selecting');
    expect(state.roundIndex).toBe(1);
    // Правильно ответивший выбирает следующим.
    expect(state.turnCounterId).toBe('p1');

    // Раунд 2: p2 берёт вопрос неверно, затем p1 берёт перехватом верно.
    state = reduce(state, {
      type: 'select-question',
      counterId: 'p1',
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'buzz', counterId: 'p2' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p2' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'p1',
      correct: false,
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    expect(state.scores).toEqual({ p1: 100, p2: -200 });
    expect(state.phase).toBe('question-open');

    state = reduce(state, { type: 'buzz', counterId: 'p1' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p1' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    expect(state.scores).toEqual({ p1: 300, p2: -200 });

    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    expect(state.phase).toBe('game-end');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `engine.ts` не существует.

- [ ] **Step 3: Реализовать `engine.ts`**

```ts
// server/src/engine.ts
import type { Pack, Question } from './pack.js';

export type Phase =
  | 'selecting'
  | 'question-open'
  | 'buzzed'
  | 'judging'
  | 'reveal'
  | 'round-end'
  | 'game-end';

export type TimerName =
  'question' | 'said-answer' | 'vote' | 'reveal' | 'round-end';

export const QUESTION_TIMER_MS = 25_000;
export const SAID_ANSWER_TIMER_MS = 10_000;
export const VOTE_TIMER_MS = 10_000;
export const REVEAL_TIMER_MS = 4_000;
export const ROUND_END_TIMER_MS = 5_000;

// Плоские массивы/объекты, а не Set/Map — EngineState целиком проходит через
// JSON.stringify в снапшоте комнаты (Task 4), а Map/Set сериализуются в '{}'.
export interface EngineState {
  pack: Pack;
  roundIndex: number;
  answeredQuestionIds: string[];
  phase: Phase;
  turnCounterId: string;
  currentQuestion: { themeIndex: number; questionId: string } | null;
  buzzedCounterId: string | null;
  triedCounterIds: string[];
  votes: Record<string, boolean>;
  scores: Record<string, number>;
  lastCorrectCounterId: string | null;
}

export type EngineEvent =
  | {
      type: 'select-question';
      counterId: string;
      themeIndex: number;
      questionId: string;
    }
  | { type: 'buzz'; counterId: string }
  | { type: 'said-answer'; counterId: string }
  | { type: 'vote'; counterId: string; correct: boolean }
  | { type: 'timer-expired'; timer: TimerName };

export type Effect =
  | { type: 'start-timer'; timer: TimerName; ms: number }
  | { type: 'cancel-timer'; timer: TimerName };

type Result = { state: EngineState; effects: Effect[] };

export function createInitialState(
  pack: Pack,
  counterIds: string[],
): EngineState {
  if (counterIds.length === 0) {
    throw new Error('Нужен хотя бы один счётчик, чтобы начать партию');
  }
  const scores: Record<string, number> = {};
  for (const id of counterIds) scores[id] = 0;
  return {
    pack,
    roundIndex: 0,
    answeredQuestionIds: [],
    phase: 'selecting',
    turnCounterId: counterIds[Math.floor(Math.random() * counterIds.length)],
    currentQuestion: null,
    buzzedCounterId: null,
    triedCounterIds: [],
    votes: {},
    scores,
    lastCorrectCounterId: null,
  };
}

function findQuestion(
  pack: Pack,
  roundIndex: number,
  themeIndex: number,
  questionId: string,
): Question | undefined {
  return pack.rounds[roundIndex]?.themes[themeIndex]?.questions.find(
    (q) => q.id === questionId,
  );
}

function isRoundComplete(
  pack: Pack,
  roundIndex: number,
  answeredQuestionIds: string[],
): boolean {
  const answered = new Set(answeredQuestionIds);
  return pack.rounds[roundIndex].themes.every((theme) =>
    theme.questions.every((q) => answered.has(q.id)),
  );
}

function unchanged(state: EngineState): Result {
  return { state, effects: [] };
}

export function reduce(state: EngineState, event: EngineEvent): Result {
  switch (event.type) {
    case 'select-question':
      return handleSelectQuestion(state, event);
    case 'buzz':
      return handleBuzz(state, event);
    case 'said-answer':
      return handleSaidAnswer(state, event);
    case 'vote':
      return handleVote(state, event);
    case 'timer-expired':
      return handleTimerExpired(state, event);
  }
}

function handleSelectQuestion(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'select-question' }>,
): Result {
  if (state.phase !== 'selecting' || event.counterId !== state.turnCounterId) {
    return unchanged(state);
  }
  const question = findQuestion(
    state.pack,
    state.roundIndex,
    event.themeIndex,
    event.questionId,
  );
  if (!question || state.answeredQuestionIds.includes(question.id)) {
    return unchanged(state);
  }
  return {
    state: {
      ...state,
      phase: 'question-open',
      currentQuestion: {
        themeIndex: event.themeIndex,
        questionId: event.questionId,
      },
      triedCounterIds: [],
    },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}

function handleBuzz(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'buzz' }>,
): Result {
  if (
    state.phase !== 'question-open' ||
    state.triedCounterIds.includes(event.counterId) ||
    !(event.counterId in state.scores)
  ) {
    return unchanged(state);
  }
  return {
    state: { ...state, phase: 'buzzed', buzzedCounterId: event.counterId },
    effects: [
      { type: 'cancel-timer', timer: 'question' },
      { type: 'start-timer', timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
    ],
  };
}

function handleSaidAnswer(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'said-answer' }>,
): Result {
  if (state.phase !== 'buzzed' || event.counterId !== state.buzzedCounterId) {
    return unchanged(state);
  }
  return startJudging(state);
}

function startJudging(state: EngineState): Result {
  return {
    state: { ...state, phase: 'judging', votes: {} },
    effects: [
      { type: 'cancel-timer', timer: 'said-answer' },
      { type: 'start-timer', timer: 'vote', ms: VOTE_TIMER_MS },
    ],
  };
}

function handleVote(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'vote' }>,
): Result {
  if (
    state.phase !== 'judging' ||
    event.counterId === state.buzzedCounterId ||
    !(event.counterId in state.scores)
  ) {
    return unchanged(state);
  }
  return unchanged({
    ...state,
    votes: { ...state.votes, [event.counterId]: event.correct },
  });
}

function handleTimerExpired(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'timer-expired' }>,
): Result {
  switch (event.timer) {
    case 'question':
      return revealQuestion(state, null);
    case 'said-answer':
      return startJudging(state);
    case 'vote':
      return resolveVote(state);
    case 'reveal':
      return afterReveal(state);
    case 'round-end':
      return startNextRound(state);
  }
}

function resolveVote(state: EngineState): Result {
  const buzzedCounterId = state.buzzedCounterId as string;
  const question = findQuestion(
    state.pack,
    state.roundIndex,
    state.currentQuestion!.themeIndex,
    state.currentQuestion!.questionId,
  )!;
  const yes = Object.values(state.votes).filter((v) => v).length;
  const no = Object.values(state.votes).filter((v) => !v).length;
  const correct = yes >= no;

  if (correct) {
    return revealQuestion(state, {
      counterId: buzzedCounterId,
      delta: question.price,
    });
  }

  // Неверно: штраф, вопрос переоткрывается для остальных со свежим полным
  // таймером (не буквальным «остатком» — см. дизайн-документ, раздел
  // «Отклонения от исходной спеки»), отвечавший больше не может нажать на
  // этот же вопрос.
  return {
    state: {
      ...state,
      phase: 'question-open',
      buzzedCounterId: null,
      votes: {},
      triedCounterIds: [...state.triedCounterIds, buzzedCounterId],
      scores: {
        ...state.scores,
        [buzzedCounterId]: state.scores[buzzedCounterId] - question.price,
      },
    },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}

function revealQuestion(
  state: EngineState,
  correctResult: { counterId: string; delta: number } | null,
): Result {
  const questionId = state.currentQuestion!.questionId;
  return {
    state: {
      ...state,
      phase: 'reveal',
      answeredQuestionIds: [...state.answeredQuestionIds, questionId],
      scores: correctResult
        ? {
            ...state.scores,
            [correctResult.counterId]:
              state.scores[correctResult.counterId] + correctResult.delta,
          }
        : state.scores,
      turnCounterId: correctResult
        ? correctResult.counterId
        : state.turnCounterId,
      lastCorrectCounterId: correctResult
        ? correctResult.counterId
        : state.lastCorrectCounterId,
      buzzedCounterId: null,
      votes: {},
    },
    effects: [{ type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS }],
  };
}

function afterReveal(state: EngineState): Result {
  const base = { ...state, currentQuestion: null, triedCounterIds: [] };
  if (
    !isRoundComplete(state.pack, state.roundIndex, state.answeredQuestionIds)
  ) {
    return { state: { ...base, phase: 'selecting' }, effects: [] };
  }
  if (state.roundIndex + 1 < state.pack.rounds.length) {
    return {
      state: { ...base, phase: 'round-end' },
      effects: [
        { type: 'start-timer', timer: 'round-end', ms: ROUND_END_TIMER_MS },
      ],
    };
  }
  return { state: { ...base, phase: 'game-end' }, effects: [] };
}

function startNextRound(state: EngineState): Result {
  return {
    state: { ...state, phase: 'selecting', roundIndex: state.roundIndex + 1 },
    effects: [],
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine.ts server/src/engine.test.ts
git commit -m "feat: add pure round engine — states, events, and effects"
```

---

### Task 3: Протокол — новые сообщения и вид игрового состояния

**Files:**

- Modify: `server/src/protocol.ts`

**Interfaces:**

- Consumes: `Phase` из `server/src/engine.ts`.
- Produces: `ClientMessage` получает варианты `start-game`/`select-question`/`buzz`/`said-answer`/`vote`; `ServerMessage` получает вариант `falsestart` и поле `game` в варианте `state`; `interface GameStateView`.

Отдельного теста нет — это чистые типы, проверяются компиляцией остальных задач.

- [ ] **Step 1: Расширить `protocol.ts`**

```ts
// server/src/protocol.ts
import type { Phase } from './engine.js';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase: Phase;
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  currentQuestion: { text: string; price: number } | null;
  buzzedParticipantId: string | null;
  correctAnswer: { text: string; comment?: string } | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean };

export type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      game: GameStateView | null;
    }
  | { type: 'falsestart' };
```

- [ ] **Step 2: Проверить, что проект пока не собирается (это ожидаемо — `Room`/`server.ts` ещё не обновлены)**

Run: `pnpm --filter server run typecheck`
Expected: FAIL — `room.ts` и `server.ts` ещё используют старую форму `{ type: 'state'; participants }` без `game`; их обновление — следующие задачи. Это единственный шаг плана, где падение typecheck ожидаемо и не является поводом останавливаться.

- [ ] **Step 3: Commit**

```bash
git add server/src/protocol.ts
git commit -m "feat: extend protocol with game messages and GameStateView"
```

---

### Task 4: Комната — игровые методы и настоящие таймеры

**Files:**

- Modify: `server/src/room.ts`
- Modify: `server/src/room.test.ts`

**Interfaces:**

- Consumes: `Pack` (`server/src/pack.ts`); `EngineState`, `EngineEvent`, `Effect`, `TimerName`, `createInitialState`, `reduce`, и таймерные константы из `server/src/engine.ts`.
- Produces: `RoomState` получает поле `game: EngineState | null`; `Room` получает конструктор `constructor(initial?: RoomState, pack?: Pack)` (обратно совместим — существующие вызовы `new Room()`/`new Room(initial)` не меняются) и методы `startGame(): { ok: true } | { error: 'not-enough-players' | 'no-pack' }`, `selectQuestion(participantId: string, themeIndex: number, questionId: string): void`, `buzz(participantId: string): 'ok' | 'falsestart'`, `saidAnswer(participantId: string): void`, `vote(participantId: string, correct: boolean): void`, `toGameStateView(): GameStateView | null` (публичный — понадобится `server.ts` в Task 6, но реализуется здесь вместе с остальным игровым состоянием).

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в server/src/room.test.ts, после существующих describe-блоков
import type { Pack } from './pack.js';

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
              text: 'Вопрос 1?',
              answer: 'ответ 1',
              type: 'обычный',
            },
            {
              id: 'q2',
              price: 200,
              text: 'Вопрос 2?',
              answer: 'ответ 2',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
};

function joinedId(room: Room, name: string): string {
  const result = room.join(name);
  if (!('participant' in result)) throw new Error('expected join to succeed');
  return result.participant.id;
}

describe('Room.startGame', () => {
  it('fails with not-enough-players when fewer than two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    expect(room.startGame()).toEqual({ error: 'not-enough-players' });
  });

  it('fails with no-pack when the room was built without one', () => {
    const room = new Room();
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    expect(room.startGame()).toEqual({ error: 'no-pack' });
  });

  it('starts the game and exposes a game state view once two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');

    expect(room.startGame()).toEqual({ ok: true });

    const view = room.toGameStateView();
    expect(view).not.toBeNull();
    expect(view?.phase).toBe('selecting');
    expect(view?.grid).toEqual([
      {
        themeName: 'Тема',
        questions: [
          { id: 'q1', price: 100, answered: false },
          { id: 'q2', price: 200, answered: false },
        ],
      },
    ]);
    expect([vanya, katya]).toContain(view?.turnParticipantId);
    expect(view?.scores).toEqual(
      expect.arrayContaining([
        { participantId: vanya, score: 0 },
        { participantId: katya, score: 0 },
      ]),
    );
  });

  it('notifies listeners on a successful start', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const listener = vi.fn();
    room.onChange(listener);
    room.startGame();
    expect(listener).toHaveBeenCalledOnce();
  });
});

function startedRoom(): { room: Room; picker: string; other: string } {
  const room = new Room(undefined, TEST_PACK);
  const vanya = joinedId(room, 'Ваня');
  const katya = joinedId(room, 'Катя');
  room.startGame();
  const view = room.toGameStateView()!;
  const picker = view.turnParticipantId;
  const other = picker === vanya ? katya : vanya;
  return { room, picker, other };
}

describe('Room game flow', () => {
  it('walks a question from selection through a correct answer', () => {
    const { room, picker, other } = startedRoom();

    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.phase).toBe('question-open');
    expect(room.toGameStateView()?.currentQuestion).toEqual({
      text: 'Вопрос 1?',
      price: 100,
    });

    expect(room.buzz(picker)).toBe('ok');
    expect(room.toGameStateView()?.phase).toBe('buzzed');
    expect(room.toGameStateView()?.buzzedParticipantId).toBe(picker);

    room.saidAnswer(picker);
    expect(room.toGameStateView()?.phase).toBe('judging');

    room.vote(other, true);
    // Голосование разрешается только по таймеру (Task 2) — до него фаза не
    // меняется, даже когда все имеющие право уже проголосовали.
    expect(room.toGameStateView()?.phase).toBe('judging');
  });

  it('rejects a buzz outside question-open as a falsestart, without touching game state', () => {
    const { room, picker } = startedRoom();
    const before = room.toGameStateView();

    expect(room.buzz(picker)).toBe('falsestart');

    expect(room.toGameStateView()).toEqual(before);
  });

  it('advances the round automatically once the question timer fires', () => {
    vi.useFakeTimers();
    try {
      const { room, picker } = startedRoom();
      room.selectQuestion(picker, 0, 'q1');
      expect(room.toGameStateView()?.phase).toBe('question-open');

      vi.advanceTimersByTime(25_000);
      expect(room.toGameStateView()?.phase).toBe('reveal');

      vi.advanceTimersByTime(4_000);
      expect(room.toGameStateView()?.phase).toBe('selecting');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `startGame`/`selectQuestion`/`buzz`/`saidAnswer`/`vote`/`toGameStateView` ещё не существуют.

- [ ] **Step 3: Реализовать игровую часть `Room`**

Заменить весь файл `server/src/room.ts` на:

```ts
// server/src/room.ts
import { randomUUID } from 'node:crypto';
import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  type EngineState,
  type EngineEvent,
  type Effect,
  type Phase,
  type TimerName,
} from './engine.js';
import type { Pack } from './pack.js';
import type { GameStateView } from './protocol.js';

export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
}

export interface RoomState {
  participants: Participant[];
  game: EngineState | null;
}

export type JoinResult = { participant: Participant } | { error: 'name-taken' };
export type ReconnectResult =
  { participant: Participant } | { error: 'invalid-token' };
export type StartGameResult =
  { ok: true } | { error: 'not-enough-players' | 'no-pack' };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// При восстановлении из снапшота настоящий setTimeout процесса, который
// раньше двигал игру дальше, потерян вместе со старым процессом — движок сам
// об этом не знает, потому что он не знает о часах вообще. Комната обязана
// перезавести таймер, соответствующий восстановленной фазе, иначе игра
// зависнет в этой фазе навсегда. `selecting` — единственная фаза без
// таймера (спека не ограничивает время на выбор вопроса).
const PHASE_TIMER: Partial<Record<Phase, { timer: TimerName; ms: number }>> = {
  'question-open': { timer: 'question', ms: QUESTION_TIMER_MS },
  buzzed: { timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
  judging: { timer: 'vote', ms: VOTE_TIMER_MS },
  reveal: { timer: 'reveal', ms: REVEAL_TIMER_MS },
  'round-end': { timer: 'round-end', ms: ROUND_END_TIMER_MS },
};

export class Room {
  private participants: Participant[];
  private pack: Pack | undefined;
  private game: EngineState | null;
  private gameTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private gameTimerDeadline: number | null = null;
  private listeners = new Set<(state: RoomState) => void>();

  constructor(initial?: RoomState, pack?: Pack) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
    this.pack = pack;
    this.game = initial?.game ? { ...initial.game } : null;
    if (this.game) {
      const restart = PHASE_TIMER[this.game.phase];
      if (restart) {
        this.applyEffects([{ type: 'start-timer', ...restart }]);
      }
    }
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
    return { participant: { ...participant } };
  }

  reconnect(token: string): ReconnectResult {
    const participant = this.participants.find((p) => p.token === token);
    if (!participant) {
      return { error: 'invalid-token' };
    }
    participant.connected = true;
    this.notify();
    return { participant: { ...participant } };
  }

  disconnect(participantId: string): void {
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant || !participant.connected) {
      return;
    }
    participant.connected = false;
    this.notify();
  }

  startGame(): StartGameResult {
    if (!this.pack) {
      return { error: 'no-pack' };
    }
    if (this.participants.length < 2) {
      return { error: 'not-enough-players' };
    }
    const counterIds = this.participants.map((p) => p.id);
    this.game = createInitialState(this.pack, counterIds);
    this.notify();
    return { ok: true };
  }

  selectQuestion(
    participantId: string,
    themeIndex: number,
    questionId: string,
  ): void {
    this.dispatch({
      type: 'select-question',
      counterId: participantId,
      themeIndex,
      questionId,
    });
  }

  // Возвращает 'falsestart', когда нажатие пришло вне фазы «вопрос открыт» —
  // движок о таких нажатиях никогда не узнаёт (design.md, «Комната»),
  // потому что здесь для них нет смысла ни в каком состоянии.
  buzz(participantId: string): 'ok' | 'falsestart' {
    if (!this.game || this.game.phase !== 'question-open') {
      return 'falsestart';
    }
    this.dispatch({ type: 'buzz', counterId: participantId });
    return 'ok';
  }

  saidAnswer(participantId: string): void {
    this.dispatch({ type: 'said-answer', counterId: participantId });
  }

  vote(participantId: string, correct: boolean): void {
    this.dispatch({ type: 'vote', counterId: participantId, correct });
  }

  getState(): RoomState {
    return {
      participants: this.participants.map((p) => ({ ...p })),
      game: this.game ? { ...this.game } : null,
    };
  }

  toGameStateView(): GameStateView | null {
    if (!this.game) return null;
    const game = this.game;
    const round = game.pack.rounds[game.roundIndex];
    const currentQuestionData = game.currentQuestion
      ? round.themes[game.currentQuestion.themeIndex].questions.find(
          (q) => q.id === game.currentQuestion!.questionId,
        )
      : undefined;

    const showAnswer = game.phase === 'judging' || game.phase === 'reveal';

    return {
      phase: game.phase,
      roundIndex: game.roundIndex,
      grid: round.themes.map((theme) => ({
        themeName: theme.name,
        questions: theme.questions.map((q) => ({
          id: q.id,
          price: q.price,
          answered: game.answeredQuestionIds.includes(q.id),
        })),
      })),
      turnParticipantId: game.turnCounterId,
      currentQuestion: currentQuestionData
        ? { text: currentQuestionData.text, price: currentQuestionData.price }
        : null,
      buzzedParticipantId: game.buzzedCounterId,
      correctAnswer:
        showAnswer && currentQuestionData
          ? {
              text: currentQuestionData.answer,
              comment: currentQuestionData.comment,
            }
          : null,
      timerDeadline: this.gameTimerDeadline,
      scores: Object.entries(game.scores).map(([participantId, score]) => ({
        participantId,
        score,
      })),
    };
  }

  onChange(listener: (state: RoomState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: EngineEvent): void {
    if (!this.game) return;
    const { state, effects } = reduce(this.game, event);
    this.game = state;
    this.applyEffects(effects);
    this.notify();
  }

  private applyEffects(effects: Effect[]): void {
    // Сброс — один раз перед циклом, а не внутри него. При пустом effects[]
    // (например, 'reveal' → 'selecting' или 'round-end' → 'selecting', обе
    // фазы без своего таймера) тело цикла вообще не выполняется — если бы
    // сброс жил внутри for, устаревший дедлайн остался бы висеть в
    // gameTimerDeadline/gameTimeoutHandle и уходил бы в toGameStateView() как
    // ложный, уже прошедший дедлайн, вплоть до следующего эффекта, который
    // его перезапишет (для 'game-end' — уже никогда).
    if (this.gameTimeoutHandle) {
      clearTimeout(this.gameTimeoutHandle);
      this.gameTimeoutHandle = null;
      this.gameTimerDeadline = null;
    }
    for (const effect of effects) {
      if (effect.type === 'start-timer') {
        this.gameTimerDeadline = Date.now() + effect.ms;
        this.gameTimeoutHandle = setTimeout(() => {
          this.dispatch({ type: 'timer-expired', timer: effect.timer });
        }, effect.ms);
      }
    }
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
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: wire the round engine into Room with real timers"
```

---

### Task 5: Снапшот — переживает состояние игры и восстанавливает таймер

**Files:**

- Modify: `server/src/snapshot.ts`
- Modify: `server/src/snapshot.test.ts`

**Interfaces:**

- Consumes: `RoomState` (теперь с полем `game`) из `server/src/room.ts`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в server/src/snapshot.test.ts
import { createInitialState } from './engine.js';
import type { Pack } from './pack.js';

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
            { id: 'q1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
          ],
        },
      ],
    },
  ],
};

describe('serializeSnapshot / deserializeSnapshot with game state', () => {
  it('round-trips a null game unchanged', () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
      ],
      game: null,
    };
    expect(deserializeSnapshot(serializeSnapshot(state))).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
      game: null,
    });
  });

  it('round-trips an in-progress game exactly', () => {
    const game = createInitialState(TEST_PACK, ['1', '2']);
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: true },
      ],
      game,
    };
    const restored = deserializeSnapshot(serializeSnapshot(state));
    expect(restored.game).toEqual(game);
  });

  it('treats a snapshot written before this feature (no game field) as lobby-only', () => {
    const restored = deserializeSnapshot(
      JSON.stringify({
        participants: [
          { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        ],
      }),
    );
    expect(restored.game).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `deserializeSnapshot` пока не читает `game` вообще, а `serializeSnapshot`/`RoomState` в `room.ts` (Task 4) уже несут это поле, так что старые тесты сериализации, ожидавшие `RoomState` без `game`, тоже перестанут собираться — это ожидаемо и чинится этим же шагом.

- [ ] **Step 3: Обновить `snapshot.ts`**

```ts
// server/src/snapshot.ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { RoomState } from './room.js';

export function serializeSnapshot(state: RoomState): string {
  return JSON.stringify(state);
}

export function deserializeSnapshot(json: string): RoomState {
  // `participants` остаётся обязательным (без `?? []`) намеренно: его
  // отсутствие — это порча данных, и падение здесь с TypeError — то самое
  // поведение, которое уже покрыто тестом «throws on well-formed JSON that
  // is not a room state» из скелета. `game`, наоборот, обязан дефолтиться —
  // снапшоты, записанные до этой вехи, никогда его не содержали, и это не
  // порча, а более старая, валидная версия формата.
  const parsed = JSON.parse(json) as Partial<RoomState>;
  return {
    participants: parsed.participants!.map((p) => ({
      ...p,
      connected: false,
    })),
    game: parsed.game ?? null,
  };
}

export async function writeSnapshot(
  path: string,
  state: RoomState,
): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, serializeSnapshot(state), 'utf8');
  await rename(tmpPath, path);
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

Существующие тесты в `snapshot.test.ts`, которые строят `RoomState` литералом без поля `game` (например `{ participants: [...] }`), нужно поправить, добавив `game: null` — иначе они перестанут собираться по типам. Пройтись по файлу и добавить `game: null` в каждый такой литерал.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/snapshot.ts server/src/snapshot.test.ts
git commit -m "fix: persist and restore game state through the room snapshot"
```

---

### Task 6: Сервер — диспетчеризация игровых сообщений, загрузка пакета при старте

**Files:**

- Modify: `server/src/server.ts`
- Modify: `server/src/server.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `Room` игровые методы (Task 4), `loadPack` (Task 1), `ClientMessage`/`ServerMessage`/`GameStateView` (Task 3).

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в server/src/server.test.ts, внутри describe('createServer'),
// после существующих тестов. Требует TEST_PACK и передачи pack в createServer —
// добавить в beforeEach параметр pack: TEST_PACK при создании room, либо
// создавать отдельный room с pack в каждом новом тесте (см. ниже, тесты сами
// создают свой Room с TEST_PACK и отдельный createServer, не полагаясь на
// beforeEach).
import type { Pack } from './pack.js';

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
  return { ws, nextMessage, participantId: joined.participantId };
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
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-game-'));
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
    // Присоединение b уже транслировало обновлённый состав лобби всем — эту
    // трансляцию joinPlayer(b) вычитал только из очереди b, не из очереди a.
    await a.nextMessage();

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
      game: { phase: string };
    };
    expect(afterSelect.game.phase).toBe('question-open');

    picker.ws.send(JSON.stringify({ type: 'buzz' }));
    const afterBuzz = (await settle(a, b, picker)) as {
      game: { phase: string; buzzedParticipantId: string };
    };
    expect(afterBuzz.game.phase).toBe('buzzed');
    expect(afterBuzz.game.buzzedParticipantId).toBe(picker.participantId);

    a.ws.close();
    b.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
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
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter server test`
Expected: FAIL — `server.ts` пока не обрабатывает новые типы сообщений, `Room` из Task 4 их уже принимает, но диспетчер не вызывает.

- [ ] **Step 3: Обновить `server.ts`**

В `server.ts` добавить обработку новых типов сообщений внутри существующего `ws.on('message', ...)`, после уже существующих веток `join`/`reconnect`:

```ts
if (message.type === 'start-game') {
  room.startGame();
}

if (message.type === 'select-question') {
  const participantId = connections.get(ws);
  if (
    participantId &&
    typeof message.themeIndex === 'number' &&
    typeof message.questionId === 'string'
  ) {
    room.selectQuestion(participantId, message.themeIndex, message.questionId);
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
```

И обновить `broadcastState`, которая сейчас собирает `ServerMessage` без `game`:

```ts
  const broadcastState = (): void => {
    const message: ServerMessage = {
      type: 'state',
      participants: toParticipantView(room.getState()),
      game: room.toGameStateView(),
    };
```

`toParticipantView` уже принимает `RoomState`, но обращается только к `.participants` — она не ломается от нового поля `game` в `RoomState`, менять её не нужно.

- [ ] **Step 4: Обновить `index.ts`, чтобы грузить пакет при старте**

```ts
// добавить в server/src/index.ts, после существующего блока загрузки снапшота
// и до создания Room
import { loadPack } from './pack.js';

const PACK_PATH = './packs/current.json';

// ...внутри main(), перед `const room = new Room(initial ?? undefined);`
let pack;
try {
  pack = await loadPack(PACK_PATH);
} catch (err) {
  console.error(
    `Не удалось загрузить пакет вопросов ${PACK_PATH} — без него игру не начать:`,
    err,
  );
  process.exitCode = 1;
  return;
}

const room = new Room(initial ?? undefined, pack);
```

Пакет обязателен для игры (в отличие от битого снапшота участников, деградация до пустой комнаты здесь не имеет смысла — без пакета `startGame` всё равно не сработает ни для одного участника), поэтому ошибка загрузки останавливает старт тем же контролируемым способом, что уже сделан для занятого порта: понятное сообщение и `process.exitCode = 1`, без сырого стека.

- [ ] **Step 5: Убедиться, что тесты и полная сборка проходят**

Run: `pnpm --filter server test && pnpm --filter server run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/src/server.test.ts server/src/index.ts
git commit -m "feat: dispatch game messages over WS and load the pack at startup"
```

---

### Task 7: `useRoomConnection` — игровое состояние и действия

**Files:**

- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/useRoomConnection.test.ts`

**Interfaces:**

- Produces: `RoomConnection` получает поля `game: GameStateView | null`, `falsestart: boolean`, методы `startGame(): void`, `selectQuestion(themeIndex: number, questionId: string): void`, `buzz(): void`, `saidAnswer(): void`, `vote(correct: boolean): void`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в client/src/useRoomConnection.test.ts, внутри существующего
// describe('useRoomConnection', ...) — использует уже существующие в файле
// FakeWebSocket и factory(), не mock-socket и не отдельный renderConnection().
it('exposes game state from a state message and stays null before any game starts', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];

  act(() => socket.emitOpen());
  act(() =>
    socket.emitMessage({ type: 'state', participants: [], game: null }),
  );

  expect(result.current.game).toBeNull();
});

it('updates game state on every state broadcast', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  const gameView = {
    phase: 'selecting',
    roundIndex: 0,
    grid: [],
    turnParticipantId: 'p1',
    currentQuestion: null,
    buzzedParticipantId: null,
    correctAnswer: null,
    timerDeadline: null,
    scores: [],
  };

  act(() => socket.emitOpen());
  act(() =>
    socket.emitMessage({ type: 'state', participants: [], game: gameView }),
  );

  expect(result.current.game).toEqual(gameView);
});

it('sends start-game/select-question/buzz/said-answer/vote as the matching client messages', () => {
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() => result.current.startGame());
  expect(socket.sent).toContainEqual(JSON.stringify({ type: 'start-game' }));

  act(() => result.current.selectQuestion(1, 'q2'));
  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'select-question',
      themeIndex: 1,
      questionId: 'q2',
    }),
  );

  act(() => result.current.buzz());
  expect(socket.sent).toContainEqual(JSON.stringify({ type: 'buzz' }));

  act(() => result.current.saidAnswer());
  expect(socket.sent).toContainEqual(JSON.stringify({ type: 'said-answer' }));

  act(() => result.current.vote(true));
  expect(socket.sent).toContainEqual(
    JSON.stringify({ type: 'vote', correct: true }),
  );
});

it('sets falsestart on a falsestart message and clears it again after 2 seconds', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useRoomConnection(factory));
  const socket = FakeWebSocket.instances[0];

  act(() => socket.emitOpen());
  act(() => socket.emitMessage({ type: 'falsestart' }));
  expect(result.current.falsestart).toBe(true);

  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.falsestart).toBe(false);
});
```

`vi.useRealTimers()` для последнего теста уже вызывается в файле общим `afterEach` — отдельный `finally` не нужен.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — хук пока не знает про `game`/`falsestart`/новые методы.

- [ ] **Step 3: Обновить `useRoomConnection.ts`**

```ts
// client/src/useRoomConnection.ts
import { useEffect, useRef, useState } from 'react';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase:
    | 'selecting'
    | 'question-open'
    | 'buzzed'
    | 'judging'
    | 'reveal'
    | 'round-end'
    | 'game-end';
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  currentQuestion: { text: string; price: number } | null;
  buzzedParticipantId: string | null;
  correctAnswer: { text: string; comment?: string } | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
}

type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      game: GameStateView | null;
    }
  | { type: 'falsestart' };

type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean };

export type ConnectionStatus =
  'connecting' | 'joining' | 'joined' | 'name-taken' | 'disconnected';

export interface RoomConnection {
  status: ConnectionStatus;
  participants: ParticipantView[];
  selfId: string | null;
  lanUrl: string | null;
  game: GameStateView | null;
  falsestart: boolean;
  join(name: string): void;
  startGame(): void;
  selectQuestion(themeIndex: number, questionId: string): void;
  buzz(): void;
  saidAnswer(): void;
  vote(correct: boolean): void;
}

const TOKEN_KEY = 'svoya-igra-token';
const RECONNECT_DELAY_MS = 2000;
const FALSESTART_LOCK_MS = 2000;

type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

export function useRoomConnection(
  wsFactory: WebSocketFactory = defaultWsFactory,
): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [game, setGame] = useState<GameStateView | null>(null);
  const [falsestart, setFalsestart] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let falsestartTimer: ReturnType<typeof setTimeout> | undefined;

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
          setGame(message.game);
        }
        if (message.type === 'falsestart') {
          setFalsestart(true);
          clearTimeout(falsestartTimer);
          falsestartTimer = setTimeout(
            () => setFalsestart(false),
            FALSESTART_LOCK_MS,
          );
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
      clearTimeout(falsestartTimer);
      wsRef.current?.close();
    };
  }, [wsFactory]);

  function send(message: ClientMessage): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function join(name: string): void {
    pendingNameRef.current = name;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus('joining');
      send({ type: 'join', name });
    }
  }

  return {
    status,
    participants,
    selfId,
    lanUrl,
    game,
    falsestart,
    join,
    startGame: () => send({ type: 'start-game' }),
    selectQuestion: (themeIndex, questionId) =>
      send({ type: 'select-question', themeIndex, questionId }),
    buzz: () => send({ type: 'buzz' }),
    saidAnswer: () => send({ type: 'said-answer' }),
    vote: (correct) => send({ type: 'vote', correct }),
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts
git commit -m "feat: expose game state and actions from useRoomConnection"
```

---

### Task 8: Страница игрока — экран по фазе

**Files:**

- Modify: `client/src/Player.tsx`
- Modify: `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `RoomConnection` (Task 7), в частности `game`, `selfId`, `falsestart`, `startGame`/`selectQuestion`/`buzz`/`saidAnswer`/`vote`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в client/src/Player.test.tsx. Файл уже использует
// vi.mock('./useRoomConnection', () => ({ useRoomConnection: vi.fn() })) и
// mockedUseRoomConnection.mockReturnValue({...полный объект...}) — каждый
// вызов задаёт ВЕСЬ RoomConnection целиком, не частично. Раньше в файле было
// всего 5 полей; теперь (после Task 7) их 12, и вручную перечислять все в
// каждом тесте — сплошное дублирование, поэтому здесь заводятся два
// локальных хелпера-фабрики (baseGame/connection), сохраняющие тот же
// mockReturnValue-паттерн, просто с разумными дефолтами.

import type { GameStateView, RoomConnection } from './useRoomConnection';

function baseGame(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    phase: 'selecting',
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    buzzedParticipantId: null,
    correctAnswer: null,
    timerDeadline: null,
    scores: [],
    ...overrides,
  };
}

function connection(overrides: Partial<RoomConnection> = {}): RoomConnection {
  return {
    status: 'joined',
    participants: [],
    selfId: null,
    lanUrl: null,
    game: null,
    falsestart: false,
    join: vi.fn(),
    startGame: vi.fn(),
    selectQuestion: vi.fn(),
    buzz: vi.fn(),
    saidAnswer: vi.fn(),
    vote: vi.fn(),
    ...overrides,
  };
}

it('shows a start-game button in the lobby once joined, before any game exists', () => {
  mockedUseRoomConnection.mockReturnValue(connection({ game: null }));
  render(<Player />);
  expect(
    screen.getByRole('button', { name: /начать игру/i }),
  ).toBeInTheDocument();
});

it('calls startGame when the lobby button is clicked', async () => {
  const startGame = vi.fn();
  mockedUseRoomConnection.mockReturnValue(connection({ game: null, startGame }));
  render(<Player />);
  await userEvent.click(screen.getByRole('button', { name: /начать игру/i }));
  expect(startGame).toHaveBeenCalledOnce();
});

it('shows the question grid when it is my turn to select', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      game: baseGame({
        turnParticipantId: 'me',
        grid: [
          {
            themeName: 'Тема',
            questions: [{ id: 'q1', price: 100, answered: false }],
          },
        ],
      }),
    }),
  );
  render(<Player />);
  expect(screen.getByRole('button', { name: /100/ })).toBeInTheDocument();
});

it("shows whose turn it is by name when it isn't mine", () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      participants: [{ id: 'other', name: 'Катя', connected: true }],
      game: baseGame({ turnParticipantId: 'other' }),
    }),
  );
  render(<Player />);
  expect(screen.getByText(/сейчас выбирает Катя/i)).toBeInTheDocument();
});

it('calls selectQuestion with the right ids when a grid cell is clicked', async () => {
  const selectQuestion = vi.fn();
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      selectQuestion,
      game: baseGame({
        turnParticipantId: 'me',
        grid: [
          {
            themeName: 'Тема',
            questions: [{ id: 'q1', price: 100, answered: false }],
          },
        ],
      }),
    }),
  );
  render(<Player />);
  await userEvent.click(screen.getByRole('button', { name: /100/ }));
  expect(selectQuestion).toHaveBeenCalledWith(0, 'q1');
});

it('shows the buzz button while the question is open', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({ game: baseGame({ phase: 'question-open' }) }),
  );
  render(<Player />);
  expect(screen.getByRole('button', { name: /жать/i })).toBeInTheDocument();
});

it('disables the buzz button for 2 seconds after a falsestart', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({ phase: 'question-open' }),
      falsestart: true,
    }),
  );
  render(<Player />);
  expect(screen.getByRole('button', { name: /жать/i })).toBeDisabled();
});

it('prompts the buzzed player to say the answer aloud and confirm', async () => {
  const saidAnswer = vi.fn();
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      saidAnswer,
      game: baseGame({ phase: 'buzzed', buzzedParticipantId: 'me' }),
    }),
  );
  render(<Player />);
  expect(screen.getByText(/скажи ответ вслух/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /я ответил/i }));
  expect(saidAnswer).toHaveBeenCalledOnce();
});

it('shows the answering opponent by name to everyone else', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      participants: [{ id: 'other', name: 'Катя', connected: true }],
      game: baseGame({ phase: 'buzzed', buzzedParticipantId: 'other' }),
    }),
  );
  render(<Player />);
  expect(screen.getByText(/Катя отвечает/i)).toBeInTheDocument();
});

it('shows judging buttons for everyone except the answerer', async () => {
  const vote = vi.fn();
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      vote,
      game: baseGame({ phase: 'judging', buzzedParticipantId: 'other' }),
    }),
  );
  render(<Player />);
  // Якорный regex — /зачёт/i без ^$ ловит и «Зачёт», и «Незачёт» разом,
  // потому что вторая строка содержит первую как подстроку.
  await userEvent.click(screen.getByRole('button', { name: /^зачёт$/i }));
  expect(vote).toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: /^незачёт$/i }));
  expect(vote).toHaveBeenCalledWith(false);
});

it('does not show judging buttons to the answerer themselves, showing a waiting message instead', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      selfId: 'me',
      game: baseGame({ phase: 'judging', buzzedParticipantId: 'me' }),
    }),
  );
  render(<Player />);
  expect(
    screen.queryByRole('button', { name: /^зачёт$/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/ждём решения/i)).toBeInTheDocument();
});

it('shows the reveal result, comment, and updated scores by name', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      participants: [{ id: 'me', name: 'Ваня', connected: true }],
      game: baseGame({
        phase: 'reveal',
        correctAnswer: { text: 'Ответ', comment: 'Комментарий' },
        scores: [{ participantId: 'me', score: 100 }],
      }),
    }),
  );
  render(<Player />);
  expect(screen.getByText('Ответ')).toBeInTheDocument();
  expect(screen.getByText('Комментарий')).toBeInTheDocument();
  expect(screen.getByText(/Ваня: 100/)).toBeInTheDocument();
});

it('shows the intermediate score by name at round-end', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      participants: [{ id: 'me', name: 'Ваня', connected: true }],
      game: baseGame({
        phase: 'round-end',
        scores: [{ participantId: 'me', score: 100 }],
      }),
    }),
  );
  render(<Player />);
  expect(screen.getByText(/следующий раунд/i)).toBeInTheDocument();
  expect(screen.getByText(/Ваня: 100/)).toBeInTheDocument();
});

it('shows the final standings at game-end by name, not raw id', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'game-end',
        scores: [
          { participantId: 'me', score: 300 },
          { participantId: 'other', score: 100 },
        ],
      }),
      participants: [
        { id: 'me', name: 'Я', connected: true },
        { id: 'other', name: 'Другой', connected: true },
      ],
    }),
  );
  render(<Player />);
  expect(screen.getByText(/итог/i)).toBeInTheDocument();
  expect(screen.getByText(/Я: 300/)).toBeInTheDocument();
  expect(screen.getByText(/Другой: 100/)).toBeInTheDocument();
  expect(screen.queryByText('me')).not.toBeInTheDocument();
});
```

Три существующих теста в файле (`calls join with the entered name on submit`, `shows a message once joined instead of the form`, `shows an error when the name is taken`) сейчас строят `RoomConnection` литералом из 5 полей напрямую в `mockedUseRoomConnection.mockReturnValue({...})` — без `game`/`falsestart`/новых методов они перестанут собираться по типам после Task 7. Переписать все три на `connection({ ...тот же набор полей, что и был... })`, ничего не меняя по существу — то же поведение, тот же мок, просто через новый хелпер вместо голого литерала.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — `Player.tsx` пока ничего не знает о фазах игры.

- [ ] **Step 3: Реализовать `Player.tsx`**

```tsx
// client/src/Player.tsx
import { useState, type FormEvent } from 'react';
import { useRoomConnection, type GameStateView } from './useRoomConnection';

export function Player() {
  const {
    status,
    join,
    game,
    selfId,
    participants,
    falsestart,
    startGame,
    selectQuestion,
    buzz,
    saidAnswer,
    vote,
  } = useRoomConnection();
  const [name, setName] = useState('');

  function nameOf(participantId: string | null): string {
    if (!participantId) return '';
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  function scoreboard(scores: GameStateView['scores']) {
    return (
      <ul>
        {[...scores]
          .sort((a, b) => b.score - a.score)
          .map((s) => (
            <li key={s.participantId}>
              {nameOf(s.participantId)}: {s.score}
            </li>
          ))}
      </ul>
    );
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) {
      join(name.trim());
    }
  }

  if (status !== 'joined') {
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

  if (!game) {
    return (
      <div>
        <p>Ты в игре. Жди начала.</p>
        <button onClick={startGame}>Начать игру</button>
      </div>
    );
  }

  const isMyTurn = game.turnParticipantId === selfId;
  const isBuzzedByMe = game.buzzedParticipantId === selfId;

  switch (game.phase) {
    case 'selecting':
      if (!isMyTurn) {
        return <p>Сейчас выбирает {nameOf(game.turnParticipantId)}</p>;
      }
      return (
        <div>
          {game.grid.map((theme) => (
            <div key={theme.themeName}>
              <h2>{theme.themeName}</h2>
              {theme.questions.map((q) => (
                <button
                  key={q.id}
                  disabled={q.answered}
                  onClick={() => selectQuestion(game.grid.indexOf(theme), q.id)}
                >
                  {q.price}
                </button>
              ))}
            </div>
          ))}
        </div>
      );

    case 'question-open':
      return (
        <button onClick={buzz} disabled={falsestart}>
          Жать!
        </button>
      );

    case 'buzzed':
      if (isBuzzedByMe) {
        return (
          <div>
            <p>Скажи ответ вслух</p>
            <button onClick={saidAnswer}>Я ответил</button>
          </div>
        );
      }
      return <p>{nameOf(game.buzzedParticipantId)} отвечает</p>;

    case 'judging':
      if (isBuzzedByMe) {
        return <p>Ждём решения соперников</p>;
      }
      return (
        <div>
          <button onClick={() => vote(true)}>Зачёт</button>
          <button onClick={() => vote(false)}>Незачёт</button>
        </div>
      );

    case 'reveal':
      return (
        <div>
          <p>{game.correctAnswer?.text}</p>
          {game.correctAnswer?.comment && <p>{game.correctAnswer.comment}</p>}
          {scoreboard(game.scores)}
        </div>
      );

    case 'round-end':
      return (
        <div>
          <p>Раунд окончен, следующий раунд начинается</p>
          {scoreboard(game.scores)}
        </div>
      );

    case 'game-end':
      return (
        <div>
          <h2>Итог</h2>
          {scoreboard(game.scores)}
        </div>
      );
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/Player.tsx client/src/Player.test.tsx
git commit -m "feat: drive the player screen from the round phase"
```

---

### Task 9: Страница табло — сетка, вопрос, раскрытие, итог

**Files:**

- Modify: `client/src/Board.tsx`
- Modify: `client/src/Board.test.tsx`

**Interfaces:**

- Consumes: `RoomConnection` (Task 7), в частности `game`, `participants`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// добавить в client/src/Board.test.tsx. Тот же паттерн и те же причины, что
// в Task 8: файл использует vi.mock + mockedUseRoomConnection.mockReturnValue
// с ПОЛНЫМ RoomConnection, поэтому здесь тоже заводятся baseGame/connection
// — идентичные хелперам из Player.test.tsx (сознательное дублирование
// между двумя тестовыми файлами; выносить в общий модуль не требуется ради
// такого маленького совпадения).

import type { GameStateView, RoomConnection } from './useRoomConnection';

function baseGame(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    phase: 'selecting',
    roundIndex: 0,
    grid: [],
    turnParticipantId: '',
    currentQuestion: null,
    buzzedParticipantId: null,
    correctAnswer: null,
    timerDeadline: null,
    scores: [],
    ...overrides,
  };
}

function connection(overrides: Partial<RoomConnection> = {}): RoomConnection {
  return {
    status: 'joined',
    participants: [],
    selfId: null,
    lanUrl: null,
    game: null,
    falsestart: false,
    join: vi.fn(),
    startGame: vi.fn(),
    selectQuestion: vi.fn(),
    buzz: vi.fn(),
    saidAnswer: vi.fn(),
    vote: vi.fn(),
    ...overrides,
  };
}

it('shows the lobby (QR + participants) when no game exists yet', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      lanUrl: 'http://x/',
      participants: [{ id: '1', name: 'Ваня', connected: true }],
      game: null,
    }),
  );
  render(<Board />);
  expect(screen.getByText('Ваня')).toBeInTheDocument();
});

it('shows whose turn it is to pick during selecting', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({ phase: 'selecting', turnParticipantId: '1' }),
      participants: [{ id: '1', name: 'Ваня', connected: true }],
    }),
  );
  render(<Board />);
  expect(screen.getByText(/выбирает Ваня/i)).toBeInTheDocument();
});

it('shows the grid with answered cells greyed out once the game has started', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        grid: [
          {
            themeName: 'Тема',
            questions: [
              { id: 'q1', price: 100, answered: true },
              { id: 'q2', price: 200, answered: false },
            ],
          },
        ],
      }),
    }),
  );
  render(<Board />);
  expect(screen.getByText('200')).toBeInTheDocument();
  expect(screen.queryByText('100')).not.toBeInTheDocument();
});

it('shows the open question text', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'question-open',
        currentQuestion: { text: 'Столица Франции?', price: 100 },
      }),
    }),
  );
  render(<Board />);
  expect(screen.getByText('Столица Франции?')).toBeInTheDocument();
});

it('shows who buzzed', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({ phase: 'buzzed', buzzedParticipantId: '1' }),
      participants: [{ id: '1', name: 'Ваня', connected: true }],
    }),
  );
  render(<Board />);
  expect(screen.getByText(/Ваня/)).toBeInTheDocument();
});

it('shows the correct answer and score on reveal', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'reveal',
        correctAnswer: { text: 'Париж' },
        scores: [{ participantId: '1', score: 100 }],
      }),
      participants: [{ id: '1', name: 'Ваня', connected: true }],
    }),
  );
  render(<Board />);
  expect(screen.getByText('Париж')).toBeInTheDocument();
});

it('shows final standings at game-end', () => {
  mockedUseRoomConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'game-end',
        scores: [
          { participantId: '1', score: 300 },
          { participantId: '2', score: 100 },
        ],
      }),
      participants: [
        { id: '1', name: 'Ваня', connected: true },
        { id: '2', name: 'Катя', connected: true },
      ],
    }),
  );
  render(<Board />);
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Ваня');
});
```

Три существующих теста в файле (`lists connected and disconnected participants`, `shows the LAN url as text and a QR code once known`, `renders neither URL nor QR code before the LAN url is known`) сейчас строят `RoomConnection` литералом из 5 полей напрямую — без `game`/`falsestart`/новых методов они перестанут собираться по типам после Task 7. Переписать все три на `connection({ ...тот же набор полей, что и был... })`, ничего не меняя по существу.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter client test`
Expected: FAIL — `Board.tsx` пока не знает про `game`.

- [ ] **Step 3: Реализовать `Board.tsx`**

```tsx
// client/src/Board.tsx
import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';

export function Board() {
  const { participants, lanUrl, game } = useRoomConnection();

  function nameOf(participantId: string): string {
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  if (!game) {
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

  const scoreboard = (
    <ul>
      {[...game.scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => (
          <li key={s.participantId}>
            {nameOf(s.participantId)}: {s.score}
          </li>
        ))}
    </ul>
  );

  if (game.phase === 'game-end') {
    return (
      <div>
        <h1>Игра окончена</h1>
        {scoreboard}
      </div>
    );
  }

  return (
    <div>
      {game.phase === 'selecting' && (
        <p>Выбирает {nameOf(game.turnParticipantId)}</p>
      )}

      <div>
        {game.grid.map((theme) => (
          <div key={theme.themeName}>
            <h2>{theme.themeName}</h2>
            {theme.questions
              .filter((q) => !q.answered)
              .map((q) => (
                <span key={q.id}>{q.price}</span>
              ))}
          </div>
        ))}
      </div>

      {game.currentQuestion && <p>{game.currentQuestion.text}</p>}

      {game.buzzedParticipantId && (
        <p>{nameOf(game.buzzedParticipantId)} жмёт кнопку</p>
      )}

      {game.correctAnswer && (
        <div>
          <p>{game.correctAnswer.text}</p>
          {game.correctAnswer.comment && <p>{game.correctAnswer.comment}</p>}
        </div>
      )}

      {scoreboard}
    </div>
  );
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `pnpm --filter client test`
Expected: PASS

- [ ] **Step 5: Прогнать полную сборку клиента**

Run: `pnpm --filter client run typecheck && pnpm --filter client test && pnpm --filter client run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/Board.tsx client/src/Board.test.tsx
git commit -m "feat: drive the board screen from the round phase"
```

---

### Task 10: E2E — табло и два игрока разыгрывают два вопроса

**Files:**

- Create: `e2e/round.spec.ts`

**Interfaces:**

- Consumes: реальный собранный сервер+клиент (как в `e2e/lobby.spec.ts`), реальный `packs/current.json`.

- [ ] **Step 1: Написать e2e-сценарий**

```ts
// e2e/round.spec.ts
import { test, expect, type Page } from '@playwright/test';

async function join(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
}

test('board and two players play two questions end to end', async ({
  browser,
}) => {
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto('/board');

  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  await join(a, 'Ваня');

  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await join(b, 'Катя');

  await a.getByRole('button', { name: 'Начать игру' }).click();

  // Кто-то из двоих увидит сетку — определить, чей ход, и довести раунд
  // одним и тем же игроком, чтобы не гадать заранее, кому выпадет первый ход.
  const pickerFirstButtonA = a.getByRole('button', { name: /^\d+$/ }).first();
  const pickerFirstButtonB = b.getByRole('button', { name: /^\d+$/ }).first();
  const [picker, other] = (await pickerFirstButtonA
    .isVisible()
    .catch(() => false))
    ? [a, b]
    : [b, a];

  await expect(board.getByText(/\d/).first()).toBeVisible();

  for (let i = 0; i < 2; i++) {
    await picker.getByRole('button', { name: /^\d+$/ }).first().click();
    await expect(board.locator('p')).toContainText(/\?/);

    // Оба видят кнопку «Жать» — нажимает picker, чтобы сценарий был
    // детерминированным (не зависел от того, кто физически быстрее).
    await picker.getByRole('button', { name: 'Жать!' }).click();
    await picker.getByRole('button', { name: 'Я ответил' }).click();

    await other.getByRole('button', { name: 'Зачёт' }).click();

    // Раскрытие (4с) и, если раунд ещё не разобран, снова 'selecting' —
    // таймеры настоящие, е2е намеренно не мокает время. Дожидаемся, что у
    // picker'а (правильно ответившего — значит, снова его ход) заново
    // появилась кликабельная сетка: это единственный надёжный сигнал, что
    // цикл buzzed → judging → reveal → selecting долистал до конца, не
    // завязанный на конкретный текст конкретного вопроса.
    await expect(
      picker.getByRole('button', { name: /^\d+$/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  await boardContext.close();
  await aContext.close();
  await bContext.close();
});
```

- [ ] **Step 2: Прогнать e2e**

Run: `pnpm run test:e2e`
Expected: PASS. Если тест зависает на ожидании раскрытия — вероятно, реальный таймер `reveal` (4с) плюс сетевые задержки превысили таймаут по умолчанию; уже заложенный `timeout: 10_000` в последнем ожидании — осознанный запас именно под это. Если раунд использует вопросы с ценой 100 первым — таймер вопроса (25с) не должен успеть истечь при обычной скорости прогона теста, так как picker жмёт кнопку сразу после появления вопроса.

- [ ] **Step 3: Commit**

```bash
git add e2e/round.spec.ts
git commit -m "test: add e2e scenario for a full two-question round"
```

---

## Self-Review Notes

Пройдено по всем разделам `docs/superpowers/specs/2026-08-04-base-round-design.md`: движок (Task 2), запуск из лобби (Task 4 — `startGame`), комната и фальстарт (Task 4), счётчик (Task 2 — `scores`/`Record<string, number>`, отдельный от `Participant`), протокол (Task 3), клиенты (Task 8, 9), формат пакета (Task 1), тестирование (юниты движка — Task 2; интеграция комнаты — Task 4, 6; e2e — Task 10), отклонения (таймеры `reveal`/`round-end`, свежий таймер вместо «остатка времени», правило большинства) — всё реализовано явно, ничего не осталось только в дизайн-документе как décor.

Отдельно проверены типы между задачами: `EngineState`/`EngineEvent`/`Effect`/`TimerName` (Task 2) используются в `Room` (Task 4) с теми же именами полей; `GameStateView` (Task 3) — той же формы в `server.ts` (Task 6), `useRoomConnection` (Task 7) и обоих экранах (Task 8, 9); таймерные константы экспортированы из `engine.ts` и переиспользованы в `Room`'е для восстановления после снапшота (Task 4), а не продублированы магическими числами.

## Отклонения от плана

**Task 4, найдено при выполнении (2026-08-04):** реализатор Task 4 корректно остановился и запросил решение вместо того, чтобы гадать — план не учёл два следствия того, что `RoomState` получает обязательное поле `game`:

1. **Существующий тест `Room.join > notifies listeners on successful join`** (в `room.test.ts`, написан ещё во время скелета) проверяет состояние, переданное слушателю, через `toEqual` без поля `game` — с обязательным полем это точное сравнение перестаёт совпадать. Решение: обновить именно эту одну assertion, добавив `game: null` в ожидаемый объект. Это не смена поведения, а приведение устаревшего утверждения в соответствие с полем, которого не существовало на момент его написания — не автономная правка, выходящая за рамки задачи, а прямое следствие её собственного изменения типа.
2. **`server/src/snapshot.ts` и `snapshot.test.ts` тоже перестают собираться по типам** после этой задачи — та же природа, что уже нормализована для `server.ts`/`index.ts` в Task 3 (упоминалось только для них, `snapshot.ts` по ошибке не назвали явно). Остаётся так до Task 5, которая как раз и чинит `snapshot.ts` под новое поле. Отклонения от плана в этом нет — это чистая недосказанность в тексте дозвона к реализатору, не в самом плане: план с самого начала предполагал, что `snapshot.ts` меняется в Task 5, а Task 4 намеренно её не трогает.

Рассмотренная и отклонённая альтернатива: сделать `game` опциональным полем (`game?: EngineState | null`) вместо обязательного, чтобы старые литералы без него продолжали собираться без правок. Отклонено — это создало бы два конкурирующих способа выразить «игры ещё нет» (`undefined` и `null`) вместо одного, ровно та путаница, которой `deserializeSnapshot`'s `parsed.game ?? null` в Task 5 и так предназначена избежать на границе с диском; лучше поправить одну устаревшую assertion, чем размывать инвариант поля на весь остаток плана.

**Task 4, баг в собственном коде плана, найден ревью (2026-08-04):** `applyEffects` в исходном тексте плана сбрасывала `gameTimeoutHandle`/`gameTimerDeadline` внутри `for (const effect of effects)` — при пустом `effects[]` (переходы `'reveal'`/`'round-end'` → `'selecting'`, `'reveal'` → `'game-end'`, все три — фазы без своего таймера) тело цикла не выполняется вообще, и устаревший дедлайн от только что сработавшего таймера остаётся висеть в `toGameStateView().timerDeadline` — для `'game-end'` навсегда, для `'selecting'` до следующего `start-timer`. Не осознанное решение, а недосмотр при написании плана — реализатор Task 4 скопировал код дословно, ревьюер поймал и воспроизвёл. Исправлено переносом сброса на уровень выше цикла, выполняется один раз безусловно; код плана (раздел Task 4, метод `applyEffects`) обновлён на исправленную версию.

**Task 5, баг в собственном коде плана, найден реализатором (2026-08-04):** исходный текст плана менял каст `deserializeSnapshot`'а с `as RoomState` на `as Partial<RoomState>` и заодно (лишнее, не требовалось задачей) добавил `parsed.participants ?? []` — то есть отсутствие `participants` в JSON стало бы тихо превращаться в пустой массив вместо броска. Это ломает уже существующий, специально написанный ещё во время скелета тест «throws on well-formed JSON that is not a room state», который полагается именно на то, что `.map` на `undefined` бросает `TypeError` — так комната отличает порчу данных от нормального случая. `game`, в отличие от `participants`, дефолтить обязательно нужно — старые снапшоты, записанные до этой вехи, никогда его не содержали, и это не порча, а более старая версия формата; `participants` же был обязателен всегда, и его отсутствие — это именно порча. Реализатор сам поймал несостыковку до всякого ревью (при прогоне существующего теста), оставил `parsed.participants!.map(...)` без дефолта и продефолтил только `game`. Код плана (раздел Task 5) обновлён на исправленную версию с комментарием, объясняющим асимметрию.

**Task 6, неполнота примера в плане, найдена реализатором (2026-08-04):** блок кода Task 6 показывал только обновление `broadcastState` (добавление `game` в рассылаемое состояние), но в `server.ts` есть второе место, отправляющее `ServerMessage` с типом `'state'` — начальный `send(ws, {type:'state', ...})` сразу после `hello` при подключении нового сокета. Это место в код плана не попало вообще, не только с ошибкой — план просто не показал его. Реализатор обнаружил это по ошибке typecheck (поле `game` стало обязательным в Task 3) и добавил `game: room.toGameStateView()` туда же. Не отклонение от явного решения плана, а восполнение пробела в примере кода — план для этой задачи не был исчерпывающим.

**Task 7, неверный тестовый фреймворк в плане, найдено до диспетчеризации (2026-08-04):** исходный текст плана для Task 7 писал новые тесты под API библиотеки `mock-socket` (`renderConnection()`, `server.connected`, `server.send`, `expect(server).toReceiveMessage(...)`) — но в реальном `client/src/useRoomConnection.test.ts` такой библиотеки и такого хелпера нет вообще. Файл с самого начала (со времён скелета) использует рукописный класс `FakeWebSocket` (методы `emitOpen()`/`emitMessage()`, поле `sent`) и передаёт его как `wsFactory` напрямую в `useRoomConnection(factory)`, без всякого мок-сервера с отдельным сетевым уровнем. Тесты в исходном тексте плана просто не собрались бы и не заработали бы против этого файла — это не опечатка в деталях, а целиком выдуманный, никогда не существовавший в проекте API. Поймано при чтении реального файла перед диспетчеризацией задачи, до того как реализатор успел на это наткнуться. Код плана (раздел Task 7, Step 1) переписан на реальный паттерн `FakeWebSocket`/`renderHook`/`act`, один в один с уже существующими тестами того же файла.

**Tasks 8 и 9, тот же класс несоответствия, найдено до диспетчеризации (2026-08-04):** по тому же поводу, что и Task 7 — исходный текст плана для `Player.test.tsx`/`Board.test.tsx` предполагал несуществующий хелпер `mockUseRoomConnection(partial)`, принимающий частичный объект. Реальный файл использует `vi.mock('./useRoomConnection', () => ({ useRoomConnection: vi.fn() }))` и `mockedUseRoomConnection.mockReturnValue({...ПОЛНЫЙ объект...})` — каждый вызов задаёт весь `RoomConnection` целиком, без слияния с дефолтами. С 12 полями в `RoomConnection` после Task 7 (было 5) писать это вручную в каждом из ~18 тестов было бы избыточным дублированием, поэтому код плана для обеих задач переписан на два локальных хелпера-фабрики (`baseGame`/`connection`) с разумными дефолтами и `...overrides` — то же самое `mockReturnValue`, просто без повторения всех полей каждый раз. Заодно учтено: три теста, уже существующих в каждом файле до этой вехи, тоже перестанут собираться без `game`/`falsestart`/новых методов — их нужно завернуть в `connection({...})` с тем же набором полей, что и раньше, без изменения сути.

**Task 8, два бага в собственном коде плана, найдены реализатором (2026-08-04):**

1. Тест «shows judging buttons for everyone except the answerer» использовал `screen.getByRole('button', { name: /зачёт/i })` без якорей `^$` — эта регулярка ловит и «Зачёт», и «Незачёт» разом, потому что вторая строка содержит первую как подстроку, а `getByRole` с неоднозначным совпадением падает с ошибкой «multiple elements found». То же самое во втором тесте («does not show judging buttons to the answerer themselves»), где `queryByRole` с той же регуляркой возвращал бы не тот элемент. Исправлено на `/^зачёт$/i`/`/^незачёт$/i`.
2. `Player.tsx`: `theme.questions.map((q, questionIndexInTheme) => (...))` — второй параметр `questionIndexInTheme` объявлялся, но нигде не использовался (индекс темы вычислялся отдельно через `game.grid.indexOf(theme)`), что валит строгий `tsc -b` клиента (`noUnusedParameters`). Исправлено удалением неиспользуемого параметра.

Оба — механические недосмотры при написании плана, не осознанные решения; реализатор поймал оба сам при прогоне тестов/тайпчека до всякого ревью. Код плана (Task 8, Step 1 и Step 3) обновлён на исправленные версии.

**Task 8, пропущенные требования из дизайн-документа, найдены ревью (2026-08-04):** код `Player.tsx` в исходном тексте плана не выполнял таблицу фаз из `docs/superpowers/specs/2026-08-04-base-round-design.md` («Клиенты») полностью:

1. Фазы `reveal` и `round-end` в таблице явно требуют «обновлённый счёт» / «промежуточный счёт», а код плана их не показывал вообще.
2. `game-end` показывал сырой `participantId` вместо имени, хотя `participants` (с именами) уже доступен через хук.
3. Строки таблицы для «не мой ход» (`selecting`) и «не я отвечаю» (`buzzed`) используют «Х» как явный плейсхолдер для имени конкретного игрока — код плана вместо этого подставлял общую фразу («другой игрок», «Соперник»), не показывая, о ком конкретно речь.

Это не баг в смысле опечатки — задача была не полностью специфицирована в исходном коде плана относительно уже принятого дизайна, и тесты плана тоже не проверяли эти требования (тест «shows the reveal result and updated scores» проверял только текст ответа, не сам счёт — прошёл бы одинаково, даже если счёт вообще убрать из разметки). Реализатор реализовал код плана как есть, не мог обнаружить это сам без сверки с дизайн-документом построчно — ревью поймало прямым сопоставлением таблицы с кодом. Исправлено: в `Player.tsx` добавлены `nameOf()` и `scoreboard()`, используются во всех перечисленных местах; тесты плана (Task 8, Step 1) переписаны так, чтобы реально проверять имена и счёт, а не только наличие текста, который остался бы неизменным при удалении этой функциональности.

**Task 9, пропущенное требование исходной спеки, найдено до диспетчеризации (2026-08-04):** после разбора замечаний Task 8 код `Board.tsx` в плане был сверен с исходной спекой (`2026-08-03-svoya-igra-design.md`) построчно по каждой фазе, а не только с кратким пересказом в `2026-08-04-base-round-design.md`. Исходная спека прямо говорит про фазу ВЫБОР ВОПРОСА: «Остальные видят на табло, чей сейчас ход» — а в кратком пересказе дизайн-документа этой вехи («сетка, крупный текст вопроса, имя нажавшего, результат и комментарий, live-счёт, итог») эта строка потерялась при сокращении, и код плана для `Board.tsx`, соответственно, тоже никогда не показывал, чей ход. Остальные пункты фазовой таблицы (промежуточный счёт на КОНЦЕ РАУНДА, ответ на СУДЕЙСТВЕ) уже были покрыты — код показывает `scoreboard` во всех нетерминальных фазах и `correctAnswer` в течение и судейства, и раскрытия (оба используют одно и то же поле `GameStateView.correctAnswer`, которое `Room.toGameStateView()` уже заполняет для обеих фаз). Исправлено: в `Board.tsx` добавлен блок `{game.phase === 'selecting' && <p>Выбирает {nameOf(...)}</p>}`, дизайн-документ этой вехи дополнен явной строкой про «чей ход», плюс новый тест.
