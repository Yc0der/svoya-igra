# Вопросы с картинками — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вопрос в паке может нести необязательную картинку (`Question.image`); сервер
раздаёт файлы из `packs/media/`, табло (`Board.tsx`) показывает картинку рядом с текущим
вопросом (телефоны игроков — нет); `validate-pack.ts` предупреждает, если картинка указана,
а файла нет; `pack-generator` учится решать, когда картинка оправдана, искать и скачивать её
из Wikimedia Commons/Openverse и проверять результат перед тем, как прикрепить.

**Architecture:** `Question.image?: string` — просто имя файла, сервер сам собирает полный
URL как `/media/<пак-без-.json>/<image>` в `Room.toGameStateView` (та же видимость, что уже
есть у `text`). Новый статический маршрут в `server.ts` (`sirv`, тот же паттерн, что уже
раздаёт клиентские файлы), смонтированный на `packsDir/media` под префиксом `/media/`.
Поиск/скачивание/проверка картинки — не код, а инструкция для `pack-generator/SKILL.md`
(агентный процесс, тот же принцип, что уже применён к обработке жалоб на Шаге 0).

**Tech Stack:** TypeScript/Node на сервере, React на клиенте — без изменений в стеке.

## Global Constraints

- Картинка допускается только в одном из двух случаев (design.md, «Правило»): (1) вопрос —
  часть целого раунда/темы картиночных вопросов, картинка — само содержание; (2) точечный
  вопрос в обычном раунде, где без картинки вопрос нельзя нормально задать. Не украшение и
  не подсказка, срезающая путь к ответу.
- Источники поиска — Wikimedia Commons (основной), затем Openverse (резервный), оба без API-
  ключей. Unsplash/Pexels/Pixabay не подключаются в этой вехе.
- Файл живёт по адресу `packs/media/<имя-пака-без-.json>/<image>`. В `Question.image`
  хранится только имя файла, без пути — сервер сам разрешает полный путь/URL.
- Показывается **только на табло** (`Board.tsx`) — `Player.tsx`/телефоны картинку не
  получают.
- `pack.ts`'s `validatePack`/`validateQuestion` проверяют только тип/непустоту строки —
  **не** существование файла на диске: это отдельная, более дорогая проверка, нужная только
  генератору (Шаг 6), не живому серверу на каждой загрузке пака.
- Финал (`pack.final`) картинки не получает в этой вехе — `FinalTheme['question']` не
  меняется. Тот же принцип, что уже применён к правкам Вехи A редактора пакетов («финал не
  трогаем»/не расширяем без явной необходимости).
- `validate-pack.ts` при отсутствующем файле картинки **предупреждает, но не роняет
  валидацию** — пак всё равно засчитывается готовым (design.md, «Валидация при генерации»).

---

### Task 1: `server/src/pack.ts` — поле `image` и проверка наличия файлов

**Files:**

- Modify: `server/src/pack.ts`
- Modify: `server/src/pack.test.ts`

**Interfaces:**

- Consumes: ничего нового — `node:fs/promises` (`access`), `node:path` (`join`).
- Produces:
  ```ts
  export interface Question {
    id: string;
    price: number;
    text: string;
    answer: string;
    comment?: string;
    type: 'обычный' | 'кот' | 'аукцион';
    image?: string; // имя файла, без пути
  }

  export interface MissingMedia {
    questionId: string;
    image: string;
  }

  export async function findMissingMedia(
    pack: Pack,
    mediaDir: string,
  ): Promise<MissingMedia[]>;
  ```
  `image` на `Question` используется в Task 2 (`room.ts`) и Task 3 (клиент). `findMissingMedia`
  используется в Task 4 (`validate-pack.ts`).

- [ ] **Step 1: Написать падающие тесты**

Добавить в `server/src/pack.test.ts`, после блока тестов про `comment` (после теста
`'accepts a question with an optional comment'`):

```ts
  it('accepts a question with an optional image', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { image?: string }).image =
      'eiffel-tower.jpg';
    expect(validatePack(data).rounds[0].themes[0].questions[0].image).toBe(
      'eiffel-tower.jpg',
    );
  });

  it('accepts a question with no image at all', () => {
    const data = validPackData();
    expect(validatePack(data).rounds[0].themes[0].questions[0].image).toBeUndefined();
  });

  it('rejects a non-string image when present', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { image?: unknown }).image = 123;
    expect(() => validatePack(data)).toThrow(/image/);
  });

  it('rejects an empty string image', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { image?: string }).image = '';
    expect(() => validatePack(data)).toThrow(/image/);
  });
```

