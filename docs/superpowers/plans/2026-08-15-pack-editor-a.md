# Ручной редактор пакетов — Веха A — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В `/admin` — просмотр пакета сеткой «раунды → темы → цены», правка существующего
вопроса (текст/ответ/комментарий/цена/тип) и его удаление, с записью прямо в тот же файл на
диске.

**Architecture:** Три новых admin-only WebSocket-сообщения (`admin-get-pack`,
`admin-update-question`, `admin-delete-question`), один общий тип ответа (`admin-pack`/
`admin-pack-error`). Чистая логика чтения/правки/записи — в `server/src/packs.ts` (тот же файл,
что уже держит `listAvailablePacks`), проводка через протокол — в `server/src/server.ts`. На
клиенте — `useAdminConnection.ts` получает новые поля состояния и методы, `Admin.tsx` — новый
режим редактирования поверх уже существующего списка пакетов.

**Tech Stack:** TypeScript/Node на сервере, React на клиенте — без изменений в стеке.

## Global Constraints

- Правка перезаписывает тот же файл пакета — не создаёт новый (решение при брейнсторминге).
- Запись атомарная: temp-файл + rename, тот же паттерн, что уже есть в `server/src/snapshot.ts`
  (`writeFileAtomic`) — свой отдельный хелпер в `packs.ts`, без общего модуля с snapshot.ts
  (два похожих места, отдельная абстракция ради них не оправдана).
- **Записанный JSON — с отступом в 2 пробела** (`JSON.stringify(pack, null, 2)`), не компактный
  — пакеты остаются человекочитаемым/редактируемым в блокноте форматом (то же самое
  требование, что уже действует для генератора). Отличие от `snapshot.ts`'s
  `serializeSnapshot` (та пишет компактно) — снапшот никто руками не читает, пакет — читают.
- `id` вопроса не редактируется — не принимается в сообщениях на правку вообще, только как
  идентификатор, по которому ищется вопрос.
- Каждая правка сервер перечитывает файл заново с диска перед изменением и отвечает
  свежепрочитанным содержимым после записи — источник истины всегда файл, не то, что было в
  памяти клиента или только что записано сервером.
- Вся валидация — через уже существующий `validatePack` (`server/src/pack.ts`) на результат
  целиком, не только на изменённое поле — ловит и некорректную цену/текст, и опустевшую тему
  после удаления, одним и тем же путём.
- `filename` защищается проверкой `basename(filename) === filename` — тот же паттерн, что уже
  есть у `admin-select-pack`/`select-pack` в `server.ts` (`handleSelectPack`), включая свой
  тест на path traversal.
- Финал (`pack.final`) и метаданные пакета (`title`/`author`/`description`) в этой вехе не
  редактируются.

---

### Task 1: `packs.ts` — атомарная запись, правка и удаление вопроса

**Files:**

- Modify: `server/src/packs.ts`
- Modify: `server/src/packs.test.ts`

**Interfaces:**

- Consumes: `validatePack`, `loadPack` (`server/src/pack.ts`, уже существуют).
- Produces:

  ```ts
  function updateQuestion(
    dir: string,
    filename: string,
    questionId: string,
    fields: {
      price: number;
      text: string;
      answer: string;
      comment?: string;
      questionType: Question['type'];
    },
  ): Promise<Pack>; // бросает Error, если вопрос не найден или результат не проходит validatePack

  function deleteQuestion(
    dir: string,
    filename: string,
    questionId: string,
  ): Promise<Pack>; // бросает Error, если вопрос не найден или тема опустела
  ```

  Используется в Task 2 (`server.ts`).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/src/packs.test.ts`, импорт новых функций и `readFile`/`Question`-типа:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteQuestion, listAvailablePacks, updateQuestion } from './packs.js';
```

(Заменяет текущую строку `import { mkdtemp, rm, writeFile } from 'node:fs/promises';` и
`import { listAvailablePacks } from './packs.js';` — добавляет `readFile` и две новые функции
в уже существующие импорты, не дублирует их.)

Новая константа рядом с `VALID_PACK` — пакет с двумя вопросами в одной теме (нужен для теста
успешного удаления: `VALID_PACK` содержит только один вопрос, удалять который — как раз
случай ошибки «тема опустела», отдельно проверяемый ниже):

```ts
const TWO_QUESTION_PACK = {
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
              text: 'В1?',
              answer: 'О1',
              type: 'обычный',
            },
            {
              id: 'q2',
              price: 200,
              text: 'В2?',
              answer: 'О2',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
};
```

Новые `describe`-блоки в конец файла:

```ts
describe('updateQuestion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-update-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('updates the fields of an existing question and writes them to disk', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const updated = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 200,
      text: 'Новый текст?',
      answer: 'Новый ответ',
      questionType: 'обычный',
    });

    expect(updated.rounds[0].themes[0].questions[0]).toMatchObject({
      id: 'q1',
      price: 200,
      text: 'Новый текст?',
      answer: 'Новый ответ',
      type: 'обычный',
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk.rounds[0].themes[0].questions[0].price).toBe(200);
  });

  it('sets and clears the optional comment field', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const withComment = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      comment: 'Пояснение',
      questionType: 'обычный',
    });
    expect(withComment.rounds[0].themes[0].questions[0].comment).toBe(
      'Пояснение',
    );

    const withoutComment = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      questionType: 'обычный',
    });
    expect(
      withoutComment.rounds[0].themes[0].questions[0].comment,
    ).toBeUndefined();
  });

  it('can change the question type', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const updated = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      questionType: 'аукцион',
    });
    expect(updated.rounds[0].themes[0].questions[0].type).toBe('аукцион');
  });

  it('throws and does not write when the question id is not found', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'ghost', {
        price: 100,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow(/не найден/);
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('throws and does not write when the new price is invalid', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'q1', {
        price: 0,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('throws and does not write when the new text is empty', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'q1', {
        price: 100,
        text: '',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('writes the file pretty-printed with 2-space indentation, matching the hand-editable format', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await updateQuestion(dir, 'sport.json', 'q1', {
      price: 200,
      text: 'В?',
      answer: 'О',
      questionType: 'обычный',
    });

    const raw = await readFile(join(dir, 'sport.json'), 'utf8');
    expect(raw).toBe(
      `${JSON.stringify(JSON.parse(raw), null, 2)}\n` === raw ? raw : raw,
    );
    expect(raw).toContain('\n  "title"');
  });
});

describe('deleteQuestion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-delete-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('removes the question from its theme and writes the result to disk', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(TWO_QUESTION_PACK),
      'utf8',
    );

    const updated = await deleteQuestion(dir, 'sport.json', 'q2');
    expect(updated.rounds[0].themes[0].questions).toHaveLength(1);
    expect(updated.rounds[0].themes[0].questions[0].id).toBe('q1');

    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
  });

  it('throws and does not write when the question id is not found', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(TWO_QUESTION_PACK),
      'utf8',
    );

    await expect(deleteQuestion(dir, 'sport.json', 'ghost')).rejects.toThrow(
      /не найден/,
    );
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(TWO_QUESTION_PACK);
  });

  it('throws and does not write when deleting would leave the theme with zero questions', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(deleteQuestion(dir, 'sport.json', 'q1')).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });
});
```

(В тесте «writes the file pretty-printed» строка с тройным сравнением избыточна — оставлена
как явная проверка, что раздел ниже, `expect(raw).toContain('\n  "title"')`, и есть
единственная содержательная assertion; убрать первую строку при реализации, она не добавляет
сигнала. Оставлено намеренно на этапе плана, чтобы не потерять саму идею проверки формата —
исполнитель просто пишет один `expect(raw).toContain('\n  "title"');` и всё.)

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd server
npx vitest run src/packs.test.ts
```

Expected: FAIL — `updateQuestion`/`deleteQuestion` не существуют, `readFile`/
`TWO_QUESTION_PACK` тоже пока не используются нигде, кроме новых тестов.

- [ ] **Step 3: Реализовать в `packs.ts`**

Импорты в начале файла — заменить текущие:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePack } from './pack.js';
```

на:

```ts
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPack, validatePack, type Pack, type Question } from './pack.js';
```

В конец файла добавить:

```ts
// Тот же паттерн, что уже есть в snapshot.ts (writeFileAtomic) — temp-файл
// + rename, а не прямая перезапись: половина записанного файла на диске
// после сбоя посреди write() хуже отсутствия записи вовсе. Отдельного
// общего хелпера с snapshot.ts не заводим — два похожих места, лишняя
// абстракция ради них не оправдана (YAGNI).
//
// null, 2 — а не компактный JSON.stringify, как в serializeSnapshot: пакет,
// в отличие от снапшота комнаты, человекочитаемый формат, который
// открывают и правят в текстовом редакторе (design.md пакет-генератора,
// «человекочитаемый формат»). Перезаписать его компактной строкой значило
// бы сломать эту читаемость для всего остального файла, не только для
// изменённого вопроса.
async function writePackAtomic(path: string, pack: Pack): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(pack, null, 2), 'utf8');
  await rename(tmpPath, path);
}

function findQuestion(pack: Pack, questionId: string): Question | undefined {
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const found = theme.questions.find((q) => q.id === questionId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Правит существующий вопрос по его `id` и сразу пишет результат на диск.
 * `id` не редактируется — вопрос ищется по нему, не переименовывается
 * (design.md, «Правило»: id — служебное поле движка, менять его человеку
 * незачем).
 *
 * Перечитывает файл заново с диска перед правкой (не доверяет тому, что
 * было в памяти вызывающего) и возвращает свежепрочитанное содержимое
 * после записи — источник истины всегда файл на диске.
 */
export async function updateQuestion(
  dir: string,
  filename: string,
  questionId: string,
  fields: {
    price: number;
    text: string;
    answer: string;
    comment?: string;
    questionType: Question['type'];
  },
): Promise<Pack> {
  const path = join(dir, filename);
  const pack = await loadPack(path);
  const question = findQuestion(pack, questionId);
  if (!question) {
    throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
  }
  question.price = fields.price;
  question.text = fields.text;
  question.answer = fields.answer;
  question.comment = fields.comment;
  question.type = fields.questionType;
  // Валидируем результат целиком, не только изменённое поле — дёшево
  // (пакет ≤ 50 вопросов) и заодно ловит структурные проблемы, которых
  // локальная проверка одного вопроса не увидела бы.
  const validated = validatePack(pack);
  await writePackAtomic(path, validated);
  return loadPack(path);
}

/**
 * Убирает вопрос по его `id` и сразу пишет результат на диск. Бросает,
 * если после удаления в какой-то теме не осталось вопросов —
 * `validatePack` это уже проверяет (`requireArray` требует непустой
 * массив), явного ручного счётчика тут не нужно.
 */
export async function deleteQuestion(
  dir: string,
  filename: string,
  questionId: string,
): Promise<Pack> {
  const path = join(dir, filename);
  const pack = await loadPack(path);
  let found = false;
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const index = theme.questions.findIndex((q) => q.id === questionId);
      if (index !== -1) {
        theme.questions.splice(index, 1);
        found = true;
      }
    }
  }
  if (!found) {
    throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
  }
  const validated = validatePack(pack);
  await writePackAtomic(path, validated);
  return loadPack(path);
}
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/packs.test.ts
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/packs.ts src/packs.test.ts
cd ..
git add server/src/packs.ts server/src/packs.test.ts
git commit -m "feat: add update/delete-question logic with atomic pack writes"
```

---

### Task 2: Протокол и `server.ts`

**Files:**

- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `updateQuestion`/`deleteQuestion` (`server/src/packs.js`, Task 1), `loadPack`
  (`server/src/pack.js`, уже существует).
- Produces: `ClientMessage` получает `admin-get-pack`/`admin-update-question`/
  `admin-delete-question`; `ServerMessage` получает `admin-pack`/`admin-pack-error`.
  Используется в Task 3 (`useAdminConnection.ts`).

- [ ] **Step 1: Расширить протокол**

`server/src/protocol.ts` — добавить импорт типа `Pack` (сейчас файл импортирует только
`PackSummary` из `./packs.js`):

```ts
import type { Phase } from './engine.js';
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
import type { Pack, Question } from './pack.js';
```

`ClientMessage` — новые варианты после `admin-select-pack`:

```ts
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string }
  // Ручной редактор пакетов, веха A (design.md, 2026-08-15) — просмотр,
  // правка и удаление существующего вопроса. id не редактируется, только
  // используется для поиска вопроса внутри пакета.
  | { type: 'admin-get-pack'; filename: string }
  | {
      type: 'admin-update-question';
      filename: string;
      questionId: string;
      price: number;
      text: string;
      answer: string;
      comment?: string;
      // Не «type» — не путать с полем-дискриминантом самого сообщения.
      questionType: Question['type'];
    }
  | { type: 'admin-delete-question'; filename: string; questionId: string };
```

`ServerMessage` — новые варианты после `select-pack-error`:

```ts
  | { type: 'select-pack-error'; reason: 'unknown-file' }
  // Ответ на все три admin-get-pack/admin-update-question/
  // admin-delete-question сразу — один тип на три запроса, чтобы клиенту
  // не нужно было по-разному обрабатывать три разных формы успеха.
  | { type: 'admin-pack'; filename: string; pack: Pack }
  | { type: 'admin-pack-error'; filename: string; reason: string };
```

- [ ] **Step 2: Написать падающие тесты**

Добавить в `server/src/server.test.ts`, новый `describe`-блок сразу после `describe('createServer
pack picker', ...)` (использует те же `PACK_A`/`PACK_B`, `connectAdmin`, `dir`/`packsDir`,
`beforeEach`/`afterEach` — переиспользовать буквально тот же сетап, скопировав блок целиком, а
не пытаться шарить между `describe`, если для этого пришлось бы выносить общий `beforeEach` —
план сознательно выбирает копию сетапа ради изоляции тестов, тот же принцип, что уже
применяется в этом файле между соседними `describe`):

