# Постоянные личности игроков (слайс D2) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** игра узнаёт человека между партиями, история привязывается к нему, а генератор видит, кто к каким темам тянется и кто их берёт.

**Architecture:** две новые таблицы и ни одной изменённой колонки — человек у сыгранного вопроса не хранится, а выводится соединением через состав партии. `Room` получает у участника ссылку на человека и передаёт её в историю при старте партии. Лобби превращается из поля ввода в список знакомых. Статистика пересчитывается в раздел `docs/players.md` той же машинкой, что уже работает для «Автособранного». Движок не трогается.

**Tech Stack:** TypeScript, `node:sqlite`, React, Vitest. Никаких новых зависимостей.

**Спека:** [2026-08-26-player-identity-design.md](../specs/2026-08-26-player-identity-design.md) — источник всех решений; при расхождении права спека.

## Global Constraints

- **Движок (`server/src/engine.ts`) не трогается вообще.** Человек — понятие комнаты, не правил игры.
- **SQL живёт только в `server/src/history.ts`.**
- **Три сущности не смешиваются:** человек живёт между партиями, участник — внутри партии, счётчик держит очки. `counterId` — это `participant.id`.
- **Ни одна существующая колонка не меняется.** Только `CREATE TABLE IF NOT EXISTS` — миграции нет и не должно появиться.
- **Человек у вопроса выводится, а не хранится:** `played_questions.answered_by_counter_id` + `game_people(game_id, counter_id)`. Второго источника правды быть не должно.
- **Сервер пишет числа, а не выводы.** Порогов в коде нет; правило «мало данных — не вывод» живёт текстом в `SKILL.md`.
- **История выключена — лобби работает ровно как раньше**, через ввод имени. Это заявленный откат.
- **Слияние профилей — только вне партии.**
- Клиент не импортирует из `server/` — типы сообщений дублируются вручную.
- Комментарии и текст — по-русски. Prettier + ESLint, 2 пробела, одинарные кавычки, точки с запятой.
- Готово — только когда зелено `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Файловая структура

| Файл                                                       | Что делает                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `server/src/history.ts`                                    | **изменяется** — две таблицы, запись состава, чтение списка людей, статистика, слияние |
| `server/src/room.ts`                                       | **изменяется** — `personId` у участника, вход человеком, передача состава в историю    |
| `server/src/protocol.ts`                                   | **изменяется** — `join-as`, список людей в состоянии, слияние                          |
| `server/src/server.ts`                                     | **изменяется** — обработчики, пересчёт раздела                                         |
| `server/src/playerStats.ts`                                | **создаётся** — разметка раздела «Показывает в игре», чистые функции                   |
| `server/src/playersFile.ts`                                | **изменяется** — запись раздела статистики                                             |
| `client/src/useRoomConnection.ts`                          | **изменяется** — список людей, вход человеком, память телефона                         |
| `client/src/Player.tsx`                                    | **изменяется** — лобби со списком                                                      |
| `client/src/useAdminConnection.ts`, `client/src/Admin.tsx` | **изменяются** — слияние профилей                                                      |
| `.claude/skills/pack-generator/SKILL.md`, `docs/ideas.md`  | **изменяются** — правила и статус                                                      |

---

### Task 1: Таблицы людей, состав партии и статистика

**Files:**

- Modify: `server/src/history.ts`
- Test: `server/src/history.test.ts`

**Interfaces:**

- Produces: `PersonSummary`, `PersonThemeStat`, `PersonStats`, `PlayerStats`; методы `listPeople()`, `createPerson(name, createdAt)`, `mergePeople(fromId, intoId)`, `playerStats()`; поле `personId` в `ParticipantRecord`. Задачи 2–6 работают только с этими именами.

- [ ] **Шаг 1: Написать падающие тесты**

В конец `server/src/history.test.ts`. Хелперы `makeHistory` и `QUESTION` в файле уже есть.

```ts
describe('люди и состав партии', () => {
  it('заводит человека и возвращает его в списке', () => {
    const history = makeHistory();
    const id = history.createPerson('Ваня', '2026-08-26');
    expect(id).not.toBeNull();
    expect(history.listPeople()).toEqual([{ id, name: 'Ваня', games: 0 }]);
  });

  it('сортирует список по числу партий убыванием', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const katya = history.createPerson('Катя', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Катя', personId: katya }],
    });
    expect(history.listPeople().map((p) => p.name)).toEqual(['Катя', 'Ваня']);
    expect(history.listPeople()[0].games).toBe(1);
    expect(vanya).not.toBe(katya);
  });

  it('пишет состав только для участников с человеком', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'c1', name: 'Ваня', personId: vanya },
        { counterId: 'c2', name: 'Гость', personId: null },
      ],
    });
    expect(history.listPeople()).toEqual([
      { id: vanya, name: 'Ваня', games: 1 },
    ]);
  });
});

