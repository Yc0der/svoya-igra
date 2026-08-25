# Агрегация сигналов в профиль генератора (слайс B) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сервер пересчитывает накопленное в базе в раздел `## Автособранное` файла `docs/pack-generator-profile.md`, откуда его читает генератор пакетов.

**Architecture:** три новые чистые части поверх готовой базы. `history.ts` получает один метод `profileAggregate()` — только чтение, только SQL, никакого текста. Новый `profileSection.ts` превращает агрегат в markdown и вставляет его в файл, не задевая ручных разделов, — чистые функции без ввода-вывода. `generatorProfile.ts` связывает их с диском, `server.ts` вызывает пересчёт в двух точках. Движок и `Room` не трогаются вообще.

**Tech Stack:** TypeScript, Node (`node:sqlite`), Vitest. Никаких новых зависимостей.

**Спека:** [2026-08-25-profile-aggregation-design.md](../specs/2026-08-25-profile-aggregation-design.md) — она источник всех решений ниже; при расхождении права спека.

## Global Constraints

- **Движок (`engine.ts`) не трогается. `Room` (`room.ts`) не трогается.** Всё нужное они пишут в базу с вех A и C.
- **SQL живёт только в `history.ts`.** Ни один другой модуль сервера не знает про таблицы.
- **Сервер не делает выводов.** Никаких порогов, никаких формулировок вида «вянут на спорте». Только числа с контекстом.
- **Идентификатор учтённой записи — `<pack_filename>#<question_id>`**, никогда один `question_id`: он не уникален между паками.
- **Маркер `<!-- учтено: … -->` ищется только ВНЕ заменяемого раздела.** Положенный внутрь, он был бы стёрт следующим пересчётом.
- **Раздел `## Жалобы и оценки игроков` обязан оставаться последним в файле** — `appendComplaint` дописывает жалобы буквально в конец.
- **Маркер «учтено» действует только на список вопросов**, не на числа по ценам и не на сводку тем.
- Комментарии и текст — по-русски, как во всём проекте. Prettier + ESLint, 2 пробела, одинарные кавычки, точки с запятой.
- Тесты — Vitest. База в тестах открывается как `new GameHistory(':memory:')`, как уже сделано в `history.test.ts`.
- Готово — только когда зелено `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Файловая структура

| Файл                                                                         | Что делает                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `server/src/history.ts`                                                      | **изменяется** — типы агрегата и метод `profileAggregate()`                                   |
| `server/src/protocol.ts`                                                     | **изменяется** — именованная константа причины «Неинтересная тема»                            |
| `server/src/profileSection.ts`                                               | **создаётся** — рендер раздела и вставка его в текст файла, чистые функции                    |
| `server/src/profileSection.test.ts`                                          | **создаётся** — тесты рендера и вставки                                                       |
| `server/src/generatorProfile.ts`                                             | **изменяется** — `rewriteAutoSection()`: чтение файла, вызов чистых функций, атомарная запись |
| `server/src/server.ts`                                                       | **изменяется** — две точки пересчёта; запись разбора через `appendComplaint` убирается        |
| `server/src/index.ts`                                                        | **изменяется** — `history` прокидывается в `createServer`                                     |
| `server/src/history.test.ts`                                                 | **изменяется** — тесты `profileAggregate()`                                                   |
| `server/src/generatorProfile.test.ts`                                        | **изменяется** — тесты `rewriteAutoSection()`                                                 |
| `server/src/server.test.ts`                                                  | **изменяется** — тесты проводки                                                               |
| `docs/pack-generator-profile.md`                                             | **изменяется** — вводный текст, маркер, заголовок раздела                                     |
| `.claude/skills/pack-generator/SKILL.md`                                     | **изменяется** — Шаг 0                                                                        |
| `docs/ideas.md`, `docs/superpowers/specs/2026-08-21-question-tags-design.md` | **изменяются** — статусы и пометки                                                            |

---

### Task 1: Агрегат из базы

**Files:**

- Modify: `server/src/protocol.ts` (рядом с `TAG_REASONS`)
- Modify: `server/src/history.ts`
- Test: `server/src/history.test.ts`

**Interfaces:**

- Consumes: существующие таблицы `games`, `played_questions`, `question_tags`.
- Produces: `ProfileAggregate`, `DownTaggedQuestion`, `PriceStats`, `BoringTheme`, `ReasonCount`, `ProfileAggregateSource` и метод `GameHistory.profileAggregate(): ProfileAggregate`. Задачи 2–4 работают только с этими типами и больше ни с чем из `history.ts`.

- [ ] **Шаг 1: Именованная константа причины**

В `server/src/protocol.ts` заменить литерал внутри `TAG_REASONS` на именованную константу — задача 3 будет фильтровать по ней, и второй литерал «Неинтересная тема» в другом файле разошёлся бы с этим при первой же правке списка причин:

```ts
/**
 * Единственная причина с оси «Вкус» (docs/ideas.md, «Две оси, которые нельзя
 * смешивать»). Вынесена из TAG_REASONS отдельным именем, потому что
 * history.ts отбирает по ней сводку тем: литерал, повторённый в двух файлах,
 * разошёлся бы при первой же правке формулировки.
 */
export const REASON_BORING_THEME = 'Неинтересная тема' as const;

