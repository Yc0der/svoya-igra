# Финал со ставками — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить к уже играбельному базовому раунду (Веха 1) финал со ставками (Веха 2): отсев тем, тайная ставка, текстовый ответ, судейство ведущего по всем сразу, итоговый расклад — чтобы веха была играбельна сама по себе, от лобби до итогового табло с финалом.

**Architecture:** Тот же чистый движок-редьюсер (`server/src/engine.ts`) расширяется пятью новыми фазами вместо отдельного модуля — согласовано с уже принятым в проекте принципом «Комната и Движок — единственные модули с логикой». `Room` (уже существует) получает тонкие методы-обёртки, зеркалящие уже существующий паттерн (`selectQuestion`/`vote`/…), и расширяет `toGameStateView` тем же паттерном персональных состояний, что уже применён к `correctAnswer`.

**Tech Stack:** То же, что и в предыдущих вехах — TypeScript, Node (`ws`, `sirv`), React 19 + Vite, Vitest, Playwright. Новых зависимостей не добавляется.

## Global Constraints

- Дизайн зафиксирован в `docs/superpowers/specs/2026-08-05-final-round-design.md`, которая опирается на `docs/superpowers/specs/2026-08-03-svoya-igra-design.md` и `docs/superpowers/specs/2026-08-04-base-round-design.md` — при любом сомнении сверяться с этими файлами, не додумывать.
- Ровно один финальный вопрос: отсев тем до одной, затем ставка → ответ → суд → раскрытие.
- Отсев — по кругу, по возрастанию текущего счёта счётчика; при равенстве — по порядку, в котором сформирован список счётчиков (design.md «Правила финала»).
- **Ведущий обязателен в финале всегда, даже при двух счётчиках** — это отдельное правило от стартового (там ведущий нужен только с 3+ счётчиков). Правило старта партии **не меняется**.
- Если по завершении последнего обычного раунда `pack.final` отсутствует **или** `hostId === null` — финал пропускается, партия сразу переходит в `game-end`, как и раньше.
- Ставка — на `[0, max(0, текущий счёт счётчика)]`, движок сам зажимает присланное число, клиенту не доверяет.
- Тайм-ауты: не пришедшая вовремя ставка → `0`; не пришедший вовремя ответ → `''` (считается неверным); не отмеченный вовремя вердикт → `false` (незачёт).
- Судейство: ведущий видит все ставки и ответы сразу, отмечает верно/неверно по каждому счётчику в любом порядке; очки применяются разом, когда отмечены все (или истёк таймер).
- Таймеры (прикидка на глаз, как и все остальные в проекте — уточняются после живой игры): `final-elim` 20000мс, `final-wager` 20000мс, `final-answer` 45000мс, `final-judging` 60000мс, `final-reveal` 10000мс.
- `pack.final.themes` — минимум два элемента, у финального вопроса нет `price` и `type`.
- Движок не читает часы, диск и сеть — время приходит только как событие `timer-expired` (тот же инвариант, что и везде).
- Панель ведущего (±очки/отмена вопроса) в финальных фазах не показывается — там уже есть свой интерфейс проверки.

---

## File Structure

**`server/src/`**

- `pack.ts` — модифицируется: тип `FinalTheme`, поле `Pack.final?`, валидация.
- `pack.test.ts` — модифицируется.
- `engine.ts` — модифицируется: пять новых `Phase`, новые поля `EngineState`, новые `EngineEvent`/`Effect`/`TimerName`, вся логика `final-elim`/`final-wager`/`final-answer`/`final-judging`/`final-reveal`.
- `engine.test.ts` — модифицируется.
- `protocol.ts` — модифицируется: новые клиентские сообщения, новые поля `GameStateView`.
- `room.ts` — модифицируется: `PHASE_TIMER` пополняется, новые методы-обёртки, `toGameStateView` расширяется.
- `room.test.ts` — модифицируется.
- `server.ts` — модифицируется: диспетчеризация четырёх новых типов сообщений.
- `server.test.ts` — модифицируется.
- `snapshot.ts` — **без изменений**: `EngineState` целиком проходит через `JSON.stringify`/`JSON.parse` уже сейчас (`serializeSnapshot`/`deserializeSnapshot` не перечисляют поля `game` по одному), новые плоские поля (`Record`/`number | null`/`string | null`) переживают это автоматически.
- `index.ts` — модифицируется (Task 10): `PORT`/`SNAPSHOT_PATH`/`PACK_PATH` читают `process.env.*` поверх дефолта — нужно, чтобы E2E-сценарий финала мог поднять второй процесс сервера на своём порту со своим маленьким пакетом, не трогая тот, которым пользуются `lobby.spec.ts`/`round.spec.ts`.

**`packs/`**

- `current.json` — модифицируется: добавляется `final` с тремя темами.

**`client/src/`**

- `useRoomConnection.ts` — модифицируется: `GameStateView` зеркалит протокол, `ClientMessage` — новые типы, `RoomConnection` — новые действия.
- `useRoomConnection.test.ts` — модифицируется.
- `Player.tsx` — модифицируется: пять новых веток по фазе + расширение `hostAdminPanel`-подобного интерфейса для судейства.
- `Player.test.tsx` — модифицируется.
- `Board.tsx` — модифицируется: три новых ветки по фазе (`final-elim`/`final-wager`+`final-answer`/`final-reveal`).
- `Board.test.tsx` — модифицируется.
- `index.css` — модифицируется: стили для списка тем финала, форм ставки/ответа, таблицы судейства/раскрытия.

**`e2e/`**

- `round.spec.ts`, `lobby.spec.ts` — **без изменений**.
- `reset-snapshot.mjs` — модифицируется (Task 10): путь до файла снапшота становится аргументом, чтобы обслуживать оба `webServer`.
- `global-setup.ts` — новый (Task 10). Собирает клиент+сервер один раз до старта обоих `webServer`.
- `fixtures/final-pack.json` — новый (Task 10). Маленький пакет для E2E-сценария финала.
- `final.spec.ts` — новый. Табло, два игрока и ведущий разыгрывают весь финал.

**Корень репозитория**

- `playwright.config.ts` — модифицируется (Task 10): второй `webServer` на порту 8081 со своим пакетом/снапшотом, `projects` разводят спеки по `baseURL`, `globalSetup` вместо сборки внутри команды сервера.
- `.gitignore` — модифицируется (Task 10): игнорируется файл снапшота второго сервера.

---

### Task 1: Формат пакета — `Pack.final`

**Files:**

- Modify: `server/src/pack.ts`
- Test: `server/src/pack.test.ts`

**Interfaces:**

- Produces: `interface FinalTheme { name: string; question: { id: string; text: string; answer: string; comment?: string } }`, `Pack.final?: { themes: FinalTheme[] }`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// server/src/pack.test.ts — добавить в конец файла