Добавить новый `describe`-блок в конец файла:

```ts
describe('findMissingMedia', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list when no question has an image', async () => {
    const pack = validatePack(validPackData());
    expect(await findMissingMedia(pack, dir)).toEqual([]);
  });

  it('returns an empty list when the referenced file exists', async () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { image?: string }).image =
      'exists.jpg';
    const pack = validatePack(data);
    await writeFile(join(dir, 'exists.jpg'), 'fake image bytes', 'utf8');
    expect(await findMissingMedia(pack, dir)).toEqual([]);
  });

  it('reports a question whose image file is missing', async () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { image?: string }).image =
      'missing.jpg';
    const pack = validatePack(data);
    expect(await findMissingMedia(pack, dir)).toEqual([
      { questionId: 'q1', image: 'missing.jpg' },
    ]);
  });
});
```

`mkdtemp`/`tmpdir`/`writeFile`/`rm`/`join` уже импортированы в начале файла (используются
более ранним тестом «the real packs/current.json») — новых импортов из `node:fs/promises`/
`node:os`/`node:path` не требуется. Единственная нужная правка импорта — добавить
`findMissingMedia` в уже существующую строку:

```ts
import { findMissingMedia, loadPack, validatePack } from './pack.js';
```

(заменяет текущую `import { loadPack, validatePack } from './pack.js';`).

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd server
npx vitest run src/pack.test.ts
```

Expected: FAIL — `image` не принимается `validateQuestion`, `findMissingMedia` не существует.

- [ ] **Step 3: Реализовать в `pack.ts`**

Импорты — добавить в начало файла:

```ts
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
```

(Заменяет текущую строку `import { readFile } from 'node:fs/promises';`.)

`Question` — добавить поле:

```ts
export interface Question {
  id: string;
  price: number;
  text: string;
  answer: string;
  comment?: string;
  type: 'обычный' | 'кот' | 'аукцион';
  // Правило.md, «Правило» — имя файла без пути; полный путь/URL собирает
  // сервер (room.ts) как `/media/<пак>/<image>`. Только основной раунд —
  // финал (FinalTheme.question) картинок не получает в этой вехе.
  image?: string;
}
```

`validateQuestion` — добавить проверку перед `return`:

```ts
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
  let image: string | undefined;
  if (question.image !== undefined) {
    image = requireNonEmptyString(question.image, `${where}.image`);
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
    image,
    type: type as Question['type'],
  };
}
```

Новая функция — добавить в конец файла, после `loadPack`:

```ts
/**
 * Для каждого вопроса с `image` — существует ли файл `<mediaDir>/<image>`.
 * Возвращает список вопросов, для которых файла нет. Не используется живым
 * игровым сервером — только генератором (см. `scripts/validate-pack.ts`,
 * design.md «Валидация при генерации»): лишний I/O на каждый вопрос каждого
 * пака при обычной загрузке не нужен.
 */
export async function findMissingMedia(
  pack: Pack,
  mediaDir: string,
): Promise<MissingMedia[]> {
  const missing: MissingMedia[] = [];
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (!question.image) continue;
        try {
          await access(join(mediaDir, question.image));
        } catch {
          missing.push({ questionId: question.id, image: question.image });
        }
      }
    }
  }
  return missing;
}
```

`MissingMedia` — добавить рядом с остальными интерфейсами (после `Question`):

```ts
export interface MissingMedia {
  questionId: string;
  image: string;
}
```

- [ ] **Step 4: Прогнать тесты снова**

```bash
npx vitest run src/pack.test.ts
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/pack.ts src/pack.test.ts
cd ..
git add server/src/pack.ts server/src/pack.test.ts
git commit -m "feat: add optional question images to the pack format"
```

---

### Task 2: Протокол, `room.ts`, статический маршрут `/media/`

**Files:**

- Modify: `server/src/protocol.ts`
- Modify: `server/src/room.ts`
- Modify: `server/src/room.test.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `Question.image` (`server/src/pack.js`, Task 1).
- Produces: `GameStateView.currentQuestion.image: string | null` — используется в Task 3
  (клиент).

- [ ] **Step 1: Расширить протокол**

