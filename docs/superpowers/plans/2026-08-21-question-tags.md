# Оценка вопросов игроками — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игроки ставят вопросу палец вверх или вниз одним тапом, а в конце партии объясняют, чем не понравились помеченные вниз, — и это доезжает до генератора пакетов.

**Architecture:** Оценки живут рядом с историей партий, в той же базе `game-history.db` (новая таблица `question_tags`). Room держит оценки текущего вопроса в памяти — из них считается счёт для табло и работает «передумал» — и пишет их сквозняком в базу. Окно оценки открывается и закрывается по тем же двум переходам, которые Room уже отслеживает со слайса A. Разобранные претензии уходят в `docs/pack-generator-profile.md` тем же путём, что и кнопка «Пожаловаться». Движок не меняется.

**Tech Stack:** TypeScript, Node 25 (`node:sqlite`, встроенный), Vitest, React.

**Спека:** [docs/superpowers/specs/2026-08-21-question-tags-design.md](../specs/2026-08-21-question-tags-design.md) — при расхождении плана со спекой правит спека, а расхождение выносится человеку.

## Global Constraints

- **Движок (`server/src/engine.ts`) не меняется вообще.** Оценка — не правило игры: она ничего не решает, ни на что не влияет и не меняет фазу. Ни нового `EngineEvent`, ни нового поля `EngineState`, ни нового `Effect`.
- **Новых зависимостей в `package.json` не добавляется.**
- **Окно оценки задаётся переходами, а не списком фаз:** открывается, когда вопрос закрылся, закрывается, когда открылся следующий. Перечислять фазы (`reveal`/`round-end`/`selecting`) в коде запрещено — список фаз меняется от вехи к вехе.
- **Ошибки работы с базой логируются через `console.error` и проглатываются**, партия продолжается. Ни один метод `GameHistory` не бросает; бросает только конструктор.
- **Тумблер записи истории выключен → пальцы работают и считаются на табло как обычно, но не пишутся, и экрана разбора нет.**
- **Ровно пять готовых вариантов причины**, дословно: `Слишком сложный`, `Слишком лёгкий`, `Непонятная формулировка`, `Спорный ответ`, `Неинтересная тема`.
- **Потолок разбора — 5 вопросов.**
- **Финальный вопрос не оценивается** — намеренно, см. спеку.
- **Палец вниз без причины в профиль генератора не идёт** — остаётся в базе цифрой.
- **Комментарии и тексты в интерфейсе — по-русски.**
- **Формат пакета и `packs/current.json` не трогаются.**

---

## File Structure

| Файл                                       | Ответственность                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `server/src/history.ts` (менять)           | Таблица `question_tags`, запись оценок и причин, чтение для разбора.   |
| `server/src/room.ts` (менять)              | Окно оценки, оценки текущего вопроса в памяти, счёт в `GameStateView`. |
| `server/src/protocol.ts` (менять)          | Сообщения `tag-question`/`tag-reason`, поля вида, список причин.       |
| `server/src/server.ts` (менять)            | Проводка сообщений, дозапись причины в профиль генератора.             |
| `client/src/useRoomConnection.ts` (менять) | Типы вида, отправка оценки и причины.                                  |
| `client/src/Player.tsx` (менять)           | Пальцы на экране игрока, экран разбора на `game-end`.                  |
| `client/src/Board.tsx` (менять)            | Анонимный счёт на экране ответа.                                       |
| `client/src/index.css` (менять)            | Стили пальцев и экрана разбора.                                        |

---

## Task 1: Таблица оценок и запись

**Files:**

- Modify: `server/src/history.ts`
- Test: `server/src/history.test.ts`

**Interfaces:**

- Consumes: существующие `GameHistory`, `HistoryRecorder`, `mapPlayedQuestionRow` из `server/src/history.ts`.
- Produces: тип `Thumb = 'up' | 'down'`; интерфейсы `QuestionTagInput`, `QuestionTagRow`; методы `recordTag`, `clearTag`, `recordTagReason` на `HistoryRecorder` и `GameHistory`; метод `allTags()` на `GameHistory` для тестов. Задача 2 пользуется только `recordTag`/`clearTag` через `HistoryRecorder`, задача 4 — `recordTagReason` и чтением, которое добавит сама.

**Замечание:** SQLite поддерживает upsert (`ON CONFLICT ... DO UPDATE`), и `node:sqlite` его пропускает. Это и есть механизм «передумал»: повторная оценка обновляет строку, а не плодит вторую.

- [ ] **Step 1: Написать падающие тесты записи оценки**

Дописать в `server/src/history.test.ts` (импорт типов дополнить: `type QuestionTagInput`):

```ts
describe('GameHistory: оценки вопросов', () => {
  function gameWithQuestion(history: GameHistory): number {
    const id = history.startGame({
      startedAt: '2026-08-21T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    history.recordQuestion(id, QUESTION);
    return id;
  }

  const TAG: QuestionTagInput = {
    questionId: 'r1-geo-100',
    participantId: 'p1',
    participantName: 'Ваня',
    thumb: 'down',
  };

  it('записывает оценку', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    expect(history.allTags()).toEqual([
      { gameId, ...TAG, reason: null, reasonText: null },
    ]);
  });

  it('«передумал» обновляет строку, а не плодит вторую', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTag(gameId, { ...TAG, thumb: 'up' });
    const tags = history.allTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].thumb).toBe('up');
  });

  it('оценки разных игроков по одному вопросу не мешают друг другу', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTag(gameId, {
      ...TAG,
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'up',
    });
    expect(history.allTags()).toHaveLength(2);
  });

  it('снятая оценка удаляется', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.clearTag(gameId, TAG.questionId, TAG.participantId);
    expect(history.allTags()).toEqual([]);
  });

  it('причина дописывается к уже поставленной оценке', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Слишком сложный',
      'вообще не слышал про это',
    );
    const [row] = history.allTags();
    expect(row.reason).toBe('Слишком сложный');
    expect(row.reasonText).toBe('вообще не слышал про это');
  });

  it('не роняет вызовы, когда база недоступна', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.close();
    expect(() => history.recordTag(gameId, TAG)).not.toThrow();
    expect(() =>
      history.clearTag(gameId, TAG.questionId, TAG.participantId),
    ).not.toThrow();
    expect(() =>
      history.recordTagReason(
        gameId,
        TAG.questionId,
        TAG.participantId,
        'X',
        '',
      ),
    ).not.toThrow();
    expect(history.allTags()).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать тесты и убедиться, что они падают**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `history.recordTag is not a function`.

- [ ] **Step 3: Добавить таблицу в схему**

В `server/src/history.ts`, в конец константы `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS question_tags (
  id               INTEGER PRIMARY KEY,
  game_id          INTEGER NOT NULL REFERENCES games(id),
  question_id      TEXT NOT NULL,
  participant_id   TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  thumb            INTEGER NOT NULL,
  reason           TEXT,
  reason_text      TEXT,
  UNIQUE (game_id, question_id, participant_id)
);
```

- [ ] **Step 4: Добавить типы и методы**

В `server/src/history.ts`:

```ts
export type Thumb = 'up' | 'down';

