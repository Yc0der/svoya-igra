# Редактор пакетов — список и жалобы на вопрос — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В редакторе пакета (`/admin`) — переключатель вида «Сетка»/«Список» (по умолчанию
список), и кнопка «Пожаловаться» у каждого вопроса в списке, дописывающая структурированную
жалобу (с уже подставленным контекстом вопроса) в `docs/pack-generator-profile.md`, которую
`pack-generator` читает перед каждой генерацией.

**Architecture:** Новый серверный модуль `server/src/generatorProfile.ts` — чистая логика
атомарного дописывания жалобы в markdown-файл, без сети. Новое WS-сообщение
`admin-report-question` и ответы `admin-report-ack`/`admin-report-error` — тот же паттерн, что
уже есть у `admin-update-question`/`admin-pack`/`admin-pack-error` (Веха A), но с собственным
типом ответа, чтобы ошибка жалобы не путалась с ошибкой правки. На клиенте —
`useAdminConnection.ts` получает метод и состояние по образцу уже существующих
`updateQuestion`/`editedPackError`, `Admin.tsx` получает переключатель вида и панель жалобы,
взаимоисключающую с уже существующей формой правки.

**Tech Stack:** TypeScript/Node на сервере, React на клиенте — без изменений в стеке.

## Global Constraints

- Жалобы копятся в новом разделе `## Жалобы из ручного редактора` — **последнем** разделе
  `docs/pack-generator-profile.md` (после уже существующего «Автособранное»). Сервер сам
  подставляет контекст вопроса (текст, ответ, тема, цена, файл и название пакета) — от
  человека нужен только текст жалобы.
- Формат одной записи — ровно такой (решение при брейнсторминге, design.md):
  ```markdown
  - **2026-08-15, «Общая эрудиция» (sport.json), тема «Спорт», вопрос за 300:**
    «текст вопроса…» (ответ: «ответ») — не понравился, потому что…
  ```
  Дата — календарная (`YYYY-MM-DD`), без времени.
- Запись — атомарная: temp-файл + rename, тот же паттерн, что уже есть в `snapshot.ts` и
  `packs.ts`. Отдельная от записи пакетов очередь сериализации (`withProfileWriteLock`) — та же
  защита от гонки, что уже есть у `withPackWriteLock` (Веха A), применённая к отдельному
  ресурсу (`profile.md`, не файлы пакетов).
- `id` вопроса в жалобе не редактируется и не запрашивается у человека — только текст жалобы.
  Контекст вопроса сервер достаёт сам, перечитывая пакет по `filename`+`questionId`.
- `filename` защищается тем же `basename(filename) === filename` guard, что уже есть у всех
  остальных `admin-*` хендлеров, работающих с именем файла пакета.
- Переключатель вида по умолчанию — «Список». Переключение вида закрывает любую открытую
  панель (форму правки или панель жалобы) — обе панели существуют только в одном из двух видов
  или должны предсказуемо закрываться при уходе из него.
- Кнопка «Пожаловаться» — только в списке, не в сетке.
- «Отправить» неактивна на пустом/пробельном тексте жалобы — тот же клиентский guard, что уже
  есть у «Сохранить» в форме правки.

---

### Task 1: `server/src/generatorProfile.ts` — атомарное дописывание жалобы

**Files:**

- Create: `server/src/generatorProfile.ts`
- Create: `server/src/generatorProfile.test.ts`

**Interfaces:**

- Consumes: ничего нового — только `node:fs/promises` (`readFile`, `writeFile`, `rename`).
- Produces:

  ```ts
  export interface ComplaintEntry {
    date: string; // 'YYYY-MM-DD', собирается вызывающим кодом
    packFilename: string;
    packTitle: string;
    themeName: string;
    price: number;
    questionText: string;
    answer: string;
    complaint: string;
  }

  export async function appendComplaint(
    profilePath: string,
    entry: ComplaintEntry,
  ): Promise<void>;
  ```

  Используется в Task 2 (`server.ts`).

- [ ] **Step 1: Написать падающие тесты**

Создать `server/src/generatorProfile.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendComplaint, type ComplaintEntry } from './generatorProfile.js';

const ENTRY: ComplaintEntry = {
  date: '2026-08-15',
  packFilename: 'sport.json',
  packTitle: 'Общая эрудиция',
  themeName: 'Спорт',
  price: 300,
  questionText: 'Сколько колец на олимпийском флаге?',
  answer: '5',
  complaint: 'не понравился, потому что слишком просто для такой цены',
};

describe('appendComplaint', () => {
  let dir: string;
  let profilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-generator-profile-'));
    profilePath = join(dir, 'profile.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the section heading on the first complaint and appends the entry', async () => {
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);

    const content = await readFile(profilePath, 'utf8');
    expect(content).toContain('## Жалобы из ручного редактора');
    expect(content).toContain(
      '- **2026-08-15, «Общая эрудиция» (sport.json), тема «Спорт», вопрос за 300:**',
    );
    expect(content).toContain(
      '  «Сколько колец на олимпийском флаге?» (ответ: «5») — не понравился, потому что слишком просто для такой цены',
    );
  });

  it('does not duplicate the heading on a second complaint, and preserves the first entry', async () => {
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);
    await appendComplaint(profilePath, {
      ...ENTRY,
      price: 400,
      complaint: 'вторая жалоба',
    });

    const content = await readFile(profilePath, 'utf8');
    const headingCount =
      content.split('## Жалобы из ручного редактора').length - 1;
    expect(headingCount).toBe(1);
    expect(content).toContain('вопрос за 300');
    expect(content).toContain('вопрос за 400');
    expect(content.indexOf('вопрос за 300')).toBeLessThan(
      content.indexOf('вопрос за 400'),
    );
  });

  it('does not leave a .tmp file behind', async () => {
    await writeFile(profilePath, '# Профиль компании\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);

    await expect(readFile(`${profilePath}.tmp`, 'utf8')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd server
npx vitest run src/generatorProfile.test.ts
```