```ts
describe('createServer pack editor', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  const PACK_A: Pack = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'В?',
                answer: 'О',
                type: 'обычный',
              },
              {
                id: 'a2',
                price: 200,
                text: 'В2?',
                answer: 'О2',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-packs-'));
    await writeFile(join(packsDir, 'a.json'), JSON.stringify(PACK_A), 'utf8');
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

  it('admin-get-pack returns the full pack content', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    expect(reply.pack.title).toBe('Пак А');
    expect(reply.pack.rounds[0].themes[0].questions).toHaveLength(2);
    admin.ws.close();
  });

  it('admin-get-pack on an unknown file returns admin-pack-error', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'ghost.json' }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toMatchObject({
      type: 'admin-pack-error',
      filename: 'ghost.json',
    });
    admin.ws.close();
  });

  it('admin-get-pack with a path-traversal filename is a silent no-op', async () => {
    const admin = await connectAdmin(baseUrl);
    // Тот же приём, что уже используется в 'admin-select-pack with a
    // path-traversal filename' — легитимное действие после подозрительного
    // доказывает, что сокет жив и молчание не было случайностью.
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: '../a.json' }),
    );
    admin.ws.send(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );
    const reply = (await admin.nextMessage()) as { type: string };
    expect(reply.type).toBe('admin-pack');
    admin.ws.close();
  });

  it('admin-update-question changes the question and returns the updated pack', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-update-question',
        filename: 'a.json',
        questionId: 'a1',
        price: 300,
        text: 'Новый текст?',
        answer: 'Новый ответ',
        questionType: 'обычный',
      }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    const updated = reply.pack.rounds[0].themes[0].questions.find(
      (q) => q.id === 'a1',
    );
    expect(updated).toMatchObject({ price: 300, text: 'Новый текст?' });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(
      onDisk.rounds[0].themes[0].questions.find((q) => q.id === 'a1')?.price,
    ).toBe(300);
    admin.ws.close();
  });

  it('admin-update-question with an invalid price returns admin-pack-error and does not write', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-update-question',
        filename: 'a.json',
        questionId: 'a1',
        price: 0,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    );
    const reply = await admin.nextMessage();
    expect(reply).toMatchObject({
      type: 'admin-pack-error',
      filename: 'a.json',
    });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(
      onDisk.rounds[0].themes[0].questions.find((q) => q.id === 'a1')?.price,
    ).toBe(100);
    admin.ws.close();
  });

  it('admin-delete-question removes the question and returns the updated pack', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a2',
      }),
    );
    const reply = (await admin.nextMessage()) as { type: string; pack: Pack };
    expect(reply.type).toBe('admin-pack');
    expect(reply.pack.rounds[0].themes[0].questions).toHaveLength(1);

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
    admin.ws.close();
  });

  it('admin-delete-question on the last question in a theme returns admin-pack-error and does not write', async () => {
    const admin = await connectAdmin(baseUrl);
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a1',
      }),
    );
    admin.ws.send(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'a2',
      }),
    );
    // Первое удаление (a1) проходит нормально — из двух вопросов остаётся
    // один. Второе (a2) оставило бы тему пустой и должно быть отклонено;
    // не вычитываем ответ на первое отдельно, а сразу проверяем итог по
    // диску — после обоих сообщений должен остаться ровно вопрос a2.
    await admin.nextMessage(); // ответ на первое удаление
    const reply = await admin.nextMessage(); // ответ на второе
    expect(reply).toMatchObject({
      type: 'admin-pack-error',
      filename: 'a.json',
    });

    const onDisk: Pack = JSON.parse(
      await readFile(join(packsDir, 'a.json'), 'utf8'),
    );
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
    expect(onDisk.rounds[0].themes[0].questions[0].id).toBe('a2');
    admin.ws.close();
  });
});
```

- [ ] **Step 3: Прогнать тесты, убедиться, что падают**

```bash
npx vitest run src/server.test.ts
```

Expected: компиляция падает — новых полей `ClientMessage`/`ServerMessage` ещё нет.

- [ ] **Step 4: Реализовать в `server.ts`**

Импорты — добавить `updateQuestion`/`deleteQuestion` рядом с уже импортированным
`listAvailablePacks`:

```ts
import { listAvailablePacks, updateQuestion, deleteQuestion } from './packs.js';
```

Новые обработчики — сразу после блока `admin-select-pack`, перед закрывающей `}` функции
`handleMessage` (после `handleSelectPack`'s определения, там же, где остальные `admin-*`
хендлеры):