describe('validatePack — final', () => {
  function withFinal(themes: unknown) {
    const data = validPackData() as Record<string, unknown>;
    data.final = { themes };
    return data;
  }

  it('accepts a well-formed final block', () => {
    const data = withFinal([
      {
        name: 'Финал A',
        question: { id: 'f1', text: 'F1?', answer: 'ответ f1' },
      },
      {
        name: 'Финал B',
        question: { id: 'f2', text: 'F2?', answer: 'ответ f2', comment: 'к.' },
      },
    ]);
    const pack = validatePack(data);
    expect(pack.final).toEqual({
      themes: [
        {
          name: 'Финал A',
          question: {
            id: 'f1',
            text: 'F1?',
            answer: 'ответ f1',
            comment: undefined,
          },
        },
        {
          name: 'Финал B',
          question: {
            id: 'f2',
            text: 'F2?',
            answer: 'ответ f2',
            comment: 'к.',
          },
        },
      ],
    });
  });

  it('is undefined when the pack has no final block', () => {
    expect(validatePack(validPackData()).final).toBeUndefined();
  });

  it('rejects a final block with fewer than two themes', () => {
    const data = withFinal([
      { name: 'Финал A', question: { id: 'f1', text: 'F1?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/final/);
  });

  it('rejects a final theme with an empty name', () => {
    const data = withFinal([
      { name: '', question: { id: 'f1', text: 'F1?', answer: 'x' } },
      { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/name/);
  });

  it('rejects a final question missing an answer', () => {
    const data = withFinal([
      { name: 'А', question: { id: 'f1', text: 'F1?' } },
      { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/answer/);
  });

  it('rejects a final question id that collides with a round question id', () => {
    const data = validPackData() as Record<string, unknown>;
    data.final = {
      themes: [
        // 'q1' переиспользует id, уже занятый round[0].themes[0].questions[0]
        // в validPackData() — проверка уникальности должна видеть весь пакет
        // целиком, не только rounds.
        { name: 'А', question: { id: 'q1', text: 'F1?', answer: 'x' } },
        { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
      ],
    };
    expect(() => validatePack(data)).toThrow(/повторяющийся id/);
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter server test -- pack.test.ts`
Expected: FAIL — `final` не существует на типе `Pack`, `validatePack` не читает это поле.

- [ ] **Step 3: Реализовать**

```ts
// server/src/pack.ts

export interface FinalTheme {
  name: string;
  question: {
    id: string;
    text: string;
    answer: string;
    comment?: string;
  };
}

export interface Pack {
  title: string;
  author: string;
  createdAt: string;
  rounds: Round[];
  final?: { themes: FinalTheme[] };
}
```

Добавить после `validateQuestion`:

```ts
function validateFinalQuestion(
  data: unknown,
  where: string,
): FinalTheme['question'] {
  const question = requireRecord(data, where);
  const id = requireNonEmptyString(question.id, `${where}.id`);
  const text = requireNonEmptyString(question.text, `${where}.text`);
  const answer = requireNonEmptyString(question.answer, `${where}.answer`);
  if (question.comment !== undefined && typeof question.comment !== 'string') {
    throw new Error(`${where}.comment: если есть, должно быть строкой`);
  }
  return { id, text, answer, comment: question.comment as string | undefined };
}

function validateFinalTheme(data: unknown, where: string): FinalTheme {
  const theme = requireRecord(data, where);
  const name = requireNonEmptyString(theme.name, `${where}.name`);
  const question = validateFinalQuestion(theme.question, `${where}.question`);
  return { name, question };
}

function validateFinal(data: unknown, where: string): { themes: FinalTheme[] } {
  const final = requireRecord(data, where);
  const themesData = requireArray(final.themes, `${where}.themes`);
  if (themesData.length < 2) {
    throw new Error(`${where}.themes: должно быть минимум две темы`);
  }
  const themes = themesData.map((t, i) =>
    validateFinalTheme(t, `${where}.themes[${i}]`),
  );
  return { themes };
}
```

`checkUniqueQuestionIds` должна видеть и финальные id — расширить сигнатуру, чтобы принимать необязательный финальный блок:

```ts
function checkUniqueQuestionIds(
  rounds: Round[],
  final: { themes: FinalTheme[] } | undefined,
): void {
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (seen.has(question.id)) {
          throw new Error(
            `пакет: повторяющийся id вопроса "${question.id}" — id должны быть уникальны на весь пакет`,
          );
        }
        seen.add(question.id);
      }
    }
  }
  if (final) {
    for (const theme of final.themes) {
      if (seen.has(theme.question.id)) {
        throw new Error(
          `пакет: повторяющийся id вопроса "${theme.question.id}" — id должны быть уникальны на весь пакет`,
        );
      }
      seen.add(theme.question.id);
    }
  }
}
```

И в `validatePack`:

```ts
export function validatePack(data: unknown): Pack {
  const pack = requireRecord(data, 'пакет');
  const title = requireString(pack.title, 'пакет.title');
  const author = requireString(pack.author, 'пакет.author');
  const createdAt = requireString(pack.createdAt, 'пакет.createdAt');
  const roundsData = requireArray(pack.rounds, 'пакет.rounds');
  const rounds = roundsData.map((r, i) =>
    validateRound(r, `пакет.rounds[${i}]`),
  );
  const final =
    pack.final !== undefined
      ? validateFinal(pack.final, 'пакет.final')
      : undefined;
  checkUniqueQuestionIds(rounds, final);
  return { title, author, createdAt, rounds, final };
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter server test -- pack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/pack.ts server/src/pack.test.ts
git commit -m "feat: add optional final block to the pack format"
```

---

### Task 2: Движок — фазы финала

**Files:**

- Modify: `server/src/engine.ts`
- Test: `server/src/engine.test.ts`

**Interfaces:**

- Consumes: `Pack.final` (Task 1).
- Produces: `Phase` включает `'final-elim' | 'final-wager' | 'final-answer' | 'final-judging' | 'final-reveal'`; `EngineState` включает `finalRemainingThemeIndices: number[] | null`, `finalElimCounterId: string | null`, `finalThemeIndex: number | null`, `finalWagers: Record<string, number>`, `finalAnswers: Record<string, string>`, `finalVerdicts: Record<string, boolean>`; `EngineEvent` включает `eliminate-final-theme`/`submit-wager`/`submit-final-answer`/`final-vote`; `TimerName` включает пять новых имён; константы `FINAL_ELIM_TIMER_MS`, `FINAL_WAGER_TIMER_MS`, `FINAL_ANSWER_TIMER_MS`, `FINAL_JUDGING_TIMER_MS`, `FINAL_REVEAL_TIMER_MS`.

- [ ] **Step 1: Написать падающие тесты**

Файл уже импортирует таймерные константы из `./engine.js` (`import { createInitialState, reduce, QUESTION_TIMER_MS, SAID_ANSWER_TIMER_MS, VOTE_TIMER_MS, REVEAL_TIMER_MS, ROUND_END_TIMER_MS, type EngineState } from './engine.js';`) — расширить этот импорт пятью новыми: `FINAL_ELIM_TIMER_MS, FINAL_WAGER_TIMER_MS, FINAL_ANSWER_TIMER_MS, FINAL_JUDGING_TIMER_MS, FINAL_REVEAL_TIMER_MS`. Тесты ниже их используют.

```ts
// server/src/engine.test.ts — добавить рядом с makePack/PACK

const FINAL_PACK = makePack({
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
      {
        name: 'Финал C',
        question: { id: 'f3', text: 'F3?', answer: 'ответ f3' },
      },
    ],
  },
});

// Строит EngineState прямо в final-elim, минуя весь предыдущий раунд —
// unit-тестам финала не нужно доигрывать до него через select/buzz/vote.
function finalElimState(scores: Record<string, number>): EngineState {
  const ordered = Object.keys(scores).sort((a, b) => scores[a] - scores[b]);
  return {
    ...createInitialState(FINAL_PACK, Object.keys(scores), 'judge'),
    phase: 'final-elim',
    scores,
    finalRemainingThemeIndices: [0, 1, 2],
    finalElimCounterId: ordered[0],
  };
}

describe('final round transition', () => {
  it('starts final-elim after the last round when a final pack and a host exist', () => {
    let state = createInitialState(FINAL_PACK, ['p1', 'p2'], 'judge');
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
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('final-elim');
    expect(next.finalRemainingThemeIndices).toEqual([0, 1, 2]);
    expect(['p1', 'p2']).toContain(next.finalElimCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });

  it('goes straight to game-end after the last round when the pack has no final block', () => {
    let state = createInitialState(PACK, ['p1', 'p2'], 'judge');
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
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
  });

  it('goes straight to game-end after the last round when there is no host (two counters)', () => {
    let state = createInitialState(FINAL_PACK, ['p1', 'p2']); // hostId по умолчанию null
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    // hostId === null: голосует единственный не отвечавший, разрешается
    // немедленно тем же путём, что уже покрыт в 'vote' — здесь важен только
    // конечный переход после последнего раунда, поэтому идём по тайм-ауту.
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
  });
});

describe('eliminate-final-theme', () => {
  it('removes the theme and advances the turn to the next counter by ascending score', () => {
    const state = finalElimState({ p1: 100, p2: 0, p3: 50 });
    expect(state.finalElimCounterId).toBe('p2');
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p2',
      themeIndex: 0,
    });
    expect(next.phase).toBe('final-elim');
    expect(next.finalRemainingThemeIndices).toEqual([1, 2]);
    expect(next.finalElimCounterId).toBe('p3');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });

  it('moves to final-wager once a single theme remains', () => {
    const state = {
      ...finalElimState({ p1: 0, p2: 100 }),
      finalRemainingThemeIndices: [1, 2],
    };
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 1,
    });
    expect(next.phase).toBe('final-wager');
    expect(next.finalRemainingThemeIndices).toEqual([2]);
    expect(next.finalThemeIndex).toBe(2);
    expect(next.finalElimCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
    ]);
  });

  it('is a no-op from someone other than finalElimCounterId', () => {
    const state = finalElimState({ p1: 100, p2: 0 });
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 0,
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op for an already-eliminated theme', () => {
    const state = {
      ...finalElimState({ p1: 0, p2: 100 }),
      finalRemainingThemeIndices: [1, 2],
    };
    const { state: next } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 0,
    });
    expect(next).toEqual(state);
  });
});

describe('timer-expired: final-elim', () => {
  it('eliminates a random remaining theme and keeps going', () => {
    const state = finalElimState({ p1: 0, p2: 100 });
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-elim',
    });
    expect(next.finalRemainingThemeIndices).toHaveLength(2);
    expect(next.finalElimCounterId).toBe('p2');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });
});

function finalWagerState(scores: Record<string, number>): EngineState {
  return {
    ...finalElimState(scores),
    phase: 'final-wager',
    finalRemainingThemeIndices: [1],
    finalThemeIndex: 1,
    finalElimCounterId: null,
  };
}

describe('submit-wager', () => {
  it('clamps the amount to [0, score]', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 9999,
    });
    expect(next.finalWagers.p1).toBe(300);
  });

  it('clamps a negative amount up to zero', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: -50,
    });
    expect(next.finalWagers.p1).toBe(0);
  });

  it('clamps the maximum to zero when the score is negative', () => {
    const state = finalWagerState({ p1: -100, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    });
    expect(next.finalWagers.p1).toBe(0);
  });

  it('moves to final-answer once every counter has wagered', () => {
    let state = finalWagerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    }).state;
    expect(state.phase).toBe('final-wager');
    const { state: next, effects } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p2',
      amount: 100,
    });
    expect(next.phase).toBe('final-answer');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ]);
  });

  it('is a no-op outside final-wager', () => {
    const state = finalElimState({ p1: 0, p2: 100 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 10,
    });
    expect(next).toEqual(state);
  });
});

describe('timer-expired: final-wager', () => {
  it('defaults missing wagers to 0 and moves to final-answer', () => {
    let state = finalWagerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-wager',
    });
    expect(next.phase).toBe('final-answer');
    expect(next.finalWagers).toEqual({ p1: 50, p2: 0 });
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ]);
  });
});

function finalAnswerState(scores: Record<string, number>): EngineState {
  return {
    ...finalWagerState(scores),
    phase: 'final-answer',
    finalWagers: Object.fromEntries(Object.keys(scores).map((id) => [id, 0])),
  };
}

describe('submit-final-answer', () => {
  it('moves to final-judging once every counter has answered', () => {
    let state = finalAnswerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p1',
      text: 'ответ p1',
    }).state;
    expect(state.phase).toBe('final-answer');
    const { state: next, effects } = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p2',
      text: 'ответ p2',
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalAnswers).toEqual({ p1: 'ответ p1', p2: 'ответ p2' });
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'final-judging',
        ms: FINAL_JUDGING_TIMER_MS,
      },
    ]);
  });
});

describe('timer-expired: final-answer', () => {
  it('defaults missing answers to an empty string and moves to final-judging', () => {
    let state = finalAnswerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p1',
      text: 'ответ p1',
    }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-answer',
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalAnswers).toEqual({ p1: 'ответ p1', p2: '' });
  });
});