export interface QuestionTagInput {
  questionId: string;
  participantId: string;
  // Имя лежит копией рядом с id по той же причине, что и в played_questions:
  // оно человекочитаемо и переживает смену id.
  participantName: string;
  thumb: Thumb;
}

export interface QuestionTagRow extends QuestionTagInput {
  gameId: number;
  // Готовый вариант причины; null — игрок не разбирал этот вопрос в конце.
  reason: string | null;
  // Свободный текст; null — не писал.
  reasonText: string | null;
}
```

В интерфейс `HistoryRecorder` — три метода:

```ts
  recordTag(gameId: number, tag: QuestionTagInput): void;
  clearTag(gameId: number, questionId: string, participantId: string): void;
  recordTagReason(
    gameId: number,
    questionId: string,
    participantId: string,
    reason: string | null,
    reasonText: string | null,
  ): void;
```

В класс `GameHistory` — их реализации и чтение для тестов:

```ts
  recordTag(gameId: number, tag: QuestionTagInput): void {
    try {
      // Upsert по UNIQUE (game_id, question_id, participant_id) — это и есть
      // «передумал»: повторная оценка того же игрока по тому же вопросу
      // обновляет строку, а не заводит вторую.
      this.db
        .prepare(
          `INSERT INTO question_tags
             (game_id, question_id, participant_id, participant_name, thumb)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (game_id, question_id, participant_id)
           DO UPDATE SET thumb = excluded.thumb`,
        )
        .run(
          gameId,
          tag.questionId,
          tag.participantId,
          tag.participantName,
          tag.thumb === 'up' ? 1 : 0,
        );
    } catch (err) {
      console.error('История: не удалось записать оценку вопроса —', err);
    }
  }

  clearTag(gameId: number, questionId: string, participantId: string): void {
    try {
      this.db
        .prepare(
          `DELETE FROM question_tags
           WHERE game_id = ? AND question_id = ? AND participant_id = ?`,
        )
        .run(gameId, questionId, participantId);
    } catch (err) {
      console.error('История: не удалось снять оценку вопроса —', err);
    }
  }

  recordTagReason(
    gameId: number,
    questionId: string,
    participantId: string,
    reason: string | null,
    reasonText: string | null,
  ): void {
    try {
      this.db
        .prepare(
          `UPDATE question_tags SET reason = ?, reason_text = ?
           WHERE game_id = ? AND question_id = ? AND participant_id = ?`,
        )
        .run(
          reason,
          reasonText === null || reasonText === '' ? null : reasonText,
          gameId,
          questionId,
          participantId,
        );
    } catch (err) {
      console.error('История: не удалось записать причину оценки —', err);
    }
  }

  allTags(): QuestionTagRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM question_tags ORDER BY id`)
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        gameId: Number(row.game_id),
        questionId: row.question_id as string,
        participantId: row.participant_id as string,
        participantName: row.participant_name as string,
        thumb: Number(row.thumb) === 1 ? 'up' : 'down',
        reason: (row.reason as string | null) ?? null,
        reasonText: (row.reason_text as string | null) ?? null,
      }));
    } catch (err) {
      console.error('История: не удалось прочитать оценки —', err);
      return [];
    }
  }
```

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS — все тесты файла, включая существующие.

- [ ] **Step 6: Прогнать типы и линтер**

Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`

Expected: обе команды без ошибок. `wrapHistoryRecorder` в `room.ts` оборачивает методы `HistoryRecorder` — если `tsc` пожалуется, что новые три метода не обёрнуты, добавить их туда (это и есть цель задачи 2, но собираться должно уже сейчас).

- [ ] **Step 7: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts
git commit -m "feat: таблица оценок вопросов в истории партий"
```

---

## Task 2: Окно оценки и приём пальцев в Room

**Files:**

- Modify: `server/src/room.ts`
- Modify: `server/src/protocol.ts`
- Test: `server/src/room.test.ts`

**Interfaces:**

- Consumes: `Thumb`, `QuestionTagInput`, методы `recordTag`/`clearTag` из `server/src/history.ts` (Task 1).
- Produces: метод `Room.tagQuestion(participantId: string, thumb: Thumb): void`; поле `questionTags` в `GameStateView`:

```ts
  questionTags: {
    up: number;
    down: number;
    // Оценка самого смотрящего (viewerId); null — не оценивал.
    mine: 'up' | 'down' | null;
  } | null; // null — окно оценки закрыто
```

Задача 3 читает это поле и вызывает `tagQuestion` через сообщение протокола.