```ts
if (message.type === 'admin-get-pack' && typeof message.filename === 'string') {
  await handleGetPack(message.filename);
}

if (
  message.type === 'admin-update-question' &&
  typeof message.filename === 'string' &&
  typeof message.questionId === 'string' &&
  typeof message.price === 'number' &&
  typeof message.text === 'string' &&
  typeof message.answer === 'string' &&
  (message.comment === undefined || typeof message.comment === 'string') &&
  typeof message.questionType === 'string'
) {
  await handleUpdateQuestion(message.filename, message.questionId, {
    price: message.price,
    text: message.text,
    answer: message.answer,
    comment: message.comment,
    questionType: message.questionType as Question['type'],
  });
}

if (
  message.type === 'admin-delete-question' &&
  typeof message.filename === 'string' &&
  typeof message.questionId === 'string'
) {
  await handleDeleteQuestion(message.filename, message.questionId);
}

// Тот же приём, что у handleSelectPack: легитимный клиент никогда сам
// не конструирует filename — эхом отправляет то, что уже видел в
// availablePacks. Значение, не прошедшее эту проверку, может прийти
// только от нестандартного отправителя — тихий no-op.
async function handleGetPack(filename: string): Promise<void> {
  if (basename(filename) !== filename) return;
  try {
    const pack = await loadPack(join(packsDir, filename));
    send(ws, { type: 'admin-pack', filename, pack });
  } catch (err) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: (err as Error).message,
    });
  }
}

async function handleUpdateQuestion(
  filename: string,
  questionId: string,
  fields: {
    price: number;
    text: string;
    answer: string;
    comment?: string;
    questionType: Question['type'];
  },
): Promise<void> {
  if (basename(filename) !== filename) return;
  try {
    const pack = await updateQuestion(packsDir, filename, questionId, fields);
    send(ws, { type: 'admin-pack', filename, pack });
  } catch (err) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: (err as Error).message,
    });
  }
}

async function handleDeleteQuestion(
  filename: string,
  questionId: string,
): Promise<void> {
  if (basename(filename) !== filename) return;
  try {
    const pack = await deleteQuestion(packsDir, filename, questionId);
    send(ws, { type: 'admin-pack', filename, pack });
  } catch (err) {
    send(ws, {
      type: 'admin-pack-error',
      filename,
      reason: (err as Error).message,
    });
  }
}
```

Импорт типа `Question` — добавить к уже существующему `import type { ClientMessage,
ParticipantView, ServerMessage } from './protocol.js';`, но `Question` живёт в `pack.js`, не в
`protocol.js` — добавить отдельной строкой:

```ts
import type { Question } from './pack.js';
```

(`loadPack`/`join`/`basename` — уже импортированы в файле, ничего дополнительно не требуют.)

- [ ] **Step 5: Прогнать тесты снова**

```bash
npx vitest run src/server.test.ts
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/protocol.ts src/server.ts src/server.test.ts
cd ..
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: wire the pack editor into the protocol and server"
```

---

### Task 3: `useAdminConnection.ts` — клиентский хук

**Files:**

- Modify: `client/src/useAdminConnection.ts`
- Modify: `client/src/useAdminConnection.test.ts`

**Interfaces:**

- Consumes: изменения протокола из Task 2 (зеркалятся локально, не импортируются — тот же
  принцип, что уже применён ко всему остальному в этом хуке).
- Produces:

  ```ts
  interface AdminConnection {
    // ...существующие поля...
    editedPack: Pack | null;
    editedPackFilename: string | null;
    editedPackError: string | null;
    getPack(filename: string): void;
    updateQuestion(
      filename: string,
      questionId: string,
      fields: {
        price: number;
        text: string;
        answer: string;
        comment?: string;
        questionType: Question['type'];
      },
    ): void;
    deleteQuestion(filename: string, questionId: string): void;
  }
  ```

  Используется в Task 4 (`Admin.tsx`).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/useAdminConnection.test.ts`, в конец файла:

```ts
it('sends admin-get-pack and picks up the returned pack', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() => result.current.getPack('a.json'));
  expect(socket.sent).toContainEqual(
    JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
  );

  const pack = {
    title: 'Пак',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [],
  };
  act(() =>
    socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
  );
  expect(result.current.editedPack).toEqual(pack);
  expect(result.current.editedPackFilename).toBe('a.json');
  expect(result.current.editedPackError).toBeNull();
});

it('sends admin-update-question with all fields, including the optional comment', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    result.current.updateQuestion('a.json', 'q1', {
      price: 200,
      text: 'Текст?',
      answer: 'Ответ',
      comment: 'Комментарий',
      questionType: 'обычный',
    }),
  );
  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'admin-update-question',
      filename: 'a.json',
      questionId: 'q1',
      price: 200,
      text: 'Текст?',
      answer: 'Ответ',
      comment: 'Комментарий',
      questionType: 'обычный',
    }),
  );
});

it('sends admin-delete-question', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() => result.current.deleteQuestion('a.json', 'q1'));
  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'admin-delete-question',
      filename: 'a.json',
      questionId: 'q1',
    }),
  );
});

it('surfaces an admin-pack-error reason and filename from the server', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    socket.emitMessage({
      type: 'admin-pack-error',
      filename: 'a.json',
      reason: 'вопрос с id "ghost" не найден в пакете',
    }),
  );
  expect(result.current.editedPackError).toBe(
    'вопрос с id "ghost" не найден в пакете',
  );
  expect(result.current.editedPackFilename).toBe('a.json');
});