export const TAG_REASONS = [
  'Слишком сложный',
  'Слишком лёгкий',
  'Непонятная формулировка',
  'Спорный ответ',
  REASON_BORING_THEME,
] as const;
```

- [ ] **Шаг 2: Написать падающие тесты агрегата**

В конец `server/src/history.test.ts`. Хелперы `makeHistory` и `QUESTION` уже есть в файле — использовать их, не заводить свои.

```ts
describe('GameHistory.profileAggregate', () => {
  it('схлопывает один вопрос из двух партий в одну запись', () => {
    const history = makeHistory();
    const g1 = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    const g2 = history.startGame({
      startedAt: '2026-08-02',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    history.recordQuestion(g1, QUESTION);
    history.recordQuestion(g2, QUESTION);
    history.recordTag(g1, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
      reason: null,
      reasonText: null,
    });
    history.recordTag(g2, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
      reason: null,
      reasonText: null,
    });
    history.recordTagReason(
      g1,
      QUESTION.questionId,
      'p1',
      'Слишком сложный',
      '',
    );
    history.recordTagReason(
      g2,
      QUESTION.questionId,
      'p1',
      'Слишком сложный',
      '',
    );

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged).toHaveLength(1);
    expect(aggregate.downTagged[0]).toMatchObject({
      packFilename: 'pack.json',
      questionId: QUESTION.questionId,
      down: 2,
      up: 0,
      reasons: [{ reason: 'Слишком сложный', count: 2 }],
      lastGameId: g2,
    });
  });

  it('включает палец вниз без разбора и не выдумывает ему причину', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    history.recordQuestion(gameId, QUESTION);
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
      reason: null,
      reasonText: null,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged[0].down).toBe(1);
    expect(aggregate.downTagged[0].reasons).toEqual([]);
    expect(aggregate.downTagged[0].texts).toEqual([]);
  });

  it('считает палец вверх рядом с пальцем вниз, но сам по себе записи не создаёт', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'p1', name: 'Ваня' },
        { counterId: 'p2', name: 'Катя' },
      ],
    })!;
    history.recordQuestion(gameId, QUESTION);
    history.recordQuestion(gameId, { ...QUESTION, questionId: 'r1-geo-200' });
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
      reason: null,
      reasonText: null,
    });
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'up',
      reason: null,
      reasonText: null,
    });
    history.recordTag(gameId, {
      questionId: 'r1-geo-200',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'up',
      reason: null,
      reasonText: null,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged).toHaveLength(1);
    expect(aggregate.downTagged[0]).toMatchObject({ down: 1, up: 1 });
  });

  it('различает «не взял никто» и «без вердикта»', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    // Верный, неверный, никто не нажал, ведущий отменил после нажатия.
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'a',
      correct: true,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'b',
      correct: false,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'c',
      answeredBy: null,
      answeredByCounterId: null,
      correct: null,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'd',
      correct: null,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.prices).toEqual([
      { price: 100, correct: 1, wrong: 1, untaken: 1, noVerdict: 1 },
    ]);
  });

  it('исключает из цен финальные вопросы и аукционы, но оставляет котов', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'кот',
      type: 'кот',
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'аукцион',
      type: 'аукцион',
      price: 700,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'финал',
      roundIndex: -1,
      price: 0,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.prices).toEqual([
      { price: 100, correct: 1, wrong: 0, untaken: 0, noVerdict: 0 },
    ]);
  });

  it('считает темы только по причине «Неинтересная тема»', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'p1', name: 'Ваня' },
        { counterId: 'p2', name: 'Катя' },
      ],
    })!;
    history.recordQuestion(gameId, QUESTION);
    for (const participantId of ['p1', 'p2']) {
      history.recordTag(gameId, {
        questionId: QUESTION.questionId,
        participantId,
        participantName: participantId,
        thumb: 'down',
        reason: null,
        reasonText: null,
      });
    }
    history.recordTagReason(
      gameId,
      QUESTION.questionId,
      'p1',
      'Неинтересная тема',
      '',
    );
    history.recordTagReason(
      gameId,
      QUESTION.questionId,
      'p2',
      'Непонятная формулировка',
      '',
    );

    const aggregate = history.profileAggregate();
    expect(aggregate.boringThemes).toEqual([
      { themeName: 'География', count: 1, games: 1 },
    ]);
  });

  it('на пустой базе отдаёт нули и пустые списки', () => {
    const aggregate = makeHistory().profileAggregate();
    expect(aggregate).toEqual({
      games: 0,
      questions: 0,
      tags: 0,
      downTagged: [],
      prices: [],
      boringThemes: [],
    });
  });
});
```

- [ ] **Шаг 3: Прогнать тесты и убедиться, что они падают**

Run: `pnpm -C server exec vitest run src/history.test.ts`
Expected: FAIL — `history.profileAggregate is not a function`.

- [ ] **Шаг 4: Типы агрегата**

В `server/src/history.ts`, рядом с остальными экспортируемыми интерфейсами:

```ts
export interface ReasonCount {
  reason: string;
  count: number;
}

/**
 * Вопрос, помеченный пальцем вниз, — единица списка в разделе
 * «Автособранное». Ключ — пара (пак, id вопроса), а не строка партии: один и
 * тот же вопрос, сыгранный дважды, даёт одну запись со сложенными числами.
 * Один только questionId ключом быть не может: `r1-geo-100` встречается в
 * разных паках, и на слайсе C эта коллизия уже привязывала жалобу к чужому
 * вопросу.
 */
export interface DownTaggedQuestion {
  packFilename: string;
  questionId: string;
  themeName: string;
  price: number;
  text: string;
  answer: string;
  down: number;
  // Печатается рядом с down: вопрос с тремя 👎 и пятью 👍 не брак, а раскол в
  // компании, и для генератора это разные выводы.
  up: number;
  // По убыванию кратности.
  reasons: ReasonCount[];
  texts: string[];
  // Наибольший game_id среди оценок этого вопроса — по нему задача 2
  // разрешает равенство при сортировке (свежее выше).
  lastGameId: number;
}

/**
 * Как берётся цена. Четыре числа, а не три: `correct IS NULL` означает две
 * разные вещи (room.ts, recordPlayedQuestion) — никто не нажал, либо ведущий
 * отменил вопрос уже после нажатия. Различает их answered_by, и без
 * четвёртого числа сумма по строке не сходится с числом сыгранных вопросов.
 */
export interface PriceStats {
  price: number;
  correct: number;
  wrong: number;
  untaken: number;
  noVerdict: number;
}

export interface BoringTheme {
  themeName: string;
  count: number;
  games: number;
}

export interface ProfileAggregate {
  games: number;
  questions: number;
  tags: number;
  downTagged: DownTaggedQuestion[];
  prices: PriceStats[];
  boringThemes: BoringTheme[];
}

/**
 * Узкий интерфейс для server.ts — только чтение сводки. Отдельно от
 * HistoryRecorder (интерфейса Room) намеренно: сервер не должен иметь
 * возможности что-то записать в историю, это дело Комнаты.
 */