**Как определяются границы окна (движок не трогаем):** `Room.dispatch()` уже захватывает `answeredCountBefore` и `questionBefore` со слайса A. Окно **открывается**, когда `state.answeredQuestionIds.length > answeredCountBefore` (вопрос закрылся). Окно **закрывается**, когда `questionBefore === null && state.currentQuestion !== null` (выбрали следующий вопрос). Проверено по движку: `revealQuestion` оставляет `currentQuestion` заполненным на время фазы `reveal`, а обнуляет его переход в `selecting` — поэтому «было null, стало не-null» однозначно означает именно выбор нового вопроса.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/src/room.test.ts`. Хелперы `TEST_PACK`, `joinedId`, `roomWithHistory`, `pickerOf`, `playQuestionToTimeout` и фейковый рекордер уже есть в файле со слайса A — переиспользовать их, своих копий не заводить.

Фейк надо дополнить, иначе он перестанет удовлетворять `HistoryRecorder` и `tsc` не соберётся. Добавить в его интерфейс и тело:

```ts
tags: {
  gameId: number;
  tag: QuestionTagInput;
}
[];
clearedTags: {
  gameId: number;
  questionId: string;
  participantId: string;
}
[];
reasons: {
  gameId: number;
  questionId: string;
  participantId: string;
  reason: string | null;
  reasonText: string | null;
}
[];
```

```ts
    recordTag(gameId, tag) {
      fake.tags.push({ gameId, tag });
    },
    clearTag(gameId, questionId, participantId) {
      fake.clearedTags.push({ gameId, questionId, participantId });
    },
    recordTagReason(gameId, questionId, participantId, reason, reasonText) {
      fake.reasons.push({
        gameId,
        questionId,
        participantId,
        reason,
        reasonText,
      });
    },
