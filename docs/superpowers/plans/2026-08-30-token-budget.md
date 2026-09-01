# Сокращение расхода токенов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Уменьшить расход контекста в сессиях проекта: срезать стартовый контекст, дать модели карту проекта вместо разведки с нуля, показать расход отчётом `/tokens` и напоминать о точке выхода в момент, когда очистка безопасна.

**Architecture:** Четыре независимые части. (1) Отключение неиспользуемого плагина `playwright` в `~/.claude/settings.json` — вне репозитория. (2) `CLAUDE.md` в корне — карта проекта и правила работы с контекстом. (3) `.claude/scripts/tokens.mjs` разбирает `.jsonl`-транскрипты и печатает ≤30 строк сводки; вся тяжёлая работа в скрипте, в контекст попадает только результат. (4) `.claude/scripts/checkpoint.mjs` — неблокирующий `PostToolUse`-хук: проверяет объективные факты (что закоммичено, чисто ли дерево, был ли прогон проверок, размер контекста из хвоста транскрипта) и дописывает короткую пометку о точке выхода.

Обе части, работающие с транскриптами, делят один модуль разбора `lib/transcript.mjs`. Логика решений вынесена в чистые функции (`lib/report.mjs`, `lib/checkpoint-rules.mjs`) — они тестируются без файловой системы, без git и без Claude Code; вводу-выводу оставлены тонкие оболочки `tokens.mjs` и `checkpoint.mjs`.

**Tech Stack:** Node ESM (`.mjs`), без зависимостей. Тесты — встроенный `node:test` + `node:assert/strict`. Конфигурация хука — `.claude/settings.json`. Слэш-команды — `.claude/commands/*.md`.

## Global Constraints

- Все новые тексты (CLAUDE.md, слэш-команды, тексты напоминаний, комментарии в скриптах) — по-русски. Обоснование в спеке: разница языков ~0,1% расхода, экономить на ней нечего.
- Скрипты — чистый Node ESM в файлах `.mjs`, **без единой внешней зависимости**. Ни `package.json` в `.claude/scripts/`, ни новых пакетов в корень.
- Целевой рантайм — Node ≥ 22 (на машине разработчика v25.8.2).
- Тесты скриптов — только `node:test` и `node:assert/strict`, запуск `node --test .claude/scripts/lib`.
- **Ни один хук не блокирует.** `checkpoint.mjs` всегда завершается кодом `0`, никогда не печатает `decision: "block"` и не пишет в stderr. Любая внутренняя ошибка = тихий выход без вывода.
- Хук не читает транскрипт целиком — только хвост ≤ 256 КБ (`readTail`).
- Текст одного напоминания ≤ 400 символов. Напоминание, которое само стоит дорого, бессмысленно.
- Стиль по Prettier проекта: 2 пробела, одинарные кавычки, точки с запятой.
- Коммиты — Conventional Commits, это проверяет commitlint в `.husky/commit-msg`.
- Числа в `CLAUDE.md` — округлённые (`~1.7k строк`), не точные. Точные устаревают за неделю; в спеке они уже устарели (там `room.ts` 1794, фактически 1669).

## File Structure

