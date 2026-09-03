# Удаление пакета и пропуск вопроса из админки — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ ПОД-СКИЛЛ — выполнять задача за задачей через
> `superpowers:subagent-driven-development` (рекомендуется) или
> `superpowers:executing-plans`. Шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** дать админ-панели пропускать активный вопрос без назначенного ведущего и удалять
пакет вместе с его картинками.

**Архитектура:** две независимые правки вокруг существующих механик. Пропуск вопроса — это
уже написанный `cancel-question`, у которого `requesterId` становится `string | null`, где
`null` означает «пришло с админ-панели»; нового правила в движке не появляется. Удаление
пакета движка вообще не касается: новая функция `deletePack` в `packs.ts`, обработчик под
существующим `withPackWriteLock` и кнопка в списке паков.

**Стек:** TypeScript, Node + ws (server), React 19 + Vite (client), Vitest.

**Спека:** `docs/superpowers/specs/2026-09-03-pack-delete-and-skip-question-design.md`

## Глобальные ограничения

- Русский язык в подписях интерфейса и в сообщениях об ошибках; комментарии в коде — тоже
  русские, как во всём проекте. Названия тестов — как у соседей в том же файле.
- Движок не знает про сеть, диск и часы (инвариант 1 из `svoya-igra-dev`). В этом плане он
  трогается один раз и только в проверке отправителя.
- `requesterId` подставляет сервер, а не клиент: значение никогда не берётся из входящего
  сообщения (`room.ts`, тот же принцип, что у `adjustScore` и `finalVote`).
- Все админские операции с файлами пакетов проходят проверку `basename(filename) !== filename`
  и идут под `withPackWriteLock`.
- Новых типов ошибок протокола не заводим: отказы едут существующим
  `admin-pack-error { filename, reason }`.
- Задачи 1–3 (пропуск) и 4–6 (удаление) не связаны между собой ничем: порядок в плане —
  просто порядок, любую половину можно делать первой.
- Формат коммитов — Conventional Commits, ветка `feature/pack-delete-and-skip-question`
  (уже создана).

## Уточнения, внесённые в спеку

Две вещи всплыли при разборе кода уже после того, как спека была закоммичена. **Спека
поправлена** — здесь краткая выжимка, чтобы не ходить за ней по ходу работы.

1. **Автозакрытия редактора при удалении нет.** Редактор открывается единственной кнопкой, и
   она всегда открывает активный пакет (`setEditingFilename(activePackFilename)`,
   `Admin.tsx:931` — других присваиваний `editingFilename` в файле нет), а активный пакет
   удалить нельзя. Состояние «удалённый пакет открыт в редакторе» не наступает никогда, теста,
   который его по-честному вызывает, не существует — кода тоже не пишем.
2. **`title` вешается на обёртку `<span>`, а не на саму `disabled`-кнопку.** Отключённый
   элемент не получает mouse-событий, подсказка на нём не всплывает — то есть буквально
   выполненная первая редакция спеки дала бы ровно ту беззвучную блокировку, ради ухода от
   которой этот `title` и заводился. Кнопка остаётся выключенной.

---

## Часть 1. Пропуск вопроса

### Задача 1: движок принимает пропуск от админ-панели

**Файлы:**

- Правка: `server/src/engine.ts:152` (тип события), `server/src/engine.ts:637-648`
  (`handleCancelQuestion`)
- Тест: `server/src/engine.test.ts`, в существующий `describe('cancel-question', ...)`
  (около строки 796)

**Интерфейсы:**

- Отдаёт наружу: вариант `EngineEvent` `{ type: 'cancel-question'; requesterId: string | null }`.
  Задача 2 полагается на то, что `null` проходит проверку, а чужой id — нет.

- [ ] **Шаг 1: написать падающие тесты**

Дописать в конец `describe('cancel-question', ...)` в `server/src/engine.test.ts`
(перед закрывающим `});` блока):

```ts
it('closes the question when the requester is the admin panel (requesterId: null)', () => {
  const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
  const opened = selectFirst(initial).state;
  const { state: next } = reduce(opened, {
    type: 'cancel-question',
    requesterId: null,
  });
  expect(next.phase).toBe('reveal');
  expect(next.answeredQuestionIds).toEqual(['a1']);
  expect(next.scores).toEqual(initial.scores);
});

// Ровно тот случай, ради которого правило и менялось: играли вдвоём,
// ведущего никто не назначал, и пропустить вопрос было нечем.
it('works from the admin panel even with no host assigned', () => {
  const initial = createInitialState(PACK, ['p1', 'p2']);
  const opened = selectFirst(initial).state;
  expect(opened.hostId).toBeNull();
  const { state: next } = reduce(opened, {
    type: 'cancel-question',
    requesterId: null,
  });
  expect(next.phase).toBe('reveal');
  expect(next.answeredQuestionIds).toEqual(['a1']);
});

it('is still a no-op for a player who is not the host', () => {
  const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
  const opened = selectFirst(initial).state;
  const { state: next } = reduce(opened, {
    type: 'cancel-question',
    requesterId: 'p1',
  });
  expect(next).toEqual(opened);
});

it('is a no-op from the admin panel when there is no open question', () => {
  const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
  const { state: next, effects } = reduce(state, {
    type: 'cancel-question',
    requesterId: null,
  });
  expect(next).toEqual(state);
  expect(effects).toEqual([]);
});
```