```

(Метод `downTagsForReview` фейку понадобится в задаче 4 — сейчас его добавлять не нужно, `HistoryRecorder` его пока не объявляет.)

```ts
describe('Room: оценки вопросов', () => {
  it('окно закрыто, пока вопрос не сыгран', () => {
    const room = roomWithHistory(fakeHistory());
    room.startGame('requester');
    expect(room.toGameStateView()?.questionTags).toBeNull();
  });

  it('после закрытия вопроса окно открыто и оценка считается', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    const picker = pickerOf(room);
    playQuestionToTimeout(room);

    room.tagQuestion(picker, 'down');

    expect(room.toGameStateView(picker)?.questionTags).toEqual({
      up: 0,
      down: 1,
      mine: 'down',
    });
    expect(history.tags).toHaveLength(1);
  });

  it('чужая оценка видна в счёте, но не как своя', () => {
    const room = roomWithHistory(fakeHistory());
    room.startGame('requester');
    const picker = pickerOf(room);
    const other = room
      .getState()
      .participants.map((p) => p.id)
      .find((id) => id !== picker)!;
    playQuestionToTimeout(room);

    room.tagQuestion(other, 'up');

    expect(room.toGameStateView(picker)?.questionTags).toEqual({
      up: 1,
      down: 0,
      mine: null,
    });
  });

  it('повторный тап по тому же пальцу снимает оценку', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.startGame('requester');
    const picker = pickerOf(room);
    playQuestionToTimeout(room);

    room.tagQuestion(picker, 'up');
    room.tagQuestion(picker, 'up');

    expect(room.toGameStateView(picker)?.questionTags).toEqual({
      up: 0,
      down: 0,
      mine: null,
    });
    expect(history.clearedTags).toHaveLength(1);
  });

  it('тап по другому пальцу меняет оценку, а не добавляет вторую', () => {
    const room = roomWithHistory(fakeHistory());
    room.startGame('requester');
    const picker = pickerOf(room);
    playQuestionToTimeout(room);

    room.tagQuestion(picker, 'up');
    room.tagQuestion(picker, 'down');

    expect(room.toGameStateView(picker)?.questionTags).toEqual({
      up: 0,
      down: 1,
      mine: 'down',
    });
  });

  it('выбор следующего вопроса закрывает окно и обнуляет счёт', () => {
    const room = roomWithHistory(fakeHistory());
    room.startGame('requester');
    const picker = pickerOf(room);
    playQuestionToTimeout(room);
    room.tagQuestion(picker, 'down');

    room.selectQuestion(pickerOf(room), 0, 'q2');

    expect(room.toGameStateView(picker)?.questionTags).toBeNull();
  });

  it('при выключенном тумблере оценка работает, но не пишется', () => {
    const history = fakeHistory();
    const room = roomWithHistory(history);
    room.setHistoryEnabled(false);
    room.startGame('requester');
    const picker = pickerOf(room);
    playQuestionToTimeout(room);

    room.tagQuestion(picker, 'down');

    expect(room.toGameStateView(picker)?.questionTags).toEqual({
      up: 0,
      down: 1,
      mine: 'down',
    });
    expect(history.tags).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/room.test.ts`

Expected: FAIL — `room.tagQuestion is not a function`.

- [ ] **Step 3: Расширить `GameStateView`**

В `server/src/protocol.ts`, внутрь `interface GameStateView`, рядом с `currentQuestion`:

```ts
  // Оценки вопроса, который только что доиграли (design.md,
  // 2026-08-21-question-tags-design.md). null — окно оценки закрыто: либо
  // вопрос ещё идёт, либо уже выбрали следующий. Счёт анонимный: имён нет
  // намеренно, на табло видно только сколько.
  questionTags: {
    up: number;
    down: number;
    // Оценка самого смотрящего; null — не оценивал.
    mine: 'up' | 'down' | null;
  } | null;
```

- [ ] **Step 4: Добавить поля и метод в Room**

В `server/src/room.ts`, рядом с прочими эфемерными полями:

```ts
  // Вопрос, который только что доиграли, и оценки по нему. Эфемерные: окно
  // оценки живёт секунды и переживать перезапуск сервера не обязано (design.md,
  // 2026-08-21-question-tags-design.md, «Движок не трогаем»). null — окно
  // закрыто.
  private taggableQuestionId: string | null = null;
  // participantId -> палец. Из неё считается счёт для табло и работает
  // «передумал». В базу пишется отдельно, сквозняком: при выключенном
  // тумблере остаётся только эта память, и всё видимое ведёт себя как в
  // настоящей партии, просто не оставляет следа.
  private currentTags = new Map<string, Thumb>();
```

Импорт дополнить: `import type { HistoryRecorder, PlayedQuestionInput, Thumb } from './history.js';`

Метод — рядом с прочими действиями участников:

```ts
  /**
   * Оценка только что сыгранного вопроса. Не правило игры: ничего не решает,
   * ни на что не влияет, фазу не меняет — поэтому живёт здесь, а не в движке.
   *
   * Повторный тап по тому же пальцу снимает оценку, тап по другому — меняет.
   */
  tagQuestion(participantId: string, thumb: Thumb): void {
    if (this.taggableQuestionId === null) return;
    if (!this.participants.some((p) => p.id === participantId)) return;
    const questionId = this.taggableQuestionId;
    if (this.currentTags.get(participantId) === thumb) {
      this.currentTags.delete(participantId);
      if (this.historyGameId !== null) {
        this.history.clearTag(this.historyGameId, questionId, participantId);
      }
    } else {
      this.currentTags.set(participantId, thumb);
      if (this.historyGameId !== null) {
        this.history.recordTag(this.historyGameId, {
          questionId,
          participantId,
          participantName: this.nameOf(participantId) ?? '',
          thumb,
        });
      }
    }
    this.notify();
  }
```

- [ ] **Step 5: Открывать и закрывать окно в `dispatch()`**

В `server/src/room.ts`, в `dispatch()`, рядом с уже существующей веткой записи закрывшегося вопроса:

```ts
if (state.answeredQuestionIds.length > answeredCountBefore) {
  // ... существующий вызов recordPlayedQuestion ...
  // Окно оценки открывается ровно здесь: вопрос доиграли, его текст и
  // ответ сейчас на экране.
  this.taggableQuestionId = questionBefore?.questionId ?? null;
  this.currentTags.clear();
}
// Окно закрывается, когда выбрали следующий вопрос. Именно переход
// «было null, стало не-null», а не список фаз: revealQuestion оставляет
// currentQuestion заполненным на время фазы reveal и обнуляет его только
// переход в selecting, так что этот переход однозначно означает выбор
// нового вопроса. Список фаз перечислять нельзя — он растёт от вехи к
// вехе, и перечисление молча теряло бы окно (design.md,
// 2026-08-21-question-tags-design.md, «Где и как долго»).
if (questionBefore === null && state.currentQuestion !== null) {
  this.taggableQuestionId = null;
  this.currentTags.clear();
}
```

В `startGame()`, `resetGame()` и `resetRoom()`, рядом с существующим обнулением `historyGameId`:

```ts
this.taggableQuestionId = null;
this.currentTags.clear();
```

- [ ] **Step 6: Отдать счёт в `toGameStateView`**

В `server/src/room.ts`, в `toGameStateView(viewerId)`, в возвращаемый объект:

```ts
      questionTags:
        this.taggableQuestionId === null
          ? null
          : {
              up: [...this.currentTags.values()].filter((t) => t === 'up')
                .length,
              down: [...this.currentTags.values()].filter((t) => t === 'down')
                .length,
              mine:
                viewerId === null
                  ? null
                  : (this.currentTags.get(viewerId) ?? null),
            },
```

- [ ] **Step 7: Прогнать серверные тесты**

Run: `pnpm -C server exec vitest run`
Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`

Expected: все три без ошибок. Существующие тесты, сравнивающие весь объект `GameStateView` через `toEqual`, потребуют добавления `questionTags: null` — это неизбежное следствие расширения вида, не расширение объёма задачи.

- [ ] **Step 8: Коммит**

```bash
git add server/src/room.ts server/src/room.test.ts server/src/protocol.ts
git commit -m "feat: комната принимает оценки вопроса и считает их для табло"
```

---

## Task 3: Пальцы на телефоне и счёт на табло

**Files:**

- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/Player.tsx`
- Modify: `client/src/Board.tsx`
- Modify: `client/src/index.css`
- Test: `server/src/server.test.ts`
- Test: `client/src/Player.test.tsx`
- Test: `client/src/Board.test.tsx`

**Interfaces:**

- Consumes: `Room.tagQuestion(participantId, thumb)` и поле `questionTags` в `GameStateView` (Task 2).
- Produces: сообщение `{ type: 'tag-question'; thumb: 'up' | 'down' }` от клиента; функция `tagQuestion(thumb: 'up' | 'down'): void` из `useRoomConnection`. Задача 4 добавит рядом второе сообщение и вторую функцию.

- [ ] **Step 1: Написать падающий серверный тест**

Дописать в `server/src/server.test.ts`, рядом с существующими тестами игрового потока. В файле уже есть хелперы `joinPlayer(baseUrl, name)`, `collectMessages(ws)` и `settle(...)` — переиспользовать их, своих копий не заводить.

```ts
it('tag-question доносит оценку игрока до комнаты', async () => {
  // Два игрока, партия, один вопрос доигран до таймаута — тем же способом,
  // каким это делают соседние тесты игрового потока в этом файле.
  const first = await joinPlayer(url, 'Ваня');
  const second = await joinPlayer(url, 'Катя');
  // ... старт партии, выбор вопроса, истечение таймера ...

  first.ws.send(JSON.stringify({ type: 'tag-question', thumb: 'down' }));
  await settle();

  expect(room.toGameStateView(first.id)?.questionTags).toEqual({
    up: 0,
    down: 1,
    mine: 'down',
  });

  first.ws.close();
  second.ws.close();
});
```

Проверка идёт через `room.toGameStateView(...)`, а не через разбор рассылки: так тест утверждает то, ради чего задача существует (сообщение доехало до комнаты), и не ломается от любого другого изменения формы `state`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/server.test.ts`

Expected: FAIL — `questionTags.down` останется `0`, сообщение никем не обрабатывается.

- [ ] **Step 3: Добавить сообщение в протокол**

В `server/src/protocol.ts`, в union `ClientMessage`:

```ts
  | { type: 'tag-question'; thumb: 'up' | 'down' }
```

Там же, рядом с прочими экспортируемыми константами, — список причин (он понадобится задаче 4, но живёт вместе с протоколом, потому что клиент и сервер обязаны понимать его одинаково):

```ts
/**
 * Готовые варианты причины для разбора в конце партии. Пять, и они не
 * случайны: это ровно те разделы, из которых уже состоит
 * docs/pack-generator-profile.md — «Калибровка сложности», «Брак», «Вкус».
 * Клиент рисует их кнопками, сервер принимает только их.
 */
export const TAG_REASONS = [
  'Слишком сложный',
  'Слишком лёгкий',
  'Непонятная формулировка',
  'Спорный ответ',
  'Неинтересная тема',
] as const;
```

- [ ] **Step 4: Провести сообщение через сервер**

В `server/src/server.ts`, в обработчике сообщений, рядом с прочими действиями участника (там, где уже берётся `connections.get(ws)`):

```ts
if (
  message.type === 'tag-question' &&
  (message.thumb === 'up' || message.thumb === 'down')
) {
  const participantId = connections.get(ws);
  if (participantId) {
    room.tagQuestion(participantId, message.thumb);
  }
}
```

- [ ] **Step 5: Прогнать серверный тест**

Run: `pnpm -C server exec vitest run src/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Написать падающий клиентский тест**

Дописать в `client/src/Player.test.tsx`. В файле уже есть `baseGame(overrides)` (собирает `GameStateView`), `connection(overrides)` (собирает объект соединения) и мок `mockedUseRoomConnection`. **Новые поля надо добавить в оба хелпера** — `questionTags: null` и `tagReview: []` в `baseGame`, `tagQuestion: vi.fn()` и `submitTagReason: vi.fn()` в `connection`, — иначе `tsc` не пропустит.

Плюс написать в этом же файле маленький хелпер поверх существующих, чтобы тесты ниже не повторяли одну и ту же сборку:

```ts
function renderPlayer(
  game: Partial<GameStateView>,
  conn: Partial<RoomConnection> = {},
): void {
  mockedUseRoomConnection.mockReturnValue(
    connection({ selfId: 'p1', game: baseGame(game), ...conn }),
  );
  render(<Player />);
}
```

Тесты:

```ts
it('показывает пальцы, когда окно оценки открыто, и шлёт оценку', async () => {
  const tagQuestion = vi.fn();
  renderPlayer(
    { phase: 'reveal', questionTags: { up: 0, down: 0, mine: null } },
    { tagQuestion },
  );

  await userEvent.click(screen.getByRole('button', { name: 'Понравился' }));

  expect(tagQuestion).toHaveBeenCalledWith('up');
});

it('подсвечивает уже поставленную оценку', () => {
  renderPlayer({
    phase: 'reveal',
    questionTags: { up: 1, down: 0, mine: 'up' },
  });

  expect(screen.getByRole('button', { name: 'Понравился' })).toHaveClass(
    'is-selected',
  );
});

it('не показывает пальцы, когда окно закрыто', () => {
  renderPlayer({ phase: 'question-open', questionTags: null });

  expect(
    screen.queryByRole('button', { name: 'Понравился' }),
  ).not.toBeInTheDocument();
});

it('не показывает пальцы тому, кто сейчас выбирает вопрос', () => {
  // «Выбирает сейчас» — это turnParticipantId === selfId; отдельного поля
  // isMyTurn в GameStateView нет, Player.tsx выводит его сам.
  renderPlayer({
    phase: 'selecting',
    turnParticipantId: 'p1',
    questionTags: { up: 0, down: 0, mine: null },
  });

  expect(
    screen.queryByRole('button', { name: 'Понравился' }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 7: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/Player.test.tsx`

Expected: FAIL — кнопки «Понравился» нет.

- [ ] **Step 8: Расширить `useRoomConnection`**

В `client/src/useRoomConnection.ts`:

```ts
// 1) в типе GameStateView, рядом с currentQuestion:
  questionTags: {
    up: number;
    down: number;
    mine: 'up' | 'down' | null;
  } | null;

// 2) в union исходящих сообщений:
  | { type: 'tag-question'; thumb: 'up' | 'down' }

// 3) в интерфейс возвращаемого соединения:
  tagQuestion: (thumb: 'up' | 'down') => void;

// 4) в возвращаемый объект:
    tagQuestion: (thumb: 'up' | 'down') =>
      send({ type: 'tag-question', thumb }),
```

- [ ] **Step 9: Нарисовать пальцы в `Player.tsx`**

Взять `tagQuestion` из `useRoomConnection` там же, где берутся остальные действия. Добавить функцию рядом с прочими вспомогательными блоками компонента:

```tsx
// Пальцы показываются, пока открыто окно оценки (game.questionTags !== null),
// и не показываются тому, кто в этот момент выбирает вопрос: у него на
// экране сетка тем и цен, на телефоне она и так плотная (design.md,
// 2026-08-21-question-tags-design.md, «Где и как долго»). Ему остаётся окно
// экрана ответа, где сетки ещё нет.
function questionTagButtons(): JSX.Element | null {
  if (!game?.questionTags) return null;
  if (game.phase === 'selecting' && isMyTurn) return null;
  const { mine } = game.questionTags;
  return (
    <div className="player-tags">
      <button
        className={`button button--yes${mine === 'up' ? ' is-selected' : ''}`}
        onClick={() => tagQuestion('up')}
      >
        Понравился
      </button>
      <button
        className={`button button--no${mine === 'down' ? ' is-selected' : ''}`}
        onClick={() => tagQuestion('down')}
      >
        Не понравился
      </button>
    </div>
  );
}
```

Вызвать `{questionTagButtons()}` в двух местах: в ветке `case 'reveal':` — после табло, и в ветке `case 'selecting':` — в блоке для того, кто **не** выбирает (там, где сейчас только строка «Сейчас выбирает …»). Между раундами фаза `round-end` — вызвать и там тоже, той же строкой.

- [ ] **Step 10: Показать счёт на табло**

В `client/src/Board.tsx`, внутрь блока `{game.correctAnswer && (<div className="board-answer">…`, после текста ответа и комментария:

```tsx
{
  game.questionTags && game.questionTags.up + game.questionTags.down > 0 && (
    <p className="board-tags">
      👍 {game.questionTags.up} 👎 {game.questionTags.down}
    </p>
  );
}
```

Счёт анонимный: имён нет намеренно.

- [ ] **Step 11: Добавить стили**

В `client/src/index.css`, рядом с существующим `.player-vote`:

```css
.player-tags {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 1rem;
}

.board-tags {
  margin-top: 0.5rem;
  opacity: 0.75;
}
```

- [ ] **Step 12: Прогнать клиент и сервер**

Run: `pnpm -C client exec vitest run`
Run: `pnpm -C client typecheck`
Run: `pnpm -C client lint`
Run: `pnpm -C server exec vitest run`

Expected: всё без ошибок.

- [ ] **Step 13: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts client/src/useRoomConnection.ts client/src/Player.tsx client/src/Player.test.tsx client/src/Board.tsx client/src/Board.test.tsx client/src/index.css
git commit -m "feat: пальцы вверх/вниз на телефоне и анонимный счёт на табло"
```

---

## Task 4: Разбор в конце игры

**Files:**

- Modify: `server/src/history.ts`
- Modify: `server/src/room.ts`
- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/Player.tsx`
- Modify: `client/src/index.css`
- Test: `server/src/history.test.ts`, `server/src/room.test.ts`, `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `recordTagReason` (Task 1), `TAG_REASONS` (Task 3), существующие `appendComplaint`/`ComplaintEntry` из `server/src/generatorProfile.ts` и `findQuestionLocation` из `server/src/pack.ts`.
- Produces: `GameHistory.downTagsForReview(gameId, participantId, limit): ReviewItem[]`, поле `tagReview: ReviewItem[]` в `GameStateView`, сообщение `{ type: 'tag-reason'; questionId: string; reason: string | null; text: string }`.

**Почему список читается из базы, а не из памяти:** так «нет записи — нет разбора» получается само собой, без отдельной ветки. Тумблер выключен → строк в базе нет → список пуст → экрана нет. Ровно то, что требует спека.

- [ ] **Step 1: Написать падающий тест чтения**

Дописать в `server/src/history.test.ts`:

```ts
describe('GameHistory.downTagsForReview', () => {
  function gameWithTwoQuestions(history: GameHistory): number {
    const id = history.startGame({
      startedAt: '2026-08-21T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, { ...QUESTION, questionId: 'q1' });
    history.recordQuestion(id, {
      ...QUESTION,
      questionId: 'q2',
      text: 'Второй вопрос?',
      answer: 'Второй ответ',
    });
    return id;
  }

  it('возвращает только пальцы вниз этого игрока, с текстом и ответом', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.recordTag(gameId, {
      questionId: 'q1',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTag(gameId, {
      questionId: 'q2',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'up',
    });
    history.recordTag(gameId, {
      questionId: 'q2',
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'down',
    });

    const items = history.downTagsForReview(gameId, 'p1', 5);

    expect(items).toEqual([
      {
        questionId: 'q1',
        themeName: 'География',
        price: 100,
        text: 'Столица Австралии?',
        answer: 'Канберра',
      },
    ]);
  });

  it('уже разобранный вопрос из списка уходит', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.recordTag(gameId, {
      questionId: 'q1',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTagReason(gameId, 'q1', 'p1', 'Слишком сложный', null);

    expect(history.downTagsForReview(gameId, 'p1', 5)).toEqual([]);
  });

  it('соблюдает потолок', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    for (const questionId of ['q1', 'q2']) {
      history.recordTag(gameId, {
        questionId,
        participantId: 'p1',
        participantName: 'Ваня',
        thumb: 'down',
      });
    }

    expect(history.downTagsForReview(gameId, 'p1', 1)).toHaveLength(1);
  });

  it('не роняет вызов, когда база недоступна', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.close();
    expect(() => history.downTagsForReview(gameId, 'p1', 5)).not.toThrow();
    expect(history.downTagsForReview(gameId, 'p1', 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: FAIL — `history.downTagsForReview is not a function`.

- [ ] **Step 3: Написать чтение**

В `server/src/history.ts`:

```ts
export interface ReviewItem {
  questionId: string;
  themeName: string;
  price: number;
  text: string;
  answer: string;
}
```

В интерфейс `HistoryRecorder`:

```ts
  downTagsForReview(
    gameId: number,
    participantId: string,
    limit: number,
  ): ReviewItem[];
```

В класс `GameHistory`:

```ts
  /**
   * Помеченные вниз и ещё не разобранные вопросы одного игрока — материал
   * экрана разбора в конце партии.
   *
   * Условие «reason IS NULL AND reason_text IS NULL» и есть правило «разобрал
   * — больше не спрашиваем»: заполненная причина убирает вопрос из списка, и
   * второй раз то же самое человеку не покажут.
   */
  downTagsForReview(
    gameId: number,
    participantId: string,
    limit: number,
  ): ReviewItem[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT q.question_id, q.theme_name, q.price, q.text, q.answer
           FROM question_tags t
           JOIN played_questions q
             ON q.game_id = t.game_id AND q.question_id = t.question_id
           WHERE t.game_id = ? AND t.participant_id = ? AND t.thumb = 0
             AND t.reason IS NULL AND t.reason_text IS NULL
           ORDER BY q.id
           LIMIT ?`,
        )
        .all(gameId, participantId, limit) as Record<string, unknown>[];
      return rows.map((row) => ({
        questionId: row.question_id as string,
        themeName: row.theme_name as string,
        price: Number(row.price),
        text: row.text as string,
        answer: row.answer as string,
      }));
    } catch (err) {
      console.error('История: не удалось прочитать оценки для разбора —', err);
      return [];
    }
  }
```

- [ ] **Step 4: Прогнать тест чтения**

Run: `pnpm -C server exec vitest run src/history.test.ts`

Expected: PASS.

- [ ] **Step 5: Написать падающий тест Room**

Дописать в `server/src/room.test.ts`:

```ts
it('на game-end отдаёт разбор только тому, кто ставил пальцы вниз', () => {
  const history = fakeHistory();
  const room = roomWithHistory(history);
  room.startGame('requester');
  const picker = pickerOf(room);
  // Первый вопрос играется здесь, чтобы успеть поставить палец в открытое
  // окно; остаток партии доигрывает driveToGameEnd.
  playQuestionToTimeout(room);
  room.tagQuestion(picker, 'down');
  driveToGameEnd(room, ['q2']);

  expect(room.toGameStateView(picker)?.tagReview).toHaveLength(1);
  expect(room.toGameStateView('someone-else')?.tagReview).toEqual([]);
});

it('до конца партии разбор пуст', () => {
  const history = fakeHistory();
  const room = roomWithHistory(history);
  room.startGame('requester');
  const picker = pickerOf(room);
  playQuestionToTimeout(room);
  room.tagQuestion(picker, 'down');

  expect(room.toGameStateView(picker)?.tagReview).toEqual([]);
});
```

Хелпер `driveToGameEnd` — в `TEST_PACK` ровно один раунд, одна тема и два вопроса (`q1`, `q2`), финала нет. Значит до `game-end` доводит прогон обоих вопросов по таймауту плюс истечение таймера конца раунда:

```ts
// remaining — какие вопросы ещё не сыграны. Список принимается параметром,
// а не зашит: тест выше играет q1 отдельно (чтобы успеть поставить палец в
// открытое окно) и досылает сюда только остаток.
function driveToGameEnd(room: Room, remaining: string[]): void {
  vi.useFakeTimers();
  try {
    for (const questionId of remaining) {
      room.selectQuestion(pickerOf(room), 0, questionId);
      vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS);
      vi.advanceTimersByTime(QUESTION_TIMER_MS);
      vi.advanceTimersByTime(REVEAL_TIMER_MS);
    }
    vi.advanceTimersByTime(ROUND_END_TIMER_MS);
  } finally {
    vi.useRealTimers();
  }
}
```

`REVEAL_TIMER_MS` и `ROUND_END_TIMER_MS` импортируются из `./engine.js` — в шапке `room.test.ts` уже импортируется часть таймеров оттуда, дополнить список.

Фейковый рекордер дополнить методом `downTagsForReview`, который отдаёт накопленные в `fake.tags` пальцы вниз нужного участника, у которых ещё нет причины в `fake.reasons`, в форме `ReviewItem` (текст и ответ взять из `QUESTION`, которым фейк наполнялся).

- [ ] **Step 6: Отдать разбор в `toGameStateView`**

В `server/src/protocol.ts`, в `GameStateView`:

```ts
// Помеченные вниз и ещё не разобранные вопросы САМОГО смотрящего — материал
// экрана в конце партии (design.md, 2026-08-21-question-tags-design.md).
// Пустой массив, пока партия не кончилась, а также когда запись истории
// выключена тумблером: строк в базе нет, значит и разбирать нечего.
tagReview: {
  questionId: string;
  themeName: string;
  price: number;
  text: string;
  answer: string;
}
[];
```

В `server/src/room.ts`, в `toGameStateView(viewerId)`:

```ts
      tagReview:
        this.game?.phase === 'game-end' &&
        viewerId !== null &&
        this.historyGameId !== null
          ? this.history.downTagsForReview(
              this.historyGameId,
              viewerId,
              TAG_REVIEW_LIMIT,
            )
          : [],
```

Константу объявить рядом с прочими в `server/src/room.ts`:

```ts
// Потолок разбора: больше пяти вопросов подряд гарантированно бросят на
// третьем, и не будет разобрано ни одного. Число условное, подлежит
// калибровке на живых партиях (design.md,
// 2026-08-21-question-tags-design.md, «Потолок в пять вопросов»).
const TAG_REVIEW_LIMIT = 5;
```

- [ ] **Step 7: Добавить приём причины**

В `server/src/protocol.ts`, в `ClientMessage`:

```ts
  | {
      type: 'tag-reason';
      questionId: string;
      // Один из TAG_REASONS либо null, если игрок написал только текст.
      reason: string | null;
      // Свободный текст; пустая строка — не писал.
      text: string;
    }
```

В `server/src/room.ts`:

```ts
  /**
   * Причина, по которой игрок пометил вопрос пальцем вниз. Приходит с экрана
   * разбора в конце партии.
   */
  submitTagReason(
    participantId: string,
    questionId: string,
    reason: string | null,
    text: string,
  ): void {
    if (this.historyGameId === null) return;
    this.history.recordTagReason(
      this.historyGameId,
      questionId,
      participantId,
      reason,
      text,
    );
    this.notify();
  }
```

- [ ] **Step 8: Провести причину через сервер и дописать её в профиль генератора**

В `server/src/server.ts`. Сначала вынести сборку записи жалобы из `handleReportQuestion` в общий хелпер, чтобы не заводить второй копии тех же пятнадцати строк:

```ts
// Общая сборка записи жалобы: используется и кнопкой «Пожаловаться» в
// редакторе пакетов, и разбором в конце партии — материал у них
// одинаковый (вопрос, ответ, тема, цена), различается только текст
// претензии и то, кому отвечать об успехе.
async function buildComplaintEntry(
  filename: string,
  questionId: string,
  complaint: string,
): Promise<ComplaintEntry> {
  const pack = await loadPack(join(packsDir, filename));
  const location = findQuestionLocation(pack, questionId);
  if (!location) {
    throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    packFilename: filename,
    packTitle: pack.title,
    themeName: location.themeName,
    price: location.question.price,
    questionText: location.question.text,
    answer: location.question.answer,
    complaint,
  };
}
```

`handleReportQuestion` переписать так, чтобы он звал этот хелпер вместо собственной сборки; его существующие ветки ошибок и ack не менять.

Затем — обработчик нового сообщения, рядом с прочими действиями участника:

```ts
if (
  message.type === 'tag-reason' &&
  typeof message.questionId === 'string' &&
  (message.reason === null ||
    (TAG_REASONS as readonly string[]).includes(message.reason)) &&
  typeof message.text === 'string'
) {
  const participantId = connections.get(ws);
  if (participantId) {
    room.submitTagReason(
      participantId,
      message.questionId,
      message.reason,
      message.text,
    );
    await appendTagReasonToProfile(
      message.questionId,
      message.reason,
      message.text,
    );
  }
}
```

И сама дозапись:

```ts
// Палец вниз БЕЗ причины в профиль не идёт: «кому-то не понравилось,
// неизвестно чем» — генератору нечего с этим делать (design.md,
// 2026-08-21-question-tags-design.md, «Куда уходит собранное»). Такая
// оценка остаётся в базе цифрой и дождётся агрегации слайса B.
async function appendTagReasonToProfile(
  questionId: string,
  reason: string | null,
  text: string,
): Promise<void> {
  if (!profilePath) return;
  const trimmed = text.trim();
  if (reason === null && trimmed === '') return;
  const filename = room.getPackInfo().activeFilename;
  if (!filename) return;
  const complaint =
    reason === null
      ? `оценка игрока после партии: ${trimmed}`
      : trimmed === ''
        ? `${reason.toLowerCase()} (оценка игрока после партии)`
        : `${reason.toLowerCase()} (оценка игрока после партии): ${trimmed}`;
  try {
    const entry = await buildComplaintEntry(filename, questionId, complaint);
    await withProfileWriteLock(() => appendComplaint(profilePath, entry));
  } catch (err) {
    // Проглатываем: партия уже кончилась, показывать игроку ошибку
    // записи в файл профиля бессмысленно, а ронять сервер из-за неё
    // тем более. Цифра в базе при этом уже сохранена.
    console.error('Не удалось дописать оценку в профиль генератора:', err);
  }
}
```

- [ ] **Step 9: Написать падающий тест экрана разбора**

Дописать в `client/src/Player.test.tsx`:

```ts
it('на конце игры показывает разбор помеченных вниз вопросов', () => {
  renderPlayer({
    phase: 'game-end',
    tagReview: [
      {
        questionId: 'q1',
        themeName: 'География',
        price: 100,
        text: 'Столица Австралии?',
        answer: 'Канберра',
      },
    ],
  });

  expect(screen.getByText('Столица Австралии?')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Слишком сложный' }),
  ).toBeInTheDocument();
});

it('шлёт выбранную причину', async () => {
  const submitTagReason = vi.fn();
  renderPlayer(
    {
      phase: 'game-end',
      tagReview: [
        {
          questionId: 'q1',
          themeName: 'География',
          price: 100,
          text: 'Столица Австралии?',
          answer: 'Канберра',
        },
      ],
    },
    { submitTagReason },
  );

  await userEvent.click(
    screen.getByRole('button', { name: 'Слишком сложный' }),
  );

  expect(submitTagReason).toHaveBeenCalledWith('q1', 'Слишком сложный', '');
});

it('без помеченных вниз вопросов разбора нет', () => {
  renderPlayer({ phase: 'game-end', tagReview: [] });

  expect(screen.queryByText(/что было не так/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 10: Расширить `useRoomConnection` и нарисовать экран**

В `client/src/useRoomConnection.ts` — поле `tagReview` в типе вида (той же формы, что в протоколе), сообщение `tag-reason` в union исходящих, и функция:

```ts
    submitTagReason: (questionId: string, reason: string | null, text: string) =>
      send({ type: 'tag-reason', questionId, reason, text }),
```

Плюс копия списка причин рядом с прочими константами файла (клиент и сервер обязаны понимать его одинаково; `client/` не импортирует из `server/` — типы и константы в этом проекте дублируются вручную):

```ts
export const TAG_REASONS = [
  'Слишком сложный',
  'Слишком лёгкий',
  'Непонятная формулировка',
  'Спорный ответ',
  'Неинтересная тема',
] as const;
```

В `client/src/Player.tsx`, в ветке `case 'game-end':`, **над** итоговым табло:

```tsx
{
  game.tagReview.length > 0 && (
    <div className="player-review">
      <h3>Что было не так?</h3>
      {game.tagReview.map((item) => (
        <div key={item.questionId} className="player-review-item">
          <p className="player-review-question">{item.text}</p>
          <p className="player-review-answer">Ответ: {item.answer}</p>
          <div className="player-review-reasons">
            {TAG_REASONS.map((reason) => (
              <button
                key={reason}
                className="button"
                onClick={() => submitTagReason(item.questionId, reason, '')}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            value={reviewText[item.questionId] ?? ''}
            onChange={(e) =>
              setReviewText((prev) => ({
                ...prev,
                [item.questionId]: e.target.value,
              }))
            }
            placeholder="или своими словами"
          />
          <button
            className="button"
            onClick={() =>
              submitTagReason(
                item.questionId,
                null,
                reviewText[item.questionId] ?? '',
              )
            }
          >
            Отправить
          </button>
        </div>
      ))}
    </div>
  );
}
```

Состояние текста — рядом с прочими `useState` компонента:

```tsx
const [reviewText, setReviewText] = useState<Record<string, string>>({});
```

Разобранный вопрос уходит из `game.tagReview` со следующей рассылкой состояния — отдельного «спасибо» рисовать не нужно, карточка исчезает сама.

- [ ] **Step 11: Добавить стили**

В `client/src/index.css`:

```css
.player-review {
  margin-bottom: 1.5rem;
  text-align: left;
}

.player-review-item {
  margin-bottom: 1.25rem;
}

.player-review-question {
  font-weight: 600;
}

.player-review-answer {
  opacity: 0.75;
}

.player-review-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.player-review-item textarea {
  width: 100%;
  min-height: 3rem;
}
```

- [ ] **Step 12: Прогнать всё**

Run: `pnpm -C server exec vitest run`
Run: `pnpm -C server typecheck`
Run: `pnpm -C server lint`
Run: `pnpm -C client exec vitest run`
Run: `pnpm -C client typecheck`
Run: `pnpm -C client lint`
Run: `pnpm build`

Expected: всё без ошибок.

- [ ] **Step 13: Обновить `docs/ideas.md`**

В таблице нарезки блока «Память и обучение генератора» поставить слайсу C статус `сделано` со ссылкой на спеку, а в записи «Уточнение формы тегов и разбора (2026-08-20)» отметить, что метка ведущего «вопрос кривой» закрыта общей механикой и отдельной задачей больше не является.

- [ ] **Step 14: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts server/src/room.ts server/src/room.test.ts server/src/protocol.ts server/src/server.ts client/src/useRoomConnection.ts client/src/Player.tsx client/src/Player.test.tsx client/src/index.css docs/ideas.md
git commit -m "feat: разбор помеченных вопросов в конце партии уходит в профиль генератора"
```

---

## После всех задач

- Полный набор обоих пакетов: `vitest run`, `typecheck`, `lint`, `build`.
- **Живая проверка** (Шаг 7 в `svoya-igra-dev/SKILL.md`) — тестами не заменяется. Что смотреть, из спеки: успевают ли ставить оценки вообще; проявится ли стадный эффект от счёта со знаком на табло; не бросают ли экран разбора и не мал ли потолок в пять вопросов; какими вариантами причин реально пользуются, а какими не пользуется никто.
- Записать наблюдения в «Проверено вживую» в `svoya-igra-dev/SKILL.md`.
- Закрыть ветку через `superpowers:finishing-a-development-branch`.