`server/src/protocol.ts` — `GameStateView.currentQuestion`, заменить:

```ts
  currentQuestion: {
    text: string | null;
    price: number;
    themeName: string;
  } | null;
```

на:

```ts
  currentQuestion: {
    text: string | null;
    price: number;
    themeName: string;
    // Готовый относительный URL картинки (`/media/<пак>/<файл>`) или null,
    // если у вопроса нет картинки. Та же видимость, что у text — null во
    // время cat-handoff/торгов, пока получатель/победитель ещё не
    // определён (design.md, 2026-08-16, «Сервер и клиент»).
    image: string | null;
  } | null;
```

- [ ] **Step 2: Написать падающие тесты — `room.test.ts`**

Пять существующих мест уже сравнивают `currentQuestion` через `toEqual({...})` без поля
`image` — они станут падать сами по себе, как только Step 4 добавит `image` в реальный
вывод (это и есть падающий тест для этой части задачи, отдельного нового теста для самого
факта появления поля не требуется). Поправить сейчас, до реализации, дописав `image: null,`
в каждый из них — так, когда Step 4 добавит поле в `room.ts`, они сразу пройдут, без
промежуточного «специально красного» состояния:

1. `expect(room.toGameStateView()?.currentQuestion).toEqual({ text: 'Вопрос 1?', price: 100, themeName: 'Тема' });` (тест `'walks a question from selection through a correct answer'`, `describe('Room game flow', ...)`) → добавить `image: null,` после `themeName: 'Тема',`.
2. `expect(room.toGameStateView()?.currentQuestion).toEqual({ text: null, price: 100, themeName: 'Тема' });` (кот, до `assignCat`) → добавить `image: null,`.
3. `expect(room.toGameStateView()?.currentQuestion).toEqual({ text: 'Вопрос-кот?', price: 100, themeName: 'Тема' });` (кот, после `assignCat`) → добавить `image: null,`.
4. `expect(room.toGameStateView()?.currentQuestion).toEqual({ text: null, price: 100, themeName: 'Тема' });` (аукцион, во время торгов, сразу после `expect(room.toGameStateView()!.currentQuestion!.text).toBeNull();`) → добавить `image: null,`.

(Пятое место, `expect(room.toGameStateView()!.currentQuestion!.text).toBe('Вопрос-аукцион?');` — точечный доступ к `.text`, не целому объекту, не требует правки.)

Добавить новый тест в `describe('Room game flow', ...)`, рядом с тестом `'walks a question
from selection through a correct answer'` — построен на уже существующих в этом файле
`TEST_PACK`/`joinedId`/`startedRoom()` (`TEST_PACK` — пак с `q1`/`q2` в одной теме
`'Тема'`, `joinedId(room, name)` присоединяет участника и возвращает его id, `startedRoom()`
— то же самое плюс `startGame()`, но без имени файла, поэтому для теста с картинкой партия
собирается вручную, чтобы передать `'sport.json'` четвёртым аргументом конструктора):

```ts
  it('exposes the media URL for a question with an image, built from the active pack filename', () => {
    const packWithImage: Pack = {
      ...TEST_PACK,
      rounds: [
        {
          themes: [
            {
              name: 'Тема',
              questions: [
                {
                  ...TEST_PACK.rounds[0].themes[0].questions[0],
                  image: 'photo.jpg',
                },
                TEST_PACK.rounds[0].themes[0].questions[1],
              ],
            },
          ],
        },
      ],
    };
    const room = new Room(undefined, packWithImage, undefined, 'sport.json');
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame('requester');
    const picker = room.toGameStateView()!.turnParticipantId;
    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.currentQuestion?.image).toBe(
      '/media/sport/photo.jpg',
    );
  });

  it('does not build a media URL for a question without an image', () => {
    const { room, picker } = startedRoom();
    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.currentQuestion?.image).toBeNull();
  });
```

- [ ] **Step 3: Написать падающие тесты — статический маршрут (`server.test.ts`)**

Добавить новый `describe`-блок в конец `server.test.ts`:

```ts
describe('createServer media static route', () => {
  let server: GameServer;
  let dir: string;
  let packsDir: string;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-route-'));
    packsDir = await mkdtemp(join(tmpdir(), 'svoya-igra-media-route-packs-'));
    const mediaDir = join(packsDir, 'media', 'sport');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'photo.jpg'), 'fake image bytes', 'utf8');
    const room = new Room();
    server = createServer({ room, clientDistPath: dir, port: 8080, packsDir });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    await rm(packsDir, { recursive: true, force: true });
  });

  it('serves a file under packs/media/ at /media/', async () => {
    const res = await fetch(`${baseUrl}/media/sport/photo.jpg`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('fake image bytes');
  });

  it('returns 404 for a media path that does not exist, not the client SPA fallback', async () => {
    const res = await fetch(`${baseUrl}/media/sport/ghost.jpg`);
    expect(res.status).toBe(404);
  });
});
```

`mkdir` — добавить в импорт из `node:fs/promises` в начале файла (сейчас там уже есть
`mkdtemp, readFile, rm, writeFile`).

- [ ] **Step 4: Прогнать тесты, убедиться, что падают**

```bash
cd server
npx vitest run src/pack.test.ts src/room.test.ts src/server.test.ts
```

Expected: FAIL — `room.ts` ещё не строит `image`, `server.ts` ещё не раздаёт `/media/`.

- [ ] **Step 5: Реализовать в `room.ts`**

`toGameStateView` — заменить блок `currentQuestion`:

```ts
      currentQuestion: currentQuestionData
        ? {
            text:
              game.phase === 'cat-handoff' || game.phase === 'auction-bidding'
                ? null
                : currentQuestionData.text,
            price: currentQuestionData.price,
            themeName: currentThemeName!,
          }
        : null,
```

на:

```ts
      currentQuestion: currentQuestionData
        ? {
            text:
              game.phase === 'cat-handoff' || game.phase === 'auction-bidding'
                ? null
                : currentQuestionData.text,
            price: currentQuestionData.price,
            themeName: currentThemeName!,
            // Та же видимость, что у text выше — скрыта во время
            // cat-handoff/торгов. this.activePackFilename почти всегда
            // задан вместе с this.pack (constructor/selectPack всегда
            // присваивают их парой) — на случай расхождения фолбэк на
            // null безопаснее, чем бросать ошибку ради поля, которое и
            // так необязательно.
            image:
              (game.phase === 'cat-handoff' ||
                game.phase === 'auction-bidding') ||
              !currentQuestionData.image ||
              !this.activePackFilename
                ? null
                : `/media/${this.activePackFilename.replace(/\.json$/, '')}/${currentQuestionData.image}`,
          }
        : null,
```

- [ ] **Step 6: Реализовать статический маршрут в `server.ts`**

Заменить:

```ts
export function createServer(options: CreateServerOptions): GameServer {
  const { room, clientDistPath, port, packsDir, profilePath } = options;
  const assets = sirv(clientDistPath, { single: true });

  const httpServer = createHttpServer((req, res) => {
    assets(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });
```

на:

```ts
export function createServer(options: CreateServerOptions): GameServer {
  const { room, clientDistPath, port, packsDir, profilePath } = options;
  const assets = sirv(clientDistPath, { single: true });
  // Раздаёт packsDir/media/... под префиксом /media/ — БЕЗ single:true:
  // отсутствующая картинка обязана дать настоящий 404, а не откат на
  // клиентский index.html (design.md, 2026-08-16, «Отказы»). Смонтирован
  // на сам packsDir (не packsDir/media) — префикс /media/ снимается с
  // req.url перед вызовом, поэтому dir для sirv должен совпадать с тем,
  // что остаётся ПОСЛЕ снятия префикса.
  const media = sirv(join(packsDir, 'media'));

  const httpServer = createHttpServer((req, res) => {
    if (req.url?.startsWith('/media/')) {
      req.url = req.url.slice('/media'.length);
      media(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }
    assets(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });
```

- [ ] **Step 7: Прогнать тесты снова**

```bash
npx vitest run
```

Expected: весь пакет тестов сервера зелёный.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint src/protocol.ts src/room.ts src/room.test.ts src/server.ts src/server.test.ts
cd ..
git add server/src/protocol.ts server/src/room.ts server/src/room.test.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: build media URLs for question images and serve packs/media/"
```

---

### Task 3: Табло — `useRoomConnection.ts`, `Board.tsx`, стили

**Files:**

- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/Board.tsx`
- Modify: `client/src/Board.test.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: изменения протокола из Task 2 (зеркалятся локально, тот же принцип, что и у
  всего остального в этом хуке).
- Produces: ничего наружу — конечный экран.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/Board.test.tsx`, рядом с тестом `'shows the open question text'`:

```ts
  it('shows the question image when present', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: {
            text: 'Что за цветок на картинке?',
            price: 100,
            themeName: 'Тема',
            image: '/media/sport/flower.jpg',
          },
        }),
      }),
    );
    render(<Board />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain('/media/sport/flower.jpg');
  });

  it('does not show an image when the question has none', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: {
            text: 'Столица Франции?',
            price: 100,
            themeName: 'Тема',
          },
        }),
      }),
    );
    render(<Board />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
```

(Второй тест намеренно не указывает `image` вовсе — поле необязательное в клиентском типе,
см. Step 3 ниже, так что уже существующие тесты этого файла и `Player.test.tsx`, не
указывающие `image`, не ломаются самим фактом появления поля.)

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd client
npx vitest run src/Board.test.tsx
```

Expected: FAIL — `Board.tsx` ещё не рендерит `<img>`, тип `currentQuestion` ещё не принимает
`image`.

- [ ] **Step 3: Расширить тип в `useRoomConnection.ts`**

`GameStateView.currentQuestion` — заменить:

```ts
  currentQuestion: {
    text: string | null;
    price: number;
    themeName: string;
  } | null;
```

на:

```ts
  // image — необязательное поле в этом локальном типе (в отличие от
  // сервера, где оно обязательное) намеренно: делает его опциональным
  // для тестовых фикстур в Board.test.tsx/Player.test.tsx, у которых
  // `currentQuestion` собирается вручную — без этого пришлось бы
  // дописывать `image: null` в ~18 уже существующих мест в обоих файлах
  // ради поля, которого эти тесты не касаются. Реальные сообщения с
  // сервера всегда содержат image — на строгость разбора реальных
  // сообщений это не влияет, недостающий у TypeScript-типа необязательный
  // ключ не отбрасывает лишние поля во входящих данных.
  currentQuestion: {
    text: string | null;
    price: number;
    themeName: string;
    image?: string | null;
  } | null;
```

- [ ] **Step 4: Реализовать в `Board.tsx`**

Заменить:

```tsx
      {game.currentQuestion && (
        <>
          {/* text — null во время cat-handoff (текст ещё скрыт, см.
              Room.toGameStateView) — показываем тему и цену, не пустой
              абзац. */}
          {game.currentQuestion.text !== null ? (
            <p className="board-question">{game.currentQuestion.text}</p>
          ) : (
            <p className="board-question">
              {game.currentQuestion.themeName} за {game.currentQuestion.price}
            </p>
          )}
          {(game.phase === 'question-open' || game.phase === 'cat-handoff') &&
            remainingSeconds !== null && (
              <p className="board-timer">{remainingSeconds}с</p>
            )}
        </>
      )}
```

на:

```tsx
      {game.currentQuestion && (
        <>
          {/* text — null во время cat-handoff (текст ещё скрыт, см.
              Room.toGameStateView) — показываем тему и цену, не пустой
              абзац. */}
          {game.currentQuestion.text !== null ? (
            <p className="board-question">{game.currentQuestion.text}</p>
          ) : (
            <p className="board-question">
              {game.currentQuestion.themeName} за {game.currentQuestion.price}
            </p>
          )}
          {game.currentQuestion.image && (
            <img
              className="board-question-image"
              src={game.currentQuestion.image}
              alt="Картинка к вопросу"
            />
          )}
          {(game.phase === 'question-open' || game.phase === 'cat-handoff') &&
            remainingSeconds !== null && (
              <p className="board-timer">{remainingSeconds}с</p>
            )}
        </>
      )}