Expected: FAIL — `generatorProfile.ts` не существует.

- [ ] **Step 3: Реализовать `generatorProfile.ts`**

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';

export interface ComplaintEntry {
  date: string;
  packFilename: string;
  packTitle: string;
  themeName: string;
  price: number;
  questionText: string;
  answer: string;
  complaint: string;
}

const HEADING = '## Жалобы из ручного редактора';

function formatEntry(entry: ComplaintEntry): string {
  return (
    `- **${entry.date}, «${entry.packTitle}» (${entry.packFilename}), ` +
    `тема «${entry.themeName}», вопрос за ${entry.price}:**\n` +
    `  «${entry.questionText}» (ответ: «${entry.answer}») — ${entry.complaint}`
  );
}

/**
 * Дописывает жалобу на вопрос в конец `profilePath` — раздел «Жалобы из
 * ручного редактора» всегда последний в файле (design.md, 2026-08-15), так
 * что «дописать в раздел» здесь буквально «дописать в конец файла». Дата не
 * вычисляется здесь — вызывающий код (server.ts) собирает её сам, чтобы этот
 * модуль оставался чистой функцией без своего обращения к часам.
 *
 * Тот же паттерн атомарной записи, что уже есть в snapshot.ts/packs.ts —
 * temp-файл + rename, не прямая перезапись.
 */
export async function appendComplaint(
  profilePath: string,
  entry: ComplaintEntry,
): Promise<void> {
  const current = await readFile(profilePath, 'utf8');
  const bullet = formatEntry(entry);
  const updated = current.includes(HEADING)
    ? `${current}${bullet}\n`
    : `${current}\n---\n\n${HEADING}\n\n${bullet}\n`;
  const tmpPath = `${profilePath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, profilePath);
}
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/generatorProfile.test.ts
```

Expected: все тесты зелёные.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/generatorProfile.ts src/generatorProfile.test.ts
cd ..
git add server/src/generatorProfile.ts server/src/generatorProfile.test.ts
git commit -m "feat: add atomic complaint-append helper for the generator profile"
```

---

### Task 2: `packs.ts` (поиск вопроса) + протокол + `server.ts` + `index.ts`

**Files:**

- Modify: `server/src/packs.ts`
- Modify: `server/src/packs.test.ts`
- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/server.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `appendComplaint`, `type ComplaintEntry` (`server/src/generatorProfile.js`, Task 1).
- Produces:

  ```ts
  export function findQuestionLocation(
    pack: Pack,
    questionId: string,
  ): { themeName: string; question: Question } | undefined;
  ```

  Новые сообщения протокола (используются в Task 3):

  ```ts
  // ClientMessage
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    }
  // ServerMessage
  | { type: 'admin-report-ack'; filename: string; questionId: string }
  | { type: 'admin-report-error'; filename: string; questionId: string; reason: string }
  ```

  `CreateServerOptions` получает новое **опциональное** поле `profilePath?: string` — опционально
  специально, чтобы не трогать все 17 существующих вызовов `createServer({...})` в
  `server.test.ts`, которым этот путь не нужен: `admin-report-question` на сервере без
  `profilePath` — тихий no-op, тем же принципом, что и невалидный `filename` у остальных
  `admin-*` хендлеров (сервер, не сконфигурированный для жалоб, не может их принять).

- [ ] **Step 1: Написать падающие тесты — `findQuestionLocation` (`packs.test.ts`)**

В `server/src/packs.test.ts` заменить импорт:

```ts
import {
  deleteQuestion,
  findQuestionLocation,
  listAvailablePacks,
  updateQuestion,
} from './packs.js';
```

Добавить в конец файла:

```ts
describe('findQuestionLocation', () => {
  it('returns the theme name and the question object for an existing id', () => {
    const location = findQuestionLocation(VALID_PACK, 'q1');
    expect(location).toEqual({
      themeName: 'Тема',
      question: VALID_PACK.rounds[0].themes[0].questions[0],
    });
  });

  it('returns undefined for an unknown id', () => {
    expect(findQuestionLocation(VALID_PACK, 'ghost')).toBeUndefined();
  });
});
```

(`VALID_PACK` — уже существующая фикстура в этом файле, используемая другими тестами.)

- [ ] **Step 2: Написать падающие тесты — протокол/сервер (`server.test.ts`)**

В `describe('createServer pack editor', ...)` — добавить `profilePath` в `beforeEach` и новые
тесты. Заменить текущий `beforeEach`/`afterEach`:

```ts
let profilePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-'));
  packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-editor-packs-'));
  await writeFile(join(packsDir, 'a.json'), JSON.stringify(PACK_A), 'utf8');
  profilePath = join(dir, 'profile.md');
  await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');
  const room = new Room(undefined, PACK_A, undefined, 'a.json');
  server = createServer({
    room,
    clientDistPath: dir,
    port: 8080,
    packsDir,
    profilePath,
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
```

Добавить в конец `describe('createServer pack editor', ...)`:

```ts
it('admin-report-question appends a complaint to the profile file and acks', async () => {
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({
      type: 'admin-report-question',
      filename: 'a.json',
      questionId: 'a1',
      complaint: 'непонятная формулировка',
    }),
  );
  const reply = await admin.nextMessage();
  expect(reply).toEqual({
    type: 'admin-report-ack',
    filename: 'a.json',
    questionId: 'a1',
  });

  const profileContent = await readFile(profilePath, 'utf8');
  expect(profileContent).toContain('## Жалобы из ручного редактора');
  expect(profileContent).toContain('«Пак А» (a.json)');
  expect(profileContent).toContain('тема «Тема», вопрос за 100');
  expect(profileContent).toContain(
    '«В?» (ответ: «О») — непонятная формулировка',
  );
  admin.ws.close();
});

it('admin-report-question on an unknown question id returns admin-report-error and does not write', async () => {
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({
      type: 'admin-report-question',
      filename: 'a.json',
      questionId: 'ghost',
      complaint: 'жалоба',
    }),
  );
  const reply = await admin.nextMessage();
  expect(reply).toMatchObject({
    type: 'admin-report-error',
    filename: 'a.json',
    questionId: 'ghost',
  });

  const profileContent = await readFile(profilePath, 'utf8');
  expect(profileContent).not.toContain('## Жалобы из ручного редактора');
  admin.ws.close();
});