Если `createInitialState(PACK, ['p1', 'p2'])` без ведущего в этом файле не собирается —
посмотреть, как соседний тест `'is a no-op with no host'` (около строки 774) строит
состояние без ведущего, и повторить его вызов.

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
pnpm --filter server test -- -t "cancel-question"
```

Ожидается: два новых теста с `requesterId: null` красные — сейчас проверка
`event.requesterId !== state.hostId` даёт `true` для `null`, и событие уходит в
`unchanged(state)`, то есть фаза остаётся `question-open`, а не `reveal`.

- [ ] **Шаг 3: расширить тип события**

`server/src/engine.ts`, строка 152 — заменить

```ts
  | { type: 'cancel-question'; requesterId: string }
```

на

```ts
  // requesterId: null — с админ-панели, у которой нет личности отправителя
  // (room.ts, Admin.tsx). Строка — телефон ведущего; чужой id движок
  // отсеивает сам, как и у adjust-score.
  | { type: 'cancel-question'; requesterId: string | null }
```

- [ ] **Шаг 4: поправить проверку в обработчике**

`server/src/engine.ts`, `handleCancelQuestion`:

```ts
function handleCancelQuestion(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'cancel-question' }>,
): Result {
  // Либо это админ-панель (requesterId === null — подставляет сервер, клиент
  // соврать про себя не может), либо назначенный ведущий. Второго события
  // ради админ-панели не заводим: в движке это была бы дословная копия того
  // же правила.
  if (event.requesterId !== null) {
    if (state.hostId === null || event.requesterId !== state.hostId) {
      return unchanged(state);
    }
  }
  if (!state.currentQuestion) {
    return unchanged(state);
  }
  return revealQuestion(state, null);
}
```

Комментарий над функцией («Закрывает текущий вопрос без начисления очков…») оставить,
дописав к нему строку про то, что доступно это теперь ведущему **или** админ-панели.

- [ ] **Шаг 5: убедиться, что тесты зелёные**

```bash
pnpm --filter server test -- -t "cancel-question"
```

Ожидается: PASS, включая четыре старых теста блока.

- [ ] **Шаг 6: коммит**

```bash
git add server/src/engine.ts server/src/engine.test.ts
git commit -m "feat: пропуск вопроса разрешён админ-панели, не только ведущему"
```

---

### Задача 2: транспорт — admin-cancel-question

**Файлы:**

- Правка: `server/src/room.ts:885` (`cancelQuestion`), `server/src/protocol.ts:196`
  (рядом с `admin-skip-to-final`), `server/src/server.ts:625` (рядом с обработчиком
  `admin-skip-to-final`)
- Тест: `server/src/server.test.ts`, в `describe('createServer game flow', ...)`

**Интерфейсы:**

- Потребляет: `EngineEvent` с `requesterId: string | null` из задачи 1.
- Отдаёт наружу: сообщение протокола `{ type: 'admin-cancel-question' }` — задача 3
  посылает именно его; метод `Room.cancelQuestion(requesterId: string | null): void`.

- [ ] **Шаг 1: написать падающий тест**

Дописать в `server/src/server.test.ts` внутрь `describe('createServer game flow', ...)`,
рядом с тестом `'plays a question from start-game through a correct answer'`:

```ts
it('admin-cancel-question closes the open question with no host assigned', async () => {
  // Фейковые таймеры — только чтобы дожать question-reveal до
  // question-open, тем же приёмом (shouldAdvanceTime), что и соседний
  // тест партии выше: сеть при этом остаётся настоящей.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const dir = await mkdtemp(join(tmpdir(), 'svoya-igra-admin-cancel-'));
    const room = new Room(undefined, TEST_PACK);
    const server = createServer({
      room,
      clientDistPath: dir,
      port: 8080,
      packsDir: dir,
    });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/ws`;

    const a = await joinPlayer(url, 'Ваня');
    const b = await joinPlayer(url, 'Катя');
    await a.nextMessage();
    const admin = await connectAdmin(url);

    a.ws.send(JSON.stringify({ type: 'start-game' }));
    const started = (await settle(a, b, a)) as {
      game: {
        phase: string;
        turnParticipantId: string;
        hostId: string | null;
      };
    };
    await admin.nextMessage();
    // Ведущего никто не назначал — ровно тот случай, ради которого
    // правило и менялось.
    expect(started.game.hostId).toBeNull();

    const picker = started.game.turnParticipantId === a.participantId ? a : b;
    picker.ws.send(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 0,
        questionId: 'q1',
      }),
    );
    await settle(a, b, picker);
    await admin.nextMessage();
    await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
    const open = (await settle(a, b, picker)) as { game: { phase: string } };
    await admin.nextMessage();
    expect(open.game.phase).toBe('question-open');

    admin.ws.send(JSON.stringify({ type: 'admin-cancel-question' }));
    const skipped = (await settle(a, b, picker)) as {
      game: {
        phase: string;
        scores: { participantId: string; score: number }[];
      };
    };
    expect(skipped.game.phase).toBe('reveal');
    expect(skipped.game.scores).toEqual(
      expect.arrayContaining([
        { participantId: a.participantId, score: 0 },
        { participantId: b.participantId, score: 0 },
      ]),
    );

    a.ws.close();
    b.ws.close();
    admin.ws.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  } finally {
    vi.useRealTimers();
  }
});
```

Если счёт лишних `await admin.nextMessage()` не сойдётся (админский сокет получает те же
широковещательные `state`, что и игроки), выровнять по факту: посмотреть, как соседние
тесты в этом файле вычитывают очередь админа, и добавить/убрать вычитывание — важна только
последняя проверка фазы.

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
pnpm --filter server test -- -t "admin-cancel-question"
```

Ожидается: FAIL — сообщение `admin-cancel-question` сервер сейчас не знает, ничего не
происходит, `settle` виснет на ожидании следующего состояния и тест падает по таймауту.

- [ ] **Шаг 3: расширить `Room.cancelQuestion`**

`server/src/room.ts`, около строки 885:

```ts
  // requesterId === null — с админ-панели (тот же паттерн, что у
  // refreshAvailablePacks/selectPack). Настоящий отправитель, а не то, что
  // клиент о себе заявляет: строку сюда кладёт server.ts из connections.
  cancelQuestion(requesterId: string | null): void {
    this.dispatch({ type: 'cancel-question', requesterId });
  }
```

- [ ] **Шаг 4: добавить сообщение протокола**

`server/src/protocol.ts`, сразу под `| { type: 'admin-skip-to-final' }` (строка 196):

```ts
  // Пропуск активного вопроса с пульта хозяина комнаты. Без параметров: что
  // именно отменять, знает комната, а не клиент.
  | { type: 'admin-cancel-question' }
```

- [ ] **Шаг 5: добавить обработчик**

`server/src/server.ts`, сразу под обработчиком `admin-skip-to-final` (около строки 627):

```ts
if (message.type === 'admin-cancel-question') {
  room.cancelQuestion(null);
}
```

- [ ] **Шаг 6: убедиться, что тест зелёный**

```bash
pnpm --filter server test -- -t "admin-cancel-question"
```

Ожидается: PASS.

- [ ] **Шаг 7: прогнать серверную область целиком**

```bash
pnpm --filter server test
```

Ожидается: PASS — обработчик игрока `cancel-question` (`server.ts:534`) передаёт
`participantId` и продолжает работать без изменений.

- [ ] **Шаг 8: коммит**

```bash
git add server/src/room.ts server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: сообщение admin-cancel-question для пропуска вопроса из админки"
```

---

### Задача 3: кнопки — «Пропустить вопрос» в /admin и переименование у ведущего

**Файлы:**

- Правка: `client/src/useAdminConnection.ts` (union `ClientMessage` около строки 111,
  интерфейс `AdminConnection` около строки 180, объект возврата около строки 457),
  `client/src/Admin.tsx:1204` (блок с «Перейти к финалу (тест)»),
  `client/src/Player.tsx:435` (подпись кнопки)
- Тест: `client/src/Admin.test.tsx`, `client/src/Player.test.tsx`

**Интерфейсы:**

- Потребляет: сообщение `{ type: 'admin-cancel-question' }` из задачи 2.
- Отдаёт наружу: `AdminConnection.cancelQuestion(): void`.

- [ ] **Шаг 1: написать падающие тесты**

В `client/src/Admin.test.tsx` — новый тест рядом с тестами управления партией:

```tsx
it('кнопка пропуска выключена без активного вопроса и шлёт cancelQuestion с ним', async () => {
  const cancelQuestion = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({ game: baseGame(), cancelQuestion }),
  );
  const { rerender } = render(<Admin />);
  expect(
    screen.getByRole('button', { name: 'Пропустить вопрос' }),
  ).toBeDisabled();

  mockedUseAdminConnection.mockReturnValue(
    connection({
      game: baseGame({
        phase: 'question-open',
        currentQuestion: {
          themeIndex: 0,
          questionId: 'q1',
          price: 100,
          text: 'В?',
          type: 'обычный',
        },
      }),
      cancelQuestion,
    }),
  );
  rerender(<Admin />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Пропустить вопрос' }),
  );
  expect(cancelQuestion).toHaveBeenCalledTimes(1);
});
```

Форму объекта `currentQuestion` не выдумывать: взять её из типа `GameStateView`
(`client/src/useRoomConnection.ts`) или скопировать у любого теста в `Admin.test.tsx` /
`Player.test.tsx`, который уже собирает состояние с открытым вопросом.

В `client/src/Player.test.tsx` — заменить обе строки ожидания подписи (около строк 863 и
2019):

```ts
      screen.getByRole('button', { name: 'Пропустить вопрос' }),
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "Пропустить вопрос"
```

Ожидается: FAIL — такой кнопки нет ни в `Admin.tsx`, ни (под этим именем) в `Player.tsx`.

- [ ] **Шаг 3: добавить метод в хук**

`client/src/useAdminConnection.ts` — в union `ClientMessage`, под `admin-skip-to-final`:

```ts
  | { type: 'admin-cancel-question' }
```

в интерфейс `AdminConnection`, рядом со `skipToFinal`:

```ts
  // Закрывает активный вопрос без начисления очков — то же, что кнопка на
  // телефоне ведущего, но с пульта и не требуя назначенного ведущего.
  cancelQuestion(): void;
```

в объект возврата, рядом со `skipToFinal`:

```ts
    cancelQuestion: () => send({ type: 'admin-cancel-question' }),
```

- [ ] **Шаг 4: добавить кнопку в `/admin`**

`client/src/Admin.tsx` — взять `cancelQuestion` из `useAdminConnection()` (там же, где
берётся `skipToFinal`) и вставить кнопку **перед** временной «Перейти к финалу (тест)», в
том же `div.admin-actions`:

```tsx
<button
  className="button"
  onClick={cancelQuestion}
  disabled={!game || game.currentQuestion === null}
>
  Пропустить вопрос
</button>
```

Подтверждения нет намеренно: цена ошибки — один вопрос, цена лишнего тапа посреди партии
выше.

- [ ] **Шаг 5: переименовать кнопку у ведущего**

`client/src/Player.tsx:435` — заменить `Отменить вопрос` на `Пропустить вопрос`. Место
кнопки и обработчик не трогать. Смысл правки: «отменить» читается как «вопрос вернётся на
табло», а механика противоположная — вопрос считается сыгранным и с табло уходит.

- [ ] **Шаг 6: убедиться, что тесты зелёные**

```bash
pnpm --filter client test
```

Ожидается: PASS. Если где-то ещё остались ожидания подписи «Отменить вопрос» — поправить
их, это та же переименованная кнопка.

- [ ] **Шаг 7: коммит**

```bash
git add client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Player.tsx client/src/Admin.test.tsx client/src/Player.test.tsx
git commit -m "feat: кнопка «Пропустить вопрос» в /admin и та же подпись у ведущего"
```

---

## Часть 2. Удаление пакета

### Задача 4: deletePack — json и папка медиа

**Файлы:**

- Правка: `server/src/packs.ts` (импорт `rm`, новая функция после `deleteQuestion`)
- Тест: `server/src/packs.test.ts`

**Интерфейсы:**

- Отдаёт наружу: `deletePack(dir: string, filename: string): Promise<void>` — задача 5
  вызывает её под `withPackWriteLock`.

- [ ] **Шаг 1: написать падающие тесты**

В `server/src/packs.test.ts` — добавить `deletePack` в список импортов из `./packs.js`,
`mkdir` и `stat` в импорт из `node:fs/promises`, и новый блок:

```ts
describe('deletePack', () => {
  it('удаляет json и папку с картинками пакета', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await mkdir(join(dir, 'media', 'a'), { recursive: true });
    await writeFile(join(dir, 'media', 'a', 'pic.png'), 'png', 'utf8');

    await deletePack(dir, 'a.json');

    await expect(stat(join(dir, 'a.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(dir, 'media', 'a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('удаляет текстовый пакет без папки медиа без ошибки', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await expect(deletePack(dir, 'a.json')).resolves.toBeUndefined();
  });

  it('не трогает картинки соседнего пакета', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await writeFile(join(dir, 'b.json'), JSON.stringify(VALID_PACK), 'utf8');
    await mkdir(join(dir, 'media', 'b'), { recursive: true });
    await writeFile(join(dir, 'media', 'b', 'pic.png'), 'png', 'utf8');

    await deletePack(dir, 'a.json');

    await expect(
      stat(join(dir, 'media', 'b', 'pic.png')),
    ).resolves.toBeTruthy();
  });

  // Запрос на удаление того, чего нет, — рассинхрон интерфейса, а не
  // штатная ситуация: тихий успех спрятал бы его.
  it('бросает на несуществующем файле, а не заканчивается тихим успехом', async () => {
    await expect(deletePack(dir, 'ghost.json')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
```

Имя переменной временной директории (`dir`) взять то же, что у соседних блоков этого файла;
если оно другое — переиспользовать существующее, новый `beforeEach` не заводить.

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
pnpm --filter server test -- -t "deletePack"
```

Ожидается: FAIL с `deletePack is not a function` (или ошибкой импорта).

- [ ] **Шаг 3: реализовать `deletePack`**

`server/src/packs.ts` — в импорте заменить

```ts
import { readdir, readFile } from 'node:fs/promises';
```

на

```ts
import { readdir, readFile, rm } from 'node:fs/promises';
```

и добавить после `deleteQuestion`:

```ts
/**
 * Сносит пакет целиком: json и папку с его картинками.
 *
 * Раскладка медиа не угадывается, а выводится из имени файла: URL картинки
 * комната собирает как `/media/<имя пакета без .json>/<файл>` (room.ts), и
 * генератор пакетов кладёт файлы туда же. То есть у каждого пакета своя
 * папка, названная его же именем, и общих картинок между пакетами по
 * построению не бывает.
 *
 * Порядок важен: сначала json, потом медиа. Пакет без картинок хотя бы виден
 * в списке и чинится руками; картинки без пакета — мусор, который никто не
 * найдёт.
 *
 * Несуществующий json бросает ENOENT, а не заканчивается тихим успехом:
 * запрос на удаление того, чего нет, — рассинхрон интерфейса, о котором
 * стоит знать. Отсутствие папки медиа, наоборот, норма — у текстового пакета
 * её просто нет, отсюда `force: true`.
 */
export async function deletePack(dir: string, filename: string): Promise<void> {
  await rm(join(dir, filename));
  await rm(join(dir, 'media', filename.replace(/\.json$/, '')), {
    recursive: true,
    force: true,
  });
}
```

- [ ] **Шаг 4: убедиться, что тесты зелёные**

```bash
pnpm --filter server test -- -t "deletePack"
```

Ожидается: PASS (4 теста).

- [ ] **Шаг 5: коммит**

```bash
git add server/src/packs.ts server/src/packs.test.ts
git commit -m "feat: deletePack сносит пакет вместе с его папкой картинок"
```

---

### Задача 5: обработчик admin-delete-pack с тремя отказами

**Файлы:**

- Правка: `server/src/protocol.ts:243` (рядом с `admin-delete-question`),
  `server/src/server.ts:~725` (разбор сообщения) и `server/src/server.ts:~947`
  (обработчик рядом с `handleDeleteQuestion`)
- Тест: `server/src/server.test.ts`, в блоке про редактор пакетов (тот, где `beforeEach`
  пишет `a.json` и создаёт `new Room(undefined, PACK_A, undefined, 'a.json')`, около
  строки 2899)

**Интерфейсы:**

- Потребляет: `deletePack(dir, filename)` из задачи 4.
- Отдаёт наружу: сообщение `{ type: 'admin-delete-pack'; filename: string }` — задача 6
  посылает именно его. Отказы приходят существующим
  `{ type: 'admin-pack-error'; filename; reason }`, успех виден как широковещательный
  `state` с обновлённым `availablePacks`.

- [ ] **Шаг 1: написать падающие тесты**

В `server/src/server.test.ts`, в блок про редактор пакетов:

```ts
it('admin-delete-pack удаляет файл и рассылает обновлённый список всем', async () => {
  await writeFile(join(packsDir, 'b.json'), JSON.stringify(PACK_A), 'utf8');
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(JSON.stringify({ type: 'admin-refresh-packs' }));
  const listed = (await admin.nextMessage()) as {
    availablePacks: { filename: string }[];
  };
  expect(listed.availablePacks.map((p) => p.filename)).toEqual(
    expect.arrayContaining(['a.json', 'b.json']),
  );

  admin.ws.send(
    JSON.stringify({ type: 'admin-delete-pack', filename: 'b.json' }),
  );
  const after = (await admin.nextMessage()) as {
    type: string;
    availablePacks: { filename: string }[];
  };
  expect(after.type).toBe('state');
  expect(after.availablePacks.map((p) => p.filename)).toEqual(['a.json']);
  await expect(readFile(join(packsDir, 'b.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  admin.ws.close();
});

// Идущая партия не должна остаться без картинок посреди хода — поэтому
// отказ, а не разбор состояния «игра идёт / игра не начата».
it('admin-delete-pack отказывает для активного пакета с причиной', async () => {
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({ type: 'admin-delete-pack', filename: 'a.json' }),
  );
  const reply = await admin.nextMessage();
  expect(reply).toEqual({
    type: 'admin-pack-error',
    filename: 'a.json',
    reason: 'сначала выберите другой пакет',
  });
  await expect(readFile(join(packsDir, 'a.json'))).resolves.toBeTruthy();
  admin.ws.close();
});

// Файлы репозитория, а не пакеты компании: из них сервер заводит рабочие
// копии. В списке паков их нет, так что через интерфейс сюда не попасть —
// проверка на случай прямого сообщения.
it('admin-delete-pack отказывает для *.example.json', async () => {
  await writeFile(
    join(packsDir, 'current.example.json'),
    JSON.stringify(PACK_A),
    'utf8',
  );
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({
      type: 'admin-delete-pack',
      filename: 'current.example.json',
    }),
  );
  const reply = await admin.nextMessage();
  expect(reply).toEqual({
    type: 'admin-pack-error',
    filename: 'current.example.json',
    reason: 'пример из репозитория нельзя удалить',
  });
  await expect(
    readFile(join(packsDir, 'current.example.json')),
  ).resolves.toBeTruthy();
  admin.ws.close();
});

it('admin-delete-pack с путём наружу — молчаливый no-op', async () => {
  const admin = await connectAdmin(baseUrl);
  // Тот же приём, что у соседей: легитимное действие после подозрительного
  // доказывает, что сокет жив и молчание не было случайностью.
  admin.ws.send(
    JSON.stringify({ type: 'admin-delete-pack', filename: '../a.json' }),
  );
  admin.ws.send(JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }));
  const reply = (await admin.nextMessage()) as { type: string };
  expect(reply.type).toBe('admin-pack');
  admin.ws.close();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
pnpm --filter server test -- -t "admin-delete-pack"
```

Ожидается: FAIL — сообщение неизвестно серверу, ответа нет, тесты падают по таймауту
ожидания следующего сообщения.

- [ ] **Шаг 3: добавить сообщение протокола**

`server/src/protocol.ts`, под `| { type: 'admin-delete-question'; ... }` (строка 243):

```ts
  // Сносит пакет целиком — json и его папку картинок. Ответа при успехе нет:
  // виден он как обновлённый список паков в широковещательном состоянии.
  | { type: 'admin-delete-pack'; filename: string }
```

- [ ] **Шаг 4: разобрать сообщение**

`server/src/server.ts`, под блоком `admin-delete-question` (около строки 725):

```ts
if (
  message.type === 'admin-delete-pack' &&
  typeof message.filename === 'string'
) {
  await handleDeletePack(message.filename);
}
```

- [ ] **Шаг 5: написать обработчик**

`server/src/server.ts`, сразу после `handleDeleteQuestion` (около строки 964). Импорт
`deletePack` добавить к существующему импорту из `./packs.js`:

```ts
async function handleDeletePack(filename: string): Promise<void> {
  // Тот же охранник, что у handleDeleteQuestion. Молча, потому что это
  // не пользовательская ошибка, а попытка обхода пути.
  if (basename(filename) !== filename) return;
  // Файлы репозитория, а не пакеты этой компании: из них сервер заводит
  // рабочие копии (ensureFileFromExample). В listAvailablePacks их и так
  // нет — проверка на случай прямого сообщения.
  if (filename.endsWith('.example.json')) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: 'пример из репозитория нельзя удалить',
    });
    return;
  }
  // Пока пакет выбран, удалять его нельзя: иначе идущая партия может
  // остаться без картинок посреди хода. Отказ вместо разбора состояния
  // «игра идёт / игра не начата».
  if (filename === room.getPackInfo().activeFilename) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: 'сначала выберите другой пакет',
    });
    return;
  }
  try {
    await withPackWriteLock(() => deletePack(packsDir, filename));
    room.refreshAvailablePacks(null, await listAvailablePacks(packsDir));
  } catch (err) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: adminPackErrorReason(err),
    });
  }
}
```

- [ ] **Шаг 6: убедиться, что тесты зелёные**

```bash
pnpm --filter server test -- -t "admin-delete-pack"
```

Ожидается: PASS (4 теста).

- [ ] **Шаг 7: прогнать серверную область целиком**

```bash
pnpm --filter server test
```

- [ ] **Шаг 8: коммит**

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: admin-delete-pack удаляет пакет, кроме активного и примеров"
```

---

### Задача 6: кнопка «Удалить» в списке пакетов /admin

**Файлы:**

- Правка: `client/src/useAdminConnection.ts` (union `ClientMessage`, интерфейс
  `AdminConnection`, объект возврата — рядом с `deleteQuestion`),
  `client/src/Admin.tsx` (состояние около строки 216 и список `ul.admin-packs`,
  строки 943–962), при необходимости `client/src/index.css`
- Тест: `client/src/Admin.test.tsx`

**Интерфейсы:**

- Потребляет: сообщение `{ type: 'admin-delete-pack'; filename: string }` из задачи 5.
- Отдаёт наружу: `AdminConnection.deletePack(filename: string): void`.

- [ ] **Шаг 1: написать падающие тесты**

В `client/src/Admin.test.tsx`:

```tsx
it('удаление пакета требует двух нажатий', async () => {
  const deletePack = vi.fn();
  mockedUseAdminConnection.mockReturnValue(
    connection({
      availablePacks: [
        { filename: 'a.json', title: 'Пак А', description: null },
        { filename: 'b.json', title: 'Пак Б', description: null },
      ],
      activePackFilename: 'a.json',
      deletePack,
    }),
  );
  render(<Admin />);
  const row = screen.getByRole('button', { name: /Пак Б/ }).closest('li');
  const remove = within(row as HTMLElement).getByRole('button', {
    name: 'Удалить',
  });

  await userEvent.click(remove);
  expect(deletePack).not.toHaveBeenCalled();

  await userEvent.click(
    within(row as HTMLElement).getByRole('button', {
      name: 'Точно? Вместе с картинками',
    }),
  );
  expect(deletePack).toHaveBeenCalledWith('b.json');
});

it('у активного пакета кнопка удаления выключена и объясняет, почему', () => {
  mockedUseAdminConnection.mockReturnValue(
    connection({
      availablePacks: [
        { filename: 'a.json', title: 'Пак А', description: null },
      ],
      activePackFilename: 'a.json',
      deletePack: vi.fn(),
    }),
  );
  render(<Admin />);
  const row = screen.getByRole('button', { name: /Пак А/ }).closest('li');
  expect(
    within(row as HTMLElement).getByRole('button', { name: 'Удалить' }),
  ).toBeDisabled();
  expect(
    within(row as HTMLElement).getByTitle('Сначала выберите другой пакет'),
  ).toBeInTheDocument();
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

```bash
pnpm --filter client test -- -t "пакет"
```

Ожидается: FAIL — кнопки «Удалить» в строке пакета нет.

- [ ] **Шаг 3: добавить метод в хук**

`client/src/useAdminConnection.ts` — в union `ClientMessage`, под `admin-delete-question`:

```ts
  | { type: 'admin-delete-pack'; filename: string }
```

в интерфейс `AdminConnection`, рядом с `deleteQuestion`:

```ts
  // Сносит пакет вместе с его папкой картинок. Ответа при успехе нет —
  // пакет просто исчезает из availablePacks.
  deletePack(filename: string): void;
```

в объект возврата, рядом с `deleteQuestion`:

```ts
    deletePack: (filename) => send({ type: 'admin-delete-pack', filename }),
```

- [ ] **Шаг 4: добавить состояние подтверждения в `Admin.tsx`**

Рядом с `const [confirmingDelete, setConfirmingDelete] = useState(false);` (строка 216) —
отдельное состояние, помнящее **какую** строку подтверждают (у вопроса подтверждение одно
на форму, здесь строк много):

```tsx
// Какой именно пакет ждёт подтверждения удаления. Не boolean, как
// confirmingDelete у вопроса: строк в списке много, и «Точно?» должно
// гореть ровно на нажатой.
const [confirmingDeletePack, setConfirmingDeletePack] = useState<string | null>(
  null,
);
```

и обработчик рядом с `handleDeleteQuestion`:

```tsx
function handleDeletePack(filename: string): void {
  if (confirmingDeletePack !== filename) {
    setConfirmingDeletePack(filename);
    return;
  }
  deletePack(filename);
  setConfirmingDeletePack(null);
}
```

`deletePack` взять из `useAdminConnection()` там же, где берётся `deleteQuestion`.

- [ ] **Шаг 5: добавить кнопку в строку списка**

`client/src/Admin.tsx`, внутри `<ul className="admin-packs">` — дописать вторую кнопку
после кнопки выбора, не трогая её саму:

```tsx
<li key={p.filename}>
  <button
    className={`button${selected ? ' is-selected' : ''}`}
    onClick={() => selectPack(p.filename)}
    disabled={selected}
  >
    <span className="admin-pack-title">{p.title}</span>
    {p.description && (
      <span className="admin-pack-description">{p.description}</span>
    )}
  </button>
  {/* title на обёртке, а не на самой кнопке: выключенный
                          элемент не получает mouse-событий, и подсказка на нём
                          не всплывает — блокировка осталась бы беззвучной,
                          ровно того случая мы и избегаем. */}
  <span
    className="admin-pack-delete"
    title={selected ? 'Сначала выберите другой пакет' : undefined}
  >
    <button
      className={`button button--no${
        confirmingDeletePack === p.filename ? ' is-selected' : ''
      }`}
      onClick={() => handleDeletePack(p.filename)}
      onBlur={() => setConfirmingDeletePack(null)}
      disabled={selected}
    >
      {confirmingDeletePack === p.filename
        ? 'Точно? Вместе с картинками'
        : 'Удалить'}
    </button>
  </span>
</li>
```

Подпись в подтверждающем состоянии говорит про картинки намеренно: удаление медиа
необратимо, и из слова «удалить» это никак не следует.

- [ ] **Шаг 6: поправить раскладку строки, если она поехала**

Открыть `/admin` (`pnpm dev`) и посмотреть список пакетов. Если две кнопки в `li` встали
друг под друга или разъехались — добавить в `client/src/index.css` рядом с существующим
правилом `.admin-packs`:

```css
.admin-packs li {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.admin-packs li > .button {
  flex: 1;
}
```

Если раскладка и так в порядке — шаг пропустить, лишнего CSS не добавлять.

- [ ] **Шаг 7: убедиться, что тесты зелёные**

```bash
pnpm --filter client test
```

Ожидается: PASS.

- [ ] **Шаг 8: коммит**

```bash
git add client/src/useAdminConnection.ts client/src/Admin.tsx client/src/Admin.test.tsx client/src/index.css
git commit -m "feat: кнопка удаления пакета в списке /admin с подтверждением"
```

---

### Задача 7: проверка целиком и слияние

**Файлы:** без правок кода, если проверки зелёные.

- [ ] **Шаг 1: полный прогон**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Ожидается: PASS во всех четырёх. Смотреть вывод, а не предполагать результат
(`superpowers:verification-before-completion`). Упало — чинить причину; три попытки без
результата — остановиться и рассказать, что происходит.

- [ ] **Шаг 2: ручная проверка обеих механик**

Поднять `pnpm dev`, открыть `/admin` и две вкладки игроков. Проверить:

1. начать партию **без назначенного ведущего**, открыть вопрос, нажать «Пропустить вопрос»
   в `/admin` — вопрос уходит с табло, очки не меняются, ход остаётся у того же игрока;
2. в списке пакетов нажать «Удалить» у неактивного пакета, затем «Точно? Вместе с
   картинками» — пакет исчезает из списка у всех подключённых, файл и папка
   `packs/media/<имя>/` пропали с диска;
3. у активного пакета кнопка выключена, и при наведении видна подсказка «Сначала выберите
   другой пакет».

- [ ] **Шаг 3: ревью**

`superpowers:requesting-code-review`. Отдельно попросить проверить пять инвариантов из
скилла `svoya-igra-dev` — в этой работе под ударом первый (движок не знает про диск и часы)
и второй (участник и счётчик — разные сущности).

- [ ] **Шаг 4: PR**

`superpowers:finishing-a-development-branch`. Заголовок PR становится строкой changelog:

```
feat: пропуск вопроса из админки и удаление пакета вместе с картинками
```

- [ ] **Шаг 5: живая игра**

Работа не закрыта, пока обе кнопки не проверены на настоящей партии. Наблюдения — в раздел
«Проверено вживую» в `.claude/skills/svoya-igra-dev/SKILL.md`, особенно всё, что опровергло
ожидание. Отдельно смотреть, находится ли теперь кнопка пропуска: причина, по которой её не
находили, была объяснена игрой без ведущего, и это предположение живая партия либо
подтвердит, либо нет.

---

## Что сознательно не делается

Из спеки, повторено здесь, чтобы не появилось «раз уж я всё равно тут»:

- удаление пакетов с телефона ведущего — там только выбор;
- механика «снять вопрос и вернуть его на табло» — это другое правило, не запрашивалось;
- уборка осиротевших папок в `packs/media/` от пакетов, удалённых мимо кнопки;
- подтверждение у кнопки пропуска вопроса;
- автозакрытие редактора при исчезновении пакета из списка — см. «Расхождения со спекой».