function finalJudgingState(
  scores: Record<string, number>,
  wagers: Record<string, number>,
): EngineState {
  return {
    ...finalAnswerState(scores),
    phase: 'final-judging',
    finalWagers: wagers,
    finalAnswers: Object.fromEntries(
      Object.keys(scores).map((id) => [id, 'x']),
    ),
  };
}

describe('final-vote', () => {
  it('is a no-op from someone other than the host', () => {
    const state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 50 });
    const { state: next } = reduce(state, {
      type: 'final-vote',
      requesterId: 'p1',
      counterId: 'p2',
      correct: true,
    });
    expect(next).toEqual(state);
  });

  it('does not resolve on a partial set of verdicts', () => {
    const state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 50 });
    const { state: next, effects } = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalVerdicts).toEqual({ p1: true });
    expect(effects).toEqual([]);
  });

  it('applies scores by wager and moves to final-reveal once every counter is judged', () => {
    let state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 80 });
    state = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    }).state;
    const { state: next, effects } = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p2',
      correct: false,
    });
    expect(next.phase).toBe('final-reveal');
    expect(next.scores).toEqual({ p1: 150, p2: 120 });
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'final-reveal',
        ms: FINAL_REVEAL_TIMER_MS,
      },
    ]);
  });
});

describe('timer-expired: final-judging', () => {
  it('defaults missing verdicts to false, applies scores, and moves to final-reveal', () => {
    let state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 80 });
    state = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-judging',
    });
    expect(next.phase).toBe('final-reveal');
    // p1 отмечен верно вручную (+50 -> 150); p2 не отмечен -> незачёт по
    // умолчанию (-80 -> 120).
    expect(next.scores).toEqual({ p1: 150, p2: 120 });
  });
});

describe('timer-expired: final-reveal', () => {
  it('moves to game-end', () => {
    const state: EngineState = {
      ...finalJudgingState({ p1: 150, p2: 120 }, { p1: 50, p2: 80 }),
      phase: 'final-reveal',
    };
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-reveal',
    });
    expect(next.phase).toBe('game-end');
    expect(effects).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter server test -- engine.test.ts`
Expected: FAIL — новых типов/полей/веток ещё нет.

- [ ] **Step 3: Реализовать**

```ts
// server/src/engine.ts — правки по всему файлу

export type Phase =
  | 'selecting'
  | 'question-open'
  | 'buzzed'
  | 'judging'
  | 'reveal'
  | 'round-end'
  | 'final-elim'
  | 'final-wager'
  | 'final-answer'
  | 'final-judging'
  | 'final-reveal'
  | 'game-end';

export type TimerName =
  | 'question'
  | 'said-answer'
  | 'vote'
  | 'reveal'
  | 'round-end'
  | 'final-elim'
  | 'final-wager'
  | 'final-answer'
  | 'final-judging'
  | 'final-reveal';

export const FINAL_ELIM_TIMER_MS = 20_000;
export const FINAL_WAGER_TIMER_MS = 20_000;
export const FINAL_ANSWER_TIMER_MS = 45_000;
export const FINAL_JUDGING_TIMER_MS = 60_000;
export const FINAL_REVEAL_TIMER_MS = 10_000;

export interface EngineState {
  // ...существующие поля без изменений...
  finalRemainingThemeIndices: number[] | null;
  finalElimCounterId: string | null;
  finalThemeIndex: number | null;
  finalWagers: Record<string, number>;
  finalAnswers: Record<string, string>;
  finalVerdicts: Record<string, boolean>;
}

export type EngineEvent =
  | /* ...существующие варианты без изменений... */
  | { type: 'eliminate-final-theme'; counterId: string; themeIndex: number }
  | { type: 'submit-wager'; counterId: string; amount: number }
  | { type: 'submit-final-answer'; counterId: string; text: string }
  | {
      type: 'final-vote';
      requesterId: string;
      counterId: string;
      correct: boolean;
    };
```

`createInitialState` — добавить новые поля в возвращаемый объект:

```ts
export function createInitialState(
  pack: Pack,
  counterIds: string[],
  hostId: string | null = null,
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
    votes: {},
    scores,
    lastCorrectCounterId: null,
    hostId,
    finalRemainingThemeIndices: null,
    finalElimCounterId: null,
    finalThemeIndex: null,
    finalWagers: {},
    finalAnswers: {},
    finalVerdicts: {},
  };
}
```

`reduce()` — добавить ветки в `switch`:

```ts
export function reduce(state: EngineState, event: EngineEvent): Result {
  switch (event.type) {
    // ...существующие case без изменений...
    case 'eliminate-final-theme':
      return handleEliminateFinalTheme(state, event);
    case 'submit-wager':
      return handleSubmitWager(state, event);
    case 'submit-final-answer':
      return handleSubmitFinalAnswer(state, event);
    case 'final-vote':
      return handleFinalVote(state, event);
  }
}
```

Порядок счётчиков по возрастанию счёта — общий helper, используется и при старте финала, и при передаче хода:

```ts
function ascendingByScore(state: EngineState): string[] {
  return [...Object.keys(state.scores)].sort(
    (a, b) => state.scores[a] - state.scores[b],
  );
}
```

`afterReveal` — заменить последний `return` на переход в финал:

```ts
function afterReveal(state: EngineState): Result {
  const base = { ...state, currentQuestion: null };
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
  return startFinalOrEnd(base);
}

// Финал требует ведущего всегда, даже при двух счётчиках — это отдельное
// правило от стартового (design.md, финал-спека, «Правила финала»). Партия
// на двоих без ведущего или партия по пакету без final играется как раньше,
// без изменений.
function startFinalOrEnd(state: EngineState): Result {
  if (!state.pack.final || state.hostId === null) {
    return { state: { ...state, phase: 'game-end' }, effects: [] };
  }
  const ordered = ascendingByScore(state);
  return {
    state: {
      ...state,
      phase: 'final-elim',
      finalRemainingThemeIndices: state.pack.final.themes.map((_, i) => i),
      finalElimCounterId: ordered[0],
    },
    effects: [
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ],
  };
}
```

Обработчики новых событий — добавить в конец файла, рядом с существующими `handle*`:

```ts
function handleEliminateFinalTheme(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'eliminate-final-theme' }>,
): Result {
  if (
    state.phase !== 'final-elim' ||
    event.counterId !== state.finalElimCounterId ||
    !state.finalRemainingThemeIndices?.includes(event.themeIndex)
  ) {
    return unchanged(state);
  }
  return eliminateFinalTheme(state, event.themeIndex);
}

function eliminateFinalTheme(state: EngineState, themeIndex: number): Result {
  const remaining = state.finalRemainingThemeIndices!.filter(
    (i) => i !== themeIndex,
  );
  if (remaining.length === 1) {
    return {
      state: {
        ...state,
        phase: 'final-wager',
        finalRemainingThemeIndices: remaining,
        finalThemeIndex: remaining[0],
        finalElimCounterId: null,
      },
      effects: [
        { type: 'start-timer', timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
      ],
    };
  }
  const ordered = ascendingByScore(state);
  const turnIndex = ordered.indexOf(state.finalElimCounterId!);
  const nextCounterId = ordered[(turnIndex + 1) % ordered.length];
  return {
    state: {
      ...state,
      finalRemainingThemeIndices: remaining,
      finalElimCounterId: nextCounterId,
    },
    effects: [
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ],
  };
}

function handleSubmitWager(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'submit-wager' }>,
): Result {
  if (state.phase !== 'final-wager' || !(event.counterId in state.scores)) {
    return unchanged(state);
  }
  const max = Math.max(0, state.scores[event.counterId]);
  const amount = Math.min(max, Math.max(0, event.amount));
  const wagers = { ...state.finalWagers, [event.counterId]: amount };
  if (Object.keys(wagers).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalWagers: wagers });
  }
  return startFinalAnswer({ ...state, finalWagers: wagers });
}

function startFinalAnswer(state: EngineState): Result {
  return {
    state: { ...state, phase: 'final-answer' },
    effects: [
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ],
  };
}

function resolveWagers(state: EngineState): Result {
  const wagers = { ...state.finalWagers };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in wagers)) wagers[counterId] = 0;
  }
  return startFinalAnswer({ ...state, finalWagers: wagers });
}

function handleSubmitFinalAnswer(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'submit-final-answer' }>,
): Result {
  if (state.phase !== 'final-answer' || !(event.counterId in state.scores)) {
    return unchanged(state);
  }
  const answers = { ...state.finalAnswers, [event.counterId]: event.text };
  if (Object.keys(answers).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalAnswers: answers });
  }
  return startFinalJudging({ ...state, finalAnswers: answers });
}

function startFinalJudging(state: EngineState): Result {
  return {
    state: { ...state, phase: 'final-judging' },
    effects: [
      {
        type: 'start-timer',
        timer: 'final-judging',
        ms: FINAL_JUDGING_TIMER_MS,
      },
    ],
  };
}

function resolveAnswers(state: EngineState): Result {
  const answers = { ...state.finalAnswers };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in answers)) answers[counterId] = '';
  }
  return startFinalJudging({ ...state, finalAnswers: answers });
}

function handleFinalVote(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'final-vote' }>,
): Result {
  if (
    state.phase !== 'final-judging' ||
    state.hostId === null ||
    event.requesterId !== state.hostId ||
    !(event.counterId in state.scores)
  ) {
    return unchanged(state);
  }
  const verdicts = { ...state.finalVerdicts, [event.counterId]: event.correct };
  if (Object.keys(verdicts).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalVerdicts: verdicts });
  }
  return applyFinalVerdicts({ ...state, finalVerdicts: verdicts });
}

function applyFinalVerdicts(state: EngineState): Result {
  const scores = { ...state.scores };
  for (const counterId of Object.keys(scores)) {
    const wager = state.finalWagers[counterId] ?? 0;
    const correct = state.finalVerdicts[counterId] ?? false;
    scores[counterId] = scores[counterId] + (correct ? wager : -wager);
  }
  return {
    state: { ...state, phase: 'final-reveal', scores },
    effects: [
      { type: 'start-timer', timer: 'final-reveal', ms: FINAL_REVEAL_TIMER_MS },
    ],
  };
}