export interface ProfileAggregateSource {
  profileAggregate(): ProfileAggregate;
}
```

Дописать `ProfileAggregateSource` в объявление класса:

```ts
export class GameHistory implements HistoryRecorder, ProfileAggregateSource {
```

- [ ] **Шаг 5: Метод `profileAggregate()`**

Метод класса `GameHistory`, рядом с `allTags()`. Импортировать `REASON_BORING_THEME` из `./protocol.js`.

```ts
  /**
   * Сводка для раздела «Автособранное» в docs/pack-generator-profile.md
   * (design.md, 2026-08-25-profile-aggregation-design.md). Только числа и
   * контекст — никаких выводов и никаких порогов: толкует их генератор,
   * читая файл, а не сервер, записывая его.
   *
   * Список «учтено» здесь не применяется: он живёт в файле профиля, а не в
   * базе (инвариант 5 — генератор не пишет в хранилище игры), и фильтрует
   * записи уже profileSection.ts.
   */
  profileAggregate(): ProfileAggregate {
    const empty: ProfileAggregate = {
      games: 0,
      questions: 0,
      tags: 0,
      downTagged: [],
      prices: [],
      boringThemes: [],
    };
    try {
      const counts = this.db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM games) AS games,
                  (SELECT COUNT(*) FROM played_questions) AS questions,
                  (SELECT COUNT(*) FROM question_tags) AS tags`,
        )
        .get() as Record<string, unknown>;

      // round_index >= 0 отсекает финальный вопрос (room.ts,
      // recordFinalQuestion пишет -1 и price 0 — ноль вместо цены не цена).
      // type != 'аукцион' отсекает аукционы: в price у них лежит выигравшая
      // ставка, а не номинал пакета (room.ts, recordPlayedQuestion), и на
      // вопрос «верно ли выставлена цена 500 в паке» такая строка не
      // отвечает. Номинал в базе не сохранён, чинить нечем.
      const priceRows = this.db
        .prepare(
          `SELECT price,
                  SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct,
                  SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS wrong,
                  SUM(CASE WHEN answered_by IS NULL THEN 1 ELSE 0 END) AS untaken,
                  SUM(CASE WHEN answered_by IS NOT NULL AND correct IS NULL
                           THEN 1 ELSE 0 END) AS no_verdict
           FROM played_questions
           WHERE round_index >= 0 AND type != 'аукцион'
           GROUP BY price
           ORDER BY price`,
        )
        .all() as Record<string, unknown>[];

      const themeRows = this.db
        .prepare(
          `SELECT q.theme_name AS theme_name,
                  COUNT(*) AS count,
                  COUNT(DISTINCT t.game_id) AS games
           FROM question_tags t
           JOIN played_questions q
             ON q.game_id = t.game_id AND q.question_id = t.question_id
           WHERE t.reason = ?
           GROUP BY q.theme_name
           ORDER BY count DESC, q.theme_name`,
        )
        .all(REASON_BORING_THEME) as Record<string, unknown>[];

      // Схлопывание идёт в TypeScript, а не в SQL: собрать здесь надо не одно
      // число, а счётчики пальцев, кратности причин и список текстов сразу —
      // в SQL это три отдельных запроса с ручной сборкой поверх них, при
      // объёмах в сотни строк выигрыша нет, а читаемость хуже.
      const tagRows = this.db
        .prepare(
          `SELECT g.pack_filename, t.question_id, t.game_id, t.thumb,
                  t.reason, t.reason_text,
                  q.theme_name, q.price, q.text, q.answer
           FROM question_tags t
           JOIN played_questions q
             ON q.game_id = t.game_id AND q.question_id = t.question_id
           JOIN games g ON g.id = t.game_id
           ORDER BY t.id`,
        )
        .all() as Record<string, unknown>[];

      const byQuestion = new Map<
        string,
        DownTaggedQuestion & { reasonCounts: Map<string, number> }
      >();
      for (const row of tagRows) {
        const packFilename = row.pack_filename as string;
        const questionId = row.question_id as string;
        const key = `${packFilename}#${questionId}`;
        let entry = byQuestion.get(key);
        if (!entry) {
          entry = {
            packFilename,
            questionId,
            themeName: row.theme_name as string,
            price: Number(row.price),
            text: row.text as string,
            answer: row.answer as string,
            down: 0,
            up: 0,
            reasons: [],
            texts: [],
            lastGameId: 0,
            reasonCounts: new Map(),
          };
          byQuestion.set(key, entry);
        }
        const isDown = Number(row.thumb) === 0;
        if (isDown) entry.down += 1;
        else entry.up += 1;
        // lastGameId двигают только пальцы вниз: сортировка задачи 2 про них,
        // и поздний палец вверх не должен поднимать старую претензию наверх.
        if (isDown) {
          entry.lastGameId = Math.max(entry.lastGameId, Number(row.game_id));
        }
        const reason = (row.reason as string | null) ?? null;
        if (reason !== null) {
          entry.reasonCounts.set(reason, (entry.reasonCounts.get(reason) ?? 0) + 1);
        }
        const reasonText = (row.reason_text as string | null) ?? null;
        if (reasonText !== null && reasonText !== '') entry.texts.push(reasonText);
      }

      const downTagged = [...byQuestion.values()]
        .filter((entry) => entry.down > 0)
        .map(({ reasonCounts, ...entry }) => ({
          ...entry,
          reasons: [...reasonCounts.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        }))
        .sort((a, b) => b.down - a.down || b.lastGameId - a.lastGameId);

      return {
        games: Number(counts.games),
        questions: Number(counts.questions),
        tags: Number(counts.tags),
        downTagged,
        prices: priceRows.map((row) => ({
          price: Number(row.price),
          correct: Number(row.correct),
          wrong: Number(row.wrong),
          untaken: Number(row.untaken),
          noVerdict: Number(row.no_verdict),
        })),
        boringThemes: themeRows.map((row) => ({
          themeName: row.theme_name as string,
          count: Number(row.count),
          games: Number(row.games),
        })),
      };
    } catch (err) {
      // Тот же принцип, что у остальных методов: побочная функция не роняет
      // сервер (design.md, 2026-08-20, «Отказы не ломают партию»).
      console.error('История: не удалось собрать сводку для профиля —', err);
      return empty;
    }
  }
```

- [ ] **Шаг 6: Прогнать тесты и убедиться, что они проходят**

Run: `pnpm -C server exec vitest run src/history.test.ts`
Expected: PASS, все тесты файла.

- [ ] **Шаг 7: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts server/src/protocol.ts
git commit -m "feat: сводка истории партий для профиля генератора"
```

---

### Task 2: Разметка раздела

**Files:**

- Create: `server/src/profileSection.ts`
- Test: `server/src/profileSection.test.ts`

**Interfaces:**

- Consumes: `ProfileAggregate` из `history.ts` (задача 1) — целиком, поле в поле.
- Produces: `AUTO_HEADING: string`, `renderAutoSection(aggregate: ProfileAggregate, acknowledged: ReadonlySet<string>): string`. Возврат — текст раздела **без** завершающего перевода строки: добавляет его задача 3 при вставке.

- [ ] **Шаг 1: Написать падающие тесты**