it('admin-report-question with a path-traversal filename is a silent no-op', async () => {
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({
      type: 'admin-report-question',
      filename: '../a.json',
      questionId: 'a1',
      complaint: 'жалоба',
    }),
  );
  admin.ws.send(JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }));
  const reply = (await admin.nextMessage()) as { type: string };
  expect(reply.type).toBe('admin-pack');
  admin.ws.close();
});

it('two admin-report-question calls in a row both land in the profile file (write-lock)', async () => {
  const admin = await connectAdmin(baseUrl);
  admin.ws.send(
    JSON.stringify({
      type: 'admin-report-question',
      filename: 'a.json',
      questionId: 'a1',
      complaint: 'первая жалоба',
    }),
  );
  admin.ws.send(
    JSON.stringify({
      type: 'admin-report-question',
      filename: 'a.json',
      questionId: 'a2',
      complaint: 'вторая жалоба',
    }),
  );
  await admin.nextMessage();
  await admin.nextMessage();

  const profileContent = await readFile(profilePath, 'utf8');
  expect(profileContent).toContain('первая жалоба');
  expect(profileContent).toContain('вторая жалоба');
  const headingCount =
    profileContent.split('## Жалобы из ручного редактора').length - 1;
  expect(headingCount).toBe(1);
  admin.ws.close();
});
```

- [ ] **Step 3: Прогнать тесты, убедиться, что падают**

```bash
cd server
npx vitest run src/packs.test.ts src/server.test.ts
```

Expected: FAIL — `findQuestionLocation` не существует, новые типы сообщений не определены,
`profilePath` не принимается `createServer`.

- [ ] **Step 4: Реализовать `findQuestionLocation` в `packs.ts`**

Добавить в `server/src/packs.ts`, рядом с уже существующей приватной `findQuestion`:

```ts
/**
 * Как `findQuestion`, но публичная и возвращает ещё и название темы —
 * нужно для жалобы на вопрос (server.ts, admin-report-question), где текст
 * записи требует «тема «…»». Не объединяется с приватной `findQuestion`
 * внутри update/deleteQuestion — та возвращает только вопрос, этой нужен ещё
 * контекст темы, а трогать уже проверенный код ради двух похожих сигнатур
 * не оправдано (YAGNI).
 */
export function findQuestionLocation(
  pack: Pack,
  questionId: string,
): { themeName: string; question: Question } | undefined {
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const found = theme.questions.find((q) => q.id === questionId);
      if (found) return { themeName: theme.name, question: found };
    }
  }
  return undefined;
}
```

- [ ] **Step 5: Расширить протокол**

`server/src/protocol.ts` — `ClientMessage`, добавить после `admin-delete-question`:

```ts
  | { type: 'admin-delete-question'; filename: string; questionId: string }
  // Жалоба на вопрос — список для беглого просмотра (design.md, 2026-08-15).
  // Контекст вопроса (текст/ответ/тема/цена) сервер достаёт сам по
  // filename+questionId, от клиента нужен только текст жалобы.
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    };
```

`ServerMessage`, добавить после `admin-pack-error`:

```ts
  | { type: 'admin-pack-error'; filename: string; reason: string }
  // Отдельные от admin-pack/admin-pack-error — жалоба не редактирует пакет,
  // её ошибка не должна путаться с ошибкой правки вопроса.
  | { type: 'admin-report-ack'; filename: string; questionId: string }
  | {
      type: 'admin-report-error';
      filename: string;
      questionId: string;
      reason: string;
    };
