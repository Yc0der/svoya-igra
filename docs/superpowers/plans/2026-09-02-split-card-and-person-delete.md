# Разделение удаления анкеты и удаления человека

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** кнопка у анкеты убирает только анкету, а человека из истории партий убирает отдельный
список «Люди в истории» в `/admin`.

**Architecture:** серверный обработчик удаления уже состоит из двух независимых половин —
`deletePlayerCard` пишет файл, `history.forgetPerson` чистит базу. Слайс их не расщепляет, а
разводит по двум сообщениям протокола (`admin-delete-player-card` и `admin-forget-person`) и по
двум местам в интерфейсе. Новый список садится на уже приходящие в админку данные `admin-people`
(id, имя, число партий) — те же, на которых работает слияние профилей.

**Tech Stack:** TypeScript, Node + ws (сервер), React 19 + Vite (клиент), Vitest.

Спеки: [анкеты](../specs/2026-08-26-player-questionnaire-design.md), раздел «Удаление анкеты —
это удаление анкеты»; [идентичность](../specs/2026-08-26-player-identity-design.md), раздел
«Список людей истории».

## Global Constraints

- Ветка `feature/player-identity`, коммиты — Conventional Commits, по-русски после префикса.
- Движок (`engine.ts`) и комната (`room.ts`) в этом слайсе не трогаются вовсе.
- Любая запись в `docs/players.md` идёт через `withPlayersWriteLock` и атомарно (temp + rename) —
  это уже обеспечено функциями `playersFile.ts`, новых путей записи слайс не заводит.
- Новых зависимостей нет.
- Тексты интерфейса — по-русски, тем же тоном, что уже в админке: называть, что исчезнет, а не
  спрашивать «вы уверены?».
- Удаление анкеты разрешено во время партии (трогает файл), удаление человека — запрещено
  (человек за столом связан с участником и счётчиком).
- Проверки после каждой задачи: `pnpm --filter server test`, `pnpm --filter client test`; перед
  PR — полный `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Task 1: удаление анкеты перестаёт трогать историю

**Files:**

- Modify: `server/src/protocol.ts:274-277` (переименование сообщения)
- Modify: `server/src/server.ts:796-801` (разбор сообщения), `server/src/server.ts:1085-1125`
  (обработчик)
- Modify: `server/src/server.test.ts:3594-3615`, `:4084-4110`, `:4137-4160`
- Modify: `server/src/playersFile.test.ts` (новый тест рядом с существующими про
  `deletePlayerCard`, ~строка 123)
- Modify: `client/src/useAdminConnection.ts` (локальная копия `ClientMessage`, поле интерфейса
  `deletePlayer`, отправка на `:518`)
- Modify: `client/src/Admin.tsx:105` (деструктуризация), `:748` (вызов)
- Modify: `client/src/Admin.test.tsx:98` (значение по умолчанию), тесты на `:1571-1625`

**Interfaces:**

- Produces: `ClientMessage` вариант `{ type: 'admin-delete-player-card'; name: string }`; метод
  хука `deletePlayerCard(name: string): void`. Задачи 2–4 опираются на эти имена.

- [ ] **Step 1: Переписать серверный тест «удаление уносит и человека» под новое поведение**

В `server/src/server.test.ts`, в `describe('createServer admin delete player')`, заменить тест
`'удаление убирает и человека из истории, и его блок «Показывает в игре»'` целиком на:

```ts
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
```

В том же `describe` заменить тест `'во время идущей партии отказывает и ничего не трогает'` на:

```ts
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
```

И в тесте `'admin-delete-player убирает анкету и отдаёт обновлённый список'`
(`server.test.ts:3594`) поменять имя теста на `'admin-delete-player-card убирает анкету и отдаёт
обновлённый список'` и тип сообщения внутри на `'admin-delete-player-card'`.

- [ ] **Step 2: Прогнать тесты и убедиться, что они падают**

Run: `pnpm --filter server test -- -t "удаление анкеты не трогает человека"`
Expected: FAIL — сервер не знает сообщения `admin-delete-player-card` и не отвечает; тест падает
на ожидании сообщения (таймаут vitest).

- [ ] **Step 3: Переименовать сообщение в протоколе**