| Файл                                            | Ответственность                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md`                                     | Карта проекта, команды, правила работы с контекстом. Ссылается на `docs/`, не пересказывает их.                                            |
| `.claude/settings.json`                         | Регистрация `PostToolUse`-хука. В git.                                                                                                     |
| `.claude/scripts/lib/transcript.mjs`            | Поиск и разбор `.jsonl`-транскриптов: слаг проекта, список файлов, запросы с размером контекста, результаты инструментов, чтение хвоста.   |
| `.claude/scripts/lib/report.mjs`                | Чистое форматирование отчёта `/tokens` в ≤30 строк. Не знает про файлы.                                                                    |
| `.claude/scripts/lib/checkpoint-rules.mjs`      | Чистые правила: классификация события, вердикт по прогону проверок, факты → текст напоминания или `null`. Не знает про git, stdin и файлы. |
| `.claude/scripts/tokens.mjs`                    | CLI-оболочка: собрать данные из транскриптов, посчитать агрегаты, напечатать отчёт.                                                        |
| `.claude/scripts/checkpoint.mjs`                | Оболочка хука: прочитать payload со stdin, собрать факты (git, файл состояния, хвост транскрипта), позвать правила, напечатать hook JSON.  |
| `.claude/scripts/lib/transcript.test.mjs`       | Тесты разбора.                                                                                                                             |
| `.claude/scripts/lib/report.test.mjs`           | Тесты форматирования.                                                                                                                      |
| `.claude/scripts/lib/checkpoint-rules.test.mjs` | Тесты правил.                                                                                                                              |
| `.claude/commands/tokens.md`                    | Слэш-команда `/tokens`.                                                                                                                    |
| `.claude/commands/handoff.md`                   | Слэш-команда `/handoff` — дописать секцию «Состояние» в файл плана.                                                                        |
| `package.json` (корень)                         | Скрипт `test:scripts`, подключённый к `test`.                                                                                              |
| `.lintstagedrc.json`                            | Прогон Prettier по `.claude/**/*.mjs`.                                                                                                     |
| `.gitignore`                                    | Игнор `.claude/state/` — файлы состояния хука.                                                                                             |

**Замечание по спеке.** Спека называет среди объективных фактов, проверяемых хуком, «тесты зелёные». Хук не может запустить `pnpm test` — это десятки секунд на каждом вызове инструмента, и спека сама запрещает задержки. Вместо этого хук **наблюдает** прогон: когда через Bash проходит `pnpm test`/`pnpm typecheck`, он записывает вердикт (`green`/`red`/`unknown`) по маркерам в выводе и позже опирается на записанное. Когда вердикт `unknown`, напоминание класса Б всё равно выдаётся, но с явной просьбой подтвердить проверки. Это честнее, чем притворяться, что хук знает больше, чем видит.

---

### Task 1: Отключить плагин `playwright`

Плагин включён, вызван за всю историю проекта 0 раз — браузер использовался встроенный (2400+ вызовов). Его определения инструментов оплачиваются в каждом из 25 852 запросов.

**Files:**

- Modify: `C:\Users\ib1te\.claude\settings.json` (**вне репозитория**, в git не попадает)

**Interfaces:**

- Consumes: ничего
- Produces: ничего — задача не оставляет следа в коде, следующие задачи от неё не зависят

- [x] **Step 1: Посмотреть, где включён плагин**

```bash
node -e "console.log(require('fs').readFileSync(process.env.USERPROFILE+'/.claude/settings.json','utf8'))"
```

Ожидается: JSON, в котором есть ключ со списком включённых плагинов (`enabledPlugins` либо `plugins`), а в нём запись про `playwright`.

Если в этом файле записи нет — плагин включён в другом месте:

```bash
grep -rln playwright /c/Users/ib1te/.claude/settings.json /c/Users/ib1te/.claude/plugins/config.json
```

- [x] **Step 2: Выключить playwright**

Отредактировать найденный файл: запись плагина `playwright` перевести в `false` (если формат — объект вида `{"имя@маркетплейс": true}`) либо убрать из массива (если формат — список имён).

Остальные плагины не трогать. В частности `context7` вызван 0 раз, но это всего два определения инструментов — спека явно оставляет его.

- [x] **Step 3: Проверить, что JSON остался валидным**

```bash
node -e "JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.claude/settings.json','utf8'));console.log('settings.json валиден')"
```

Ожидается: `settings.json валиден`.

- [x] **Step 4: Сообщить пользователю**

Коммита нет — файл вне репозитория. Сказать: плагин выключен, изменение подхватится при следующем запуске Claude Code, разницу видно в `/context` до и после перезапуска.

---

### Task 2: `CLAUDE.md` — карта проекта

**Files:**

- Create: `CLAUDE.md`

**Interfaces:**

- Consumes: ничего
- Produces: раздел «Точки выхода» в `CLAUDE.md` — на него ссылаются тексты напоминаний из Task 6 и слэш-команда `/handoff` из Task 8

- [x] **Step 1: Сверить размеры файлов с репозиторием**

Числа в спеке устарели (там `room.ts` 1794 строки, фактически 1669). Взять актуальные и округлить:

```bash
wc -l server/src/*.ts client/src/*.ts client/src/*.tsx | sort -rn | head -14
```

- [x] **Step 2: Создать `CLAUDE.md`**

Содержимое целиком (округлённые размеры — на момент написания плана; если Step 1 показал заметно другие, поправить):

```markdown
# Своя игра — рабочая карта

Файл нужен, чтобы не выяснять структуру проекта заново в каждой сессии. Здесь только то,
что дорого восстанавливать разведкой. Порядок работ — в скилле `svoya-igra-dev`, причины
архитектурных решений — в `docs/`.

## Стек и команды

pnpm-монорепозиторий, две рабочие области: `server` (Node + ws + TypeScript) и `client`
(React 19 + Vite). Пакетный менеджер — только pnpm.

- `pnpm test` — vitest в обеих областях плюс тесты скриптов из `.claude/scripts`
- `pnpm typecheck` — `tsc --noEmit` (server) и `tsc -b` (client)
- `pnpm lint` — eslint (server), oxlint (client)
- `pnpm build` — сборка обеих областей
- `pnpm test:e2e` — playwright, требует сборки; долгий, только вручную
- `pnpm --filter server test` — одна область
- `pnpm --filter server test -- -t "имя теста"` — один тест

## Карта

- `server/src/` — движок и сервер. `engine.ts` — чистая машина состояний игры, не знает про
  часы и сокеты. `room.ts` — комната: игроки, очки, таймеры. `server.ts` — HTTP и ws.
  `protocol.ts` — типы сообщений между клиентом и сервером. `pack.ts`/`packs.ts` — формат и
  загрузка пакетов вопросов. `history.ts` — история партий. Рядом с каждым файлом `*.test.ts`.
- `client/src/` — `Board.tsx` (экран на телевизоре), `Player.tsx` (телефон игрока),
  `Admin.tsx` (панель ведущего), `use*Connection.ts` (ws-подключения), `VideoPlayer.tsx`.
- `packs/` — пакеты вопросов в JSON, `packs/media/` — картинки и видео к ним.
- `e2e/` — playwright-сценарии.
- `docs/` — спеки, планы и решения (см. ниже).
- `.claude/scripts/` — служебные скрипты (`tokens.mjs`, `checkpoint.mjs`), чистый Node без
  зависимостей, тесты на `node:test`.

## Крупные файлы — не читать целиком

Тесты: `room.test.ts` ~3.6k строк, `server.test.ts` ~3.4k, `engine.test.ts` ~2.5k,
`Player.test.tsx` ~2.1k, `Admin.test.tsx` ~1.4k.

Код: `room.ts` ~1.7k, `Player.tsx` ~1.2k, `engine.ts` ~1.1k, `server.ts` ~950,
`history.ts` ~900, `Admin.tsx` ~860.

Всё это открывается фрагментом, а не целиком.

## Работа с контекстом

Контекст перечитывается на каждом вызове инструмента, а не на каждом сообщении. Файл,
прочитанный на тридцатом сообщении, оплачивается ещё сотни раз до конца сессии.

- Сначала искать по символу (`Grep` по имени функции или типа), потом читать найденный
  фрагмент с `offset`/`limit`. Целиком — только файлы примерно до 200 строк.
- Независимые команды — одним вызовом. 5000 вызовов Bash со средним ответом 623 байта:
  дёшев ответ, дорог круг.
- Широкую разведку по коду («где вообще трогается X») отдавать субагенту `Explore`: он
  читает выдержки в своём контексте и возвращает вывод.
- Не пересказывать в ответе то, что уже видно в выводе инструмента.
- `/tokens` — отчёт, куда ушёл контекст в этой сессии и в проекте.

## Точки выхода

Контекст безопасно чистить, когда всё нужное для продолжения лежит **вне** контекста.

Чистим всегда, передача состояния не нужна — файл сам является передачей: спека дописана и
закоммичена; план дописан и закоммичен; PR смёржен (перед очисткой занести в этот файл
устные правила, прозвучавшие в ревью); артефакт вроде JSON-пака записан на диск.

Чистим по условию, сначала `/handoff`: этап плана закрыт и проверки зелёные; баг починен, а
причина записана в сообщении коммита; смена темы, а предыдущая задача доведена до коммита.

Не чистим: красные тесты или падающая сборка; незакоммиченные правки; идущая отладка с
неподтверждённой гипотезой; заданный и неотвеченный вопрос; середина многофайловой правки;
прочитанные, но не отработанные комментарии к PR.

## Документы

- `docs/superpowers/specs/2026-08-03-svoya-igra-design.md` — что строим и почему
- `docs/ideas.md` — что сознательно не строим, с причинами
- `docs/lifecycle.md` — цикл разработки под этот проект
- `docs/players.md`, `docs/pack-generator-profile.md` — анкеты игроков и профиль генератора
- `docs/superpowers/plans/` — планы вех, там же секции «Состояние» от `/handoff`
- `CONTRIBUTING.md` — ветки и коммиты
```

- [x] **Step 3: Проверить, что все упомянутые пути существуют**

```bash
ls CLAUDE.md server/src/engine.ts server/src/room.ts server/src/server.ts server/src/protocol.ts server/src/pack.ts server/src/packs.ts server/src/history.ts client/src/Board.tsx client/src/Player.tsx client/src/Admin.tsx client/src/VideoPlayer.tsx packs e2e docs/ideas.md docs/lifecycle.md docs/players.md docs/pack-generator-profile.md docs/superpowers/specs/2026-08-03-svoya-igra-design.md CONTRIBUTING.md
```

Ожидается: все пути напечатаны, ни одного `No such file`.

- [x] **Step 4: Прогнать Prettier**

```bash
pnpm exec prettier --write CLAUDE.md
```

Ожидается: файл отформатирован без ошибок разбора.

- [x] **Step 5: Коммит**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — карта проекта и правила работы с контекстом"
```

---

### Task 3: Разбор транскриптов — `lib/transcript.mjs`

Модуль, которым пользуются и `/tokens`, и хук. Отвечает за одно: превратить `.jsonl`-транскрипт в структуру, по которой можно считать.

Ключевые факты о формате, проверенные на реальных транскриптах проекта (не угадывать заново):

- Одна строка — один JSON-объект. Хвост файла может быть дописан наполовину, битые строки пропускаются.
- Размер контекста запроса = `message.usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens` у записи `type: "assistant"`.
- Один запрос к модели даёт **несколько** записей `assistant` с одним `requestId` (4842 записи на 2498 запросов в замеренной сессии). `usage` у них идентичен, поэтому дедуп по `requestId`, берётся первая.
- Записи с `message.model === "<synthetic>"` — не запросы к модели, их не считать.
- Автокомпакт — запись `type: "system"`, `subtype: "compact_boundary"`.
- `tool_use` лежит в `message.content` записи `assistant` (есть `id` и `name`), `tool_result` — в `message.content` записи `user` (есть `tool_use_id`). Имя инструмента для результата берётся по `tool_use_id`.
- Каталог транскриптов — `~/.claude/projects/<слаг>`, где слаг = путь рабочего каталога, в котором каждый символ не из `[A-Za-z0-9]` заменён на `-`. Воркtree живёт в отдельном каталоге `<слаг проекта>--claude-worktrees-<имя>`.

**Files:**

- Create: `.claude/scripts/lib/transcript.mjs`
- Create: `.claude/scripts/lib/transcript.test.mjs`
- Modify: `package.json` (корень) — скрипты `test:scripts` и `test`
- Modify: `.lintstagedrc.json` — Prettier для `.claude/**/*.mjs`

**Interfaces:**

- Consumes: ничего
- Produces:
  - `projectSlug(dir: string): string`
  - `projectRootSlug(dir: string): string`
  - `findTranscripts(projectsDir: string, cwd: string): Promise<Array<{path: string, mtimeMs: number}>>` — отсортировано по убыванию `mtimeMs`
  - `parseTranscript(text: string): {sessionId: string|null, requests: Request[], toolResults: ToolResult[], compacts: number, userMessages: number}`, где `Request = {requestId: string, timestamp: string|null, model: string|null, contextTokens: number, outputTokens: number}` и `ToolResult = {tool: string, bytes: number, at: number}` (`at` — сколько запросов уже прошло к моменту появления результата)
  - `carryCostByTool(parsed): Array<{tool: string, tokens: number}>` — по убыванию `tokens`
  - `readTail(path: string, maxBytes?: number): Promise<string>`
  - `latestContextTokens(text: string): number|null`

- [x] **Step 1: Подключить запуск тестов скриптов**

В корневом `package.json` в `scripts` заменить `"test"` и добавить `"test:scripts"`:

```json
    "test": "pnpm -r run test && pnpm run test:scripts",
    "test:scripts": "node --test .claude/scripts/lib",