```

- [ ] **Step 5: Прогнать тесты снова**

```bash
npx vitest run src/Board.test.tsx
```

Expected: все тесты зелёные, включая полный существующий набор файла (`Player.test.tsx`
тоже прогнать — он использует тот же `GameStateView` из `useRoomConnection.ts`, но не
трогает `image` нигде, так что должен остаться зелёным без изменений):

```bash
npx vitest run src/Player.test.tsx
```

- [ ] **Step 6: Добавить стили**

`client/src/index.css` — рядом с `.board-question`:

```css
.board-question-image {
  max-width: 700px;
  max-height: 45vh;
  object-fit: contain;
  border-radius: 8px;
}
```

- [ ] **Step 7: Полная проверка проекта**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: всё зелёное.

- [ ] **Step 8: Commit**

```bash
git add client/src/useRoomConnection.ts client/src/Board.tsx client/src/Board.test.tsx client/src/index.css
git commit -m "feat: show the question image on the board"
```

---

### Task 4: `validate-pack.ts` — предупреждение об отсутствующей картинке

**Files:**

- Modify: `server/scripts/validate-pack.ts`

**Interfaces:**

- Consumes: `findMissingMedia` (`server/src/pack.js`, Task 1).
- Produces: ничего наружу — CLI-скрипт.

Без TDD-цикла — файл, по собственному описанию в шапке, не покрывается юнит-тестами (тонкая
CLI-обёртка вокруг уже протестированной логики; `findMissingMedia` сама протестирована в
Task 1). Проверяется прогоном вручную на Step 2.

- [ ] **Step 1: Реализовать**

Заменить:

```ts
import { readFile } from 'node:fs/promises';
import { validatePack } from '../src/pack.js';
```

на:

```ts
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { findMissingMedia, validatePack } from '../src/pack.js';
```

Заменить:

```ts
try {
  const pack = validatePack(parsed);
  const questionCount = pack.rounds.reduce(
    (sum, round) =>
      sum + round.themes.reduce((s, theme) => s + theme.questions.length, 0),
    0,
  );
  console.log(
    `OK: ${path} — валидный пакет ("${pack.title}", ${pack.rounds.length} раунд(ов), ` +
      `${questionCount} вопрос(ов), финал: ${pack.final ? pack.final.themes.length + ' тем' : 'нет'})`,
  );
} catch (err) {
  console.error(`${path}: невалидный пакет — ${(err as Error).message}`);
  process.exit(1);
}
```

на:

```ts
try {
  const pack = validatePack(parsed);
  const questionCount = pack.rounds.reduce(
    (sum, round) =>
      sum + round.themes.reduce((s, theme) => s + theme.questions.length, 0),
    0,
  );
  console.log(
    `OK: ${path} — валидный пакет ("${pack.title}", ${pack.rounds.length} раунд(ов), ` +
      `${questionCount} вопрос(ов), финал: ${pack.final ? pack.final.themes.length + ' тем' : 'нет'})`,
  );
  // Предупреждение, не ошибка — design.md, «Валидация при генерации»: пак
  // всё равно валиден, это страховка на случай, если скачивание картинки
  // не успело завершиться до этого шага (при штатном потоке — не должно
  // случаться).
  const mediaDir = join(dirname(path), 'media', basename(path, '.json'));
  const missing = await findMissingMedia(pack, mediaDir);
  for (const m of missing) {
    console.warn(
      `⚠ ${path}: вопрос "${m.questionId}" ссылается на картинку "${m.image}", ` +
        `но файла ${join(mediaDir, m.image)} нет на диске`,
    );
  }
} catch (err) {
  console.error(`${path}: невалидный пакет — ${(err as Error).message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Проверить вручную**

```bash
cd server
npx tsc --noEmit
npx eslint scripts/validate-pack.ts
npx tsx scripts/validate-pack.ts ../packs/current.json
```

Expected: `OK: ...` без предупреждений (у `current.json` нет вопросов с `image`). Если
хочется дополнительно убедиться, что предупреждение реально печатается — временно дописать
`"image": "ghost.jpg"` в любой вопрос `packs/current.json`, прогнать снова, увидеть `⚠ ...`,
откатить правку (`git checkout -- ../packs/current.json`).

- [ ] **Step 3: Commit**

```bash
cd ..
git add server/scripts/validate-pack.ts
git commit -m "feat: warn on missing question-image files in validate-pack"
```

---

### Task 5: `pack-generator` — когда и как добавлять картинку

**Files:**

- Modify: `.claude/skills/pack-generator/SKILL.md`

**Interfaces:** нет — правка промпта, кода не меняет.

- [ ] **Step 1: Переписать инвариант 3**

Заменить:

```markdown
3. **Никаких медиа-вопросов.** Ни картинок, ни аудио, ни видео, ни ссылок на файлы, которых не
   существует. Только текст.
```

на:

```markdown
3. **Картинки — можно, при соблюдении Шага 3а. Аудио и видео — по-прежнему нельзя.** Ни
   аудио, ни видео, ни ссылок на файлы, которые сами не скачали и не проверили (см. Шаг 3а).
```

- [ ] **Step 2: Добавить Шаг 3а**

Вставить новый раздел сразу после Шага 3 («Основной раунд — вопросы»), перед Шагом 4:

```markdown
## Шаг 3а. Картинка к вопросу — когда и как

Картинка допускается только в одном из двух случаев — определить явно, какой именно, прежде
чем прикреплять:

1. **Целый раунд/тема картиночных вопросов.** Картинка — само содержание вопроса, не
   иллюстрация к нему: «что за цветок на картинке?», «кадр из какого фильма/музыкального
   клипа?». Текст вопроса минимален.
2. **Точечная картинка в обычном раунде — только если без неё вопрос нельзя нормально
   задать.** Не украшение и не подсказка, срезающая путь к ответу: если вопрос прекрасно
   работает как чисто текстовый — картинки не будет. Годный пример: вопрос про визуальный
   паттерн (созвездие, герб, флаг с редким сочетанием цветов), который иначе пришлось бы
   неуклюже и неточно описывать словами.

Брак: «Какой газ самый распространённый в атмосфере Земли?» с картинкой атмосферы — картинка
ничего не добавляет, вопрос самодостаточен текстом. Годно: «Флаг какой страны здесь
изображён?» с картинкой этого флага — без картинки вопрос не имеет смысла.

**Процесс на вопрос, для которого решено добавить картинку:**

1. Сформулировать поисковый запрос по предмету вопроса/ответа (не по формулировке вопроса
   целиком) — например, «Эйфелева башня», не «что это за сооружение в Париже».
2. Запросить Wikimedia Commons API: `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=<запрос>&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&format=json` — взять первого разумного кандидата из `query.pages`.
3. Если ничего подходящего — тот же запрос в Openverse: `https://api.openverse.org/v1/images/?q=<запрос>` — взять `results[].url`.
4. Скачать кандидата в `packs/media/<slug-пака>/<slug-предмета>.<расширение>` (создать
   директорию, если её ещё нет). `<slug-пака>` — то же имя, что будет у файла `packs/<slug-
   пака>.json` (Шаг 6) без расширения; определить его заранее, до Шага 3, если картинки
   планируются в этом паке.
5. **Посмотреть на скачанную картинку** — убедиться, что она действительно соответствует
   вопросу/ответу, а не просто совпала по ключевым словам с чем-то посторонним.
6. Подходит — записать `question.image` (имя файла, без пути). Не подходит — попробовать
   следующего кандидата из того же запроса; после разумного числа попыток по обоим
   источникам — отказаться от картинки для этого вопроса, оставить его чисто текстовым и
   запомнить для Шага 7 («не нашлась картинка для …»).

Об авторстве/лицензии картинки в паке не запоминается — личная непубличная вечеринка, не
публикация.
```

- [ ] **Step 3: Обновить Шаг 6**

Добавить пункт в конец списка внутри Шага 6 (после пункта про сверку с
`pack-generator-profile.md`):

```markdown
   - Валидатор (Шаг 3, п.1 выше в этом скрипте) теперь дополнительно печатает `⚠` для
     каждого вопроса, чья `image` указана, но файл не найден на диске — если такое
     появилось, значит картинку решили прикрепить, но не скачали до этого шага. Скачать (см.
     Шаг 3а) или убрать `image` у вопроса и прогнать валидатор снова.
```

- [ ] **Step 4: Обновить Шаг 7**

Добавить предложение в конец существующего абзаца Шага 7:

```markdown
Если для каких-то вопросов картинка задумывалась (Шаг 3а), но подходящая не нашлась —
явно перечислить эти вопросы отдельным списком в этом же отчёте.
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pack-generator/SKILL.md
git commit -m "docs: teach pack-generator to source and attach question images"
```

---

## После плана

Живая проверка: сгенерировать (или руками собрать) небольшой пак с одним картиночным
вопросом (точечным, по критерию Шага 3а), прогнать партию до этого вопроса, убедиться, что
картинка появляется на табло синхронно с текстом и пропадает/не мешает остальному экрану;
проверить, что телефон игрока картинку не показывает вовсе. Отдельно — сгенерировать
настоящий пак с реальным обращением к Wikimedia Commons/Openverse, чтобы увидеть, как
процесс поиска/скачивания/проверки в Шаге 3а ведёт себя на живых данных, а не только в
тестах на файлах-заглушках.