`server/src/protocol.ts`, заменить вариант `admin-delete-player` вместе с комментарием на:

```ts
  // Удаление анкеты — и только анкеты. Человек в истории партий, его участие в
  // играх и его блок в «Показывает в игре» остаются: их убирает
  // admin-forget-person (спека анкет, «Удаление анкеты — это удаление анкеты»).
  // Во время партии разрешено: трогается файл, а не состояние игры.
  | { type: 'admin-delete-player-card'; name: string }
```

- [ ] **Step 4: Урезать обработчик до одной ответственности**

`server/src/server.ts`, разбор сообщения (было `:796-801`):

```ts
if (
  message.type === 'admin-delete-player-card' &&
  typeof message.name === 'string'
) {
  await handleDeletePlayerCard(message.name);
}
```

Обработчик `handleDeletePlayer` (`:1085-1125`) заменить целиком на:

```ts
async function handleDeletePlayerCard(name: string): Promise<void> {
  if (!playersPath) return;
  // Проверки «идёт ли партия» здесь нет намеренно: удаление анкеты, как и её
  // правка, трогает файл, а не состояние игры. С партией связан человек в
  // истории — его убирает admin-forget-person, и вот там запрет на месте.
  try {
    await withPlayersWriteLock(() => deletePlayerCard(playersPath, name));
    send(ws, {
      type: 'admin-players',
      players: await playersView(playersPath),
    });
  } catch (err) {
    send(ws, {
      type: 'admin-player-error',
      reason:
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'файл анкет не найден'
          : 'не удалось удалить анкету',
    });
  }
}
```

- [ ] **Step 5: Прогнать серверные тесты**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 6: Добавить файловый тест-сторож на раздел «Показывает в игре»**

`server/src/playersFile.test.ts`, после теста `'повторное удаление не трогает диск и возвращает
false'`:

```ts
it('удаление анкеты не трогает раздел «Показывает в игре»', async () => {
  await savePlayerCard(playersPath, CARD, '2026-08-26');
  await savePlayerStats(playersPath, STATS);

  expect(await deletePlayerCard(playersPath, 'Ваня')).toBe(true);

  const content = await readFile(playersPath, 'utf8');
  // Заголовки различаются уровнем: анкета — «## Ваня», блок статистики —
  // «### Ваня». Проверять подстрокой нельзя: «### Ваня» содержит «## Ваня».
  expect(content).not.toMatch(/^## Ваня$/m);
  expect(content).toMatch(/^### Ваня$/m);
});
```

Этот тест — сторож, а не красный шаг: `removePlayerSection` отбирает строки по
`startsWith('## ')` и блок статистики не задевает уже сейчас. Он стоит здесь потому, что спека
называет это поведение обязательным, а сломать его может любая будущая правка разбора файла.

- [ ] **Step 7: Прогнать тест-сторож**

Run: `pnpm --filter server test -- -t "не трогает раздел"`
Expected: PASS сразу.

- [ ] **Step 8: Переименовать метод на клиенте**

`client/src/useAdminConnection.ts`:

- в локальной копии `ClientMessage` заменить `| { type: 'admin-delete-player'; name: string }` на
  `| { type: 'admin-delete-player-card'; name: string }`;
- в интерфейсе хука заменить объявление `deletePlayer(name: string): void;` на:

```ts
  // Убирает только анкету. Человека из истории партий убирает forgetPerson
  // (задача 3 слайса) — это разные действия и разные кнопки.
  deletePlayerCard(name: string): void;
```

- в возвращаемом объекте (`:518`) заменить строку на:

```ts
    deletePlayerCard: (name) =>
      send({ type: 'admin-delete-player-card', name }),
```

`client/src/Admin.tsx`: в деструктуризации (`:105`) `deletePlayer` → `deletePlayerCard`, в вызове
(`:748`) `deletePlayer(deletingName)` → `deletePlayerCard(deletingName)`.

`client/src/Admin.test.tsx`: в `connection()` (`:98`) `deletePlayer: vi.fn(),` →
`deletePlayerCard: vi.fn(),`; в трёх тестах на `:1571-1625` переименовать локальную переменную
`deletePlayer` и передаваемое поле в `deletePlayerCard` (сами утверждения не трогать — тексты
диалога переписываются в задаче 4).