describe('GameHistory.playerStats', () => {
  // Готовит партию: Ваня берёт два вопроса из трёх по «Истории», один верно.
  function seed() {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const gameId = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanya }],
    })!;
    const base = { ...QUESTION, themeName: 'История' };
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q1',
      answeredByCounterId: 'c1',
      correct: true,
    });
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q2',
      answeredByCounterId: 'c1',
      correct: false,
    });
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q3',
      answeredBy: null,
      answeredByCounterId: null,
      correct: null,
    });
    return { history, vanya, gameId };
  }

  it('считает нажатия и верные ответы по теме', () => {
    const { history, vanya } = seed();
    const stats = history.playerStats();
    expect(stats.games).toBe(1);
    expect(stats.people).toEqual([
      {
        id: vanya,
        name: 'Ваня',
        games: 1,
        played: 3,
        buzzes: 2,
        correct: 1,
        themes: [{ themeName: 'История', played: 3, buzzes: 2, correct: 1 }],
      },
    ]);
  });

  it('не считает вопросы партий, в которых человека не было', () => {
    const { history, vanya } = seed();
    const other = history.createPerson('Катя', '2026-08-26')!;
    const second = history.startGame({
      startedAt: '2026-08-27',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c9', name: 'Катя', personId: other }],
    })!;
    history.recordQuestion(second, { ...QUESTION, questionId: 'q9' });

    const vanyaStats = history.playerStats().people.find((p) => p.id === vanya);
    expect(vanyaStats?.played).toBe(3);
  });

  it('исключает финальные вопросы', () => {
    const { history, gameId, vanya } = seed();
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'final',
      roundIndex: -1,
      price: 0,
      themeName: 'Финал',
      answeredByCounterId: 'c1',
      correct: true,
    });
    const stats = history.playerStats().people.find((p) => p.id === vanya);
    expect(stats?.played).toBe(3);
    expect(stats?.themes.map((t) => t.themeName)).toEqual(['История']);
  });

  it('не печатает людей без единой партии', () => {
    const { history } = seed();
    history.createPerson('Никогда не играл', '2026-08-26');
    expect(history.playerStats().people).toHaveLength(1);
  });
});

describe('GameHistory.mergePeople', () => {
  it('перепривязывает состав и удаляет лишнюю запись', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const b = history.createPerson('ваня', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: a }],
    });
    history.startGame({
      startedAt: '2026-08-27',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c2', name: 'ваня', personId: b }],
    });

    expect(history.mergePeople(b, a)).toBe(true);
    expect(history.listPeople()).toEqual([{ id: a, name: 'Ваня', games: 2 }]);
  });

  it('отказывается сливать человека с самим собой', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    expect(history.mergePeople(a, a)).toBe(false);
    expect(history.listPeople()).toHaveLength(1);
  });

  it('переживает случай, когда оба были за одним столом', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const b = history.createPerson('ваня', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'c1', name: 'Ваня', personId: a },
        { counterId: 'c2', name: 'ваня', personId: b },
      ],
    });
    expect(history.mergePeople(b, a)).toBe(true);
    expect(history.listPeople()).toEqual([{ id: a, name: 'Ваня', games: 1 }]);
  });
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/history.test.ts`
Expected: FAIL — `createPerson is not a function`.

- [ ] **Шаг 3: Таблицы и типы**

В `SCHEMA` (`server/src/history.ts`) дописать:

```sql
CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_people (
  game_id    INTEGER NOT NULL REFERENCES games(id),
  person_id  INTEGER NOT NULL REFERENCES people(id),
  counter_id TEXT NOT NULL,
  PRIMARY KEY (game_id, counter_id)
);
```

Комментарий над ними — почему так:

```ts
// Человек живёт между партиями, участник — внутри одной, счётчик держит
// очки (design.md, 2026-08-26-player-identity, «Три сущности»). game_people
// связывает счётчик партии с человеком, и это ЕДИНСТВЕННОЕ место связи:
// у played_questions своей колонки с человеком нет намеренно, иначе при
// слиянии профилей перепривязывать пришлось бы две таблицы, и второй
// источник правды однажды разошёлся бы с первым.
//
// Ключ (game_id, counter_id), а не (game_id, person_id): счётчик в партии
// принадлежит ровно одному человеку, а человек ПОСЛЕ СЛИЯНИЯ профилей может
// владеть двумя счётчиками одной партии. Такой ключ переживает слияние без
// конфликта.
//
// Ни одна существующая колонка не меняется — поэтому миграции не нужно:
// CREATE TABLE IF NOT EXISTS заводит новые таблицы на уже существующей базе
// при первом же открытии. Старые партии останутся без опознанных людей и
// просто не попадут в персональную статистику.
```

Типы рядом с остальными экспортируемыми:

```ts
export interface PersonSummary {
  id: number;
  name: string;
  games: number;
}

export interface PersonThemeStat {
  themeName: string;
  // Сколько вопросов этой темы сыграли при этом человеке.
  played: number;
  buzzes: number;
  correct: number;
}