function resolveFinalVerdicts(state: EngineState): Result {
  const verdicts = { ...state.finalVerdicts };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in verdicts)) verdicts[counterId] = false;
  }
  return applyFinalVerdicts({ ...state, finalVerdicts: verdicts });
}
```

`handleTimerExpired` — добавить пять новых `case`:

```ts
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
    case 'final-elim': {
      const remaining = state.finalRemainingThemeIndices!;
      const randomIndex =
        remaining[Math.floor(Math.random() * remaining.length)];
      return eliminateFinalTheme(state, randomIndex);
    }
    case 'final-wager':
      return resolveWagers(state);
    case 'final-answer':
      return resolveAnswers(state);
    case 'final-judging':
      return resolveFinalVerdicts(state);
    case 'final-reveal':
      return { state: { ...state, phase: 'game-end' }, effects: [] };
  }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter server test -- engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine.ts server/src/engine.test.ts
git commit -m "feat: add final round phases to the game engine"
```

---

### Task 3: Протокол — новые сообщения

**Files:**

- Modify: `server/src/protocol.ts`

**Interfaces:**

- Consumes: `Phase`/`FinalTheme` (Task 1, 2).
- Produces: `ClientMessage` включает `eliminate-final-theme`/`submit-wager`/`submit-final-answer`/`final-vote`; `GameStateView` включает `finalThemes`/`finalElimParticipantId`/`finalQuestion`/`finalWagers`/`finalAnswers`/`finalVerdicts`.

- [ ] **Step 1: Внести правки**

```ts
// server/src/protocol.ts

export interface GameStateView {
  // ...существующие поля без изменений...
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  // Персональные, тем же паттерном что correctAnswer (Room.toGameStateView):
  // обычному игроку — только его собственная запись (или пустой массив, пока
  // не отправил); ведущему на final-judging и всем на final-reveal — все.
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
}

export type ClientMessage =
  | /* ...существующие варианты без изменений... */
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean };
```

Типизация `Phase` уже реэкспортируется из `engine.ts` (`import type { Phase } from './engine.js'`) — новые фазы подхватываются автоматически, отдельной правки не требуется.

- [ ] **Step 2: Проверить типы**

Run: `pnpm --filter server typecheck`
Expected: FAIL пока (Room/server ещё не знают новых полей/событий — это ожидаемо, следующие задачи это закроют). Если на этом шаге типы уже проходят — значит нигде ничего не потребляет новые поля, что тоже нормально на этом этапе.

- [ ] **Step 3: Commit**

```bash
git add server/src/protocol.ts
git commit -m "feat: add final round messages to the protocol"
```

---

### Task 4: Комната — методы и таймеры финала

**Files:**

- Modify: `server/src/room.ts`
- Test: `server/src/room.test.ts`

**Interfaces:**

- Consumes: `EngineEvent`/`EngineState`/`TimerName`/`Phase` (Task 2), `GameStateView` (Task 3).
- Produces: `Room.eliminateFinalTheme(participantId, themeIndex)`, `Room.submitWager(participantId, amount)`, `Room.submitFinalAnswer(participantId, text)`, `Room.finalVote(requesterId, targetParticipantId, correct)`.

- [ ] **Step 1: Написать падающие тесты**

Файл уже импортирует `QUESTION_TIMER_MS` из `./engine.js` (`import { QUESTION_TIMER_MS } from './engine.js';`) — расширить эту строку до `import { QUESTION_TIMER_MS, REVEAL_TIMER_MS } from './engine.js';`, новые тесты ниже используют `REVEAL_TIMER_MS`. `Pack` уже импортирован дальше в файле (`import type { Pack } from './pack.js';`) — новый `FINAL_PACK` ниже использует его.

```ts
// server/src/room.test.ts — добавить рядом с существующими game-flow тестами.
// Повторить локальный FINAL_PACK (final с двумя темами) по тому же образцу,
// что уже используется в этом файле для PACK/HOST-тестов — если в файле уже
// есть подходящий helper для построения пакета, расширить final через него.