it('clears editedPackError once a later admin-pack arrives', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    socket.emitMessage({
      type: 'admin-pack-error',
      filename: 'a.json',
      reason: 'ошибка',
    }),
  );
  expect(result.current.editedPackError).toBe('ошибка');

  const pack = {
    title: 'Пак',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [],
  };
  act(() =>
    socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
  );
  expect(result.current.editedPackError).toBeNull();
  expect(result.current.editedPack).toEqual(pack);
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd client
npx vitest run src/useAdminConnection.test.ts
```

Expected: FAIL — `getPack`/`updateQuestion`/`deleteQuestion`/`editedPack`/
`editedPackFilename`/`editedPackError` ещё не существуют.

- [ ] **Step 3: Реализовать в `useAdminConnection.ts`**

Добавить типы пакета — зеркало `server/src/pack.ts`, тот же принцип, что уже применён к
`ServerMessage`/`ClientMessage`/`PackSummary` в этом файле (клиент не импортирует серверные
типы, держит свою копию):

```ts
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
  description?: string;
  rounds: Round[];
  final?: unknown; // Веха A не редактирует финал — тип не нужен подробнее здесь.
}
```

`ServerMessage` (локальный тип) — новые варианты после `select-pack-error`:

```ts
  | { type: 'select-pack-error'; reason: 'unknown-file' }
  | { type: 'admin-pack'; filename: string; pack: Pack }
  | { type: 'admin-pack-error'; filename: string; reason: string };
```

`ClientMessage` (локальный тип) — новые варианты после `admin-select-pack`:

```ts
  | { type: 'admin-select-pack'; filename: string }
  | { type: 'admin-get-pack'; filename: string }
  | {
      type: 'admin-update-question';
      filename: string;
      questionId: string;
      price: number;
      text: string;
      answer: string;
      comment?: string;
      questionType: Question['type'];
    }
  | { type: 'admin-delete-question'; filename: string; questionId: string };
```

`AdminConnection` — новые поля/методы после `selectPack`:

```ts
  selectPack(filename: string): void;
  editedPack: Pack | null;
  editedPackFilename: string | null;
  editedPackError: string | null;
  getPack(filename: string): void;
  updateQuestion(
    filename: string,
    questionId: string,
    fields: {
      price: number;
      text: string;
      answer: string;
      comment?: string;
      questionType: Question['type'];
    },
  ): void;
  deleteQuestion(filename: string, questionId: string): void;
```

Новый локальный стейт, рядом с `selectPackError`:

```ts
const [editedPack, setEditedPack] = useState<Pack | null>(null);
const [editedPackFilename, setEditedPackFilename] = useState<string | null>(
  null,
);
const [editedPackError, setEditedPackError] = useState<string | null>(null);
```

Обработка входящих сообщений — в `ws.addEventListener('message', ...)`, добавить после
существующего `if (message.type === 'select-pack-error') { ... }`:

```ts
if (message.type === 'admin-pack') {
  setEditedPack(message.pack);
  setEditedPackFilename(message.filename);
  setEditedPackError(null);
}
if (message.type === 'admin-pack-error') {
  setEditedPackFilename(message.filename);
  setEditedPackError(message.reason);
}
```

Возвращаемый объект — новые записи после `selectPack: (filename) => send({ type:
'admin-select-pack', filename }),`:

```ts
    selectPack: (filename) => send({ type: 'admin-select-pack', filename }),
    editedPack,
    editedPackFilename,
    editedPackError,
    getPack: (filename) => send({ type: 'admin-get-pack', filename }),
    updateQuestion: (filename, questionId, fields) =>
      send({
        type: 'admin-update-question',
        filename,
        questionId,
        ...fields,
      }),
    deleteQuestion: (filename, questionId) =>
      send({ type: 'admin-delete-question', filename, questionId }),
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/useAdminConnection.test.ts
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc -b
npx oxlint src/useAdminConnection.ts
cd ..
git add client/src/useAdminConnection.ts client/src/useAdminConnection.test.ts
git commit -m "feat: add pack-editing methods to useAdminConnection"
```

---

### Task 4: `Admin.tsx` — экран редактора

**Files:**

- Modify: `client/src/Admin.tsx`
- Modify: `client/src/Admin.test.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: `editedPack`, `editedPackFilename`, `editedPackError`, `getPack`, `updateQuestion`,
  `deleteQuestion` (`client/src/useAdminConnection.ts`, Task 3).
- Produces: ничего наружу — конечный экран.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/Admin.test.tsx`, в `connection()`-хелпер новые поля (после
`selectPack: vi.fn(),`):

```ts
    selectPack: vi.fn(),
    editedPack: null,
    editedPackFilename: null,
    editedPackError: null,
    getPack: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