```

- [ ] **Step 6: Реализовать в `server.ts`**

Импорты — добавить `findQuestionLocation` и `appendComplaint`/`type ComplaintEntry`:

```ts
import {
  listAvailablePacks,
  updateQuestion,
  deleteQuestion,
  findQuestionLocation,
} from './packs.js';
import { appendComplaint, type ComplaintEntry } from './generatorProfile.js';
```

`CreateServerOptions` — добавить опциональное поле:

```ts
export interface CreateServerOptions {
  room: Room;
  clientDistPath: string;
  port: number;
  packsDir: string;
  // Опционально: нужен только для admin-report-question. Опционален, чтобы
  // не менять все существующие вызовы createServer в тестах, которым этот
  // путь не нужен вовсе — сервер без него просто не может принимать жалобы
  // (тихий no-op, см. handleReportQuestion).
  profilePath?: string;
}
```

`createServer` — деструктурировать новую опцию:

```ts
export function createServer(options: CreateServerOptions): GameServer {
  const { room, clientDistPath, port, packsDir, profilePath } = options;
```

Заменить существующий `packWriteQueue`/`withPackWriteLock` (сейчас — отдельная переменная и
функция прямо в `createServer`) на общую фабрику, и завести вторую очередь для профиля —
**то же самое поведение**, что уже есть у `withPackWriteLock`, только вынесенное в
переиспользуемую форму, раз теперь есть два независимых ресурса (файлы пакетов и
`profile.md`), которым нужна одна и та же логика сериализации:

```ts
// Сериализует конкурентные записи в один и тот же файл между собой — общий
// паттерн для обоих ресурсов, которые сервер пишет: файлы пакетов
// (updateQuestion/deleteQuestion) и profile.md (appendComplaint). Без
// этого два запроса подряд читают файл до того, как предыдущий успел его
// перезаписать, и один результат теряет правку другого (см. комментарий у
// исходного withPackWriteLock, Веха A) — тот же баг возможен и для
// profile.md, только там вместо потерянной правки вопроса теряется вся
// жалоба целиком. .catch(() => {}) на очереди — не глотает ошибку
// вызывающего (та уже ушла через результат withLock), а не даёт
// отклонённому промису прервать очередь для последующих операций.
function createWriteLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  };
}
const withPackWriteLock = createWriteLock();
const withProfileWriteLock = createWriteLock();
```

(Это заменяет весь текущий блок из пяти строк комментария плюс `let packWriteQueue...`/
`function withPackWriteLock...` — новый код короче и покрывает оба ресурса; поведение
`withPackWriteLock` не меняется, только его определение.)

Новый хендлер — добавить после блока `admin-delete-question`, перед `handleGetPack`:

```ts
if (
  message.type === 'admin-report-question' &&
  typeof message.filename === 'string' &&
  typeof message.questionId === 'string' &&
  typeof message.complaint === 'string'
) {
  await handleReportQuestion(
    message.filename,
    message.questionId,
    message.complaint,
  );
}
```

Функция хендлера — добавить рядом с `handleDeleteQuestion`:

```ts
async function handleReportQuestion(
  filename: string,
  questionId: string,
  complaint: string,
): Promise<void> {
  if (basename(filename) !== filename) return;
  if (!profilePath) return;
  try {
    const pack = await loadPack(join(packsDir, filename));
    const location = findQuestionLocation(pack, questionId);
    if (!location) {
      throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
    }
    const entry: ComplaintEntry = {
      date: new Date().toISOString().slice(0, 10),
      packFilename: filename,
      packTitle: pack.title,
      themeName: location.themeName,
      price: location.question.price,
      questionText: location.question.text,
      answer: location.question.answer,
      complaint,
    };
    await withProfileWriteLock(() => appendComplaint(profilePath, entry));
    send(ws, { type: 'admin-report-ack', filename, questionId });
  } catch (err) {
    send(ws, {
      type: 'admin-report-error',
      filename,
      questionId,
      reason: adminPackErrorReason(err),
    });
  }
}
```

- [ ] **Step 7: Подключить `profilePath` в `index.ts`**

Добавить рядом с существующими `PACK_PATH`/`LAN_HOST_CONFIG_PATH`:

```ts
const PROFILE_PATH =
  process.env.PROFILE_PATH ?? './docs/pack-generator-profile.md';
```

В вызове `createServer` добавить поле:

```ts
const { httpServer } = createServer({
  room,
  clientDistPath: CLIENT_DIST_PATH,
  port: PORT,
  packsDir: PACKS_DIR,
  profilePath: PROFILE_PATH,
});
```

- [ ] **Step 8: Прогнать тесты снова**

```bash
cd server
npx vitest run
```

Expected: весь пакет тестов сервера зелёный (включая все существующие 17 мест, вызывающих
`createServer` без `profilePath`, — поле опционально, ничего у них не ломается).

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/packs.ts src/packs.test.ts src/protocol.ts src/server.ts src/server.test.ts src/index.ts
cd ..
git add server/src/packs.ts server/src/packs.test.ts server/src/protocol.ts server/src/server.ts server/src/server.test.ts server/src/index.ts
git commit -m "feat: wire admin-report-question into the protocol and server"
```

---

### Task 3: `useAdminConnection.ts` — клиентский метод жалобы

**Files:**

- Modify: `client/src/useAdminConnection.ts`
- Modify: `client/src/useAdminConnection.test.ts`

**Interfaces:**

- Consumes: изменения протокола из Task 2 (зеркалятся локально, тот же принцип, что и у всего
  остального в этом хуке).
- Produces:

  ```ts
  interface AdminConnection {
    // ...существующие поля...
    reportError: string | null;
    // Увеличивается на каждое входящее admin-report-ack — тот же приём, что
    // уже есть у editedPackVersion, чтобы Admin.tsx мог отличить «пришёл
    // ack именно на мою жалобу» от «пришёл ack на чужую», не сравнивая
    // содержимое.
    reportAckVersion: number;
    clearReportError(): void;
    reportQuestion(
      filename: string,
      questionId: string,
      complaint: string,
    ): void;
  }
  ```

  Используется в Task 4 (`Admin.tsx`).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/useAdminConnection.test.ts`, в конец файла:

```ts
it('sends admin-report-question with the complaint text', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    result.current.reportQuestion('a.json', 'q1', 'непонятная формулировка'),
  );
  expect(socket.sent).toContainEqual(
    JSON.stringify({
      type: 'admin-report-question',
      filename: 'a.json',
      questionId: 'q1',
      complaint: 'непонятная формулировка',
    }),
  );
});