const FINAL_PACK: Pack = {
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

describe('Room final round', () => {
  // turnCounterId (кто выбирает первый вопрос) выбирается движком случайно
  // между двумя счётчиками (engine.ts, createInitialState) — нельзя жёстко
  // считать picker'ом конкретного из a/b, иначе тест плавает примерно в
  // половине прогонов. driveToFinalWager сам определяет, чей ход, доигрывает
  // единственный вопрос пакета верным ответом от него (получает +100),
  // гасит reveal-таймер и вычёркивает вторую тему от имени того, кто не
  // отвечал (у него счёт меньше — он и ходит первым в final-elim), приводя
  // партию к final-wager. Возвращает { picker, other }, чтобы вызывающий тест
  // не гадал, кто есть кто.
  function driveToFinalWager(
    room: Room,
    a: string,
    b: string,
    host: string,
  ): { picker: string; other: string } {
    const picker = room.getState().game?.turnCounterId === a ? a : b;
    const other = picker === a ? b : a;
    room.selectQuestion(picker, 0, 'q1');
    room.buzz(picker);
    room.saidAnswer(picker);
    room.vote(host, true); // судейство с ведущим — решает сразу
    vi.advanceTimersByTime(REVEAL_TIMER_MS);
    room.eliminateFinalTheme(other, 0);
    return { picker, other };
  }

  it('submitWager clamps and reflects in scores only once judged', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);

    expect(room.getState().game?.phase).toBe('final-wager');
    room.submitWager(picker, 999); // клэмп до текущего счёта picker'а (100)
    room.submitWager(other, 0);
    expect(room.getState().game?.phase).toBe('final-answer');
    expect(room.getState().game?.finalWagers).toEqual({
      [picker]: 100,
      [other]: 0,
    });

    vi.useRealTimers();
  });

  it('submitFinalAnswer moves to final-judging once everyone answered', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);

    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');
    expect(room.getState().game?.phase).toBe('final-judging');

    vi.useRealTimers();
  });

  it('finalVote from the host applies scores and reaches final-reveal', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    room.finalVote(host, picker, true);
    room.finalVote(host, other, false);

    const state = room.getState();
    expect(state.game?.phase).toBe('final-reveal');
    expect(state.game?.scores[picker]).toBe(150);
    expect(state.game?.scores[other]).toBe(0);

    vi.useRealTimers();
  });

  it('finalVote from someone other than the host is ignored', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    room.finalVote(picker, other, true); // picker не ведущий
    expect(room.getState().game?.phase).toBe('final-judging');

    vi.useRealTimers();
  });

  it("toGameStateView hides other counters' wagers and answers from a non-host viewer, but shows everything to the host on final-judging and to everyone on final-reveal", () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 20);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    const pickerView = room.toGameStateView(picker);
    expect(pickerView?.finalWagers).toEqual([
      { participantId: picker, amount: 50 },
    ]);
    expect(pickerView?.finalAnswers).toEqual([
      { participantId: picker, text: 'ответ picker' },
    ]);

    const hostView = room.toGameStateView(host);
    expect(hostView?.finalWagers).toHaveLength(2);
    expect(hostView?.finalAnswers).toHaveLength(2);

    room.finalVote(host, picker, true);
    room.finalVote(host, other, true);

    const pickerRevealView = room.toGameStateView(picker);
    expect(pickerRevealView?.finalWagers).toHaveLength(2);
    expect(pickerRevealView?.finalVerdicts).toHaveLength(2);

    vi.useRealTimers();
  });

  it('restores the final-elim timer after restoring from a snapshot mid-final', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const picker = room.getState().game?.turnCounterId === a ? a : b;
    const other = picker === a ? b : a;
    room.selectQuestion(picker, 0, 'q1');
    room.buzz(picker);
    room.saidAnswer(picker);
    room.vote(host, true);
    vi.advanceTimersByTime(REVEAL_TIMER_MS);
    const snapshot = room.getState();
    expect(snapshot.game?.phase).toBe('final-elim');

    const restored = new Room(snapshot, FINAL_PACK);
    // Сработает только если таймер/фаза восстановлены штатно — other ходит
    // первым (счёт 0 против picker'а 100).
    restored.eliminateFinalTheme(other, 0);
    expect(restored.getState().game?.phase).toBe('final-wager');

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter server test -- room.test.ts`
Expected: FAIL — методов `eliminateFinalTheme`/`submitWager`/`submitFinalAnswer`/`finalVote` ещё нет.

- [ ] **Step 3: Реализовать**

```ts
// server/src/room.ts

import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  FINAL_ELIM_TIMER_MS,
  FINAL_WAGER_TIMER_MS,
  FINAL_ANSWER_TIMER_MS,
  FINAL_JUDGING_TIMER_MS,
  FINAL_REVEAL_TIMER_MS,
  type EngineState,
  type EngineEvent,
  type Effect,
  type Phase,
  type TimerName,
} from './engine.js';
```

```ts
const PHASE_TIMER: Partial<Record<Phase, { timer: TimerName; ms: number }>> = {
  'question-open': { timer: 'question', ms: QUESTION_TIMER_MS },
  buzzed: { timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
  judging: { timer: 'vote', ms: VOTE_TIMER_MS },
  reveal: { timer: 'reveal', ms: REVEAL_TIMER_MS },
  'round-end': { timer: 'round-end', ms: ROUND_END_TIMER_MS },
  'final-elim': { timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
  'final-wager': { timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
  'final-answer': { timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
  'final-judging': { timer: 'final-judging', ms: FINAL_JUDGING_TIMER_MS },
  'final-reveal': { timer: 'final-reveal', ms: FINAL_REVEAL_TIMER_MS },
};
```

Новые методы — добавить в класс `Room` рядом с `cancelQuestion`:

```ts
  eliminateFinalTheme(participantId: string, themeIndex: number): void {
    this.dispatch({
      type: 'eliminate-final-theme',
      counterId: participantId,
      themeIndex,
    });
  }

  submitWager(participantId: string, amount: number): void {
    this.dispatch({ type: 'submit-wager', counterId: participantId, amount });
  }

  submitFinalAnswer(participantId: string, text: string): void {
    this.dispatch({
      type: 'submit-final-answer',
      counterId: participantId,
      text,
    });
  }

  // Панель ведущего в финале — тем же паттерном, что adjustScore/
  // cancelQuestion: requesterId настоящий отправитель, не то, что клиент о
  // себе заявляет; движок сам сверяет requesterId === hostId.
  finalVote(
    requesterId: string,
    targetParticipantId: string,
    correct: boolean,
  ): void {
    this.dispatch({
      type: 'final-vote',
      requesterId,
      counterId: targetParticipantId,
      correct,
    });
  }
```

`toGameStateView` — расширить возвращаемый объект:

```ts
  toGameStateView(viewerId: string | null = null): GameStateView | null {
    if (!this.game) return null;
    const game = this.game;
    const round = game.pack.rounds[game.roundIndex];
    const currentQuestionData = game.currentQuestion
      ? round.themes[game.currentQuestion.themeIndex].questions.find(
          (q) => q.id === game.currentQuestion!.questionId,
        )
      : undefined;

    const showAnswer =
      game.phase === 'reveal' ||
      (game.phase === 'judging' &&
        (game.hostId === null || viewerId === game.hostId));

    // Ведущему на final-judging нужно видеть ставки/ответы всех, чтобы
    // судить (design.md, финал-спека, «Комната») — та же причина, по которой
    // на judging только ему виден correctAnswer. На final-reveal видно всем,
    // ставка/ответ соперника уже не секрет — партия окончена.
    const showAllFinal =
      game.phase === 'final-reveal' ||
      (game.phase === 'final-judging' && viewerId === game.hostId);

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
      graceExcludedParticipantId: this.stillGraceExcluded()
        ? this.graceExcludedCounterId
        : null,
      graceExcludedUntil: this.stillGraceExcluded()
        ? this.graceExcludedUntil
        : null,
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
      finalThemes: game.finalRemainingThemeIndices
        ? game.pack.final!.themes.map((theme, i) => ({
            name: theme.name,
            eliminated: !game.finalRemainingThemeIndices!.includes(i),
          }))
        : null,
      finalElimParticipantId: game.finalElimCounterId,
      finalQuestion:
        game.finalThemeIndex !== null &&
        (game.phase === 'final-answer' ||
          game.phase === 'final-judging' ||
          game.phase === 'final-reveal')
          ? { text: game.pack.final!.themes[game.finalThemeIndex].question.text }
          : null,
      finalWagers:
        game.finalThemeIndex === null
          ? null
          : Object.entries(game.finalWagers)
              .filter(([counterId]) => showAllFinal || counterId === viewerId)
              .map(([participantId, amount]) => ({ participantId, amount })),
      finalAnswers:
        game.finalThemeIndex === null
          ? null
          : Object.entries(game.finalAnswers)
              .filter(([counterId]) => showAllFinal || counterId === viewerId)
              .map(([participantId, text]) => ({ participantId, text })),
      finalVerdicts:
        game.phase === 'final-judging' || game.phase === 'final-reveal'
          ? Object.entries(game.finalVerdicts)
              .filter(() => showAllFinal)
              .map(([participantId, correct]) => ({ participantId, correct }))
          : null,
    };
  }
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter server test -- room.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: wire the final round into Room"
```

---

### Task 5: Сервер — диспетчеризация сообщений финала

**Files:**

- Modify: `server/src/server.ts`
- Test: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `Room.eliminateFinalTheme`/`submitWager`/`submitFinalAnswer`/`finalVote` (Task 4), `ClientMessage` (Task 3).

- [ ] **Step 1: Написать падающий тест**

Файл уже импортирует `VOTE_TIMER_MS` из `./engine.js` (`import { VOTE_TIMER_MS } from './engine.js';`) — расширить эту строку до `import { REVEAL_TIMER_MS, VOTE_TIMER_MS } from './engine.js';`, новый тест ниже использует `REVEAL_TIMER_MS` для отсчёта шагов таймера.

```ts
// server/src/server.test.ts — добавить в конец describe('createServer game flow')
// или отдельным describe рядом с 'createServer host mode'

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

      a.ws.send(JSON.stringify({ type: 'start-game' }));
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
          { participantId: other.participantId, score: -20 },
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
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `pnpm --filter server test -- server.test.ts`
Expected: FAIL — сервер ещё не диспетчеризует `eliminate-final-theme`/`submit-wager`/`submit-final-answer`/`final-vote`.

- [ ] **Step 3: Реализовать**

```ts
// server/src/server.ts — добавить в обработчик ws.on('message', ...) рядом
// с уже существующими if-блоками (после 'cancel-question')

if (message.type === 'eliminate-final-theme') {
  const participantId = connections.get(ws);
  if (participantId && typeof message.themeIndex === 'number') {
    room.eliminateFinalTheme(participantId, message.themeIndex);
  }
}

if (message.type === 'submit-wager') {
  const participantId = connections.get(ws);
  if (participantId && typeof message.amount === 'number') {
    room.submitWager(participantId, message.amount);
  }
}

if (message.type === 'submit-final-answer') {
  const participantId = connections.get(ws);
  if (participantId && typeof message.text === 'string') {
    room.submitFinalAnswer(participantId, message.text);
  }
}

if (message.type === 'final-vote') {
  const participantId = connections.get(ws);
  if (
    participantId &&
    typeof message.participantId === 'string' &&
    typeof message.correct === 'boolean'
  ) {
    room.finalVote(participantId, message.participantId, message.correct);
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `pnpm --filter server test -- server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts server/src/server.test.ts
git commit -m "feat: dispatch final round messages over the transport"
```

---

### Task 6: `useRoomConnection` — состояние и действия финала

**Files:**

- Modify: `client/src/useRoomConnection.ts`
- Test: `client/src/useRoomConnection.test.ts`

**Interfaces:**

- Consumes: `ClientMessage`/`GameStateView`/`ServerMessage` (Task 3, зеркалятся в клиентском файле — этот проект не шарит типы протокола между `server/` и `client/`, см. существующий `GameStateView` в `useRoomConnection.ts`).
- Produces: `RoomConnection.eliminateFinalTheme(themeIndex)`, `.submitWager(amount)`, `.submitFinalAnswer(text)`, `.finalVote(participantId, correct)`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// client/src/useRoomConnection.test.ts — расширить существующий тест
// 'sends start-game/select-question/buzz/said-answer/vote as the matching
// client messages' четырьмя новыми действиями (тот же `socket`/`act`/
// `socket.sent`, никакого нового хелпера заводить не нужно — паттерн уже
// есть в файле, см. этот же тест и FakeWebSocket выше него).

    act(() => result.current.eliminateFinalTheme(1));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'eliminate-final-theme', themeIndex: 1 }),
    );

    act(() => result.current.submitWager(150));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'submit-wager', amount: 150 }),
    );

    act(() => result.current.submitFinalAnswer('мой ответ'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'submit-final-answer', text: 'мой ответ' }),
    );

    act(() => result.current.finalVote('p2', false));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'final-vote',
        participantId: 'p2',
        correct: false,
      }),
    );
  });
```

Добавить эти четыре блока в конец уже существующего теста (перед его закрывающей `});`), а не заводить отдельные новые `it(...)` — файл уже проверяет `start-game`/`select-question`/`buzz`/`said-answer`/`vote` этим же способом в одном тесте, и новые действия следуют тому же паттерну на том же `socket`.

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter client test -- useRoomConnection.test.ts`
Expected: FAIL — `eliminateFinalTheme`/`submitWager`/`submitFinalAnswer`/`finalVote` не существуют на `RoomConnection`.

- [ ] **Step 3: Реализовать**

```ts
// client/src/useRoomConnection.ts

export interface GameStateView {
  phase:
    | 'selecting'
    | 'question-open'
    | 'buzzed'
    | 'judging'
    | 'reveal'
    | 'round-end'
    | 'final-elim'
    | 'final-wager'
    | 'final-answer'
    | 'final-judging'
    | 'final-reveal'
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
  graceExcludedParticipantId: string | null;
  graceExcludedUntil: number | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
}
```

```ts
type ClientMessage =
  | /* ...существующие варианты без изменений... */
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean };
```

```ts
export interface RoomConnection {
  // ...существующие поля без изменений...
  eliminateFinalTheme(themeIndex: number): void;
  submitWager(amount: number): void;
  submitFinalAnswer(text: string): void;
  finalVote(participantId: string, correct: boolean): void;
}
```

В возвращаемом объекте `useRoomConnection` — рядом с `cancelQuestion`:

```ts
    eliminateFinalTheme: (themeIndex) =>
      send({ type: 'eliminate-final-theme', themeIndex }),
    submitWager: (amount) => send({ type: 'submit-wager', amount }),
    submitFinalAnswer: (text) =>
      send({ type: 'submit-final-answer', text }),
    finalVote: (participantId, correct) =>
      send({ type: 'final-vote', participantId, correct }),
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter client test -- useRoomConnection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts
git commit -m "feat: expose final round actions from useRoomConnection"
```

---

### Task 7: Экран игрока — финальные фазы

**Files:**

- Modify: `client/src/Player.tsx`
- Modify: `client/src/index.css`
- Test: `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `RoomConnection` (Task 6).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// client/src/Player.test.tsx — добавить рядом с существующими тестами по фазам

it('final-elim: highlights my turn and eliminates a theme on click', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-elim',
      finalThemes: [
        { name: 'Финал A', eliminated: false },
        { name: 'Финал B', eliminated: false },
      ],
      finalElimParticipantId: 'self',
    },
    selfId: 'self',
  });
  fireEvent.click(screen.getByText('Финал A'));
  expect(mockConnection.eliminateFinalTheme).toHaveBeenCalledWith(0);
});

it('final-elim: shows whose turn it is when it is not mine', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-elim',
      finalThemes: [{ name: 'Финал A', eliminated: false }],
      finalElimParticipantId: 'other',
    },
    selfId: 'self',
    participants: [{ id: 'other', name: 'Катя', connected: true }],
  });
  expect(screen.getByText(/Катя/)).toBeInTheDocument();
});