```

Новый `describe`-блок в конец файла:

```ts
describe('Admin — редактор пакета', () => {
  const PACK = {
    title: 'Пак А',
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
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };

  it('shows the pack grid after clicking "Редактировать"', async () => {
    const getPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    expect(getPack).toHaveBeenCalledWith('a.json');
  });

  it('renders the grid once the pack arrives, with a button per question price', async () => {
    const getPack = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );

    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        getPack,
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    rerender(<Admin />);
    expect(screen.getByText('Тема')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
  });

  it('opens the edit form with the question’s current values on price click', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ответ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  it('calls updateQuestion with the edited values and the fixed questionId on save', async () => {
    const updateQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        updateQuestion,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '300');
    await userEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    expect(updateQuestion).toHaveBeenCalledWith('a.json', 'q1', {
      price: 300,
      text: 'Вопрос?',
      answer: 'Ответ',
      comment: undefined,
      questionType: 'обычный',
    });
  });

  it('disables "Сохранить" for an invalid price or empty text', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const priceInput = screen.getByDisplayValue('100');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '0');
    expect(
      screen.getByRole('button', { name: /сохранить/i }),
    ).toBeDisabled();
  });

  it('shows the error from editedPackError and keeps the form open', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        editedPackError: 'цена должна быть положительным числом',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /цена должна быть положительным числом/i,
    );
  });

  it('requires clicking "Удалить" twice before it actually deletes the question', async () => {
    const deleteQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        deleteQuestion,
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '100' }));

    const del = screen.getByRole('button', { name: /^удалить$/i });
    await userEvent.click(del);
    expect(deleteQuestion).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /точно/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /точно/i }));
    expect(deleteQuestion).toHaveBeenCalledWith('a.json', 'q1');
  });

  it('returns to the pack list when "Готово" is clicked', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /готово/i }));
    expect(
      screen.queryByRole('button', { name: '100' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /редактировать/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
npx vitest run src/Admin.test.tsx
```

Expected: FAIL — кнопки «Редактировать»/сетки/формы ещё нет.

- [ ] **Step 3: Реализовать в `Admin.tsx`**

Импорт типов — добавить `Pack`/`Question` к уже существующему `import { useAdminConnection }
from './useAdminConnection';`:

```ts
import { useAdminConnection } from './useAdminConnection';
import type { Pack, Question } from './useAdminConnection';
```

Деструктуризация `useAdminConnection()` — добавить после `selectPack,`:

```ts
    selectPack,
    editedPack,
    editedPackFilename,
    editedPackError,
    getPack,
    updateQuestion,
    deleteQuestion,
  } = useAdminConnection();
```

Новый локальный стейт — рядом с `confirmingWipe`:

```ts
const [confirmingWipe, setConfirmingWipe] = useState(false);
// Режим редактора: какой файл сейчас открыт (null — обычный список
// пакетов), какой вопрос открыт формой, и текущие значения формы —
// отдельные строковые поля, а не готовые number/enum: значение в инпуте
// цены должно оставаться редактируемым текстом (в том числе временно
// невалидным, «0» или пустым), пока не нажали «Сохранить».
const [editingFilename, setEditingFilename] = useState<string | null>(null);
const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
const [formPrice, setFormPrice] = useState('');
const [formText, setFormText] = useState('');
const [formAnswer, setFormAnswer] = useState('');
const [formComment, setFormComment] = useState('');
const [formType, setFormType] = useState<Question['type']>('обычный');
const [confirmingDelete, setConfirmingDelete] = useState(false);
```

Новый эффект — запрашивает содержимое пакета при входе в режим редактирования (рядом с
остальным кодом компонента, после объявления стейта, до `roleOf`):

```ts
useEffect(() => {
  if (editingFilename) getPack(editingFilename);
  // Смена файла — закрыть открытую форму вопроса предыдущего пакета.
  setEditingQuestionId(null);
}, [editingFilename]);
```

(Требует добавить `useEffect` в импорт из `'react'`: `import { useEffect, useState } from
'react';`.)

Хелпер поиска вопроса — рядом с `roleOf`/`scoreOf`:

```ts
function findQuestionInPack(
  pack: Pack,
  questionId: string,
): Question | undefined {
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const found = theme.questions.find((q) => q.id === questionId);
      if (found) return found;
    }
  }
  return undefined;
}

function openQuestionForm(question: Question): void {
  setEditingQuestionId(question.id);
  setFormPrice(String(question.price));
  setFormText(question.text);
  setFormAnswer(question.answer);
  setFormComment(question.comment ?? '');
  setFormType(question.type);
  setConfirmingDelete(false);
}

function handleSaveQuestion(): void {
  if (!editingFilename || !editingQuestionId) return;
  updateQuestion(editingFilename, editingQuestionId, {
    price: Number(formPrice),
    text: formText,
    answer: formAnswer,
    comment: formComment.trim() === '' ? undefined : formComment,
    questionType: formType,
  });
}

function handleDeleteQuestion(): void {
  if (!confirmingDelete) {
    setConfirmingDelete(true);
    return;
  }
  if (editingFilename && editingQuestionId) {
    deleteQuestion(editingFilename, editingQuestionId);
  }
  setConfirmingDelete(false);
}

// Те же границы, что проверяет сервер (packs.ts, validatePack/
// validateQuestion): цена — положительное число, текст и ответ — не
// пустые строки. Без этой проверки кнопка «Сохранить» всегда кликабельна,
// а недопустимое значение молча улетает в admin-pack-error — тот же
// принцип, что уже применён к форме ставки в аукционе (Player.tsx).
const parsedFormPrice = Number(formPrice);
const isValidForm =
  Number.isFinite(parsedFormPrice) &&
  Number.isInteger(parsedFormPrice) &&
  parsedFormPrice > 0 &&
  formText.trim() !== '' &&
  formAnswer.trim() !== '';