```

В `.lintstagedrc.json` добавить запись (порядок ключей не важен):

```json
  ".claude/**/*.mjs": ["prettier --write"]
```

- [x] **Step 2: Написать падающий тест**

Создать `.claude/scripts/lib/transcript.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectSlug,
  projectRootSlug,
  parseTranscript,
  carryCostByTool,
} from './transcript.mjs';

const line = (obj) => JSON.stringify(obj);

const assistant = (requestId, ctx, extra = {}) =>
  line({
    type: 'assistant',
    requestId,
    timestamp: '2026-08-30T10:00:00.000Z',
    message: {
      model: 'claude-opus-5',
      content: extra.content ?? [{ type: 'text', text: 'ок' }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: ctx,
        cache_creation_input_tokens: 0,
        output_tokens: 10,
      },
    },
  });

test('projectSlug превращает путь в имя каталога транскриптов', () => {
  assert.equal(
    projectSlug('C:\\Users\\ib1te\\Desktop\\svoya_igra'),
    'C--Users-ib1te-Desktop-svoya-igra',
  );
});

test('projectRootSlug отбрасывает суффикс воркtree', () => {
  assert.equal(
    projectRootSlug(
      'C:\\Users\\ib1te\\Desktop\\svoya_igra\\.claude\\worktrees\\feature-x',
    ),
    'C--Users-ib1te-Desktop-svoya-igra',
  );
});

test('parseTranscript дедуплицирует записи одного запроса по requestId', () => {
  const text = [
    assistant('req-1', 1000),
    assistant('req-1', 1000),
    assistant('req-2', 2000),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.equal(parsed.requests.length, 2);
  assert.deepEqual(
    parsed.requests.map((r) => r.contextTokens),
    [1002, 2002],
  );
});

test('parseTranscript пропускает synthetic-записи и битые строки', () => {
  const synthetic = line({
    type: 'assistant',
    requestId: 'req-s',
    message: { model: '<synthetic>', content: [], usage: { input_tokens: 5 } },
  });
  const parsed = parseTranscript(
    [assistant('req-1', 1000), synthetic, '{не json'].join('\n'),
  );
  assert.equal(parsed.requests.length, 1);
});

test('parseTranscript считает автокомпакты и сообщения пользователя', () => {
  const text = [
    line({ type: 'user', message: { role: 'user', content: 'сделай Х' } }),
    assistant('req-1', 1000),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto' },
    }),
    line({
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: 'служебное' },
    }),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.equal(parsed.compacts, 1);
  assert.equal(parsed.userMessages, 1);
});

test('parseTranscript связывает результат инструмента с именем инструмента', () => {
  const text = [
    assistant('req-1', 1000, {
      content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
    }),
    line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'x'.repeat(400),
          },
        ],
      },
    }),
    assistant('req-2', 2000),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.deepEqual(parsed.toolResults, [{ tool: 'Read', bytes: 400, at: 1 }]);
});

test('carryCostByTool считает, сколько раз результат ещё перечитается', () => {
  const parsed = {
    requests: [{}, {}, {}, {}],
    toolResults: [
      { tool: 'Read', bytes: 400, at: 1 },
      { tool: 'Bash', bytes: 40, at: 3 },
    ],
  };
  // Read: 100 токенов × 3 оставшихся запроса = 300; Bash: 10 × 1 = 10.
  assert.deepEqual(carryCostByTool(parsed), [
    { tool: 'Read', tokens: 300 },
    { tool: 'Bash', tokens: 10 },
  ]);
});
```

- [x] **Step 3: Прогнать тесты и убедиться, что они падают**

```bash
pnpm run test:scripts
```

Ожидается: падение с `Cannot find module` — файла `transcript.mjs` ещё нет. Если вместо этого печатается `0 tests` — значит `node --test <каталог>` не нашёл файл; тогда заменить скрипт на `node --test \".claude/scripts/lib/*.test.mjs\"` и повторить.

- [x] **Step 4: Написать `lib/transcript.mjs`**

```js
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Имя каталога транскриптов для рабочего каталога. */
export function projectSlug(dir) {
  return dir.replace(/[^A-Za-z0-9]/g, '-');
}

/** Тот же слаг, но без суффикса воркtree — чтобы собрать сессии всего проекта. */
export function projectRootSlug(dir) {
  return projectSlug(dir).replace(/--claude-worktrees-.*$/, '');
}

/** Все транскрипты проекта, включая воркtree, свежие первыми. */
export async function findTranscripts(projectsDir, cwd) {
  const root = projectRootSlug(cwd);
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter(
      (e) =>
        e.isDirectory() && (e.name === root || e.name.startsWith(`${root}--`)),
    )
    .map((e) => join(projectsDir, e.name));

  const files = [];
  for (const dir of dirs) {
    let names;
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      try {
        files.push({ path, mtimeMs: (await stat(path)).mtimeMs });
      } catch {
        // файл исчез между readdir и stat — не беда
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (typeof part?.text === 'string')
      total += Buffer.byteLength(part.text, 'utf8');
  }
  return total;
}

export function parseTranscript(text) {
  const requests = [];
  const seen = new Set();
  const toolNames = new Map();
  const toolResults = [];
  let compacts = 0;
  let userMessages = 0;
  let sessionId = null;

  for (const raw of text.split('\n')) {
    if (!raw) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue; // хвост файла бывает дописан наполовину
    }
    if (!sessionId && typeof entry.sessionId === 'string')
      sessionId = entry.sessionId;

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      compacts += 1;
      continue;
    }

    if (entry.type === 'assistant' && entry.message) {
      const usage = entry.message.usage;
      const id = entry.requestId;
      if (
        id &&
        usage &&
        entry.message.model !== '<synthetic>' &&
        !seen.has(id)
      ) {
        seen.add(id);
        requests.push({
          requestId: id,
          timestamp: entry.timestamp ?? null,
          model: entry.message.model ?? null,
          contextTokens:
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
        });
      }
      for (const block of entry.message.content ?? []) {
        if (block?.type === 'tool_use' && block.id)
          toolNames.set(block.id, block.name);
      }
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (typeof content === 'string') {
        if (!entry.isMeta) userMessages += 1;
        continue;
      }
      if (!Array.isArray(content)) continue;
      let hasText = false;
      for (const block of content) {
        if (block?.type === 'text') hasText = true;
        if (block?.type !== 'tool_result') continue;
        toolResults.push({
          tool: toolNames.get(block.tool_use_id) ?? 'unknown',
          bytes: resultBytes(block.content),
          at: requests.length,
        });
      }
      if (hasText && !entry.isMeta) userMessages += 1;
    }
  }

  return { sessionId, requests, toolResults, compacts, userMessages };
}

/**
 * Во что обошёлся результат инструмента: он лежит в контексте до конца сессии и
 * перечитывается на каждом следующем запросе. Это и есть настоящая цена, а не размер ответа.
 */
export function carryCostByTool(parsed) {
  const total = parsed.requests.length;
  const byTool = new Map();
  for (const result of parsed.toolResults) {
    const tokens = Math.ceil(result.bytes / 4) * Math.max(0, total - result.at);
    byTool.set(result.tool, (byTool.get(result.tool) ?? 0) + tokens);
  }
  return [...byTool]
    .map(([tool, tokens]) => ({ tool, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** Хвост файла — чтобы хук не платил чтением 30 МБ на каждом вызове инструмента. */
export async function readTail(path, maxBytes = 256 * 1024) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return '';
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

/** Размер контекста последнего запроса — «сколько сейчас». */
export function latestContextTokens(text) {
  const { requests } = parseTranscript(text);
  return requests.length === 0
    ? null
    : requests[requests.length - 1].contextTokens;
}
```

- [x] **Step 5: Прогнать тесты и убедиться, что они зелёные**

```bash
pnpm run test:scripts
```

Ожидается: `pass 7`, `fail 0`.