Создать `server/src/profileSection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderAutoSection } from './profileSection.js';
import type { ProfileAggregate } from './history.js';

const EMPTY: ProfileAggregate = {
  games: 0,
  questions: 0,
  tags: 0,
  downTagged: [],
  prices: [],
  boringThemes: [],
};

const QUESTION = {
  packFilename: 'photo-test.json',
  questionId: 'r1-kino-400',
  themeName: 'Кино',
  price: 400,
  text: 'Опера «Кармен» какого композитора?',
  answer: 'Жорж Бизе',
  down: 3,
  up: 1,
  reasons: [
    { reason: 'Неинтересная тема', count: 2 },
    { reason: 'Слишком сложный', count: 1 },
  ],
  texts: ['вообще не про кино'],
  lastGameId: 2,
};

describe('renderAutoSection', () => {
  it('на пустой базе печатает заголовок и «пока пусто»', () => {
    const text = renderAutoSection(EMPTY, new Set());
    expect(text).toContain('## Автособранное');
    expect(text).toContain('Пока пусто — в базе нет сыгранных партий.');
    expect(text).not.toContain('###');
  });

  it('склоняет числительные в шапке выборки', () => {
    const one = renderAutoSection(
      { ...EMPTY, games: 1, questions: 1, tags: 1 },
      new Set(),
    );
    expect(one).toContain('1 партия, 1 сыгранный вопрос, 1 оценка от игроков');
    const few = renderAutoSection(
      { ...EMPTY, games: 3, questions: 22, tags: 12 },
      new Set(),
    );
    expect(few).toContain(
      '3 партии, 22 сыгранных вопроса, 12 оценок от игроков',
    );
    const many = renderAutoSection(
      { ...EMPTY, games: 5, questions: 147, tags: 25 },
      new Set(),
    );
    expect(many).toContain(
      '5 партий, 147 сыгранных вопросов, 25 оценок от игроков',
    );
  });

  it('печатает запись вопроса с пальцами, причинами и текстом', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).toContain('- **photo-test.json · «Кино» · 400** —');
    expect(text).toContain('(ответ: «Жорж Бизе»)');
    expect(text).toContain(
      '👎 3 · 👍 1 · причины: «Неинтересная тема» ×2, «Слишком сложный» ×1',
    );
    expect(text).toContain('Текстом: «вообще не про кино»');
  });

  it('не печатает 👍, когда его нет, и говорит прямо, что причин не указали', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, up: 0, reasons: [], texts: [] }],
      },
      new Set(),
    );
    expect(text).toContain('👎 3 · причины не указаны');
    expect(text).not.toContain('👍');
    expect(text).not.toContain('Текстом:');
  });

  it('пропускает записи из списка «учтено» по паре пак+вопрос', () => {
    const other = { ...QUESTION, packFilename: 'other.json' };
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION, other] },
      new Set(['photo-test.json#r1-kino-400']),
    );
    expect(text).not.toContain('photo-test.json');
    expect(text).toContain('other.json');
  });

  it('не даёт свободному тексту разорвать раздел заголовком или разделителем', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, texts: ['плохо\n## Заголовок\n---\nещё'] }],
      },
      new Set(),
    );
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Автособранное');
      expect(line.startsWith('---')).toBe(false);
    }
  });

  it('печатает цены списком по возрастанию', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        prices: [
          { price: 500, correct: 15, wrong: 2, untaken: 3, noVerdict: 1 },
          { price: 100, correct: 18, wrong: 1, untaken: 1, noVerdict: 0 },
        ],
      },
      new Set(),
    );
    const prices = text.split('\n').filter((line) => line.startsWith('- **'));
    expect(prices[0]).toBe(
      '- **100** — верно 18, неверно 1, не взял никто 1, без вердикта 0',
    );
    expect(prices[1]).toBe(
      '- **500** — верно 15, неверно 2, не взял никто 3, без вердикта 1',
    );
  });

  it('печатает сводку тем со склонением', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 2,
        boringThemes: [
          { themeName: 'Спорт', count: 4, games: 2 },
          { themeName: 'Литература', count: 1, games: 1 },
        ],
      },
      new Set(),
    );
    expect(text).toContain('- «Спорт» — 4 раза за 2 партии');
    expect(text).toContain('- «Литература» — 1 раз за 1 партию');
  });

  it('не печатает пустых блоков', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 1, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).not.toContain('### Как берутся вопросы по ценам');
    expect(text).not.toContain('### Темы, названные неинтересными');
  });
});
```

- [ ] **Шаг 2: Прогнать тесты и убедиться, что они падают**

Run: `pnpm -C server exec vitest run src/profileSection.test.ts`
Expected: FAIL — модуль `./profileSection.js` не найден.

- [ ] **Шаг 3: Реализовать рендер**

Создать `server/src/profileSection.ts`:

```ts
import type {
  DownTaggedQuestion,
  PriceStats,
  ProfileAggregate,
} from './history.js';

// Заголовок раздела. Задача 3 ищет по нему границы заменяемого куска, поэтому
// это одна константа на оба места, а не два одинаковых литерала.
export const AUTO_HEADING = '## Автособранное';

const INTRO =
  '_Раздел пересчитывается сервером после каждой партии. Правки руками не ' +
  'сохранятся — пиши их в «Ручные заметки». Источник — `game-history.db` ' +
  '(слайсы A и C)._';

/**
 * Русское склонение числительного: 1 партия, 2 партии, 5 партий. Формы —
 * [для 1, для 2–4, для 5 и остальных].
 */
function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Продолжение многострочного значения внутри буллета — тот же приём, что и в
 * formatEntry() из generatorProfile.ts, но здесь он не косметический.
 * Свободный текст приходит из <textarea>, и строка «## Что-то» внутри него,
 * вставленная как есть, стала бы настоящим заголовком: следующий пересчёт
 * принял бы её за границу раздела (задача 3 ищет границу по началу строки) и
 * обрезал бы раздел на середине.
 */
function indentContinuation(value: string): string {
  return value.replace(/\n/g, '\n  ');
}

function renderQuestion(entry: DownTaggedQuestion): string {
  const thumbs =
    entry.up > 0 ? `👎 ${entry.down} · 👍 ${entry.up}` : `👎 ${entry.down}`;
  const reasons =
    entry.reasons.length === 0
      ? 'причины не указаны'
      : `причины: ${entry.reasons
          .map(({ reason, count }) => `«${reason}» ×${count}`)
          .join(', ')}`;
  const head =
    `- **${entry.packFilename} · «${entry.themeName}» · ${entry.price}** — ` +
    `«${indentContinuation(entry.text)}» (ответ: «${entry.answer}»)`;
  const lines = [head, `  ${thumbs} · ${reasons}`];
  if (entry.texts.length > 0) {
    const texts = entry.texts
      .map((text) => `«${indentContinuation(text)}»`)
      .join('; ');
    lines.push(`  Текстом: ${texts}`);
  }
  return lines.join('\n');
}

function renderPrice(stats: PriceStats): string {
  return (
    `- **${stats.price}** — верно ${stats.correct}, неверно ${stats.wrong}, ` +
    `не взял никто ${stats.untaken}, без вердикта ${stats.noVerdict}`
  );
}

/**
 * Раздел «Автособранное» целиком, без завершающего перевода строки — его
 * добавляет вставка (задача 3).
 *
 * Выводов здесь нет и быть не должно: печатаются числа с контекстом, толкует
 * их генератор на Шаге 0 (design.md, 2026-08-25, «Сервер пишет факты,
 * толкует генератор»).
 */
export function renderAutoSection(
  aggregate: ProfileAggregate,
  acknowledged: ReadonlySet<string>,
): string {
  const sample =
    `_Выборка: ${aggregate.games} ${plural(aggregate.games, ['партия', 'партии', 'партий'])}, ` +
    `${aggregate.questions} ${plural(aggregate.questions, [
      'сыгранный вопрос',
      'сыгранных вопроса',
      'сыгранных вопросов',
    ])}, ` +
    `${aggregate.tags} ${plural(aggregate.tags, ['оценка', 'оценки', 'оценок'])} от игроков._`;

  const blocks: string[] = [];

  // Список «учтено» действует только здесь: числа по ценам и сводка тем —
  // агрегаты по всей истории, а не уроки, которые разбирают поштучно
  // (design.md, 2026-08-25).
  const downTagged = aggregate.downTagged.filter(
    (entry) => !acknowledged.has(`${entry.packFilename}#${entry.questionId}`),
  );
  if (downTagged.length > 0) {
    blocks.push(
      [
        '### Вопросы, помеченные пальцем вниз',
        '',
        ...downTagged.map(renderQuestion),
      ].join('\n'),
    );
  }
  if (aggregate.prices.length > 0) {
    // Сортировка здесь, а не только в SQL: порядок — требование к тому, ЧТО
    // видит человек, и держаться он должен в том модуле, который это рисует,
    // а не в ORDER BY соседнего файла, откуда его молча уберут при первой
    // правке запроса.
    const prices = [...aggregate.prices].sort((a, b) => a.price - b.price);
    blocks.push(
      ['### Как берутся вопросы по ценам', '', ...prices.map(renderPrice)].join(
        '\n',
      ),
    );
  }
  if (aggregate.boringThemes.length > 0) {
    blocks.push(
      [
        '### Темы, названные неинтересными',
        '',
        ...aggregate.boringThemes.map(
          (theme) =>
            `- «${theme.themeName}» — ${theme.count} ${plural(theme.count, [
              'раз',
              'раза',
              'раз',
            ])} за ${theme.games} ${plural(theme.games, ['партию', 'партии', 'партий'])}`,
        ),
      ].join('\n'),
    );
  }

  // Пустой раздел всё равно печатается заголовком и шапкой: структура файла не
  // должна зависеть от того, есть данные или нет — иначе вставка (задача 3)
  // при первой же партии искала бы границы там, где их нет.
  const body =
    blocks.length > 0
      ? blocks.join('\n\n')
      : 'Пока пусто — в базе нет сыгранных партий.';

  return [AUTO_HEADING, '', INTRO, '', sample, '', body].join('\n');
}
```

- [ ] **Шаг 4: Прогнать тесты и убедиться, что они проходят**

Run: `pnpm -C server exec vitest run src/profileSection.test.ts`
Expected: PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add server/src/profileSection.ts server/src/profileSection.test.ts
git commit -m "feat: разметка раздела «Автособранное» профиля генератора"
```

---

### Task 3: Вставка раздела в файл и маркер «учтено»

**Files:**

- Modify: `server/src/profileSection.ts`
- Test: `server/src/profileSection.test.ts`

**Interfaces:**

- Consumes: `AUTO_HEADING` из задачи 2.
- Produces: `parseAcknowledged(fileText: string): Set<string>` и `spliceAutoSection(fileText: string, section: string): string`. Задача 4 вызывает их именно в этом порядке: сначала разбор маркера по старому тексту, потом рендер, потом вставка.

- [ ] **Шаг 1: Написать падающие тесты**

Дописать в `server/src/profileSection.test.ts` (импорт расширить: `parseAcknowledged`, `spliceAutoSection`):

```ts
const FILE = [
  '# Профиль компании',
  '',
  '## Ручные заметки (сейчас)',
  '',
  '<!-- учтено: photo-test.json#r1-kino-400 -->',
  '',
  '- правило про скобки',
  '',
  '---',
  '',
  '## Автособранное (будет позже)',
  '',
  'Пока пусто.',
  '',
  '---',
  '',
  '## Жалобы и оценки игроков',
  '',
  '- старая жалоба',
  '',
].join('\n');

describe('parseAcknowledged', () => {
  it('читает идентификаторы из маркера', () => {
    expect(parseAcknowledged(FILE)).toEqual(
      new Set(['photo-test.json#r1-kino-400']),
    );
  });

  it('читает несколько идентификаторов и несколько маркеров', () => {
    const text = [
      '## Ручные заметки (сейчас)',
      '<!-- учтено: a.json#q1, b.json#q2 -->',
      '<!-- учтено: c.json#q3 -->',
    ].join('\n');
    expect(parseAcknowledged(text)).toEqual(
      new Set(['a.json#q1', 'b.json#q2', 'c.json#q3']),
    );
  });

  it('не подхватывает маркер, лежащий внутри заменяемого раздела', () => {
    const text = [
      '## Ручные заметки (сейчас)',
      '',
      '---',
      '',
      '## Автособранное',
      '',
      '<!-- учтено: a.json#q1 -->',
      '',
    ].join('\n');
    expect(parseAcknowledged(text)).toEqual(new Set());
  });

  it('на пустом маркере отдаёт пустое множество', () => {
    expect(parseAcknowledged('<!-- учтено: -->')).toEqual(new Set());
  });
});

describe('spliceAutoSection', () => {
  it('заменяет раздел, не трогая соседние', () => {
    const updated = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    expect(updated).toContain('- правило про скобки');
    expect(updated).toContain('<!-- учтено: photo-test.json#r1-kino-400 -->');
    expect(updated).toContain('новое');
    expect(updated).not.toContain('Пока пусто.');
    expect(updated).not.toContain('(будет позже)');
  });

  it('оставляет раздел жалоб последним в файле', () => {
    const updated = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings[headings.length - 1]).toBe('## Жалобы и оценки игроков');
    expect(updated.trimEnd().endsWith('- старая жалоба')).toBe(true);
  });

  it('идемпотентна: повторная вставка того же раздела ничего не меняет', () => {
    const once = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    expect(spliceAutoSection(once, '## Автособранное\n\nновое')).toBe(once);
  });

  it('вставляет раздел перед жалобами, если его в файле нет', () => {
    const text = [
      '# Профиль',
      '',
      '---',
      '',
      '## Жалобы и оценки игроков',
      '',
      '- жалоба',
      '',
    ].join('\n');
    const updated = spliceAutoSection(text, '## Автособранное\n\nновое');
    expect(updated.indexOf('## Автособранное')).toBeLessThan(
      updated.indexOf('## Жалобы и оценки игроков'),
    );
    expect(updated).toContain('- жалоба');
  });

  it('дописывает раздел в конец, если нет ни его, ни жалоб', () => {
    const updated = spliceAutoSection(
      '# Профиль\n',
      '## Автособранное\n\nновое',
    );
    expect(updated.trimEnd().endsWith('новое')).toBe(true);
    expect(updated).toContain('# Профиль');
  });
});
```