```

Новая секция в разметке — заменить существующую секцию `<section className="admin-section">
<h2>Пакет</h2> ... </section>` целиком:

```tsx
<section className="admin-section">
  <h2>Пакет</h2>
  {selectPackError && (
    <p className="player-alert" role="alert">
      Не удалось выбрать пакет — файл стал невалиден или исчез.
    </p>
  )}
  {editingFilename === null ? (
    <>
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
                <button
                  className="button"
                  onClick={() => setEditingFilename(p.filename)}
                >
                  Редактировать
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  ) : (
    <div className="pack-editor">
      <div className="admin-actions">
        <button className="button" onClick={() => setEditingFilename(null)}>
          Готово
        </button>
      </div>
      {editedPackFilename === editingFilename && editedPack ? (
        <>
          {editedPack.rounds.map((round, ri) => (
            <div key={ri} className="pack-editor-round">
              <h3>Раунд {ri + 1}</h3>
              {round.themes.map((theme, ti) => (
                <div key={ti} className="pack-editor-theme">
                  <span className="pack-editor-theme-name">{theme.name}</span>
                  {theme.questions.map((q) => (
                    <button
                      key={q.id}
                      className="button"
                      onClick={() => openQuestionForm(q)}
                    >
                      {q.price}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {editingQuestionId && (
            <div className="pack-editor-form">
              {editedPackError && (
                <p className="player-alert" role="alert">
                  {editedPackError}
                </p>
              )}
              <label htmlFor="pack-editor-price">Цена</label>
              <input
                id="pack-editor-price"
                type="number"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
              />
              <label htmlFor="pack-editor-text">Текст</label>
              <textarea
                id="pack-editor-text"
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
              />
              <label htmlFor="pack-editor-answer">Ответ</label>
              <textarea
                id="pack-editor-answer"
                value={formAnswer}
                onChange={(e) => setFormAnswer(e.target.value)}
              />
              <label htmlFor="pack-editor-comment">
                Комментарий (необязательно)
              </label>
              <textarea
                id="pack-editor-comment"
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
              />
              <label htmlFor="pack-editor-type">Тип</label>
              <select
                id="pack-editor-type"
                value={formType}
                onChange={(e) =>
                  setFormType(e.target.value as Question['type'])
                }
              >
                <option value="обычный">обычный</option>
                <option value="кот">кот</option>
                <option value="аукцион">аукцион</option>
              </select>
              <div className="admin-actions">
                <button
                  className="button button--primary"
                  onClick={handleSaveQuestion}
                  disabled={!isValidForm}
                >
                  Сохранить
                </button>
                <button
                  className={`button button--no${confirmingDelete ? ' is-selected' : ''}`}
                  onClick={handleDeleteQuestion}
                  onBlur={() => setConfirmingDelete(false)}
                >
                  {confirmingDelete ? 'Точно?' : 'Удалить'}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p>Загрузка…</p>
      )}
    </div>
  )}
</section>
```

(`editedPackFilename === editingFilename` — защита от гонки: если админ уже переключился на
редактирование другого файла до того, как пришёл ответ на предыдущий `admin-get-pack`, старый
`editedPack` не должен на мгновение показаться под именем нового файла.)

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/Admin.test.tsx
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 5: Добавить стили**

`client/src/index.css` — новые классы в конец файла:

```css
.pack-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pack-editor-round h3 {
  margin: 0 0 8px;
}

.pack-editor-theme {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.pack-editor-theme-name {
  min-width: 140px;
  font-weight: 600;
}

.pack-editor-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 500px;
}

.pack-editor-form textarea {
  min-height: 60px;
  font: inherit;
}
```

- [ ] **Step 6: Полная проверка проекта**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: всё зелёное — последняя задача плана, полный прогон подтверждает, что предыдущие
три ничего не сломали и всё ещё собирается.

- [ ] **Step 7: Commit**

```bash
git add client/src/Admin.tsx client/src/Admin.test.tsx client/src/index.css
git commit -m "feat: add the pack editor screen to the admin panel"
```

---

## После плана

Ручная проверка вживую (не отдельный вечер игры — короткая проверка с ноутбука): открыть
`/admin`, отредактировать вопрос в тестовом пакете, убедиться, что файл на диске
действительно поменялся и остался читаемым (не превратился в одну строку), проверить
сообщение об ошибке на невалидной цене/тексте, проверить, что удаление последнего вопроса
темы отклоняется с понятным текстом, и что «Удалить» требует два клика.

Веха B (добавление новых вопросов) и Веха C (структурная правка — темы/раунды/финал/
метаданные пакета) — отдельные последующие спеки, если понадобятся, каждая начинается с
брейнсторминга заново.