- [x] **Step 6: Проверить модуль на настоящем транскрипте**

```bash
node -e "import('./.claude/scripts/lib/transcript.mjs').then(async (m)=>{const fs=await import('node:fs/promises');const os=await import('node:os');const f=(await m.findTranscripts(os.homedir()+'/.claude/projects', process.cwd()))[0];const p=m.parseTranscript(await fs.readFile(f.path,'utf8'));console.log({file:f.path,requests:p.requests.length,compacts:p.compacts,top:m.carryCostByTool(p).slice(0,3)});})"
```

Ожидается: непустое число запросов и осмысленный топ инструментов. Если `requests: 0` — разбор не совпал с форматом, разбираться до перехода к следующей задаче.

- [x] **Step 7: Коммит**

```bash
git add .claude/scripts/lib/transcript.mjs .claude/scripts/lib/transcript.test.mjs package.json .lintstagedrc.json
git commit -m "feat: разбор транскриптов для отчёта по расходу контекста"
```

---

### Task 4: Форматирование отчёта — `lib/report.mjs`

Чистая функция: структура с числами → массив строк. Ничего не читает и не печатает, поэтому тестируется без файлов. Жёсткое требование спеки — вывод ≤30 строк; это проверяется тестом, а не глазами.

**Files:**

- Create: `.claude/scripts/lib/report.mjs`
- Create: `.claude/scripts/lib/report.test.mjs`

**Interfaces:**

- Consumes: ничего
- Produces:
  - `fmtTokens(n: number): string` — `447k`, `38.2M`, `11.5G`
  - `formatReport(data): string[]`, где

    ```
    data = {
      cap: number,
      current: { id: string, contextNow: number, requests: number, burned: number,
                 compacts: number, topTools: Array<{tool: string, tokens: number}> },
      project: { sessions: number, requests: number, burned: number, capped: number,
                 avgContext: number, over300: number, over500: number },
      sessions: Array<{ date: string, id: string, requests: number,
                        avgContext: number, burned: number }>
    }
    ```

    `over300`/`over500` — целые проценты. `sessions` печатается не более восьми строк.

- [x] **Step 1: Написать падающий тест**

Создать `.claude/scripts/lib/report.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTokens, formatReport } from './report.mjs';

const sample = {
  cap: 200_000,
  current: {
    id: '75b186',
    contextNow: 412_000,
    requests: 118,
    burned: 38_200_000,
    compacts: 0,
    topTools: [
      { tool: 'Read', tokens: 9_100_000 },
      { tool: 'Bash', tokens: 6_400_000 },
      { tool: 'Grep', tokens: 2_200_000 },
    ],
  },
  project: {
    sessions: 21,
    requests: 25_852,
    burned: 11_500_000_000,
    capped: 3_100_000_000,
    avgContext: 447_000,
    over300: 87,
    over500: 61,
  },
  sessions: Array.from({ length: 12 }, (_, i) => ({
    date: '2026-08-30',
    id: `sess${i}`,
    requests: 100 + i,
    avgContext: 300_000,
    burned: 30_000_000,
  })),
};

test('fmtTokens сокращает крупные числа', () => {
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(447_000), '447k');
  assert.equal(fmtTokens(38_200_000), '38.2M');
  assert.equal(fmtTokens(11_500_000_000), '11.5G');
});

test('formatReport укладывается в 30 строк', () => {
  assert.ok(
    formatReport(sample).length <= 30,
    'отчёт должен быть не длиннее 30 строк',
  );
});

test('formatReport показывает текущую сессию, проект и оценку экономии', () => {
  const text = formatReport(sample).join('\n');
  assert.match(text, /75b186/);
  assert.match(text, /412k/);
  assert.match(text, /Read 9\.1M/);
  assert.match(text, /11\.5G/);
  assert.match(text, /−73%/);
});

test('formatReport переживает пустой проект', () => {
  const empty = {
    cap: 200_000,
    current: {
      id: '—',
      contextNow: 0,
      requests: 0,
      burned: 0,
      compacts: 0,
      topTools: [],
    },
    project: {
      sessions: 0,
      requests: 0,
      burned: 0,
      capped: 0,
      avgContext: 0,
      over300: 0,
      over500: 0,
    },
    sessions: [],
  };
  const lines = formatReport(empty);
  assert.ok(lines.length <= 30);
  assert.match(lines.join('\n'), /—/);
});
```

- [x] **Step 2: Прогнать тесты и убедиться, что они падают**

```bash
pnpm run test:scripts
```

Ожидается: падение с `Cannot find module './report.mjs'`, тесты `transcript.test.mjs` при этом зелёные.

- [x] **Step 3: Написать `lib/report.mjs`**

```js
export function fmtTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(Math.round(value));
}

const MAX_SESSION_ROWS = 8;

export function formatReport({ cap, current, project, sessions }) {
  const lines = [];

  lines.push(`Текущая сессия ${current.id}`);
  lines.push(`  контекст сейчас     ${fmtTokens(current.contextNow)}`);
  lines.push(`  запросов к модели   ${current.requests}`);
  lines.push(`  сожжено             ${fmtTokens(current.burned)}`);
  lines.push(`  автокомпактов       ${current.compacts}`);
  const top =
    current.topTools.length === 0
      ? '—'
      : current.topTools
          .slice(0, 3)
          .map((t) => `${t.tool} ${fmtTokens(t.tokens)}`)
          .join(' · ');
  lines.push(`  дороже всего несут  ${top}`);

  lines.push('');
  lines.push(
    `Проект: сессий ${project.sessions}, запросов ${project.requests}`,
  );
  lines.push(`  сожжено всего       ${fmtTokens(project.burned)}`);
  lines.push(`  средний контекст    ${fmtTokens(project.avgContext)}`);
  lines.push(`  доля >300k / >500k  ${project.over300}% / ${project.over500}%`);

  lines.push('');
  lines.push('Последние сессии            запросов   ср. контекст   сожжено');
  if (sessions.length === 0) {
    lines.push('  —');
  }
  for (const s of sessions.slice(0, MAX_SESSION_ROWS)) {
    lines.push(
      `  ${s.date} ${s.id.padEnd(8)} ${String(s.requests).padStart(8)}` +
        `   ${fmtTokens(s.avgContext).padStart(12)}   ${fmtTokens(s.burned).padStart(7)}`,
    );
  }

  lines.push('');
  const saved =
    project.burned === 0
      ? 0
      : Math.round((1 - project.capped / project.burned) * 100);
  lines.push(
    `При потолке ${fmtTokens(cap)}: ${fmtTokens(project.capped)} вместо ` +
      `${fmtTokens(project.burned)} (−${saved}%)`,
  );

  return lines;
}
```

- [x] **Step 4: Прогнать тесты и убедиться, что они зелёные**

```bash
pnpm run test:scripts
```

Ожидается: `fail 0`, всего 11 тестов.

- [x] **Step 5: Коммит**

```bash
git add .claude/scripts/lib/report.mjs .claude/scripts/lib/report.test.mjs
git commit -m "feat: форматирование отчёта по расходу контекста"
```

---

### Task 5: Отчёт `/tokens`

Оболочка вокруг двух готовых модулей плюс слэш-команда. Текущей считается сессия с самым свежим `mtime` — её транскрипт дописывается прямо сейчас.

**Files:**

- Create: `.claude/scripts/tokens.mjs`
- Create: `.claude/commands/tokens.md`

**Interfaces:**

- Consumes: `findTranscripts`, `parseTranscript`, `carryCostByTool` из `lib/transcript.mjs`; `formatReport` из `lib/report.mjs`
- Produces: команда `/tokens`; переменная окружения `TOKENS_CAP` задаёт потолок для оценки экономии (по умолчанию 200000)

- [x] **Step 1: Написать `tokens.mjs`**

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  carryCostByTool,
  findTranscripts,
  parseTranscript,
} from './lib/transcript.mjs';
import { formatReport } from './lib/report.mjs';

const CAP = Number(process.env.TOKENS_CAP ?? 200_000);
const shortId = (id) => (id ?? '—').slice(0, 8);
const dateOf = (parsed) =>
  (parsed.requests[0]?.timestamp ?? '').slice(0, 10) || '——————————';

const files = await findTranscripts(
  join(homedir(), '.claude', 'projects'),
  process.cwd(),
);