- [ ] **Шаг 2: Прогнать тесты и убедиться, что они падают**

Run: `pnpm -C server exec vitest run src/profileSection.test.ts`
Expected: FAIL — `parseAcknowledged is not a function`.

- [ ] **Шаг 3: Реализовать границы, разбор маркера и вставку**

Дописать в `server/src/profileSection.ts`:

```ts
const COMPLAINTS_HEADING = '## Жалобы и оценки игроков';

// Глобальный флаг не ставится: regex с /g несёт состояние lastIndex между
// вызовами, и второй разбор того же текста начинался бы с середины. Перебор
// идёт по строкам, поэтому /g не нужен.
const MARKER = /<!--\s*учтено:([^>]*)-->/;

/**
 * Границы заменяемого раздела в списке строк: [start, end). Конец — первая
 * строка после заголовка, начинающая новый раздел («## ») или разделитель
 * («---»); сама она в раздел не входит и не трогается.
 *
 * Сравнение идёт по началу строки без обрезки отступа — это не небрежность:
 * многострочный свободный текст игрока вставляется с отступом в два пробела
 * (indentContinuation), и такая строка не должна считаться границей.
 */
function findSectionRange(
  lines: string[],
): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.startsWith(AUTO_HEADING));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.startsWith('## ') || line.startsWith('---')) break;
    end += 1;
  }
  return { start, end };
}

/**
 * Идентификаторы записей, которые генератор уже обобщил в «Ручные заметки»,
 * — из строк вида `<!-- учтено: pack.json#r1-geo-100, other.json#q2 -->`.
 *
 * Маркер ищется ВНЕ заменяемого раздела: положенный внутрь него, он был бы
 * стёрт следующим же пересчётом, и запись вернулась бы (design.md,
 * 2026-08-25, «Разобранное помечается в файле, не в базе»).
 */
export function parseAcknowledged(fileText: string): Set<string> {
  const lines = fileText.split('\n');
  const range = findSectionRange(lines);
  const acknowledged = new Set<string>();
  lines.forEach((line, index) => {
    if (range && index >= range.start && index < range.end) return;
    const match = MARKER.exec(line);
    if (!match) return;
    for (const id of match[1].split(',')) {
      const trimmed = id.trim();
      if (trimmed !== '') acknowledged.add(trimmed);
    }
  });
  return acknowledged;
}

/**
 * Ставит готовый раздел на место старого, не трогая всего остального в файле.
 *
 * Раздел «Жалобы и оценки игроков» обязан остаться последним: appendComplaint
 * дописывает жалобы буквально в конец файла (generatorProfile.ts). Поэтому
 * отсутствующий раздел вставляется ПЕРЕД жалобами, а не в конец.
 */