- [ ] **Step 9: Прогнать клиентские тесты и типы**

Run: `pnpm --filter client test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts server/src/playersFile.test.ts client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Admin.test.tsx && git commit -m "feat: удаление анкеты больше не трогает историю партий"
```

---

### Task 2: сервер умеет забыть человека из истории

**Files:**

- Modify: `server/src/protocol.ts` (новый вариант `ClientMessage` рядом с `admin-merge-people`)
- Modify: `server/src/server.ts` (новый блок сразу после обработчика `admin-merge-people`,
  ~`:871`)
- Modify: `server/src/server.test.ts` (новые тесты в `describe('createServer admin delete
player')`)

**Interfaces:**

- Consumes: `history.forgetPerson(id: number): boolean` (`server/src/history.ts:938`),
  `refreshPlayerStats()` (`server/src/server.ts:288`), `broadcastState()`
  (`server/src/server.ts:169`).
- Produces: `ClientMessage` вариант `{ type: 'admin-forget-person'; id: number }`. Ответы —
  существующие `admin-people` и `admin-people-error`, новых типов ответов слайс не заводит.

- [ ] **Step 1: Написать падающие тесты**

`server/src/server.test.ts`, в конец `describe('createServer admin delete player')`:

```ts
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
```

Порядок сообщений здесь тот же, что в тестах слияния выше: `broadcastState()` отложен в
микротаску (`server.ts:187`), а прямой ответ уходит синхронно — поэтому `nextMessage()` отдаёт
`admin-people`, а рассылка состояния приходит следом и тестом не читается.

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `pnpm --filter server test -- -t "admin-forget-person"`
Expected: FAIL — сервер сообщение игнорирует, все три теста висят на ожидании ответа до таймаута.

- [ ] **Step 3: Добавить сообщение в протокол**

`server/src/protocol.ts`, следом за вариантом `admin-merge-people`:

```ts
  // Удаление человека из истории партий по id из списка «Люди в истории»
  // (спека идентичности, «Список людей истории»). По id, а не по имени:
  // человек, назвавшийся в партиях иначе, чем в анкете, по имени не находился
  // вовсе. Анкету не трогает; сервер сам проверяет, что партия не идёт, — тем
  // же правилом, что и слияние.
  | { type: 'admin-forget-person'; id: number }
```

- [ ] **Step 4: Добавить обработчик**

`server/src/server.ts`, сразу после закрывающей скобки блока `admin-merge-people` (за строкой
`send(ws, { type: 'admin-people', people: history.listPeople() });` и её `}`):

```ts
if (message.type === 'admin-forget-person' && typeof message.id === 'number') {
  if (!history) return;
  // Дословно та же причина, что у слияния: человек за столом связан с
  // участником и счётчиком, и трогать эту связь под ногами у идущей партии —
  // класс ошибок, которого проще не заводить.
  if (room.hasActiveGame()) {
    send(ws, {
      type: 'admin-people-error',
      reason: 'нельзя удалять человека, пока идёт партия',
    });
    return;
  }
  if (!history.forgetPerson(message.id)) {
    // forgetPerson возвращает false и когда человека уже нет (его убрали с
    // другого устройства, пока ведущий смотрел на список), и при сбое базы.
    // Для ведущего ответ один и тот же: список у него устарел.
    send(ws, {
      type: 'admin-people-error',
      reason: 'такого игрока уже нет — обнови список',
    });
    return;
  }
  // Пересчёт «Показывает в игре» сразу, а не после следующей партии, — иначе
  // имя удалённого осталось бы в файле. В отличие от слияния его здесь ждём:
  // ведущий открывает файл сразу после удаления, и порядок «ответ ушёл, файл
  // ещё старый» видно глазами.
  await refreshPlayerStats();
  // Список людей едет и в обычном состоянии комнаты: лобби на телефонах
  // показывает его для входа «я — вот этот из списка» (та же причина, по
  // которой broadcastState стоит в слиянии).
  broadcastState();
  send(ws, { type: 'admin-people', people: history.listPeople() });
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts && git commit -m "feat: сервер умеет забыть человека из истории по id"
```

---

### Task 3: список «Люди в истории» в `/admin`

**Files:**