const parsedFiles = [];
for (const file of files) {
  let parsed;
  try {
    parsed = parseTranscript(await readFile(file.path, 'utf8'));
  } catch {
    continue;
  }
  if (parsed.requests.length > 0) parsedFiles.push(parsed);
}

if (parsedFiles.length === 0) {
  console.log('Транскрипты проекта не найдены — отчёт строить не из чего.');
  process.exit(0);
}

const burnedOf = (parsed) =>
  parsed.requests.reduce((sum, r) => sum + r.contextTokens, 0);
const cappedOf = (parsed) =>
  parsed.requests.reduce((sum, r) => sum + Math.min(r.contextTokens, CAP), 0);

const [now, ...rest] = parsedFiles;
const nowRequests = now.requests;

const project = {
  sessions: parsedFiles.length,
  requests: parsedFiles.reduce((sum, p) => sum + p.requests.length, 0),
  burned: parsedFiles.reduce((sum, p) => sum + burnedOf(p), 0),
  capped: parsedFiles.reduce((sum, p) => sum + cappedOf(p), 0),
  avgContext: 0,
  over300: 0,
  over500: 0,
};
project.avgContext =
  project.requests === 0 ? 0 : Math.round(project.burned / project.requests);

let over300 = 0;
let over500 = 0;
for (const parsed of parsedFiles) {
  for (const request of parsed.requests) {
    if (request.contextTokens > 300_000) over300 += request.contextTokens;
    if (request.contextTokens > 500_000) over500 += request.contextTokens;
  }
}
const share = (part) =>
  project.burned === 0 ? 0 : Math.round((part / project.burned) * 100);
project.over300 = share(over300);
project.over500 = share(over500);

const report = formatReport({
  cap: CAP,
  current: {
    id: shortId(now.sessionId),
    contextNow: nowRequests[nowRequests.length - 1]?.contextTokens ?? 0,
    requests: nowRequests.length,
    burned: burnedOf(now),
    compacts: now.compacts,
    topTools: carryCostByTool(now).slice(0, 3),
  },
  project,
  sessions: rest.map((parsed) => ({
    date: dateOf(parsed),
    id: shortId(parsed.sessionId),
    requests: parsed.requests.length,
    avgContext: Math.round(burnedOf(parsed) / parsed.requests.length),
    burned: burnedOf(parsed),
  })),
});

console.log(report.join('\n'));
```

- [x] **Step 2: Запустить и посмотреть на вывод**

```bash
node .claude/scripts/tokens.mjs
```

Ожидается: осмысленный отчёт. Проверить длину:

```bash
node .claude/scripts/tokens.mjs | wc -l
```

Ожидается: число ≤ 30. Если больше — уменьшить `MAX_SESSION_ROWS` в `lib/report.mjs` и поправить тест длины.

- [x] **Step 3: Создать слэш-команду**

`.claude/commands/tokens.md`:

```markdown
---
description: Отчёт по расходу контекста — текущая сессия и история проекта
allowed-tools: Bash(node .claude/scripts/tokens.mjs)
---

!`node .claude/scripts/tokens.mjs`

Покажи отчёт выше как есть. Не пересказывай его и не читай никаких файлов ради
пояснений — весь смысл команды в том, чтобы в контекст попала только эта сводка.

Если контекст текущей сессии больше 300k, добавь ровно одну строку: назови ближайшую
безопасную точку выхода из раздела «Точки выхода» в `CLAUDE.md` или скажи, что её сейчас
нет и почему.
```

- [x] **Step 4: Проверить, что команда видна**

Перезапуск Claude Code не нужен — файлы команд подхватываются на лету. Убедиться, что файл на месте и его frontmatter валиден:

```bash
head -5 .claude/commands/tokens.md
```

Ожидается: строки frontmatter между `---`.

- [x] **Step 5: Прогнать все проверки**

```bash
pnpm run test:scripts
```

Ожидается: `fail 0`.

- [x] **Step 6: Коммит**

```bash
git add .claude/scripts/tokens.mjs .claude/commands/tokens.md
git commit -m "feat: слэш-команда /tokens — отчёт по расходу контекста"
```

---

### Task 6: Правила точки выхода — `lib/checkpoint-rules.mjs`

Вся логика решения «напоминать или нет» — три чистые функции. Ни git, ни stdin, ни файлов: только факты на входе, текст или `null` на выходе. Поэтому все шесть классов из спеки проверяются тестами, а не живым прогоном.

Классы из спеки:

- **А (чистим всегда, передача состояния не нужна)** — файл сам является передачей. А1 спека закоммичена, А2 план закоммичен, А3 PR смёржен, А4 артефакт записан на диск. Порога по контексту нет.
- **Б (чистим при выполнении условия)** — напоминаем, только когда контекст >200k. Порог здесь не триггер, а глушитель шума.
- **В (не чистим)** — классификацию делает модель, это понимание разговора, а не механика. Правила лишь не мешают: при грязном рабочем дереве и при красных проверках ничего не выдаётся.

Б1, Б2 и Б3 спеки в правилах не различаются, и это осознанно. Объективные факты у них одни и те же — коммит есть, дерево чистое, проверки зелёные; отличие («этап плана» против «починенного бага» против «смены темы») существует только в разговоре, а разговор хук не читает. Различать их значило бы гадать. Поэтому выдаётся один текст класса Б, а решение — про какой именно случай речь и не класс ли это В — остаётся модели.

**Files:**

- Create: `.claude/scripts/lib/checkpoint-rules.mjs`
- Create: `.claude/scripts/lib/checkpoint-rules.test.mjs`

**Interfaces:**

- Consumes: ничего
- Produces:
  - `classifyEvent(payload): 'commit'|'merge'|'checks'|'artifact'|null` — payload это hook-input Claude Code (`{tool_name, tool_input, tool_response}`)
  - `checksVerdict(toolResponse): 'green'|'red'|'unknown'`
  - `checkpointReminder(facts): string|null`, где

    ```
    facts = {
      event: 'commit'|'merge'|'artifact',
      commitSha: string|null,
      changedPaths: string[],      // пути файлов последнего коммита, через '/'
      worktreeClean: boolean,
      contextTokens: number|null,  // null = неизвестно
      checks: 'green'|'red'|'unknown',
      remindedSha: string|null     // по какому sha уже напоминали в этой сессии
    }
    ```

  - `CONTEXT_THRESHOLD = 200_000`

- [x] **Step 1: Написать падающий тест**

Создать `.claude/scripts/lib/checkpoint-rules.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEvent,
  checksVerdict,
  checkpointReminder,
} from './checkpoint-rules.mjs';

const facts = (over = {}) => ({
  event: 'commit',
  commitSha: 'abc1234',
  changedPaths: [],
  worktreeClean: true,
  contextTokens: 250_000,
  checks: 'green',
  remindedSha: null,
  ...over,
});

test('classifyEvent узнаёт коммит, мёрж и прогон проверок', () => {
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(classifyEvent(bash('git commit -m "feat: X"')), 'commit');
  assert.equal(classifyEvent(bash('gh pr merge 42 --squash')), 'merge');
  assert.equal(classifyEvent(bash('pnpm test')), 'checks');
  assert.equal(
    classifyEvent(bash('pnpm --filter server run typecheck')),
    'checks',
  );
  assert.equal(classifyEvent(bash('ls -la')), null);
});

test('classifyEvent считает событием только запись пака', () => {
  const write = (file_path) => ({
    tool_name: 'Write',
    tool_input: { file_path },
  });
  assert.equal(classifyEvent(write('C:\\proj\\packs\\kino.json')), 'artifact');
  assert.equal(classifyEvent(write('packs/kino.json')), 'artifact');
  assert.equal(classifyEvent(write('server/src/room.ts')), null);
  assert.equal(classifyEvent({ tool_name: 'Read', tool_input: {} }), null);
});

test('checksVerdict читает вывод прогона', () => {
  assert.equal(
    checksVerdict({ stdout: 'Test Files  12 passed (12)' }),
    'green',
  );
  assert.equal(
    checksVerdict({ stdout: 'Test Files  1 failed | 11 passed' }),
    'red',
  );
  assert.equal(
    checksVerdict({ stderr: 'src/room.ts(10,3): error TS2345: ...' }),
    'red',
  );
  assert.equal(checksVerdict({ stderr: 'ELIFECYCLE  Command failed' }), 'red');
  assert.equal(checksVerdict({ stdout: 'что-то другое' }), 'unknown');
  assert.equal(checksVerdict(undefined), 'unknown');
});