it('final-wager: submits a clamped wager', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-wager',
      finalThemes: [{ name: 'Финал A', eliminated: false }],
      scores: [{ participantId: 'self', score: 200 }],
    },
    selfId: 'self',
  });
  fireEvent.change(screen.getByLabelText('Ставка'), {
    target: { value: '150' },
  });
  fireEvent.click(screen.getByText('Готово'));
  expect(mockConnection.submitWager).toHaveBeenCalledWith(150);
});

it('final-wager: the host sees a waiting message, not a wager form', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-wager',
      finalThemes: [{ name: 'Финал A', eliminated: false }],
    },
    selfId: 'host',
    hostParticipantId: 'host',
  });
  expect(screen.queryByLabelText('Ставка')).not.toBeInTheDocument();
  expect(screen.getByText(/Игроки делают ставки/)).toBeInTheDocument();
});

it('final-answer: submits the typed answer', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-answer',
      finalQuestion: { text: 'Вопрос финала?' },
    },
    selfId: 'self',
  });
  fireEvent.change(screen.getByLabelText('Ответ'), {
    target: { value: 'мой ответ' },
  });
  fireEvent.click(screen.getByText('Готово'));
  expect(mockConnection.submitFinalAnswer).toHaveBeenCalledWith('мой ответ');
});

it('final-answer: the host sees a waiting message, not an answer form', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-answer',
      finalQuestion: { text: 'Вопрос финала?' },
    },
    selfId: 'host',
    hostParticipantId: 'host',
  });
  expect(screen.queryByLabelText('Ответ')).not.toBeInTheDocument();
  expect(screen.getByText(/Игроки пишут ответы/)).toBeInTheDocument();
});

it('final-judging: host sees every wager and answer with verdict buttons', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-judging',
      finalWagers: [
        { participantId: 'p1', amount: 50 },
        { participantId: 'p2', amount: 20 },
      ],
      finalAnswers: [
        { participantId: 'p1', text: 'ответ 1' },
        { participantId: 'p2', text: 'ответ 2' },
      ],
    },
    selfId: 'host',
    hostParticipantId: 'host',
    participants: [
      { id: 'p1', name: 'Ваня', connected: true },
      { id: 'p2', name: 'Катя', connected: true },
    ],
  });
  const yesButtons = screen.getAllByText('Верно');
  fireEvent.click(yesButtons[0]);
  expect(mockConnection.finalVote).toHaveBeenCalledWith('p1', true);
});

it('final-judging: non-host waits', () => {
  renderPlayer({
    game: { ...baseGame(), phase: 'final-judging' },
    selfId: 'p1',
    hostParticipantId: 'host',
  });
  expect(screen.getByText(/Ведущий проверяет/)).toBeInTheDocument();
});

it('final-reveal: shows wagers, answers, verdicts and updated scores', () => {
  renderPlayer({
    game: {
      ...baseGame(),
      phase: 'final-reveal',
      finalWagers: [{ participantId: 'p1', amount: 50 }],
      finalAnswers: [{ participantId: 'p1', text: 'ответ 1' }],
      finalVerdicts: [{ participantId: 'p1', correct: true }],
      scores: [{ participantId: 'p1', score: 150 }],
    },
    selfId: 'p1',
    participants: [{ id: 'p1', name: 'Ваня', connected: true }],
  });
  expect(screen.getByText('ответ 1')).toBeInTheDocument();
  expect(screen.getByText('150')).toBeInTheDocument();
});
```

Если в файле ещё нет хелперов `renderPlayer`/`baseGame`/`mockConnection` — использовать те же, которыми уже пользуются существующие тесты фаз (`selecting`/`judging`/…), не создавая параллельный набор.

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter client test -- Player.test.tsx`
Expected: FAIL — `switch (game.phase)` не обрабатывает новые фазы.

- [ ] **Step 3: Реализовать**

```tsx
// client/src/Player.tsx — добавить деструктуризацию новых полей действий

const {
  // ...существующие поля без изменений...
  eliminateFinalTheme,
  submitWager,
  submitFinalAnswer,
  finalVote,
} = useRoomConnection();
const [wagerInput, setWagerInput] = useState('');
const [answerInput, setAnswerInput] = useState('');

useEffect(() => {
  if (game?.phase !== 'final-wager') setWagerInput('');
  if (game?.phase !== 'final-answer') setAnswerInput('');
}, [game?.phase]);
```

Добавить пять новых `case` в `phaseContent` (после `'game-end'`, порядок в самом `switch` неважен, но фазы должны идти после существующих):

```tsx
      case 'final-elim': {
        const isMyElimTurn = game.finalElimParticipantId === selfId;
        return (
          <div className="player">
            <h2>Финал — выбор темы</h2>
            {!isMyElimTurn && (
              <p>Сейчас выбирает {nameOf(game.finalElimParticipantId)}</p>
            )}
            <ul className="final-theme-list">
              {game.finalThemes?.map((theme, i) => (
                <li key={theme.name} className={theme.eliminated ? 'is-eliminated' : ''}>
                  <button
                    className="button"
                    disabled={!isMyElimTurn || theme.eliminated}
                    onClick={() => eliminateFinalTheme(i)}
                  >
                    {theme.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      }

      case 'final-wager': {
        // Ведущий не счётчик (не в game.scores) — он не ставит, движок молча
        // проигнорировал бы его submit-wager (handleSubmitWager проверяет
        // event.counterId in state.scores). Показывать ему форму ставки было
        // бы обманом интерфейса: клик выглядел бы рабочим, но ни на что не
        // влиял бы — тот же принцип, что уже применён к кнопке «Ответ» на
        // question-open (design.md, «Клиенты»).
        if (isHost) {
          return (
            <div className="player player--center">
              <h2>Финал — ставка</h2>
              <p>Игроки делают ставки…</p>
            </div>
          );
        }
        const myScore =
          game.scores.find((s) => s.participantId === selfId)?.score ?? 0;
        const max = Math.max(0, myScore);
        return (
          <div className="player player--center">
            <h2>Финал — ставка</h2>
            <p>{game.finalThemes?.find((t) => !t.eliminated)?.name}</p>
            <label htmlFor="wager">Ставка</label>
            <input
              id="wager"
              type="number"
              min={0}
              max={max}
              value={wagerInput}
              onChange={(e) => setWagerInput(e.target.value)}
            />
            <button
              className="button button--primary"
              onClick={() =>
                submitWager(
                  Math.min(max, Math.max(0, Number(wagerInput) || 0)),
                )
              }
            >
              Готово
            </button>
          </div>
        );
      }

      case 'final-answer':
        if (isHost) {
          return (
            <div className="player player--center">
              <h2>Финал — ответ</h2>
              <p className="board-question">{game.finalQuestion?.text}</p>
              <p>Игроки пишут ответы…</p>
            </div>
          );
        }
        return (
          <div className="player player--center">
            <h2>Финал — ответ</h2>
            <p className="board-question">{game.finalQuestion?.text}</p>
            <label htmlFor="final-answer">Ответ</label>
            <input
              id="final-answer"
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
            />
            <button
              className="button button--primary"
              onClick={() => submitFinalAnswer(answerInput)}
            >
              Готово
            </button>
          </div>
        );

      case 'final-judging':
        if (isHost) {
          return (
            <div className="player">
              <h2>Финал — проверка ответов</h2>
              <ul className="final-judging-list">
                {game.finalAnswers?.map((a) => {
                  const wager = game.finalWagers?.find(
                    (w) => w.participantId === a.participantId,
                  )?.amount;
                  return (
                    <li key={a.participantId}>
                      <span className="final-judging-name">
                        {nameOf(a.participantId)}
                      </span>
                      <span className="final-judging-wager">{wager}</span>
                      <span className="final-judging-answer">{a.text}</span>
                      <button
                        className="button button--yes"
                        onClick={() => finalVote(a.participantId, true)}
                      >
                        Верно
                      </button>
                      <button
                        className="button button--no"
                        onClick={() => finalVote(a.participantId, false)}
                      >
                        Неверно
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }
        return (
          <div className="player player--center">
            <p>Ведущий проверяет ответы…</p>
          </div>
        );

      case 'final-reveal':
        return (
          <div className="player">
            <h2>Финал — итог</h2>
            <ul className="final-judging-list">
              {game.finalAnswers?.map((a) => {
                const wager = game.finalWagers?.find(
                  (w) => w.participantId === a.participantId,
                )?.amount;
                const correct = game.finalVerdicts?.find(
                  (v) => v.participantId === a.participantId,
                )?.correct;
                return (
                  <li key={a.participantId}>
                    <span className="final-judging-name">
                      {nameOf(a.participantId)}
                    </span>
                    <span className="final-judging-wager">{wager}</span>
                    <span className="final-judging-answer">{a.text}</span>
                    <span>{correct ? '✓' : '✗'}</span>
                  </li>
                );
              })}
            </ul>
            {scoreboard(game.scores)}
          </div>
        );
```

`game-end` остаётся последним `case`, без изменений — итоговое табло уже показывает `game.scores`, которые уже включают исход финала (движок применил ставки в `applyFinalVerdicts` до перехода в `final-reveal` → `game-end`).

Панель ведущего (`hostAdminPanel`) в финальных фазах не показывается — обернуть существующий рендер условием:

```tsx
const isFinalPhase =
  game?.phase === 'final-elim' ||
  game?.phase === 'final-wager' ||
  game?.phase === 'final-answer' ||
  game?.phase === 'final-judging' ||
  game?.phase === 'final-reveal';

return isHost && !isFinalPhase ? (
  <>
    {phaseContent}
    {hostAdminPanel()}
  </>
) : (
  phaseContent
);
```

Добавить в `index.css`:

```css
.final-theme-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 400px;
}

/* Табло (Board.tsx) кладёт вычеркнутое имя темы прямо текстом в <li>, без
   кнопки внутри — а игрок (Player.tsx) оборачивает его в .button. Общее
   правило на .is-eliminated покрывает текст табло; более специфичное
   .is-eliminated .button переопределяет его для игрока, где перечёркивать
   нужно саму кнопку, а не невидимый текстовый узел вокруг неё. */
.final-theme-list .is-eliminated {
  text-decoration: line-through;
  opacity: 0.35;
}

.final-theme-list .is-eliminated .button {
  text-decoration: line-through;
  opacity: 1;
}

.final-judging-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 700px;
}

.final-judging-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.final-judging-name {
  min-width: 80px;
  font-weight: 600;
}

.final-judging-wager {
  font-family: var(--mono);
  color: var(--accent);
  min-width: 48px;
  text-align: right;
}

.final-judging-answer {
  flex: 1;
  text-align: left;
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter client test -- Player.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/Player.tsx client/src/Player.test.tsx client/src/index.css
git commit -m "feat: add final round screens to the player client"
```

---

### Task 8: Экран табло — финальные фазы

**Files:**

- Modify: `client/src/Board.tsx`
- Modify: `client/src/index.css`
- Test: `client/src/Board.test.tsx`

**Interfaces:**

- Consumes: `RoomConnection.game` (Task 6).

- [ ] **Step 1: Написать падающие тесты**

```tsx
// client/src/Board.test.tsx — добавить рядом с существующими тестами по фазам

it('final-elim: shows the theme list with eliminated ones struck out', () => {
  renderBoard({
    game: {
      ...baseGame(),
      phase: 'final-elim',
      finalThemes: [
        { name: 'Финал A', eliminated: true },
        { name: 'Финал B', eliminated: false },
      ],
      finalElimParticipantId: 'p1',
    },
    participants: [{ id: 'p1', name: 'Ваня', connected: true }],
  });
  expect(screen.getByText('Финал A')).toHaveClass('is-eliminated');
  expect(screen.getByText(/Ваня/)).toBeInTheDocument();
});

it('final-wager and final-answer: shows the theme name and question without revealing wagers/answers', () => {
  renderBoard({
    game: {
      ...baseGame(),
      phase: 'final-answer',
      finalThemes: [{ name: 'Финал A', eliminated: false }],
      finalQuestion: { text: 'Вопрос финала?' },
    },
  });
  expect(screen.getByText('Вопрос финала?')).toBeInTheDocument();
  expect(screen.queryByText(/ответ/)).not.toBeInTheDocument();
});

it('final-reveal: shows the full wager/answer/verdict table and updated scores', () => {
  renderBoard({
    game: {
      ...baseGame(),
      phase: 'final-reveal',
      finalWagers: [{ participantId: 'p1', amount: 50 }],
      finalAnswers: [{ participantId: 'p1', text: 'ответ 1' }],
      finalVerdicts: [{ participantId: 'p1', correct: true }],
      scores: [{ participantId: 'p1', score: 150 }],
    },
    participants: [{ id: 'p1', name: 'Ваня', connected: true }],
  });
  expect(screen.getByText('ответ 1')).toBeInTheDocument();
  expect(screen.getByText('150')).toBeInTheDocument();
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `pnpm --filter client test -- Board.test.tsx`
Expected: FAIL

- [ ] **Step 3: Реализовать**

```tsx
// client/src/Board.tsx