- Modify: `client/src/useAdminConnection.ts` (локальный `ClientMessage`, интерфейс,
  возвращаемый объект)
- Modify: `client/src/Admin.tsx` (состояние диалога рядом с `:135`, новый раздел перед
  `<h3>Один и тот же человек</h3>` на `:758`)
- Modify: `client/src/Admin.test.tsx` (значение по умолчанию в `connection()`, новые тесты рядом
  с константой `PEOPLE` на `:1409`)

**Interfaces:**

- Consumes: `admin-forget-person` (задача 2); `people: { id: number; name: string; games: number }[]`,
  `peopleError`, `clearPeopleError` — уже есть в хуке (`useAdminConnection.ts:259-268`).
- Produces: метод хука `forgetPerson(id: number): void`; кнопки с `aria-label` вида
  `Удалить человека: ${name}` — по ним задача 4 и живая проверка находят элементы.

- [ ] **Step 1: Написать падающие тесты**

`client/src/Admin.test.tsx`, в тот же `describe`, где лежат тесты слияния (используют константу
`PEOPLE` — `[{ id: 1, name: 'Ваня', games: 5 }, { id: 2, name: 'Ваня (2)', games: 1 }]`):

```tsx
it('список людей истории показывает имя и число партий', () => {
  mockedUseAdminConnection.mockReturnValue(connection({ people: PEOPLE }));
  render(<Admin />);
  expect(screen.getByText(/люди в истории/i)).toBeInTheDocument();
  expect(screen.getByText(/5 партий/)).toBeInTheDocument();
});

it('диалог удаления человека называет партии и удаляет только по подтверждению', async () => {
  const forgetPerson = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({ people: PEOPLE, forgetPerson }),
  );
  render(<Admin />);

  await userEvent.click(
    screen.getByRole('button', { name: 'Удалить человека: Ваня' }),
  );
  expect(screen.getByText(/анкета останется/i)).toBeInTheDocument();
  expect(forgetPerson).not.toHaveBeenCalled();

  await userEvent.click(
    screen.getByRole('button', { name: /удалить навсегда/i }),
  );
  expect(forgetPerson).toHaveBeenCalledWith(1);
});

it('«Не удалять» в диалоге человека ничего не удаляет', async () => {
  const forgetPerson = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({ people: PEOPLE, forgetPerson }),
  );
  render(<Admin />);

  await userEvent.click(
    screen.getByRole('button', { name: 'Удалить человека: Ваня' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /не удалять/i }));
  expect(forgetPerson).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: /удалить навсегда/i }),
  ).not.toBeInTheDocument();
});

it('без людей в истории раздел говорит об этом', () => {
  mockedUseAdminConnection.mockReturnValue(connection({ people: [] }));
  render(<Admin />);
  expect(screen.getByText(/в истории пока никого/i)).toBeInTheDocument();
});
```

Точное имя кнопки (`{ name: 'Удалить человека: Ваня' }`, строкой, а не регуляркой) здесь важно:
в `PEOPLE` есть второй человек «Ваня (2)», и регулярка `/удалить человека: ваня/i` нашла бы обе
кнопки.

В `connection()` (`:98`, рядом с `mergePeople`) добавить `forgetPerson: vi.fn(),`.

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `pnpm --filter client test -- -t "истории"`
Expected: FAIL — раздела нет, `getByText(/люди в истории/i)` и кнопки не находятся.

- [ ] **Step 3: Добавить метод в хук**

`client/src/useAdminConnection.ts`:

- в локальный `ClientMessage` рядом с `admin-merge-people`:

```ts
  | { type: 'admin-forget-person'; id: number }
```

- в интерфейс хука, рядом с `mergePeople`:

```ts
  // Забывает человека и его участие в партиях. Анкету не трогает — её убирает
  // deletePlayerCard.
  forgetPerson(id: number): void;
```

- в возвращаемый объект, рядом с `mergePeople`:

```ts
    forgetPerson: (id) => send({ type: 'admin-forget-person', id }),
```

- [ ] **Step 4: Добавить раздел в админку**

`client/src/Admin.tsx`. В деструктуризацию хука (рядом с `mergePeople`) добавить `forgetPerson`.
Рядом с `deletingName` (`:135`) завести состояние диалога:

```tsx
const [forgettingId, setForgettingId] = useState<number | null>(null);
```

Перед `<h3>Один и тот же человек</h3>` (`:758`) вставить:

```tsx
<h3>Люди в истории</h3>
<p className="admin-hint">
  Это записи истории партий, а не анкеты и не стол. Удаление убирает человека и
  его участие в партиях; анкета, если она есть, остаётся — её убирают выше. Пока
  идёт партия, удаление недоступно.
</p>
{people.length === 0 ? (
  <p className="admin-hint">В истории пока никого.</p>
) : (
  <ul className="admin-players">
    {people.map((person) => (
      <li key={person.id}>
        <span className="admin-player-name">{person.name}</span>
        <span className="admin-player-date">
          {person.games} {gamesWord(person.games)}
        </span>
        <span className="admin-actions">
          <button
            type="button"
            className="button"
            aria-label={`Удалить человека: ${person.name}`}
            onClick={() => {
              clearPeopleError();
              setForgettingId(person.id);
            }}
          >
            Удалить
          </button>
        </span>
      </li>
    ))}
  </ul>
)}
{forgettingId !== null && (
  <div className="admin-player-conflict">
    <p>
      Удалить «{people.find((person) => person.id === forgettingId)?.name ?? ''}
      » из истории? Исчезнет он сам и его участие в партиях (
      {people.find((person) => person.id === forgettingId)?.games ?? 0}{' '}
      {gamesWord(
        people.find((person) => person.id === forgettingId)?.games ?? 0,
      )}
      ). Анкета останется — её убирают кнопкой «Удалить» у самой анкеты выше.
      Сыгранные вопросы и статистика паков останутся: они обезличены.
    </p>
    <div className="admin-actions">
      <button
        type="button"
        className="button"
        onClick={() => setForgettingId(null)}
      >
        Не удалять
      </button>
      <button
        type="button"
        className="button button--danger"
        onClick={() => {
          forgetPerson(forgettingId);
          setForgettingId(null);
        }}
      >
        Удалить навсегда
      </button>
    </div>
  </div>
)}
```

`gamesWord` уже объявлена в этом файле (`:32`) — новой копии не заводить. Классы
`admin-players`, `admin-player-name`, `admin-player-date`, `admin-actions`,
`admin-player-conflict` тоже существующие, новых стилей слайс не требует.

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Admin.test.tsx && git commit -m "feat: список людей истории в /admin с удалением человека"
```

---

### Task 4: диалог удаления анкеты говорит правду

**Files:**

- Modify: `client/src/Admin.tsx:719-755` (диалог)
- Modify: `client/src/Admin.test.tsx` (три теста диалога на `:1571-1625`; записи `players` с полем
  `games` на `:1337`, `:1511`, `:1526`, `:1561`, `:1576`, `:1597`, `:1613`)
- Modify: `client/src/useAdminConnection.ts` (локальный тип `admin-players` на `:93-95`, поле
  интерфейса `players` на `:240`)
- Modify: `server/src/protocol.ts:403-410` (тип `admin-players`)
- Modify: `server/src/server.ts:309-320` (удаление `playersView`), вызовы на `:770`, `:1044`,
  `:1111`
- Modify: `server/src/server.test.ts` (удаляется тест `'число партий в списке считается по имени,
с поправкой на регистр'` на `:4113`; из ожиданий `players: [...]` уходит `games`)

**Interfaces:**

- Produces: `admin-players` с элементами `{ name: string; date: string }` — без `games`.

- [ ] **Step 1: Переписать клиентские тесты диалога**

`client/src/Admin.test.tsx`, заменить три теста на `:1571-1625` на два:

```tsx
it('диалог удаления анкеты обещает только анкету и удаляет по подтверждению', async () => {
  const deletePlayerCard = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({
      players: [{ name: 'Ваня', date: '2026-08-26' }],
      deletePlayerCard,
    }),
  );
  render(<Admin />);
  await userEvent.click(
    screen.getByRole('button', { name: /удалить анкету/i }),
  );

  expect(screen.getByText(/записи о партиях останутся/i)).toBeInTheDocument();
  expect(deletePlayerCard).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Убрать анкету' }));
  expect(deletePlayerCard).toHaveBeenCalledWith('Ваня');
});

it('«Не убирать» в диалоге анкеты ничего не удаляет', async () => {
  const deletePlayerCard = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({
      players: [{ name: 'Ваня', date: '2026-08-26' }],
      deletePlayerCard,
    }),
  );
  render(<Admin />);
  await userEvent.click(
    screen.getByRole('button', { name: /удалить анкету/i }),
  );
  await userEvent.click(screen.getByRole('button', { name: /не убирать/i }));
  expect(deletePlayerCard).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Убрать анкету' }),
  ).not.toBeInTheDocument();
});
```