test('класс А1: закоммиченная спека — чистим без порога по контексту', () => {
  const text = checkpointReminder(
    facts({
      changedPaths: [
        'docs/superpowers/specs/2026-08-30-token-budget-design.md',
      ],
      contextTokens: 40_000,
    }),
  );
  assert.match(text, /А1/);
  assert.match(text, /\/clear/);
});

test('класс А2: закоммиченный план', () => {
  const text = checkpointReminder(
    facts({
      changedPaths: ['docs/superpowers/plans/2026-08-30-token-budget.md'],
    }),
  );
  assert.match(text, /А2/);
});

test('класс А3: смёрженный PR напоминает про устные правила ревью', () => {
  const text = checkpointReminder(facts({ event: 'merge', changedPaths: [] }));
  assert.match(text, /А3/);
  assert.match(text, /CLAUDE\.md/);
});

test('класс А4: записанный пак — даже при грязном дереве', () => {
  // Запись пака сама и делает дерево грязным, поэтому чистота тут не условие.
  const text = checkpointReminder(
    facts({
      event: 'artifact',
      commitSha: null,
      worktreeClean: false,
      changedPaths: [],
    }),
  );
  assert.match(text, /А4/);
});

test('класс Б: коммит без спеки и плана — только выше порога', () => {
  assert.equal(checkpointReminder(facts({ contextTokens: 150_000 })), null);
  const text = checkpointReminder(facts({ contextTokens: 250_000 }));
  assert.match(text, /класс Б/);
  assert.match(text, /\/handoff/);
});

test('класс Б молчит, когда проверки красные или не прогонялись', () => {
  assert.equal(checkpointReminder(facts({ checks: 'red' })), null);
  const unknown = checkpointReminder(facts({ checks: 'unknown' }));
  assert.match(unknown, /подтверди/);
});

test('грязное рабочее дерево глушит все классы, кроме А4', () => {
  assert.equal(
    checkpointReminder(
      facts({
        worktreeClean: false,
        changedPaths: ['docs/superpowers/plans/x.md'],
      }),
    ),
    null,
  );
  assert.equal(checkpointReminder(facts({ worktreeClean: false })), null);
});

test('неизвестный размер контекста глушит класс Б, но не класс А', () => {
  assert.equal(checkpointReminder(facts({ contextTokens: null })), null);
  assert.match(
    checkpointReminder(
      facts({
        contextTokens: null,
        changedPaths: ['docs/superpowers/specs/x-design.md'],
      }),
    ),
    /А1/,
  );
});

test('по одному и тому же коммиту напоминаем один раз', () => {
  assert.equal(checkpointReminder(facts({ remindedSha: 'abc1234' })), null);
});

test('любое напоминание короче 400 символов', () => {
  const cases = [
    facts({ changedPaths: ['docs/superpowers/specs/x-design.md'] }),
    facts({ changedPaths: ['docs/superpowers/plans/x.md'] }),
    facts({ event: 'merge' }),
    facts({ event: 'artifact', changedPaths: ['packs/x.json'] }),
    facts({}),
    facts({ checks: 'unknown' }),
  ];
  for (const c of cases) {
    const text = checkpointReminder(c);
    assert.ok(text, 'ожидалось напоминание');
    assert.ok(text.length <= 400, `слишком длинно: ${text.length}`);
  }
});
```

- [x] **Step 2: Прогнать тесты и убедиться, что они падают**

```bash
pnpm run test:scripts
```

Ожидается: падение с `Cannot find module './checkpoint-rules.mjs'`.

- [x] **Step 3: Написать `lib/checkpoint-rules.mjs`**

```js
export const CONTEXT_THRESHOLD = 200_000;

const PACK_PATH = /(^|\/)packs\/[^/]+\.json$/;
const SPEC_PATH = /^docs\/superpowers\/specs\/.+\.md$/;
const PLAN_PATH = /^docs\/superpowers\/plans\/.+\.md$/;

const slashes = (path) => (path ?? '').replace(/\\/g, '/');

/** Что за событие только что произошло. null — повод ничего не делать и выйти. */
export function classifyEvent(payload) {
  const tool = payload?.tool_name;

  if (tool === 'Write' || tool === 'Edit') {
    return PACK_PATH.test(slashes(payload.tool_input?.file_path))
      ? 'artifact'
      : null;
  }

  if (tool !== 'Bash') return null;
  const command = payload.tool_input?.command ?? '';
  if (/\bgh\s+pr\s+merge\b/.test(command)) return 'merge';
  if (/\bgit\s+commit\b/.test(command)) return 'commit';
  if (/\bpnpm\b[^|;&]*\b(test|typecheck)\b/.test(command)) return 'checks';
  return null;
}

/**
 * Хук не может запускать проверки сам — это десятки секунд на каждом вызове инструмента.
 * Поэтому он читает вывод чужого прогона. Когда маркеров нет, честный ответ — 'unknown'.
 */
export function checksVerdict(toolResponse) {
  const text = `${toolResponse?.stdout ?? ''}\n${toolResponse?.stderr ?? ''}`;
  if (/\b\d+ failed\b|\berror TS\d+\b|ELIFECYCLE/i.test(text)) return 'red';
  if (/Test Files\s+\d+ passed|\bno errors\b/i.test(text)) return 'green';
  return 'unknown';
}

const TEXTS = {
  А1:
    'Точка выхода, класс А1: спека закоммичена, рабочее дерево чистое. Дальше writing-plans ' +
    'стартует с файла — контекст можно чистить (/clear). Если в разговоре остались устные ' +
    'решения, которых нет в спеке, сначала допиши их туда.',
  А2:
    'Точка выхода, класс А2: план закоммичен, рабочее дерево чистое. Дальше executing-plans ' +
    'стартует с файла — контекст можно чистить (/clear).',
  А3:
    'Точка выхода, класс А3: PR смёржен. Перед /clear занеси в CLAUDE.md устные правила, ' +
    'которые прозвучали в ревью, — иначе они останутся только в этом контексте.',
  А4:
    'Точка выхода, класс А4: артефакт записан на диск. Файл сам является передачей ' +
    'состояния — контекст можно чистить (/clear), не забыв закоммитить сам файл.',
};

const classB = (checks) =>
  'Точка выхода, класс Б: коммит есть, дерево чистое, контекст выше 200k. ' +
  (checks === 'unknown'
    ? 'Проверки в этой сессии не прогонялись — подтверди их сам. '
    : '') +
  'Если это не середина многофайловой правки и нет незакрытых вопросов — /handoff, потом /clear.';