if (game.phase === 'final-elim') {
  return (
    <div className="board">
      <h1>Финал — выбор темы</h1>
      <p className="board-status">
        Сейчас выбирает{' '}
        <strong>{nameOf(game.finalElimParticipantId ?? '')}</strong>
      </p>
      <ul className="final-theme-list">
        {game.finalThemes?.map((theme) => (
          <li
            key={theme.name}
            className={theme.eliminated ? 'is-eliminated' : ''}
          >
            {theme.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

if (
  game.phase === 'final-wager' ||
  game.phase === 'final-answer' ||
  game.phase === 'final-judging'
) {
  return (
    <div className="board">
      <h1>Финал</h1>
      <p className="board-status">
        {game.finalThemes?.find((t) => !t.eliminated)?.name}
      </p>
      {game.finalQuestion && (
        <p className="board-question">{game.finalQuestion.text}</p>
      )}
      {game.phase === 'final-judging' && (
        <p className="board-status">Ведущий проверяет ответы…</p>
      )}
    </div>
  );
}

if (game.phase === 'final-reveal') {
  return (
    <div className="board">
      <h1>Финал — итог</h1>
      <ul className="final-judging-list">
        {game.finalAnswers?.map((a) => {
          const wager = game.finalWagers?.find(
            (w) => w.participantId === a.participantId,
          )?.amount;
          const correct = game.finalVerdicts?.find(
            (v) => v.participantId === a.participantId,
          )?.correct;
          return (
            <li key={a.participantId}>
              <span className="final-judging-name">
                {nameOf(a.participantId)}
              </span>
              <span className="final-judging-wager">{wager}</span>
              <span className="final-judging-answer">{a.text}</span>
              <span>{correct ? '✓' : '✗'}</span>
            </li>
          );
        })}
      </ul>
      {scoreboard}
    </div>
  );
}
```

Вставить этот блок **после** проверки `if (game.phase === 'game-end')` и **до** финального `return` с обычной сеткой раунда — так же, как остальные ранние `return` по фазе уже устроены в этом файле.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pnpm --filter client test -- Board.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/Board.tsx client/src/Board.test.tsx client/src/index.css
git commit -m "feat: add final round screens to the board client"
```

---

### Task 9: Тестовый пакет — добавить финал

**Files:**

- Modify: `packs/current.json`

**Interfaces:**

- Consumes: формат `final` (Task 1).

- [ ] **Step 1: Добавить блок `final`**

```json
{
  "final": {
    "themes": [
      {
        "name": "Мифология",
        "question": {
          "id": "final-myth",
          "text": "Какой титан держит небесный свод на своих плечах в древнегреческих мифах?",
          "answer": "Атлант"
        }
      },
      {
        "name": "Космос",
        "question": {
          "id": "final-space",
          "text": "Как называется ближайшая к Солнцу звёздная система?",
          "answer": "Альфа Центавра"
        }
      },
      {
        "name": "Языки",
        "question": {
          "id": "final-lang",
          "text": "На каком языке говорит больше всего людей в мире, если считать только тех, для кого он родной?",
          "answer": "Китайский (путунхуа)"
        }
      }
    ]
  }
}
```

Добавить это поле на верхний уровень объекта пакета, рядом с `rounds` (не внутрь него).

- [ ] **Step 2: Проверить, что пакет всё ещё валиден**

Run: `pnpm --filter server test -- pack.test.ts`
Expected: PASS (уже проверенная валидация должна принять и реальный файл — при желании добавить в `pack.test.ts` разовую проверку `loadPack('../../packs/current.json')`, но это не обязательно: `index.ts` уже валидирует пакет при старте сервера).

- [ ] **Step 3: Commit**

```bash
git add packs/current.json
git commit -m "feat: add a final round to the test pack"
```

---

### Task 10: E2E — табло, два игрока и ведущий разыгрывают финал

**Проблема с прямым переиспользованием `e2e/round.spec.ts`'s обвязки:** тот файл нарочно не добивает `packs/current.json` до конца (играет 2 вопроса из 32) — раунды пакета большие, чтобы быть содержательными для живой игры. Довести реальный пакет до финала в одном E2E-прогоне непрактично, а урезать `packs/current.json` ради теста испортило бы пакет, которым реально играют вживую (Task 9). Решение — второй, отдельный `webServer` на своём порту, с собственным маленьким пакетом и собственным файлом снапшота, не пересекающийся с тем, что уже использует `lobby.spec.ts`/`round.spec.ts`.

**Files:**

- Modify: `server/src/index.ts` (env-переопределения `PORT`/`PACK_PATH`/`SNAPSHOT_PATH`, тем же паттерном, что уже есть у `LAN_HOST`)
- Modify: `e2e/reset-snapshot.mjs` (принимает путь до файла снапшота аргументом)
- Modify: `playwright.config.ts` (второй `webServer` + `projects` с разными `baseURL`, `globalSetup` вместо сборки внутри команды сервера)
- Modify: `.gitignore` (снапшот второго сервера)
- Create: `e2e/global-setup.ts`
- Create: `e2e/fixtures/final-pack.json`
- Create: `e2e/final.spec.ts`

**Interfaces:**

- Consumes: реальный собранный сервер+клиент, как в `e2e/round.spec.ts`, но на порту `8081` с пакетом `e2e/fixtures/final-pack.json`.

- [ ] **Step 1: Сделать путь/порт сервера переопределяемыми через окружение**

```ts
// server/src/index.ts — заменить три константы

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH ?? './room-snapshot.json';
const PACK_PATH = process.env.PACK_PATH ?? './packs/current.json';
```

`SNAPSHOT_PATH`/`PACK_PATH` уже были локальными константами — здесь просто добавляется `process.env.* ??`-переопределение поверх дефолта, тем же паттерном, что уже есть у `LAN_HOST` чуть ниже в этом файле. Больше в файле ничего не меняется — `PORT` используется дальше только в `httpServer.listen(PORT, ...)` и логе, оба уже читают эту константу.

- [ ] **Step 2: Обобщить сброс снапшота на произвольный путь**

```js
// e2e/reset-snapshot.mjs
import { rmSync } from 'node:fs';

// Путь передаётся аргументом, чтобы один и тот же скрипт мог обслуживать оба
// webServer'а playwright.config.ts — у каждого свой файл снапшота, чтобы два
// параллельно поднятых процесса сервера не затирали состояние друг друга.
const path = process.argv[2] ?? './room-snapshot.json';
rmSync(path, { force: true });
```

- [ ] **Step 3: Добавить маленький пакет-фикстуру для E2E финала**

```json
// e2e/fixtures/final-pack.json
{
  "title": "E2E финал",
  "author": "Тест",
  "createdAt": "2026-08-05",
  "rounds": [
    {
      "themes": [
        {
          "name": "Тема",
          "questions": [
            {
              "id": "q1",
              "price": 100,
              "text": "Вопрос?",
              "answer": "Ответ",
              "type": "обычный"
            }
          ]
        }
      ]
    }
  ],
  "final": {
    "themes": [
      {
        "name": "Финал A",
        "question": {
          "id": "f1",
          "text": "Вопрос финала A?",
          "answer": "Ответ A"
        }
      },
      {
        "name": "Финал B",
        "question": {
          "id": "f2",
          "text": "Вопрос финала B?",
          "answer": "Ответ B"
        }
      }
    ]
  }
}
```

Один вопрос в единственном обычном раунде — после него сразу наступает конец раунда и, поскольку это последний раунд, переход в финал.

- [ ] **Step 4: Вынести сборку в `globalSetup`, поднять второй `webServer`**

Оба `webServer`'а запускают уже собранный код (`pnpm run start`), а не пересобирают его сами — при массиве `webServer` Playwright поднимает оба процесса, и если сборка сидит внутри каждой команды, они гоняются параллельно и гонятся за одним и тем же `client/dist`/`server/dist`. `globalSetup` гарантированно отрабатывает до старта любого `webServer`, так что сборка происходит ровно один раз.

```ts
// e2e/global-setup.ts
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  execSync('pnpm run build', { stdio: 'inherit' });
}
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // e2e/lobby.spec.ts и e2e/round.spec.ts работают против одного и того же
  // процесса сервера (Room внутри процесса одна на всё время его жизни) —
  // сериализуем их, чтобы участник, присоединившийся в одном файле, не
  // оставался физически подключённым в момент, когда другой файл запускает
  // игру. e2e/final.spec.ts на это не завязан (отдельный сервер/порт/комната),
  // но общий workers: 1 не создаёт для него проблемы — только чуть медленнее.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'node e2e/reset-snapshot.mjs && pnpm run start',
      port: 8080,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Отдельный порт, отдельный снапшот, отдельный (маленький) пакет —
      // не пересекается с комнатой, которую использует default-проект.
      command:
        'node e2e/reset-snapshot.mjs ./e2e/fixtures/final-room-snapshot.json && pnpm run start',
      port: 8081,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: '8081',
        PACK_PATH: './e2e/fixtures/final-pack.json',
        SNAPSHOT_PATH: './e2e/fixtures/final-room-snapshot.json',
      },
    },
  ],
  projects: [
    {
      name: 'default',
      testMatch: ['lobby.spec.ts', 'round.spec.ts'],
      use: { baseURL: 'http://localhost:8080' },
    },
    {
      name: 'final',
      testMatch: 'final.spec.ts',
      use: { baseURL: 'http://localhost:8081' },
    },
  ],
});
```

Добавить в `.gitignore`, рядом с уже существующими `room-snapshot.json`/`room-snapshot.json.tmp`:

```
e2e/fixtures/final-room-snapshot.json
e2e/fixtures/final-room-snapshot.json.tmp
```

- [ ] **Step 5: Написать сценарий**

```ts
// e2e/final.spec.ts
import { test, expect, type Page } from '@playwright/test';

async function join(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
}

test('board, two players and a host play through the final round', async ({
  browser,
}) => {
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto('/board');

  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  await join(a, 'Аня');

  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await join(b, 'Боря');

  const cContext = await browser.newContext();
  const c = await cContext.newPage();
  await join(c, 'Вика');

  await c.getByRole('button', { name: 'Стать ведущим' }).click();
  await expect(c.getByText('Стать ведущим')).not.toBeVisible();

  await a.getByRole('button', { name: 'Начать игру' }).click();

  // Единственный вопрос пакета — кто из a/b видит сетку, тот и picker.
  let picker!: Page;
  let pickerName!: string;
  let other!: Page;
  let otherName!: string;
  await expect(async () => {
    if (
      await a
        .getByRole('button', { name: /^\d+$/ })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      picker = a;
      pickerName = 'Аня';
      other = b;
      otherName = 'Боря';
      return;
    }
    if (
      await b
        .getByRole('button', { name: /^\d+$/ })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      picker = b;
      pickerName = 'Боря';
      other = a;
      otherName = 'Аня';
      return;
    }
    throw new Error('grid not visible on either page yet');
  }).toPass();

  await picker.getByRole('button', { name: /^\d+$/ }).first().click();
  await picker.getByRole('button', { name: 'Ответ', exact: true }).click();
  await picker.getByRole('button', { name: 'Я ответил' }).click();

  // Судейство с ведущим (c) — решает сразу, без ожидания таймера голосования.
  await expect(c.getByText('Ответ')).toBeVisible();
  await c.getByRole('button', { name: 'Зачёт', exact: true }).click();

  // other пришёл бы к финалу с 0 очков — движок зажимает ставку до
  // max(0, score) (engine.ts, handleSubmitWager), так что ставка больше 0
  // ниже была бы молча обнулена, а тест перестал бы содержательно проверять
  // проигрыш ставки. Панель ведущего ещё видна: сейчас идёт reveal обычного
  // раунда, не финальная фаза (Player.tsx, hostAdminPanel скрыта только в
  // final-*). Пользуемся тем же путём (±очки), что уже проверен в базовом
  // раунде, чтобы дать other очки, на которые реально можно поставить.
  await expect(
    c.getByRole('listitem').filter({ hasText: otherName }),
  ).toBeVisible();
  await c
    .getByRole('listitem')
    .filter({ hasText: otherName })
    .getByRole('button', { name: '+100', exact: true })
    .click();

  // Единственный вопрос единственного раунда исчерпан — после раскрытия
  // (REVEAL_TIMER_MS) партия сразу переходит в финал, минуя round-end.
  await expect(board.getByText('Финал — выбор темы')).toBeVisible({
    timeout: 20_000,
  });

  // Изначально other пришёл бы к финалу с 0 < picker'а 100 и ходил бы первым
  // по правилу «по возрастанию счёта» (design.md, финал-спека). Но панель
  // ведущего выше выдала other фиксированные +100 (кнопка Player.tsx не
  // параметризуется), а единственный вопрос пакета тоже стоит 100 — счета
  // сравниваются 100 на 100. При равенстве engine.ts (ascendingByScore)
  // разрешает порядок по тому, в каком порядке сформирован список счётчиков
  // — то есть по порядку входа в комнату, который не совпадает ни с picker,
  // ни с other предсказуемо: кто из них войдёт первым, зависит от того, кого
  // случайный стартовый turnCounterId (engine.ts, createInitialState)
  // назначил picker'ом в начале теста. Поэтому здесь не фиксируем, что
  // первый ход — за other, а опрашиваем, у кого из двух реально включена
  // кнопка темы, тем же паттерном toPass(), что и при определении picker'а
  // выше.
  await expect(async () => {
    if (
      await picker
        .getByRole('button', { name: 'Финал A', exact: true })
        .isEnabled()
        .catch(() => false)
    ) {
      await picker
        .getByRole('button', { name: 'Финал A', exact: true })
        .click();
      return;
    }
    if (
      await other
        .getByRole('button', { name: 'Финал A', exact: true })
        .isEnabled()
        .catch(() => false)
    ) {
      await other.getByRole('button', { name: 'Финал A', exact: true }).click();
      return;
    }
    throw new Error('final elim turn not resolved on either page yet');
  }).toPass();

  await expect(picker.getByLabel('Ставка')).toBeVisible();
  await picker.getByLabel('Ставка').fill('50');
  await picker.getByRole('button', { name: 'Готово' }).click();
  await other.getByLabel('Ставка').fill('30');
  await other.getByRole('button', { name: 'Готово' }).click();

  await expect(picker.getByLabel('Ответ')).toBeVisible();
  await picker.getByLabel('Ответ').fill('ответ пикера');
  await picker.getByRole('button', { name: 'Готово' }).click();
  await other.getByLabel('Ответ').fill('ответ второго');
  await other.getByRole('button', { name: 'Готово' }).click();

  await expect(
    c.getByRole('listitem').filter({ hasText: pickerName }),
  ).toBeVisible();
  await c
    .getByRole('listitem')
    .filter({ hasText: pickerName })
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await c
    .getByRole('listitem')
    .filter({ hasText: otherName })
    .getByRole('button', { name: 'Неверно', exact: true })
    .click();

  // picker: 100 (базовый раунд) + 50 (верная ставка) = 150.
  // other: 0 (базовый раунд) + 100 (панель ведущего) − 30 (неверная ставка) = 70.
  await expect(board.getByText('Финал — итог')).toBeVisible();
  await expect(board.getByText('150')).toBeVisible();
  await expect(board.getByText('70')).toBeVisible();
  await expect(picker.getByText('150')).toBeVisible();
  await expect(other.getByText('70')).toBeVisible();

  await boardContext.close();
  await aContext.close();
  await bContext.close();
  await cContext.close();
});
```

- [ ] **Step 6: Запустить E2E**

Run: `pnpm test:e2e`
Expected: PASS для всех трёх спеков (`lobby.spec.ts`, `round.spec.ts` на порту 8080, `final.spec.ts` на порту 8081).

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts e2e/reset-snapshot.mjs e2e/global-setup.ts e2e/fixtures/final-pack.json e2e/final.spec.ts playwright.config.ts .gitignore
git commit -m "test: add an e2e scenario for the full final round"
```

---

## Финальная проверка перед объявлением вехи готовой

После Task 10 — прогнать полный набор проверок и посмотреть вывод, а не предположить результат (svoya-igra-dev, «Шаг 4»):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Затем `pnpm test:e2e` отдельно (медленный, не гоняется на каждом шаге).

Упало — чинить причину, не обходить. Три попытки без результата — остановиться и рассказать, что происходит.

Дальше — **skill `superpowers:requesting-code-review`**, отдельно попросить проверить пять инвариантов проекта (`.claude/skills/svoya-igra-dev/SKILL.md`), они ломаются тихо и не видны в диффе одного файла. Получив замечания — **skill `superpowers:receiving-code-review`**.

**Веха не закрыта, пока по ней не сыграна настоящая партия с живыми людьми** — минимум трое (чтобы был ведущий и финал состоялся), на настоящем телевизоре и настоящих телефонах, без правки кода по ходу (svoya-igra-dev, «Шаг 7»). Наблюдения — в раздел «Проверено вживую» того же файла.