Утверждения на текст диалога намеренно не ищут слова «Люди в истории»: этой же строкой называется
заголовок соседнего раздела из задачи 3, и `getByText` упал бы на двух совпадениях.

Из остальных записей `players` в файле (`:1337`, `:1511`, `:1526`, `:1561`, `:1597`, `:1613`)
убрать поле `games`.

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `pnpm --filter client test -- -t "диалог удаления анкеты"`
Expected: FAIL — в диалоге пока текст про число партий и кнопка «Удалить навсегда».

- [ ] **Step 3: Переписать диалог**

`client/src/Admin.tsx`, блок `{deletingName !== null && (...)}` (`:719-755`) заменить на:

```tsx
{
  deletingName !== null && (
    <div className="admin-player-conflict">
      <p>
        Убрать анкету «{deletingName}»? Записи о партиях останутся — сам человек
        и его игры убираются ниже, в разделе «Люди в истории». Сыгранные вопросы
        и статистика паков тоже останутся: они обезличены.
      </p>
      <div className="admin-actions">
        <button
          type="button"
          className="button"
          onClick={() => setDeletingName(null)}
        >
          Не убирать
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            deletePlayerCard(deletingName);
            setDeletingName(null);
          }}
        >
          Убрать анкету
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Прогнать клиентские тесты**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 5: Убрать `games` из `admin-players` на сервере**

`server/src/protocol.ts`, вариант `admin-players` вместе с комментарием:

```ts
  // Отдаётся и на admin-get-players, и как подтверждение успешной записи —
  // список всегда актуальный, клиенту не нужно догадываться, что изменилось.
  // Числа партий здесь нет: удаление анкеты их не трогает, а честный счётчик
  // живёт в admin-people, где человека находят по id, а не по совпадению имени.
  | {
      type: 'admin-players';
      players: { name: string; date: string }[];
    }
```

`server/src/server.ts`: удалить функцию `playersView` (`:309-320`) целиком и заменить три её
вызова (`:770`, `:1044`, `:1111`) на `await readPlayerList(playersPath)`. Импорт `readPlayerList`
уже есть (`:33`); `sameName` остаётся нужен другим местам (`:1014`, `:1018`) — импорт не трогать.

- [ ] **Step 6: Поправить серверные тесты**

`server/src/server.test.ts`: удалить тест `'число партий в списке считается по имени, с поправкой
на регистр'` (`:4113`) — считать больше нечего. Во всех оставшихся ожиданиях вида
`players: [{ name: ..., date: ..., games: ... }]` убрать поле `games`. Найти их:

```bash
grep -n "games:" server/src/server.test.ts
```

- [ ] **Step 7: Убрать `games` из клиентской копии типа**

`client/src/useAdminConnection.ts`: в локальной копии `ServerMessage` (`:93-95`) и в поле
интерфейса `players` (`:240`) убрать `games: number` из формы элемента; там же снять из
комментария упоминание диалога удаления, если оно осталось.

- [ ] **Step 8: Прогнать всё**

Run: `pnpm --filter server test && pnpm --filter client test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Admin.test.tsx && git commit -m "feat: диалог удаления анкеты обещает только анкету"
```

---

### Task 5: правила генератора и подсказки в файлах

**Files:**

- Modify: `.claude/skills/pack-generator/SKILL.md:187-188` (правило «Анкета необязательна»)
- Modify: `docs/players.example.md:14` (устаревшая строка про отсутствие кнопки удаления)

**Interfaces:**

- Consumes: спека анкет, раздел «Правила генератора», абзац «Но „нет анкеты“ и „нет ничего“ —
  разные случаи».

- [ ] **Step 1: Дописать правило генератора**