/** Факты → текст напоминания или null. Класс В остаётся на усмотрение модели. */
export function checkpointReminder(facts) {
  // Записанный пак сам и делает дерево грязным — требовать чистоты тут нечестно.
  if (facts?.event === 'artifact') return TEXTS.А4;

  if (!facts?.worktreeClean) return null;
  if (facts.commitSha && facts.commitSha === facts.remindedSha) return null;

  const paths = (facts.changedPaths ?? []).map(slashes);

  if (facts.event === 'merge') return TEXTS.А3;
  if (paths.some((p) => PLAN_PATH.test(p))) return TEXTS.А2;
  if (paths.some((p) => SPEC_PATH.test(p))) return TEXTS.А1;
  if (paths.some((p) => PACK_PATH.test(p))) return TEXTS.А4;

  if (facts.event !== 'commit') return null;
  if (facts.checks === 'red') return null;
  if (facts.contextTokens === null || facts.contextTokens < CONTEXT_THRESHOLD)
    return null;
  return classB(facts.checks);
}
```

- [x] **Step 4: Прогнать тесты и убедиться, что они зелёные**

```bash
pnpm run test:scripts
```

Ожидается: `fail 0`, всего 24 теста.

- [x] **Step 5: Коммит**

```bash
git add .claude/scripts/lib/checkpoint-rules.mjs .claude/scripts/lib/checkpoint-rules.test.mjs
git commit -m "feat: правила напоминания о безопасной точке выхода"
```

---

### Task 7: Хук — `checkpoint.mjs` и `.claude/settings.json`

Тонкая оболочка: прочитать payload со stdin, собрать факты, позвать правила, напечатать hook JSON. Три требования, которые важнее удобства кода:

1. **Не блокирует.** Всегда `exit 0`. Никакого `decision: "block"`, ничего в stderr. Любое исключение — тихий выход.
2. **Не тормозит.** Если событие не распознано (а это подавляющее большинство вызовов Bash), выход происходит до единого обращения к git и к диску.
3. **Не читает лишнего.** Из транскрипта берётся хвост 256 КБ, а не файл целиком.

Канал доставки текста модели — `hookSpecificOutput.additionalContext`. `PostToolUse` входит в объединение `hookSpecificOutput` в схемах Claude Code, поэтому JSON валиден и текст доходит.

**Files:**

- Create: `.claude/scripts/checkpoint.mjs`
- Create: `.claude/settings.json`
- Modify: `.gitignore` — добавить `.claude/state/`

**Interfaces:**

- Consumes: `classifyEvent`, `checksVerdict`, `checkpointReminder` из `lib/checkpoint-rules.mjs`; `readTail`, `latestContextTokens`, `projectSlug` из `lib/transcript.mjs`
- Produces: файл состояния `.claude/state/checkpoint-<sessionId>.json` вида `{ "checks": "green"|"red"|"unknown", "remindedSha": string|null }`

- [x] **Step 1: Написать `checkpoint.mjs`**

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  classifyEvent,
  checksVerdict,
  checkpointReminder,
} from './lib/checkpoint-rules.mjs';
import {
  latestContextTokens,
  projectSlug,
  readTail,
} from './lib/transcript.mjs';

/** Единственный выход из скрипта. Молчание — тоже допустимый ответ. */
function emit(text) {
  if (text) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: text,
        },
      }),
    );
  }
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { checks: 'unknown', remindedSha: null };
  }
}

async function saveState(dir, path, state) {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(state), 'utf8');
  } catch {
    // состояние — оптимизация, а не источник истины
  }
}

async function contextTokens(payload, cwd) {
  const direct = payload.transcript_path;
  const fallback =
    payload.session_id &&
    join(
      homedir(),
      '.claude',
      'projects',
      projectSlug(cwd),
      `${payload.session_id}.jsonl`,
    );
  for (const path of [direct, fallback]) {
    if (!path) continue;
    try {
      const tokens = latestContextTokens(await readTail(path));
      if (tokens !== null) return tokens;
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return emit(null);
  }

  const event = classifyEvent(payload);
  if (!event) return emit(null); // быстрый выход: ни git, ни диска

  const cwd = payload.cwd ?? process.cwd();
  const stateDir = join(cwd, '.claude', 'state');
  const statePath = join(
    stateDir,
    `checkpoint-${payload.session_id ?? 'unknown'}.json`,
  );
  const state = await loadState(statePath);

  if (event === 'checks') {
    const verdict = checksVerdict(payload.tool_response);
    if (verdict !== 'unknown')
      await saveState(stateDir, statePath, { ...state, checks: verdict });
    return emit(null); // сам по себе прогон проверок точкой выхода не является
  }

  const status = git(cwd, ['status', '--porcelain']);
  const worktreeClean = status !== null && status.trim() === '';
  const commitSha = git(cwd, ['rev-parse', 'HEAD'])?.trim() ?? null;
  const changedPaths = (
    git(cwd, ['show', '--name-only', '--format=', 'HEAD']) ?? ''
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const text = checkpointReminder({
    event,
    commitSha,
    changedPaths,
    worktreeClean,
    contextTokens: await contextTokens(payload, cwd),
    checks: state.checks ?? 'unknown',
    remindedSha: state.remindedSha ?? null,
  });

  if (text && commitSha)
    await saveState(stateDir, statePath, { ...state, remindedSha: commitSha });
  return emit(text);
}

main().catch(() => emit(null));
```

- [x] **Step 2: Создать `.claude/settings.json`**

Файл в git — это общая для машин конфигурация; персональные разрешения остаются в `settings.local.json`, который в `.gitignore`. Путь к скрипту относительный: хук запускается с рабочим каталогом проекта, и в воркtree он тоже разрешится правильно, потому что `.claude/scripts/` лежит в git.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/scripts/checkpoint.mjs",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [x] **Step 3: Игнорировать файлы состояния**

В конец `.gitignore` добавить:

```gitignore
# Состояние хука точек выхода (.claude/scripts/checkpoint.mjs) — на сессию, не на репозиторий
.claude/state/
```

- [x] **Step 4: Проверить молчание на нерелевантном событии**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"},"cwd":"'"$PWD"'"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
```

Ожидается: пустой вывод и `EXIT:0`.

- [x] **Step 5: Проверить срабатывание класса А2 на настоящем репозитории**

Последний коммит на этот момент — коммит правил из Task 6, файла плана в нём нет, поэтому сначала сделать проверку на подставленном событии мёржа (оно не смотрит на пути):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 1 --squash"},"cwd":"'"$PWD"'"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
```

Ожидается: JSON с `hookSpecificOutput.additionalContext`, внутри текст про класс А3, и `EXIT:0`.

- [x] **Step 6: Проверить, что грязное дерево глушит хук**

```bash
echo "мусор" > .checkpoint-probe && echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 1 --squash"},"cwd":"'"$PWD"'"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"; rm .checkpoint-probe
```

Ожидается: пустой вывод и `EXIT:0`. Это прямая проверка из раздела «Проверка» спеки: хук не срабатывает при грязном рабочем дереве.

- [x] **Step 7: Замерить, что хук не задерживает вызов инструмента**

```bash
time (echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"'"$PWD"'"}' | node .claude/scripts/checkpoint.mjs)
```

Ожидается: доли секунды, целиком на старт Node. Если больше секунды — быстрый выход не сработал, разбираться.

- [x] **Step 8: Убедиться, что состояние не попадает в git**

```bash
git status --porcelain .claude/state
```

Ожидается: пустой вывод (каталога может ещё не быть — это тоже пусто).

- [x] **Step 9: Коммит**

```bash
git add .claude/scripts/checkpoint.mjs .claude/settings.json .gitignore
git commit -m "feat: неблокирующий хук с напоминанием о точке выхода"
```

---

### Task 8: Слэш-команда `/handoff`

Для класса Б нужна передача состояния. Спека прямо запрещает плодить новые файлы: секция «Состояние» дописывается в конец соответствующего файла в `docs/superpowers/plans/`, чтобы состояние ехало в git вместе с фичей.

**Files:**

- Create: `.claude/commands/handoff.md`

**Interfaces:**

- Consumes: раздел «Точки выхода» в `CLAUDE.md` (Task 2)
- Produces: соглашение о секции «## Состояние» в файлах `docs/superpowers/plans/*.md`

- [x] **Step 1: Создать `.claude/commands/handoff.md`**

````markdown
---
description: Дописать секцию «Состояние» в файл плана перед очисткой контекста
---

Перед очисткой контекста надо вынести из него то, что нигде не записано.

Сначала проверь, не класс ли это В — тогда чистить нельзя и команда не выполняется.
Признаки: красные тесты или падающая сборка; незакоммиченные правки, которые ещё
обсуждаются; идущая отладка с неподтверждённой гипотезой; заданный и неотвеченный
вопрос; середина многофайловой правки; прочитанные, но не отработанные комментарии к PR.
Если попал хоть один — скажи, какой именно, и остановись.

Дальше найди файл плана текущей работы в `docs/superpowers/plans/`. Если работа идёт не
по плану (разовый багфикс, разведка) — скажи об этом и предложи, куда записать состояние,
но нового файла не создавай.

Допиши в **конец** файла плана секцию ровно такого вида, заменив содержимое на настоящее:

```markdown
## Состояние на 2026-08-30

- Сделано: задачи 1–4, последний коммит `abc1234`.
- Следующий шаг: задача 5, начать с падающего теста в `.claude/scripts/lib/report.test.mjs`.
- Файлы в работе: `.claude/scripts/tokens.mjs` (создан, не закоммичен).
- Решения, принятые устно: потолок для оценки экономии — 200k, а не 150k.
```

Правила для секции:

- Только то, чего нет ни в коде, ни в коммитах, ни в самом плане. Пересказ diff'а не нужен.
- «Решения, принятые устно» — самое важное поле: это единственное, что живёт только в
  контексте и исчезнет насовсем.