export interface PersonStats extends PersonSummary {
  played: number;
  buzzes: number;
  correct: number;
  // По убыванию нажатий. Ограничение показа накладывает разметка, не запрос.
  themes: PersonThemeStat[];
}

export interface PlayerStats {
  games: number;
  people: PersonStats[];
}
```

`ParticipantRecord` дополняется полем — оно обязательное, чтобы вызывающий код не забыл его молча:

```ts
export interface ParticipantRecord {
  counterId: string;
  name: string;
  // null — участник без опознанного человека: гость, или история была
  // выключена, когда он входил. Такие в game_people не попадают.
  personId: number | null;
}
```

- [ ] **Шаг 4: Запись состава в `startGame`**

В теле `GameHistory.startGame`, после вставки строки `games`, дописать вставку состава — теми же `INSERT`, в той же попытке:

```ts
const insertPerson = this.db.prepare(
  `INSERT OR IGNORE INTO game_people (game_id, person_id, counter_id)
         VALUES (?, ?, ?)`,
);
for (const participant of input.participants) {
  if (participant.personId === null) continue;
  insertPerson.run(gameId, participant.personId, participant.counterId);
}
```

`OR IGNORE` — на случай повторной записи того же счётчика: партия заводится один раз, но глотать вместо падения здесь дешевле, чем ронять запись партии из-за состава.

- [ ] **Шаг 5: Чтение и слияние**

Методы класса `GameHistory`, рядом с остальными. Все — в `try/catch` с безопасным значением по умолчанию, как уже принято в этом файле.

```ts
  createPerson(name: string, createdAt: string): number | null {
    try {
      const result = this.db
        .prepare(`INSERT INTO people (name, created_at) VALUES (?, ?)`)
        .run(name, createdAt);
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('История: не удалось завести игрока —', err);
      return null;
    }
  }

  listPeople(): PersonSummary[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT p.id, p.name, COUNT(DISTINCT gp.game_id) AS games
           FROM people p
           LEFT JOIN game_people gp ON gp.person_id = p.id
           GROUP BY p.id
           ORDER BY games DESC, p.name`,
        )
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        id: Number(row.id),
        name: row.name as string,
        games: Number(row.games),
      }));
    } catch (err) {
      console.error('История: не удалось прочитать список игроков —', err);
      return [];
    }
  }

  /**
   * Сливает двух людей в одного: перепривязывает состав партий и удаляет
   * лишнюю запись. Возвращает false, если слить нечего или что-то пошло не
   * так.
   *
   * Порядок обязателен: сначала перепривязка, потом удаление. Внешние ключи
   * в SQLite включены (слайс A), и удаление человека, на которого ещё
   * ссылается game_people, провалилось бы.
   */
  mergePeople(fromId: number, intoId: number): boolean {
    if (fromId === intoId) return false;
    try {
      this.db.exec('BEGIN');
      try {
        // OR REPLACE, а не просто UPDATE: если оба «человека» сидели за одним
        // столом (следствие ошибки при выборе себя в лобби), у одной партии
        // окажутся два счётчика одного человека — ключ (game_id, counter_id)
        // это допускает, а вот совпадения ключа быть не должно.
        this.db
          .prepare(
            `UPDATE OR REPLACE game_people SET person_id = ? WHERE person_id = ?`,
          )
          .run(intoId, fromId);
        this.db.prepare(`DELETE FROM people WHERE id = ?`).run(fromId);
        this.db.exec('COMMIT');
        return true;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      console.error('История: не удалось слить игроков —', err);
      return false;
    }
  }

  /**
   * Статистика по людям для раздела «Показывает в игре»
   * (design.md, 2026-08-26-player-identity).
   *
   * Только числа, никаких выводов и порогов: толкует их генератор.
   *
   * COUNT(DISTINCT q.id) везде не для красоты: после слияния профилей у
   * человека может быть два счётчика одной партии, соединение выдаст каждый
   * вопрос дважды, и обычный COUNT удвоил бы всё.
   */
  playerStats(): PlayerStats {
    const empty: PlayerStats = { games: 0, people: [] };
    try {
      const games = this.db
        .prepare(`SELECT COUNT(DISTINCT game_id) AS games FROM game_people`)
        .get() as Record<string, unknown>;

      const totals = this.db
        .prepare(
          `SELECT p.id, p.name,
                  COUNT(DISTINCT gp.game_id) AS games,
                  COUNT(DISTINCT q.id) AS played,
                  COUNT(DISTINCT CASE WHEN q.answered_by_counter_id = gp.counter_id
                                      THEN q.id END) AS buzzes,
                  COUNT(DISTINCT CASE WHEN q.answered_by_counter_id = gp.counter_id
                                       AND q.correct = 1 THEN q.id END) AS correct
           FROM game_people gp
           JOIN people p ON p.id = gp.person_id
           LEFT JOIN played_questions q
             ON q.game_id = gp.game_id AND q.round_index >= 0
           GROUP BY p.id
           ORDER BY p.name`,
        )
        .all() as Record<string, unknown>[];

      const themes = this.db
        .prepare(
          `SELECT gp.person_id, q.theme_name,
                  COUNT(DISTINCT q.id) AS played,
                  COUNT(DISTINCT CASE WHEN q.answered_by_counter_id = gp.counter_id
                                      THEN q.id END) AS buzzes,
                  COUNT(DISTINCT CASE WHEN q.answered_by_counter_id = gp.counter_id
                                       AND q.correct = 1 THEN q.id END) AS correct
           FROM game_people gp
           JOIN played_questions q
             ON q.game_id = gp.game_id AND q.round_index >= 0
           GROUP BY gp.person_id, q.theme_name
           ORDER BY buzzes DESC, q.theme_name`,
        )
        .all() as Record<string, unknown>[];

      return {
        games: Number(games.games),
        people: totals.map((row) => {
          const id = Number(row.id);
          return {
            id,
            name: row.name as string,
            games: Number(row.games),
            played: Number(row.played),
            buzzes: Number(row.buzzes),
            correct: Number(row.correct),
            themes: themes
              .filter((theme) => Number(theme.person_id) === id)
              .map((theme) => ({
                themeName: theme.theme_name as string,
                played: Number(theme.played),
                buzzes: Number(theme.buzzes),
                correct: Number(theme.correct),
              })),
          };
        }),
      };
    } catch (err) {
      console.error('История: не удалось собрать статистику игроков —', err);
      return empty;
    }
  }
```

**Интерфейсы делятся, а не сваливаются в один.** `HistoryRecorder` — то, что видит `Room`; ему нужны ровно два новых метода. Остальное — чтение и администрирование, это дело `server.ts`:

```ts
// Дописать в HistoryRecorder (его видит Room):
  createPerson(name: string, createdAt: string): number | null;
  listPeople(): PersonSummary[];

// Новый узкий интерфейс — его видит server.ts, рядом с ProfileAggregateSource.
// Отдельно от HistoryRecorder намеренно: Комнате незачем уметь сливать
// профили, а серверу — записывать ход партии.
export interface PeopleAdmin {
  listPeople(): PersonSummary[];
  mergePeople(fromId: number, intoId: number): boolean;
  playerStats(): PlayerStats;
}
```

`GameHistory` объявляется как `implements HistoryRecorder, ProfileAggregateSource, PeopleAdmin`.

**Не забыть `wrapHistoryRecorder` в `room.ts`.** Обёртка перечисляет методы поимённо и аннотирована типом ровно затем, чтобы забытый метод ронял typecheck, а не тихо исчезал в рантайме (слайс A). Два новых метода дописываются туда же, в том же стиле «поймать исключение, вернуть безопасное значение»: `createPerson` → `null`, `listPeople` → `[]`.

- [ ] **Шаг 6: Прогнать тесты**

Run: `pnpm -C server exec vitest run src/history.test.ts`
Expected: PASS. Существующие тесты файла падать не должны — если упали на `ParticipantRecord.personId`, дописать `personId: null` в их фикстуры, но **не менять смысл проверок**.

- [ ] **Шаг 7: Коммит**

```bash
git add server/src/history.ts server/src/history.test.ts
git commit -m "feat: таблицы людей, состав партии и статистика по игрокам"
```

---

### Task 2: Человек у участника и вход человеком

**Files:**

- Modify: `server/src/room.ts`, `server/src/protocol.ts`, `server/src/server.ts`
- Test: `server/src/room.test.ts`, `server/src/server.test.ts`

**Interfaces:**

- Consumes: `createPerson`, `listPeople`, `PersonSummary`, `ParticipantRecord.personId` (задача 1).
- Produces: `Participant.personId`; `Room.joinAsPerson(personId)`; `Room.getPeople()`; сообщения `{ type: 'join-as'; personId: number }` и поле `people` в сообщении `state`.

- [ ] **Шаг 1: Тесты комнаты**

В `server/src/room.test.ts`, по образцу существующих тестов входа:

```ts
it('вход человеком берёт его имя и связывает участника с ним', () => {
  // Комната с фейковым рекордером, который знает одного человека.
  const result = room.joinAsPerson(7);
  expect('participant' in result).toBe(true);
  if ('participant' in result) {
    expect(result.participant.name).toBe('Ваня');
    expect(result.participant.personId).toBe(7);
  }
});

it('не пускает второго под тем же человеком', () => {
  room.joinAsPerson(7);
  expect(room.joinAsPerson(7)).toEqual({ error: 'person-taken' });
});

it('отклоняет неизвестного человека', () => {
  expect(room.joinAsPerson(999)).toEqual({ error: 'person-unknown' });
});

it('обычный вход по имени заводит человека, когда история включена', () => {
  const result = room.join('Катя');
  expect('participant' in result && result.participant.personId).not.toBeNull();
});

it('обычный вход не заводит человека, когда история выключена', () => {
  room.setHistoryEnabled(false);
  const result = room.join('Катя');
  expect('participant' in result && result.participant.personId).toBeNull();
});

it('передаёт человека в историю при старте партии', () => {
  // Два входа, startGame, проверить аргумент фейкового startGame:
  expect(recorded.participants).toEqual([
    { counterId: expect.any(String), name: 'Ваня', personId: 7 },
    {
      counterId: expect.any(String),
      name: 'Катя',
      personId: expect.any(Number),
    },
  ]);
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/room.test.ts`
Expected: FAIL — `joinAsPerson is not a function`.

- [ ] **Шаг 3: `Participant` и вход**

В `server/src/room.ts`:

```ts
export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
  // Постоянный человек за этим участником (history.ts, people). null —
  // гость или история выключена. Третья сущность рядом с участником и
  // счётчиком, и путать их нельзя (design.md, 2026-08-26-player-identity).
  personId: number | null;
}
```

`join(name)` дополняется: после успешной проверки имени, если история включена, заводится человек и его id ложится в участника. Ошибка заведения (рекордер вернул null) не мешает войти — участник просто останется без человека, партия важнее.

Новый метод:

```ts
  joinAsPerson(personId: number): JoinResult {
    const person = this.history.listPeople().find((p) => p.id === personId);
    if (!person) return { error: 'person-unknown' };
    if (this.participants.some((p) => p.personId === personId)) {
      return { error: 'person-taken' };
    }
    // Имя берётся у человека, но правило уникальности имени в комнате не
    // отменяется: два РАЗНЫХ человека-тёзки разведутся здесь, как и при
    // ручном вводе (design.md, «Лобби»).
    return this.join(person.name, personId);
  }
```

`JoinResult` расширяется двумя ошибками: `'person-taken'`, `'person-unknown'`.

`getPeople(): PersonSummary[]` — `historyEnabled ? this.history.listPeople() : []`. Пустой список и есть заявленный откат: клиент показывает поле ввода.

- [ ] **Шаг 4: Состав в `startGame`**

В `Room.startGame`, в вызове `this.history.startGame`, дописать человека:

```ts
          participants: counters.map((p) => ({
            counterId: p.id,
            name: p.name,
            personId: p.personId,
          })),
```

- [ ] **Шаг 5: Протокол и сервер**

`server/src/protocol.ts`: клиентское сообщение `| { type: 'join-as'; personId: number }`; в сообщение `state` добавить `people: { id: number; name: string; games: number }[]`.

`server/src/server.ts`: обработчик `join-as` рядом с `join`, отвечает теми же сообщениями плюс новыми отказами; `stateMessageFor` кладёт `room.getPeople()`.

Отказы клиенту: `{ type: 'person-taken' }` и `{ type: 'person-unknown' }` — отдельные типы, а не переиспользование `name-taken`: причины разные, и сообщения человеку тоже.

- [ ] **Шаг 6: Тест проводки в `server.test.ts`**

По образцу уже существующих тестов входа: подключиться, отправить `join-as`, получить `joined`; отправить `join-as` тем же человеком со второго сокета, получить `person-taken`.

- [ ] **Шаг 7: Прогнать весь серверный набор**

Run: `pnpm -C server exec vitest run`
Expected: PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add server/src/room.ts server/src/room.test.ts server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: участник связан с постоянным человеком, вход из списка"
```

---

### Task 3: Лобби со списком знакомых

**Files:**

- Modify: `client/src/useRoomConnection.ts`, `client/src/Player.tsx`
- Test: `client/src/useRoomConnection.test.ts`, `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `people` в сообщении `state`, `join-as`, отказы `person-taken`/`person-unknown` (задача 2).
- Produces: в возвращаемом объекте `useRoomConnection` — `people`, `joinAs(personId)`, `rememberedPersonId`.

- [ ] **Шаг 1: Тесты хука**

Дописать в `client/src/useRoomConnection.test.ts` (там уже есть фейковая фабрика сокета и `localStorage.clear()` в `beforeEach`):

```ts
it('складывает список людей из состояния', async () => {
  // Прислать state с people — проверить result.current.people.
});

it('joinAs отправляет join-as и запоминает человека в localStorage', async () => {
  // joinAs(7) → отправлено { type: 'join-as', personId: 7 }
  // после joined: localStorage.getItem('svoya-igra-person') === '7'
});

it('rememberedPersonId читается из localStorage при монтировании', async () => {
  localStorage.setItem('svoya-igra-person', '7');
  expect(result.current.rememberedPersonId).toBe(7);
});

it('person-taken переводит статус в отдельное состояние, не в name-taken', async () => {
  expect(result.current.status).toBe('person-taken');
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/useRoomConnection.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Хук**

Продублировать новые типы сообщений локально (клиент не импортирует из `server/`), завести состояние `people`, разобрать `person-taken`/`person-unknown` в `status`, добавить:

```ts
const PERSON_KEY = 'svoya-igra-person';
```

`joinAs(personId)` шлёт `join-as` и, получив `joined`, кладёт id в `localStorage`. Обычный `join(name)` по успеху **чистит** этот ключ: телефон только что вошёл кем-то новым, и старая подсказка стала ложной.

`rememberedPersonId` читается один раз при монтировании; нечисловое значение игнорируется.

- [ ] **Шаг 4: Тесты лобби**

В `client/src/Player.test.tsx`: список отрисован и отсортирован так, как пришёл; тап по имени вызывает `joinAs`; «я новенький» открывает поле ввода и вызывает `join`; при пустом `people` поле ввода показано сразу, без списка; запомненный человек подсвечен.

- [ ] **Шаг 5: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/Player.test.tsx`
Expected: FAIL.

- [ ] **Шаг 6: Лобби**

Форма входа в `client/src/Player.tsx` (сейчас — `<form className="player player--join">` с одним полем) переделывается:

- `people.length === 0` → ровно то, что сейчас: поле имени и «Войти». Ничего не меняется, это откат при выключенной истории.
- иначе — список кнопок с именем и числом партий, запомненный человек подсвечен; под списком — «Меня тут нет» — переключает на поле ввода.
- `status === 'person-taken'` → «Этим игроком уже вошли с другого телефона»; `person-unknown` → «Такого игрока больше нет, выбери другого или введи имя».

Кнопка человека обязана быть пригодна для пальца — размеры брать у соседних кнопок, новых механизмов вёрстки не заводить.

- [ ] **Шаг 7: Прогнать клиентские тесты**

Run: `pnpm -C client exec vitest run`
Expected: PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add client/src/useRoomConnection.ts client/src/useRoomConnection.test.ts client/src/Player.tsx client/src/Player.test.tsx client/src/*.css
git commit -m "feat: лобби со списком знакомых вместо ввода имени"
```

---

### Task 4: Слияние профилей в админке

**Files:**

- Modify: `server/src/protocol.ts`, `server/src/server.ts`, `client/src/useAdminConnection.ts`, `client/src/Admin.tsx`
- Test: `server/src/server.test.ts`, `client/src/useAdminConnection.test.ts`, `client/src/Admin.test.tsx`

**Interfaces:**

- Consumes: интерфейс `PeopleAdmin` (задача 1); `Room.getPeople()` (задача 2).
- Produces: `{ type: 'admin-merge-people'; fromId: number; intoId: number }`, ответ `{ type: 'admin-people'; people: PersonSummary[] }`, отказ `{ type: 'admin-people-error'; reason: string }`.

**Поле `history` в опциях `createServer` расширяется** до `ProfileAggregateSource & PeopleAdmin` — сервер уже получает туда `GameHistory`, который реализует оба интерфейса; меняется только объявленный тип.

- [ ] **Шаг 1: Тест сервера**

В `server/src/server.test.ts`, в блоке с временным `playersPath`: слияние двух людей отдаёт обновлённый список; попытка слить во время идущей партии отдаёт ошибку и **ничего не меняет**; слияние человека с самим собой отдаёт ошибку.

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/server.test.ts`
Expected: FAIL.

- [ ] **Шаг 3: Сервер**

Обработчик рядом с обработчиками анкет:

```ts
if (
  message.type === 'admin-merge-people' &&
  typeof message.fromId === 'number' &&
  typeof message.intoId === 'number'
) {
  if (!history) return;
  // Пока партия идёт, человек связан с участником и счётчиком за
  // столом; перепривязка под ногами у идущей игры — класс ошибок,
  // которого проще не заводить (design.md, «Слияние профилей»).
  if (room.hasActiveGame()) {
    send(ws, {
      type: 'admin-people-error',
      reason: 'нельзя сливать игроков, пока идёт партия',
    });
    return;
  }
  const merged = history.mergePeople(message.fromId, message.intoId);
  if (!merged) {
    send(ws, {
      type: 'admin-people-error',
      reason: 'не удалось слить — выбраны один и тот же игрок?',
    });
    return;
  }
  send(ws, { type: 'admin-people', people: history.listPeople() });
}
```

`room.hasActiveGame()` — маленький геттер в `Room`, если его ещё нет: `this.game !== null && this.game.phase !== 'game-end'`.

- [ ] **Шаг 4: Клиент**

`useAdminConnection`: состояние `people` и `peopleError`, метод `mergePeople(fromId, intoId)`, обработка `admin-people` (кладёт список, гасит ошибку) и `admin-people-error` (кладёт причину). Новые типы сообщений продублировать локально — клиент не импортирует из `server/`. Список приходит и в `admin-people`, и вместе с обычным состоянием комнаты (`people` из задачи 2), так что отдельного запроса заводить не надо.

**Новые поля хука обязательно добавить в хелпер `connection(overrides)` в `Admin.test.tsx`** — иначе он перестанет соответствовать типу и клиент не соберётся.

`Admin.tsx`: в разделе «Анкеты игроков» — подраздел «Один и тот же человек»: два `<select>` из `people` («кого слить» и «в кого»), кнопка и подтверждение. Требования к подтверждению:

- операция необратима, поэтому подтверждение обязательно — как у замены анкеты;
- **в тексте подтверждения видно, какое имя останется, а какое исчезнет** — иначе ведущий узнает направление только по результату;
- кнопка заблокирована, пока не выбраны двое и пока выбран один и тот же;
- ошибка от сервера (`peopleError`) показывается тут же — в том числе «нельзя сливать игроков, пока идёт партия».

- [ ] **Шаг 5: Прогнать всё**

Run: `pnpm -C server exec vitest run` и `pnpm -C client exec vitest run`
Expected: PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts client/src/useAdminConnection.ts client/src/useAdminConnection.test.ts client/src/Admin.tsx client/src/Admin.test.tsx
git commit -m "feat: слияние расщепившихся профилей игроков"
```

---

### Task 5: Раздел «Показывает в игре»

**Files:**

- Create: `server/src/playerStats.ts`, `server/src/playerStats.test.ts`
- Modify: `server/src/playersFile.ts`, `server/src/playersFile.test.ts`, `server/src/server.ts`
- Test: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `PlayerStats` (задача 1), `findSectionRange` из `markdownSection.ts`, `oneLine` из `playerCard.ts`.
- Produces: `STATS_HEADING`, `renderPlayerStats(stats)`, `spliceStatsSection(fileText, section)` из `playerStats.ts`; `savePlayerStats(playersPath, stats)` из `playersFile.ts`.

- [ ] **Шаг 1: Тесты разметки**

Создать `server/src/playerStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderPlayerStats, spliceStatsSection } from './playerStats.js';
import type { PlayerStats } from './history.js';

const STATS: PlayerStats = {
  games: 7,
  people: [
    {
      id: 1,
      name: 'Ваня',
      games: 7,
      played: 210,
      buzzes: 63,
      correct: 48,
      themes: [
        { themeName: 'История СССР', played: 12, buzzes: 6, correct: 5 },
        { themeName: 'Спорт', played: 10, buzzes: 4, correct: 1 },
      ],
    },
  ],
};

describe('renderPlayerStats', () => {
  it('печатает шапку, итог и темы', () => {
    const text = renderPlayerStats(STATS);
    expect(text).toContain('## Показывает в игре');
    expect(text).toContain('_Выборка: 7 партий с опознанными игроками._');
    expect(text).toContain('### Ваня');
    expect(text).toContain(
      'Всего: нажимал 63 из 210 сыгранных при нём вопросов, верно 48.',
    );
    expect(text).toContain(
      '- **История СССР** — нажимал 6 из 12 вопросов темы, верно 5',
    );
  });

  it('на пустой базе печатает заголовок и «пока пусто»', () => {
    const text = renderPlayerStats({ games: 0, people: [] });
    expect(text).toContain('## Показывает в игре');
    expect(text).toContain('Пока пусто');
    expect(text).not.toContain('###');
  });

  it('печатает не больше десяти тем на человека', () => {
    const themes = Array.from({ length: 15 }, (_, i) => ({
      themeName: `Тема ${i}`,
      played: 10,
      buzzes: 15 - i,
      correct: 1,
    }));
    const text = renderPlayerStats({
      games: 1,
      people: [{ ...STATS.people[0], themes }],
    });
    expect(text.split('\n').filter((l) => l.startsWith('- **'))).toHaveLength(
      10,
    );
  });

  // Тот же класс дефекта, что чинили в слайсах B и D1: чужой текст, попавший
  // в markdown без обработки, становится границей раздела и рвёт разбор.
  // Имя человека приходит из лобби, название темы — из пакета.
  it('не даёт имени или названию темы создать новую строку', () => {
    const text = renderPlayerStats({
      games: 1,
      people: [
        {
          ...STATS.people[0],
          name: 'Ваня\n## Катя',
          themes: [
            { themeName: 'Спорт\n---\nещё', played: 1, buzzes: 1, correct: 1 },
          ],
        },
      ],
    });
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Показывает в игре');
      expect(line.startsWith('---')).toBe(false);
    }
  });
});

describe('spliceStatsSection', () => {
  const FILE = [
    '# Анкеты игроков',
    '',
    'Вводный текст.',
    '',
    '---',
    '',
    '## Ваня',
    '',
    '- **Спорт:** Формула-1',
    '',
  ].join('\n');

  it('дописывает раздел в конец, не трогая анкеты', () => {
    const updated = spliceStatsSection(FILE, '## Показывает в игре\n\nтело');
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).toContain('## Показывает в игре');
    expect(updated.trimEnd().endsWith('тело')).toBe(true);
  });

  it('идемпотентна', () => {
    const once = spliceStatsSection(FILE, '## Показывает в игре\n\nтело');
    expect(spliceStatsSection(once, '## Показывает в игре\n\nтело')).toBe(once);
  });

  it('заменяет старый раздел, а не дописывает второй', () => {
    const once = spliceStatsSection(FILE, '## Показывает в игре\n\nстарое');
    const twice = spliceStatsSection(once, '## Показывает в игре\n\nновое');
    expect(twice).toContain('новое');
    expect(twice).not.toContain('старое');
    expect(twice.split('## Показывает в игре')).toHaveLength(2);
  });
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/playerStats.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Шаг 3: Реализовать `playerStats.ts`**

Чистые функции, без ввода-вывода и без часов. `oneLine` берётся из `playerCard.ts`, границы раздела — из `markdownSection.ts`; третьей копии ни того, ни другого не заводить.

Формат — ровно тот, что в тестах выше. Ограничение показа — константа `MAX_THEMES = 10` с комментарием, что это ограничение показа, а не порог вывода: порог живёт в правилах генератора.

Вставка: если раздел есть — заменить (`findSectionRange` по `STATS_HEADING`), если нет — дописать в конец файла. Раздел статистики **последний в файле**, в отличие от `pack-generator-profile.md`, где последними обязаны быть жалобы: сюда никто ничего не дописывает построчно.

- [ ] **Шаг 4: Запись и пересчёт**

`playersFile.ts`: `savePlayerStats(playersPath, stats)` — читает файл, вставляет раздел, пишет атомарно (temp + rename), **не пишет на диск, если ничего не изменилось**. Тот же приём, что у `savePlayerCard`.

`server.ts`: пересчёт вызывается там же, где уже стоит пересчёт «Автособранного» — на переходе партии в `game-end`. Обе записи в `docs/players.md` идут под `withPlayersWriteLock`.

- [ ] **Шаг 5: Тесты записи и проводки**

`playersFile.test.ts`: раздел появляется, анкеты не тронуты, повторная запись того же не трогает диск.
`server.test.ts`: партия дошла до `game-end` — в файле появился раздел с игроком.

- [ ] **Шаг 6: Прогнать весь серверный набор**

Run: `pnpm -C server exec vitest run`
Expected: PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add server/src/playerStats.ts server/src/playerStats.test.ts server/src/playersFile.ts server/src/playersFile.test.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: раздел «Показывает в игре» в docs/players.md"
```

---

### Task 6: Правила генератора и документация

**Files:**

- Modify: `.claude/skills/pack-generator/SKILL.md`, `docs/players.md`, `docs/ideas.md`

- [ ] **Шаг 1: Шаг 0 в `SKILL.md`**

Раздел «Показывает в игре» читается наравне с анкетами. Анкета — что человек **говорит**, этот раздел — что он **показывает**; расхождение между ними само по себе полезно.

- [ ] **Шаг 2: Шаг 1 в `SKILL.md` — как этим пользоваться**

Дословно из спеки, раздел «Правила генератора»:

- **меньше пяти нажатий по теме — любопытный факт, а не вывод.** Число живёт здесь, в тексте, а не в коде: его видно и его можно поправить, не трогая сервер;
- **названия тем обобщать в области самостоятельно** — они принадлежат пакетам, а не миру, и почти не повторяются между паками; три темы про кино у одного человека — сигнал про кино, даже если ни одно название не совпало;
- расхождение анкеты и поведения толковать в пользу поведения по **сложности**, в пользу анкеты по **выбору тем**.

- [ ] **Шаг 3: `docs/players.md`**

Во вводный текст — что в файле теперь две части: анкеты (пишет ведущий) и «Показывает в игре» (пересчитывает сервер, правки руками не сохранятся).

- [ ] **Шаг 4: `docs/ideas.md`**

D2 → `сделано` со ссылкой на спеку. Раздел «Опознание игрока между играми» пометить как закрытый, оставив причины на месте — они объясняют, почему сделано именно так.

- [ ] **Шаг 5: Полная проверка и коммит**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Прогнать и **посмотреть вывод**, а не предположить результат.

```bash
git add docs .claude/skills/pack-generator/SKILL.md
git commit -m "docs: генератор читает, что игроки показывают за столом"
```

---

## После плана

**Живая проверка обязательна** (Шаг 7 в `svoya-igra-dev`), и в этой ветке она важнее обычного: **лобби — первый экран, который видит каждый за столом.** Всё, что делалось в слайсах B и D1, лежало в стороне от горячего пути; здесь трогается вход в игру, и ломается это заметнее всего — прямо при гостях.

Что смотреть — в спеке, раздел «Живая проверка». Отдельно: сверить пару строк статистики с тем, что реально было за столом. Числа, которым нельзя верить, хуже отсутствующих.