`.claude/skills/pack-generator/SKILL.md`, заменить абзац `**Анкета необязательна.** ...` на:

```markdown
**Анкета необязательна.** Пришедший без анкеты не получает личной темы, и пак от этого не
ломается — гость на один вечер играет наравне со всеми.

**Но «нет анкеты» и «нет ничего» — разные случаи.** У человека, который уже играл, есть блок в
«Показывает в игре». Анкету могли убрать намеренно — именно затем, чтобы генератор судил по
партиям, а не по тому, что человек когда-то о себе написал (в `/admin` это отдельная кнопка от
удаления человека). Значит, личная тема для него выводится — из поведения за столом, по правилам
подраздела «Как использовать „Показывает в игре“» ниже, и в жадный подбор охвата он входит
наравне с остальными. Без личной темы остаётся только тот, о ком не известно ничего: ни анкеты,
ни сыгранных партий.
```

- [ ] **Step 2: Поправить устаревшую строку в примере анкет**

`docs/players.example.md:14` — фраза «в `/admin` кнопки удаления пока нет» протухла ещё в прошлой
ветке. Заменить хвост предложения на:

```markdown
убрать анкету человека можно в `/admin` кнопкой «Удалить» у его анкеты; самого человека вместе с
его партиями убирают там же, ниже, в разделе «Люди в истории».
```

Свой `docs/players.md` (в git его нет) поправить тем же текстом руками, если он на машине есть:
сервер копирует пример только при первом запуске и существующий файл не обновляет.

- [ ] **Step 3: Прогнать тесты**

Run: `pnpm test`
Expected: PASS (правки текстовые, но `pnpm test` гоняет и тесты скриптов из `.claude/scripts`).

- [ ] **Step 4: Коммит**

```bash
git add .claude/skills/pack-generator/SKILL.md docs/players.example.md && git commit -m "docs: генератор учитывает человека без анкеты, но с историей"
```

---

### Task 6: проверка перед PR

**Files:** без правок, кроме тех, что потребуются по итогам проверок.

- [ ] **Step 1: Полный прогон**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: PASS. Упало — чинить причину; три безуспешных попытки подряд — остановиться и
рассказать, что происходит, а не крутить цикл дальше.

- [ ] **Step 2: Сверка с обеими спеками**

Пройти по разделам спек и убедиться, что каждое утверждение подтверждено тестом:

- удаление анкеты не трогает историю → `server.test.ts`, «удаление анкеты не трогает человека в
  истории»;
- блок «Показывает в игре» переживает удаление анкеты → `playersFile.test.ts`, «удаление анкеты
  не трогает раздел „Показывает в игре“»;
- удаление анкеты разрешено во время партии → `server.test.ts`, «во время идущей партии удаление
  анкеты разрешено»;
- удаление человека по id, анкета остаётся → `server.test.ts`, «admin-forget-person убирает
  человека и его блок, но не анкету»;
- удаление человека запрещено во время партии → `server.test.ts`, «admin-forget-person во время
  партии отказывает»;
- оба диалога называют, что исчезнет, и не удаляют до подтверждения → четыре теста в
  `Admin.test.tsx`.

- [ ] **Step 3: Живая проверка (Шаг 7 цикла, руками)**

Поднять сервер, открыть `/admin`:

1. Удалить анкету человека, у которого есть партии. Убедиться в `docs/players.md`, что раздел
   `## Имя` исчез, а блок `### Имя` в «Показывает в игре» остался.
2. Тем же человеком — сгенерировать пак и посмотреть, вывел ли генератор ему личную тему из
   поведения. Это и есть проверка задачи 5; тестами она не ловится.
3. Удалить человека в разделе «Люди в истории»: его блок в «Показывает в игре» должен пропасть
   сразу, а анкета (если её завели заново) — остаться.
4. Начать партию и убедиться, что удаление человека отказывает с внятным текстом, а удаление
   анкеты работает.

- [ ] **Step 4: PR**

```bash
git push -u origin feature/player-identity
```

Заголовок PR: `feat: удаление анкеты и удаление человека — разные кнопки`. В теле — ссылки на оба
раздела спек и строка о том, что путь «убрать человека совсем» стал двухшаговым осознанно.