- Если такая секция уже есть, обнови её, а не добавляй вторую.

Закоммить файл плана:

```bash
git add docs/superpowers/plans/<файл>.md
git commit -m "docs: состояние работы перед очисткой контекста"
```

Затем одной строкой скажи, что контекст можно чистить через `/clear`.
````

- [x] **Step 2: Проверить frontmatter**

```bash
head -4 .claude/commands/handoff.md
```

Ожидается: строка `---`, строка `description: ...`, строка `---`.

- [x] **Step 3: Прогнать Prettier**

```bash
pnpm exec prettier --write .claude/commands/handoff.md .claude/commands/tokens.md
```

Ожидается: оба файла отформатированы без ошибок разбора.

- [x] **Step 4: Коммит**

```bash
git add .claude/commands/handoff.md .claude/commands/tokens.md
git commit -m "feat: слэш-команда /handoff — передача состояния перед очисткой"
```

---

### Task 9: Приёмка по разделу «Проверка» спеки

Каждый пункт раздела «Проверка» в спеке прогоняется явно, вывод сверяется с ожиданием. Отдельная задача, потому что часть пунктов проверяет систему целиком, а не отдельный файл.

**Files:**

- Modify: `docs/superpowers/plans/2026-08-30-token-budget.md` — отметить выполненные шаги

**Interfaces:**

- Consumes: всё, сделанное в задачах 1–8
- Produces: ничего

- [x] **Step 1: `/tokens` отрабатывает и укладывается в ≤30 строк**

```bash
node .claude/scripts/tokens.mjs | tee /dev/stderr | wc -l
```

Ожидается: осмысленный отчёт и число ≤ 30.

- [x] **Step 2: Хук срабатывает на коммите**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"docs: x\""},"cwd":"'"$PWD"'","session_id":"probe"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
```

Ожидается `EXIT:0`. Текст будет либо пустой (контекст ниже порога — это штатно), либо JSON с `additionalContext`. Чтобы увидеть срабатывание независимо от текущего контекста, повторить на коммите с планом — последний коммит Task 8 меняет `.claude/commands/`, поэтому проверить путь через мёрж:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 1"},"cwd":"'"$PWD"'","session_id":"probe"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
```

Ожидается: JSON с текстом про класс А3, `EXIT:0`.

- [x] **Step 3: Хук не срабатывает при грязном рабочем дереве**

```bash
echo "мусор" > .checkpoint-probe && echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 1"},"cwd":"'"$PWD"'","session_id":"probe"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"; rm .checkpoint-probe
```

Ожидается: пустой вывод, `EXIT:0`.

- [x] **Step 4: Ни один хук не блокирует и не задерживает вызов инструмента**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"'"$PWD"'"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
echo 'не json' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
echo '{}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"cwd":"/несуществующий/путь"}' | node .claude/scripts/checkpoint.mjs; echo "EXIT:$?"
```

Ожидается: четыре раза `EXIT:0`, ни одной строки в stderr, ни одного `decision`.

- [x] **Step 5: `pnpm test`, `pnpm typecheck`, `pnpm lint` зелёные**

```bash
pnpm test
```

Ожидается: vitest зелёный в обеих областях и `fail 0` у `node --test` (24 теста).

```bash
pnpm typecheck
```

Ожидается: без ошибок. Скрипты на `.mjs` под `tsc` не попадают — `server/tsconfig.scripts.json` включает только `src` и `scripts` внутри `server/`.

```bash
pnpm lint
```

Ожидается: без ошибок. `pnpm lint` — это `pnpm -r run lint`, он проходит только по рабочим областям, `.claude/scripts` не линтуется; форматирование этих файлов держит Prettier через lint-staged.

- [ ] **Step 6: Живая проверка хука в Claude Code**

Перезапустить Claude Code (хуки читаются при старте сессии), сделать любой коммит и посмотреть, что: работа не задержалась; при чистом дереве и контексте выше 200k пришла пометка; повторный коммит того же sha пометку не продублировал.

Если хук не сработал — проверить, что он вообще зарегистрирован: `.claude/settings.json` должен быть подхвачен, а не перекрыт `settings.local.json`.

Рестарт сессии агент себе выполнить не может, поэтому вместо него — прямое наблюдение в
уже идущей сессии. Коммит Step 7 (правка этого же файла плана) сам оказался настоящим
git-путём: реальный PostToolUse-хук на реальном `git commit` вернул `additionalContext` с
текстом класса А2 («план закоммичен, можно /clear») без заметной задержки, а
`.claude/state/checkpoint-<session>.json` после коммита показывает `remindedSha`, равный
новому HEAD — дедуп по sha технически подтверждён этим же значением (совпадает с тем, что
проверяют юнит- и интеграционные тесты). `settings.local.json` не содержит ключа `hooks`,
то есть не может перекрыть регистрацию из `settings.json`. Не проверено: собственно перезапуск
процесса Claude Code (что хуки читаются заново при старте) — вне досягаемости агента, чинить
не пытался.

- [x] **Step 7: Отметить прогресс в плане и закоммитить**

```bash
git add docs/superpowers/plans/2026-08-30-token-budget.md
git commit -m "docs: отметить выполнение плана по расходу токенов"
```

---

## Порядок и зависимости

Задачи 1 и 2 независимы от остальных и друг от друга — их можно делать в любом порядке и параллельно. Задача 3 — фундамент для 4, 5 и 7. Задача 6 независима от 3–5, но нужна для 7. Задача 8 зависит только от 2. Задача 9 — последняя.

```
1 ─────────────────────────────┐
2 ──────────────┬── 8 ─────────┤
3 ── 4 ── 5 ────┤              ├── 9
     └───────── 7 ── (6) ──────┘
6 ─────────────┘
```

## Чего этот план сознательно не делает

- **Не меряет эффект автоматически.** Спека обещает ~20% от частей 1–2 и ~50% от части 4. Проверить это можно только сравнением `/tokens` через пару недель работы, а не тестом. Единственный честный шаг — снять показания `/tokens` сразу после Task 5 и записать их в секцию «Состояние» плана, чтобы через две недели было с чем сравнивать.
- **Не трогает `context7`.** Ноль вызовов, но всего два определения инструментов — спека явно оставляет его.
- **Не вводит порогов по токенам как триггеров очистки.** Порог 200k в классе Б — глушитель шума, а не условие: он решает, показывать ли напоминание, а не безопасна ли очистка.
- **Не блокирует ничего.** Хук может ошибиться в обе стороны; цена ошибки — лишняя строка в контексте или её отсутствие.

## Замер «до» — `/tokens` перед слиянием (2026-09-01)

Честный шаг из раздела выше («снять показания `/tokens`... чтобы через две недели было
с чем сравнивать») не был сделан после Task 5. Ловим его здесь, перед слиянием ветки —
позже сравнивать будет не с чем. Вывод `node .claude/scripts/tokens.mjs` на момент финальной
правки ревью (сессия уже включает саму работу над этой веткой, эталоном «чистого до» это не
является, но это единственная база, которая у нас есть):

```
Текущая сессия 7167d466
  контекст сейчас     270k
  запросов к модели   157
  сожжено             26.4M
  автокомпактов       0
  дороже всего несут  Bash 2.5M · Agent 1.5M · Write 55k

Проект: сессий 28, запросов 19158
  сожжено всего       8.8G
  средний контекст    457k
  доля >300k / >500k  87% / 63%

Последние сессии            запросов   ср. контекст   сожжено
  2026-08-29 63788a2b       27            88k      2.4M
  2026-08-29 13485a12       62           109k      6.8M
  2026-08-29 0be17c32       30            83k      2.5M
  2026-08-28 5d065415      333           394k    131.1M
  2026-08-27 82bbd7e7      716           487k    348.4M
  2026-08-24 0e81a538      341           443k    151.2M
  2026-08-24 4073f672      319           423k    135.0M
  2026-08-24 4263d6e0      731           413k    301.8M

При потолке 200k: 3.6G вместо 8.8G (−59%)
```

Дальнейшие сессии (после слияния, с работающим `CLAUDE.md`, `/handoff` и хуком-напоминателем)
сравнивать с этим `/tokens` — средний контекст 457k и доля >300k/>500k здесь и есть база.