export function spliceAutoSection(fileText: string, section: string): string {
  const lines = fileText.split('\n');
  const sectionLines = section.split('\n');
  const range = findSectionRange(lines);
  if (range) {
    return [
      ...lines.slice(0, range.start),
      ...sectionLines,
      '',
      ...lines.slice(range.end),
    ].join('\n');
  }
  const complaints = lines.findIndex((line) =>
    line.startsWith(COMPLAINTS_HEADING),
  );
  if (complaints !== -1) {
    return [
      ...lines.slice(0, complaints),
      ...sectionLines,
      '',
      '---',
      '',
      ...lines.slice(complaints),
    ].join('\n');
  }
  const base = fileText.endsWith('\n') ? fileText : `${fileText}\n`;
  return `${base}\n---\n\n${section}\n`;
}
```

- [ ] **Шаг 4: Прогнать тесты и убедиться, что они проходят**

Run: `pnpm -C server exec vitest run src/profileSection.test.ts`
Expected: PASS, включая тест на идемпотентность — если он красный, вставка добавляет или съедает пустую строку, и файл будет расти при каждой партии.

- [ ] **Шаг 5: Коммит**

```bash
git add server/src/profileSection.ts server/src/profileSection.test.ts
git commit -m "feat: вставка «Автособранного» в профиль и маркер учтённого"
```

---

### Task 4: Проводка — когда пересчитывается

**Files:**

- Modify: `server/src/generatorProfile.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/generatorProfile.test.ts`, `server/src/server.test.ts`

**Interfaces:**

- Consumes: `profileAggregate()` (задача 1), `renderAutoSection`/`parseAcknowledged`/`spliceAutoSection` (задачи 2–3).
- Produces: `rewriteAutoSection(profilePath: string, aggregate: ProfileAggregate): Promise<void>` в `generatorProfile.ts`; поле `history?: ProfileAggregateSource` в опциях `createServer`.

- [ ] **Шаг 1: Тест `rewriteAutoSection`**

Дописать в `server/src/generatorProfile.test.ts` отдельным `describe` — своим, а не внутри существующего `describe('appendComplaint')`. Импорты файла дополнить: `stat` из `node:fs/promises`, `rewriteAutoSection` из `./generatorProfile.js`, тип `ProfileAggregate` из `./history.js`.

```ts
describe('rewriteAutoSection', () => {
  let dir: string;
  let profilePath: string;

  const EMPTY: ProfileAggregate = {
    games: 0,
    questions: 0,
    tags: 0,
    downTagged: [],
    prices: [],
    boringThemes: [],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-auto-section-'));
    profilePath = join(dir, 'profile.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('переписывает раздел, не трогая ручные заметки и жалобы', async () => {
    await writeFile(
      profilePath,
      [
        '## Ручные заметки (сейчас)',
        '',
        '- правило',
        '',
        '---',
        '',
        '## Автособранное (будет позже)',
        '',
        'Пока пусто.',
        '',
        '---',
        '',
        '## Жалобы и оценки игроков',
        '',
        '- старая жалоба',
        '',
      ].join('
'),
      'utf8',
    );

    await rewriteAutoSection(profilePath, {
      ...EMPTY,
      games: 1,
      questions: 1,
      prices: [{ price: 100, correct: 1, wrong: 0, untaken: 0, noVerdict: 0 }],
    });

    const content = await readFile(profilePath, 'utf8');
    expect(content).toContain('- **100** — верно 1, неверно 0');
    expect(content).toContain('- правило');
    expect(content).toContain('- старая жалоба');
    expect(content).not.toContain('Пока пусто.');
    // Жалобы обязаны остаться последними — appendComplaint пишет в конец файла.
    expect(content.trimEnd().endsWith('- старая жалоба')).toBe(true);
  });

  it('не пишет на диск, когда пересчёт ничего не изменил', async () => {
    await writeFile(profilePath, '# Профиль

## Автособранное

старое
', 'utf8');

    await rewriteAutoSection(profilePath, EMPTY);
    const first = await stat(profilePath);
    await rewriteAutoSection(profilePath, EMPTY);
    const second = await stat(profilePath);

    // Пересчёт идёт на каждое объяснение причины — файл не должен
    // переписываться, когда в нём нечего менять.
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it('исключает записи, помеченные маркером «учтено»', async () => {
    await writeFile(
      profilePath,
      [
        '## Ручные заметки (сейчас)',
        '',
        '<!-- учтено: pack.json#q1 -->',
        '',
        '---',
        '',
        '## Автособранное',
        '',
        'Пока пусто.',
        '',
      ].join('
'),
      'utf8',
    );

    await rewriteAutoSection(profilePath, {
      ...EMPTY,
      games: 1,
      downTagged: [
        {
          packFilename: 'pack.json',
          questionId: 'q1',
          themeName: 'Тема',
          price: 100,
          text: 'Вопрос?',
          answer: 'Ответ',
          down: 1,
          up: 0,
          reasons: [],
          texts: [],
          lastGameId: 1,
        },
      ],
    });

    const content = await readFile(profilePath, 'utf8');
    expect(content).not.toContain('Вопрос?');
    expect(content).toContain('<!-- учтено: pack.json#q1 -->');
  });
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что тест падает**

Run: `pnpm -C server exec vitest run src/generatorProfile.test.ts`
Expected: FAIL — `rewriteAutoSection is not a function`.

- [ ] **Шаг 3: Реализовать `rewriteAutoSection`**

В `server/src/generatorProfile.ts` (импорты дополнить):

```ts
import type { ProfileAggregate } from './history.js';
import {
  parseAcknowledged,
  renderAutoSection,
  spliceAutoSection,
} from './profileSection.js';

/**
 * Пересчитывает раздел «Автособранное» целиком (design.md, 2026-08-25).
 * Дописывания здесь нет намеренно: раздел — чистая проекция базы, и именно
 * поэтому одна претензия от шестерых игроков даёт одну запись «×6», а не
 * шесть одинаковых буллетов (живая партия 2026-08-21).
 *
 * Порядок обязателен: список «учтено» читается из СТАРОГО текста файла, до
 * того как раздел заменён, — иначе маркер, стоящий рядом с разделом, уже
 * потерян.
 *
 * Тот же атомарный приём записи, что и в appendComplaint: temp + rename.
 */
export async function rewriteAutoSection(
  profilePath: string,
  aggregate: ProfileAggregate,
): Promise<void> {
  const current = await readFile(profilePath, 'utf8');
  const section = renderAutoSection(aggregate, parseAcknowledged(current));
  const updated = spliceAutoSection(current, section);
  // Пересчёт идёт на каждое объяснение причины, то есть несколько раз подряд,
  // пока игроки заполняют экран разбора. Без этой проверки файл переписывался
  // бы и когда в нём нечего менять.
  if (updated === current) return;
  const tmpPath = `${profilePath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, profilePath);
}
```

- [ ] **Шаг 4: Прогнать тест**

Run: `pnpm -C server exec vitest run src/generatorProfile.test.ts`
Expected: PASS.

- [ ] **Шаг 5: Переписать существующий тест проводки в `server.test.ts`**

В файле уже есть готовый интеграционный тест, который поднимает сервер с `profilePath` и настоящей `GameHistory`, доводит партию до `game-end` и отправляет `tag-reason`: **`server.test.ts:1086`, «tag-reason доносит причину до комнаты и дописывает её в профиль генератора»**. Второго такого харнесса заводить не надо — этот тест меняется на месте. После задачи 4 он обязан упасть: разбор больше не дописывает буллет в жалобы.

Что в нём поменять:

1. В `createServer({...})` добавить `history` — тот же объект, что уже передан в `Room`:

```ts
const server = createServer({
  room,
  clientDistPath: dir,
  port: 8080,
  packsDir: dir,
  profilePath,
  history,
});
```

2. Файл профиля создать с разделом, куда пересчёт будет писать:

```ts
      await writeFile(
        profilePath,
        '# Профиль компании

Вступление.

---

## Автособранное

Пока пусто.
',
        'utf8',
      );
```

3. Переименовать тест в «tag-reason доносит причину до комнаты и пересчитывает «Автособранное»» и заменить хвост с ожиданиями (всё, что после `expect(room.toGameStateView(...)?.tagReview).toEqual([])`) на:

```ts
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
expect(profileContent).toContain('- **test.json · «Тема» · 100** —');
expect(profileContent).toContain('«Вопрос?» (ответ: «Ответ»)');
expect(profileContent).toContain('👎 1 · причины: «Слишком сложный» ×1');
// Раздела жалоб разбор больше не касается вовсе.
expect(profileContent).not.toContain('## Жалобы и оценки игроков');
```

4. Тесты пути «Пожаловаться» в `/admin` (около `server.test.ts:2924`) **не трогать** — они и должны остаться зелёными: этот путь по-прежнему дописывает жалобу через `appendComplaint`. Если какой-то из них покраснел, значит задача 4 задела чужой путь.

- [ ] **Шаг 6: Прогнать и убедиться, что тест падает**

Run: `pnpm -C server exec vitest run src/server.test.ts`
Expected: FAIL — раздел «Автособранное» не появился (проводки ещё нет), а буллет от разбора всё ещё дописан в жалобы.

- [ ] **Шаг 7: Проводка в `server.ts`**

1. В `CreateServerOptions` добавить поле и разобрать его в `const { … } = options`:

```ts
  // Только чтение сводки — записывать в историю может лишь Room.
  history?: ProfileAggregateSource;
```

2. Рядом с `withProfileWriteLock` добавить:

```ts
// Пересчёт раздела «Автособранное» (design.md, 2026-08-25). Ошибки
// проглатываются с записью в лог по тому же правилу, что и остальная
// работа с профилем: партия важнее файла для генератора.
async function refreshAutoSection(): Promise<void> {
  if (!profilePath || !history) return;
  try {
    const aggregate = history.profileAggregate();
    await withProfileWriteLock(() =>
      rewriteAutoSection(profilePath, aggregate),
    );
  } catch (err) {
    console.error('Не удалось пересчитать «Автособранное» в профиле:', err);
  }
}
```

3. Удалить функцию `appendTagReasonToProfile` целиком и заменить её вызов в обработчике `tag-reason`:

```ts
const context = room.submitTagReason(
  participantId,
  message.questionId,
  message.reason,
  message.text,
);
// context !== null означает, что оценка реально записалась в базу —
// только тогда есть что пересчитывать. Дописывания буллета в
// «Жалобы и оценки игроков» здесь больше нет: то же самое теперь
// приходит пересчётом, в схлопнутом виде (design.md, 2026-08-25).
if (context) await refreshAutoSection();
```

Если после удаления `appendTagReasonToProfile` тип `TagComplaintContext` в `server.ts` больше нигде не нужен — убрать импорт; `ComplaintEntry` и `appendComplaint` остаются, их использует путь «Пожаловаться» в `/admin`.

4. Вторая точка пересчёта — конец партии. Рядом с существующими подписками (`room.onChange(broadcastState)`):

```ts
// Разбор идёт УЖЕ ПОСЛЕ game-end, поэтому одного этого пересчёта мало —
// причины он не увидит (их ловит точка в обработчике tag-reason выше).
// Нужен он ради чисел по ценам: они обновятся, даже если разбирать никто
// ничего не станет.
let previousPhase: string | null = null;
room.onChange((state) => {
  const phase = state.game?.phase ?? null;
  if (phase === 'game-end' && previousPhase !== 'game-end') {
    void refreshAutoSection();
  }
  previousPhase = phase;
});
```

- [ ] **Шаг 8: Прокинуть `history` в `index.ts`**

```ts
const { httpServer } = createServer({
  room,
  clientDistPath: CLIENT_DIST_PATH,
  port: PORT,
  packsDir: PACKS_DIR,
  profilePath: PROFILE_PATH,
  // Та же самая база, что пишет Room, — но сервер видит её через узкий
  // интерфейс только на чтение.
  history,
});
```

- [ ] **Шаг 9: Прогнать тесты**

Run: `pnpm -C server exec vitest run`
Expected: PASS, весь серверный набор.

- [ ] **Шаг 10: Коммит**

```bash
git add server/src/generatorProfile.ts server/src/generatorProfile.test.ts server/src/server.ts server/src/server.test.ts server/src/index.ts
git commit -m "feat: пересчёт «Автособранного» в конце партии и после разбора"
```

---

### Task 5: Документация

**Files:**

- Modify: `docs/pack-generator-profile.md`
- Modify: `.claude/skills/pack-generator/SKILL.md`
- Modify: `docs/ideas.md`
- Modify: `docs/superpowers/specs/2026-08-21-question-tags-design.md`

Кода здесь нет — но без этой задачи слайс не работает: генератор не узнает, что появился новый раздел, и никогда не поставит маркер «учтено», из-за чего список вопросов будет расти вечно.

- [ ] **Шаг 1: `docs/pack-generator-profile.md`**

1. Во вводном списке переписать пункт «Автособранное (будет позже)»:

```markdown
- **Автособранное.** Раздел `## Автособранное` сервер пересчитывает целиком после каждой
  партии из `game-history.db` — правки руками там не сохранятся. Он не затирает ручные
  заметки и не трогает жалобы (спека:
  `docs/superpowers/specs/2026-08-25-profile-aggregation-design.md`).
```

2. Пункт про «Жалобы и оценки игроков» поправить: разбор в конце партии сюда больше не пишет, остаётся только кнопка «Пожаловаться» в `/admin`.

3. Сразу под заголовком `## Ручные заметки (сейчас)` добавить пустой маркер:

```markdown
<!-- учтено: -->
```

с однострочным пояснением над ним, что сюда генератор дописывает `<пак>#<id вопроса>` уже обобщённых записей.

4. Заголовок `## Автособранное (будет позже)` привести к `## Автособранное` с текстом-заглушкой «Пока пусто — в базе нет сыгранных партий.» (первый же пересчёт его заменит).

- [ ] **Шаг 2: `.claude/skills/pack-generator/SKILL.md`, Шаг 0**

Дописать пункт про новый раздел:

- `## Автособранное` читать наравне с ручными заметками; это числа, а не выводы — толковать их обязан генератор;
- **обобщив запись из «Вопросов, помеченных пальцем вниз» в «Ручные заметки», дописать её идентификатор `<имя пака>#<id вопроса>` в маркер `<!-- учтено: … -->`** — вычеркнуть саму запись нельзя, она вернётся следующим пересчётом;
- раздел пересчитывается сервером: править его руками бессмысленно.

- [ ] **Шаг 3: `docs/ideas.md`**

1. В таблице слайсов: **B** → `сделано` со ссылкой на спеку.
2. Под таблицей — короткая запись о том, что из исходного списка неявных сигналов не взято и почему: спорное голосование недостижимо, время до нажатия и порядок выбора тем не берутся (причины — в спеке).

- [ ] **Шаг 4: `docs/superpowers/specs/2026-08-21-question-tags-design.md`**

В разделе про запись в профиль — пометка вида «**Изменено 2026-08-25 (слайс B).** Разбор больше не дописывает буллет в «Жалобы и оценки игроков»: те же оценки попадают в файл пересчётом раздела «Автособранное», в схлопнутом виде».

- [ ] **Шаг 5: Полная проверка и коммит**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Прогнать и **посмотреть вывод**, а не предположить результат.

```bash
git add docs .claude/skills/pack-generator/SKILL.md
git commit -m "docs: раздел «Автособранное» в профиле и обязанности генератора"
```

---

## После плана

Живая партия обязательна до закрытия (Шаг 7 в `svoya-igra-dev`). Что она должна показать — в спеке, раздел «Живая проверка»: читается ли раздел человеком, схлопывается ли претензия нескольких игроков в одну запись, не тормозит ли пересчёт экран разбора.

Отдельно: в `game-history.db` лежат данные тестовых прогонов, где пальцы ставились наугад. Их надо удалить перед тем, как судить о содержимом раздела.