it('increments reportAckVersion and clears reportError on admin-report-ack', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    socket.emitMessage({
      type: 'admin-report-error',
      filename: 'a.json',
      questionId: 'q1',
      reason: 'ошибка',
    }),
  );
  expect(result.current.reportError).toBe('ошибка');

  act(() =>
    socket.emitMessage({
      type: 'admin-report-ack',
      filename: 'a.json',
      questionId: 'q1',
    }),
  );
  expect(result.current.reportError).toBeNull();
  expect(result.current.reportAckVersion).toBe(1);
});

it('surfaces the reason from admin-report-error', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    socket.emitMessage({
      type: 'admin-report-error',
      filename: 'a.json',
      questionId: 'q1',
      reason: 'вопрос с таким id не найден',
    }),
  );
  expect(result.current.reportError).toBe('вопрос с таким id не найден');
});

it('clearReportError resets reportError locally without waiting for the server', () => {
  const { result } = renderHook(() => useAdminConnection(factory));
  const socket = FakeWebSocket.instances[0];
  act(() => socket.emitOpen());

  act(() =>
    socket.emitMessage({
      type: 'admin-report-error',
      filename: 'a.json',
      questionId: 'q1',
      reason: 'ошибка',
    }),
  );
  act(() => result.current.clearReportError());
  expect(result.current.reportError).toBeNull();
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd client
npx vitest run src/useAdminConnection.test.ts
```

Expected: FAIL — `reportQuestion`/`reportError`/`reportAckVersion`/`clearReportError` не
существуют.

- [ ] **Step 3: Реализовать в `useAdminConnection.ts`**

`ServerMessage` (локальный тип) — добавить после `admin-pack-error`:

```ts
  | { type: 'admin-pack-error'; filename: string; reason: string }
  | { type: 'admin-report-ack'; filename: string; questionId: string }
  | {
      type: 'admin-report-error';
      filename: string;
      questionId: string;
      reason: string;
    };
```

`ClientMessage` (локальный тип) — добавить после `admin-delete-question`:

```ts
  | { type: 'admin-delete-question'; filename: string; questionId: string }
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    };
```

`AdminConnection` — добавить после `deleteQuestion`:

```ts
  deleteQuestion(filename: string, questionId: string): void;
  reportError: string | null;
  reportAckVersion: number;
  clearReportError(): void;
  reportQuestion(filename: string, questionId: string, complaint: string): void;
```

Новый локальный стейт, рядом с `editedPackError`/`editedPackVersion`:

```ts
const [reportError, setReportError] = useState<string | null>(null);
const [reportAckVersion, setReportAckVersion] = useState(0);
```

Обработка входящих сообщений — добавить после блока `if (message.type === 'admin-pack-error')`:

```ts
if (message.type === 'admin-report-ack') {
  setReportError(null);
  setReportAckVersion((v) => v + 1);
}
if (message.type === 'admin-report-error') {
  setReportError(message.reason);
}
```

Возвращаемый объект — добавить после `deleteQuestion`:

```ts
    deleteQuestion: (filename, questionId) =>
      send({ type: 'admin-delete-question', filename, questionId }),
    reportError,
    reportAckVersion,
    clearReportError: () => setReportError(null),
    reportQuestion: (filename, questionId, complaint) =>
      send({ type: 'admin-report-question', filename, questionId, complaint }),
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
git commit -m "feat: add reportQuestion to useAdminConnection"
```

---

### Task 4: `Admin.tsx` — переключатель вида, список, панель жалобы

**Files:**

- Modify: `client/src/Admin.tsx`
- Modify: `client/src/Admin.test.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: `reportError`, `reportAckVersion`, `clearReportError`, `reportQuestion`
  (`client/src/useAdminConnection.ts`, Task 3).
- Produces: ничего наружу — конечный экран.

- [ ] **Step 1: Написать падающие тесты**

В `client/src/Admin.test.tsx` — добавить в `connection()`-хелпер (после `deleteQuestion:
vi.fn(),`):

```ts
    deleteQuestion: vi.fn(),
    reportError: null,
    reportAckVersion: 0,
    clearReportError: vi.fn(),
    reportQuestion: vi.fn(),
```

Новый `describe`-блок в конец файла (использует ту же фикстуру `PACK`, что уже определена в
`describe('Admin — редактор пакета', ...)` — переиспользовать её, добавив второй вопрос, чтобы
список показывал больше одной строки):

```ts
describe('Admin — список и жалобы', () => {
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
              {
                id: 'q2',
                price: 200,
                text: 'Второй вопрос?',
                answer: 'Второй ответ',
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };

  async function openEditor() {
    render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
  }

  it('shows the list view by default, with a "Пожаловаться" button per question', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    expect(screen.getByText('Вопрос?')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /пожаловаться/i }),
    ).toHaveLength(2);
  });

  it('switches to the grid when the "Сетка" radio is picked, hiding "Пожаловаться"', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    expect(
      screen.queryByRole('button', { name: /пожаловаться/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100' })).toBeInTheDocument();
  });

  it('opens the edit form from a list row click, not the complaint button', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByText('Вопрос?'));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();
  });

  it('opens the complaint panel and closes any open edit form', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    await userEvent.click(screen.getByText('Вопрос?'));
    expect(screen.getByDisplayValue('Вопрос?')).toBeInTheDocument();

    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    expect(screen.queryByDisplayValue('Вопрос?')).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/что не понравилось/i),
    ).toBeInTheDocument();
  });

  it('disables "Отправить" on empty text and calls reportQuestion with the typed complaint', async () => {
    const reportQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportQuestion,
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);

    const sendButton = screen.getByRole('button', { name: /отправить/i });
    expect(sendButton).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/что не понравилось/i),
      'слишком просто',
    );
    expect(sendButton).toBeEnabled();
    await userEvent.click(sendButton);
    expect(reportQuestion).toHaveBeenCalledWith(
      'a.json',
      'q1',
      'слишком просто',
    );
  });

  it('closes the complaint panel once a matching reportAckVersion arrives', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportAckVersion: 0,
      }),
    );
    const { rerender } = render(<Admin />);
    await userEvent.click(
      screen.getByRole('button', { name: /редактировать/i }),
    );
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.type(
      screen.getByLabelText(/что не понравилось/i),
      'текст',
    );
    await userEvent.click(screen.getByRole('button', { name: /отправить/i }));

    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportAckVersion: 1,
      }),
    );
    rerender(<Admin />);
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
  });

  it('shows reportError as an alert and keeps the panel open', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportError: 'вопрос с таким id не найден',
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /вопрос с таким id не найден/i,
    );
    expect(
      screen.getByLabelText(/что не понравилось/i),
    ).toBeInTheDocument();
  });

  it('"Отмена" closes the complaint panel without calling reportQuestion', async () => {
    const reportQuestion = vi.fn();
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
        reportQuestion,
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.click(screen.getByRole('button', { name: /отмена/i }));
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
    expect(reportQuestion).not.toHaveBeenCalled();
  });

  it('switching view mode closes an open complaint panel', async () => {
    mockedUseAdminConnection.mockReturnValue(
      connection({
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        editedPack: PACK,
        editedPackFilename: 'a.json',
      }),
    );
    await openEditor();
    const complainButtons = screen.getAllByRole('button', {
      name: /пожаловаться/i,
    });
    await userEvent.click(complainButtons[0]);
    await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));
    expect(
      screen.queryByLabelText(/что не понравилось/i),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd client
npx vitest run src/Admin.test.tsx
```

Expected: FAIL — переключателя вида, списка и панели жалобы ещё нет.

- [ ] **Step 3: Реализовать в `Admin.tsx`**

Деструктуризация `useAdminConnection()` — добавить после `deleteQuestion,`:

```ts
    deleteQuestion,
    reportError,
    reportAckVersion,
    clearReportError,
    reportQuestion,
  } = useAdminConnection();
```

Новый локальный стейт — рядом с `confirmingDelete`:

```ts
const [confirmingDelete, setConfirmingDelete] = useState(false);
// Вид редактора: 'list' по умолчанию — беглый просмотр запрошен как
// основной сценарий входа (design.md, 2026-08-15).
const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
const [complainingQuestionId, setComplainingQuestionId] = useState<
  string | null
>(null);
const [complaintText, setComplaintText] = useState('');
// Тот же приём, что pendingSaveVersionRef у формы правки: версия
// reportAckVersion, зафиксированная в момент клика «Отправить» — эффект
// ниже закрывает панель жалобы только когда пришёл ack именно на эту
// жалобу, не на чужую (см. openComplaintPanel/handleSubmitComplaint).
const pendingReportVersionRef = useRef<number | null>(null);
```

Новый эффект — рядом с уже существующим эффектом на `editedPackVersion`:

```ts
useEffect(() => {
  if (
    pendingReportVersionRef.current !== null &&
    reportAckVersion > pendingReportVersionRef.current
  ) {
    pendingReportVersionRef.current = null;
    setComplainingQuestionId(null);
    setComplaintText('');
  }
}, [reportAckVersion]);
```

`openQuestionForm` — добавить закрытие панели жалобы (мьютекс между формой правки и жалобой):

```ts
function openQuestionForm(question: Question): void {
  setEditingQuestionId(question.id);
  setFormPrice(String(question.price));
  setFormText(question.text);
  setFormAnswer(question.answer);
  setFormComment(question.comment ?? '');
  setFormType(question.type);
  setConfirmingDelete(false);
  clearPackError();
  pendingSaveVersionRef.current = null;
  // Форма правки и панель жалобы взаимоисключающие — открытие одной
  // закрывает другую (design.md, «Правило»).
  setComplainingQuestionId(null);
}

function openComplaintPanel(questionId: string): void {
  setComplainingQuestionId(questionId);
  setComplaintText('');
  clearReportError();
  pendingReportVersionRef.current = null;
  // Симметрично openQuestionForm — открытие панели жалобы закрывает
  // форму правки, если та была открыта.
  setEditingQuestionId(null);
}

function handleSubmitComplaint(): void {
  if (!editingFilename || !complainingQuestionId) return;
  pendingReportVersionRef.current = reportAckVersion;
  reportQuestion(editingFilename, complainingQuestionId, complaintText);
}

function handleViewModeChange(mode: 'grid' | 'list'): void {
  setViewMode(mode);
  // Переключение вида закрывает любую открытую панель — «Пожаловаться»
  // существует только в списке, а форма правки закрывается для
  // симметрии, чтобы переключение вида было предсказуемым «чистым»
  // действием в обе стороны (design.md, «Правило»).
  setEditingQuestionId(null);
  setComplainingQuestionId(null);
}

const isValidComplaint = complaintText.trim() !== '';
```

(`openQuestionForm`/`handleSaveQuestion`/`questionStillExists`/`isValidForm` — уже существуют,
меняется только тело `openQuestionForm`, добавляющее одну строку `setComplainingQuestionId(null);`
в конец.)

Разметка — заменить блок переключателя-и-содержимого редактора. Текущий фрагмент:

```tsx
            {editedPackError && (
              <p className="player-alert" role="alert">
                {editedPackError}
              </p>
            )}
            {editedPackFilename === editingFilename && editedPack ? (
              <>
                {editedPack.rounds.map((round, ri) => (
                  <div key={ri} className="pack-editor-round">
                    <h3>Раунд {ri + 1}</h3>
                    {round.themes.map((theme, ti) => (
                      <div key={ti} className="pack-editor-theme">
                        <span className="pack-editor-theme-name">
                          {theme.name}
                        </span>
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
                {questionStillExists && (
                  <div className="pack-editor-form">
```

Заменить на:

```tsx
            {editedPackError && (
              <p className="player-alert" role="alert">
                {editedPackError}
              </p>
            )}
            {editedPackFilename === editingFilename && editedPack ? (
              <>
                <div
                  className="pack-editor-view-toggle"
                  role="radiogroup"
                  aria-label="Вид редактора"
                >
                  <label>
                    <input
                      type="radio"
                      name="pack-editor-view"
                      checked={viewMode === 'list'}
                      onChange={() => handleViewModeChange('list')}
                    />
                    Список
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pack-editor-view"
                      checked={viewMode === 'grid'}
                      onChange={() => handleViewModeChange('grid')}
                    />
                    Сетка
                  </label>
                </div>
                {editedPack.rounds.map((round, ri) => (
                  <div key={ri} className="pack-editor-round">
                    <h3>Раунд {ri + 1}</h3>
                    {round.themes.map((theme, ti) => (
                      <div key={ti} className="pack-editor-theme">
                        <span className="pack-editor-theme-name">
                          {theme.name}
                        </span>
                        {viewMode === 'grid' ? (
                          theme.questions.map((q) => (
                            <button
                              key={q.id}
                              className="button"
                              onClick={() => openQuestionForm(q)}
                            >
                              {q.price}
                            </button>
                          ))
                        ) : (
                          <ul className="pack-editor-list">
                            {theme.questions.map((q) => (
                              <li key={q.id} className="pack-editor-list-row">
                                <button
                                  className="button pack-editor-list-question"
                                  onClick={() => openQuestionForm(q)}
                                >
                                  <span className="pack-editor-list-price">
                                    {q.price}
                                  </span>
                                  <span className="pack-editor-list-text">
                                    {q.text}
                                  </span>
                                </button>
                                <button
                                  className="button button--no"
                                  onClick={() => openComplaintPanel(q.id)}
                                >
                                  Пожаловаться
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {complainingQuestionId && (
                  <div className="pack-editor-complaint">
                    {reportError && (
                      <p className="player-alert" role="alert">
                        {reportError}
                      </p>
                    )}
                    <label htmlFor="pack-editor-complaint-text">
                      Что не понравилось
                    </label>
                    <textarea
                      id="pack-editor-complaint-text"
                      value={complaintText}
                      onChange={(e) => setComplaintText(e.target.value)}
                    />
                    <div className="admin-actions">
                      <button
                        className="button button--primary"
                        onClick={handleSubmitComplaint}
                        disabled={!isValidComplaint}
                      >
                        Отправить
                      </button>
                      <button
                        className="button"
                        onClick={() => setComplainingQuestionId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
                {questionStillExists && (
                  <div className="pack-editor-form">
```

Остальная часть формы правки (поля цены/текста/ответа/комментария/типа, кнопки «Сохранить»/
«Удалить», закрывающие теги) — без изменений, только новый блок панели жалобы вставляется
перед уже существующим `{questionStillExists && (<div className="pack-editor-form">`.

- [ ] **Step 4: Поправить существующие тесты сетки под новый вид по умолчанию**

По умолчанию теперь открывается список, а не сетка — `PACK` в `describe('Admin — редактор
пакета', ...)` содержит один вопрос с текстом `'Вопрос?'`, и в списке кнопка вопроса объединяет
цену и текст в одну кнопку (её доступное имя — `'100 Вопрос?'`, не просто `'100'`), поэтому
`screen.getByRole('button', { name: '100' })` в этих тестах перестанет что-либо находить.

Добавить строку `await userEvent.click(screen.getByRole('radio', { name: /сетка/i }));` в
каждый из следующих тестов этого `describe`-блока — сразу после первого клика по
«Редактировать» (`await userEvent.click(screen.getByRole('button', { name: /редактировать/i
}));`), либо сразу после ближайшего `rerender(<Admin />);`, если он идёт раньше первого
обращения к кнопке `'100'` в этом тесте. `viewMode` — локальный React-стейт компонента
`Admin`, а `rerender` не размонтирует его, так что один клик по radio в начале теста
переживает все последующие `rerender` в том же тесте:

- `'renders the grid once the pack arrives, with a button per question price'` — после
  `rerender(<Admin />);` (первого в этом тесте), перед `expect(screen.getByText('Тема'))`.
- `'opens the edit form with the question’s current values on price click'` — после клика по
  «Редактировать», перед `await userEvent.click(screen.getByRole('button', { name: '100' }))`.
- `'calls updateQuestion with the edited values and the fixed questionId on save'` — то же
  место.
- `'disables "Сохранить" for an invalid price or empty text'` — то же место.
- `'shows the error from editedPackError and keeps the form open'` — то же место.
- `'requires clicking "Удалить" twice before it actually deletes the question'` — то же место.
- `'closes the form after a successful delete, once editedPack no longer contains the question'`
  — то же место (после клика «Редактировать», перед первым обращением к кнопке `'100'`).
- `'closes the form after a successful save, once a new editedPackVersion arrives'` — то же
  место.

`'shows the pack grid after clicking "Редактировать"'` — не трогать: он не обращается к кнопке
`'100'` вовсе, только проверяет вызов `getPack`.

- [ ] **Step 5: Прогнать тесты снова**

```bash
npx vitest run src/Admin.test.tsx
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 6: Добавить стили**

`client/src/index.css` — новые классы в конец файла:

```css
.pack-editor-view-toggle {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.pack-editor-view-toggle label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pack-editor-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 100%;
  list-style: none;
  margin: 0;
  padding: 0;
}

.pack-editor-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pack-editor-list-question {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  text-align: left;
}

.pack-editor-list-price {
  font-family: var(--mono);
  min-width: 40px;
  font-weight: 600;
}

.pack-editor-list-text {
  flex: 1;
}

.pack-editor-complaint {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 500px;
}

.pack-editor-complaint textarea {
  min-height: 60px;
  font: inherit;
}
```

- [ ] **Step 7: Полная проверка проекта**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: всё зелёное.

- [ ] **Step 8: Commit**

```bash
git add client/src/Admin.tsx client/src/Admin.test.tsx client/src/index.css
git commit -m "feat: add list view and per-question complaints to the pack editor"
```

---

### Task 5: `pack-generator` читает жалобы

**Files:**

- Modify: `.claude/skills/pack-generator/SKILL.md`
- Modify: `docs/pack-generator-profile.md`

**Interfaces:** нет — правки промпта/документации, кода не меняют.

- [ ] **Step 1: Обновить `docs/pack-generator-profile.md`**

В начале файла, там, где уже перечислены «Ручные заметки (сейчас)» и «Автособранное (будет
позже)», добавить третий пункт после них:

```markdown
- **Жалобы из ручного редактора.** Раздел в конце файла, который сервер дописывает сам при
  клике «Пожаловаться» в `/admin` (см. `docs/superpowers/specs/2026-08-15-pack-editor-list-and-complaints-design.md`)
  — контекст вопроса подставляется автоматически, без участия человека. Генератор при
  разборе (Шаг 0 `pack-generator/SKILL.md`) переносит уже учтённые жалобы в «Ручные заметки»
  и убирает их из этого раздела, чтобы он не рос бесконечно повторами.
```

- [ ] **Step 2: Обновить Шаг 0 в `.claude/skills/pack-generator/SKILL.md`**

Заменить текущий блок Шага 0:

```markdown
- Разделы **«Ручные заметки → Брак»** и **«Ручные заметки → Калибровка сложности»** —
  учитывать при написании вопросов (Шаг 3, Шаг 4) и при финальной проверке (Шаг 6): это
  конкретные, уже пойманные ошибки формулировок и калибровки цены, которые нельзя повторять.
- Разделы **«Ручные заметки → Вкус»** и **«Автособранное»** — учитывать при выборе тем
  (Шаг 1), если там уже есть содержательные записи.
```

На:

```markdown
- Разделы **«Ручные заметки → Брак»** и **«Ручные заметки → Калибровка сложности»** —
  учитывать при написании вопросов (Шаг 3, Шаг 4) и при финальной проверке (Шаг 6): это
  конкретные, уже пойманные ошибки формулировок и калибровки цены, которые нельзя повторять.
- Разделы **«Ручные заметки → Вкус»** и **«Автособранное»** — учитывать при выборе тем
  (Шаг 1), если там уже есть содержательные записи.
- Раздел **«Жалобы из ручного редактора»** (в конце файла, если есть) — читать наравне с
  «Ручными заметками»: каждая запись уже содержит текст вопроса, ответ, тему и цену, так что
  дополнительно ничего искать не нужно. Если урок из жалобы уже применим как общее правило —
  обобщить его в подходящий раздел «Ручных заметок» (по тому же принципу, что и разбор
  сгенерированных паков) и убрать эту запись из «Жалоб из ручного редактора» при следующей
  правке файла — иначе раздел будет расти одинаковыми повторами. Жалоба, которая ещё не
  обобщена, не блокирует генерацию — просто учитывается как есть, пока не появится время её
  разобрать.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/pack-generator/SKILL.md docs/pack-generator-profile.md
git commit -m "docs: teach pack-generator to read and archive editor complaints"
```

---

## После плана

Живая проверка: открыть `/admin`, зайти в редактор пакета (список должен открыться сразу),
переключиться на сетку и обратно, пожаловаться на пару вопросов, проверить, что
`docs/pack-generator-profile.md` действительно обновился и остался читаемым. Затем в следующий
раз, когда будет генерироваться новый пакет — убедиться, что `pack-generator` реально
подхватывает жалобы на Шаге 0 без напоминания.
