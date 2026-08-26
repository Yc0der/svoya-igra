# Анкета интересов игроков (слайс D1) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** человек заполняет анкету об интересах в отдельной HTML-странице, присылает код ведущему, тот вставляет его в `/admin`, и генератор собирает пак под тех, кто реально будет за столом.

**Architecture:** три независимые части. Страница анкеты — самодостаточный HTML-файл вне приложения, без сборки и без сети. Сервер получает код, разбирает его чистыми функциями и пишет `docs/players.md` — тот же приём «чистый разбор + атомарная запись», что уже работает для профиля генератора. Правила сборки пака — текст в skill'е генератора, кода не требуют. Движок и `Room` не трогаются.

**Tech Stack:** TypeScript, Vitest, React (только новый раздел в существующей админке). Никаких новых зависимостей — и это требование, а не наблюдение.

**Спека:** [2026-08-26-player-questionnaire-design.md](../specs/2026-08-26-player-questionnaire-design.md) — источник всех решений ниже; при расхождении права спека.

## Global Constraints

- **Движок (`engine.ts`) и `Room` (`room.ts`) не трогаются вообще.** Анкета живёт вне партии.
- **`docs/anketa.html` — один файл без единой внешней ссылки.** Ни шрифтов, ни картинок, ни скриптов по URL: страница открывается с `file://` на чужом телефоне, где интернета может не быть.
- **Копирование JSON обязано работать без `navigator.clipboard`.** API требует защищённого контекста; JSON всегда лежит в видимом текстовом поле, кнопка — удобство поверх.
- **Всё, что пришло из анкеты, — чужой текст.** Имя и примеры перед записью в markdown прогоняются через `oneLine()`; тест на это обязателен и обязан падать при снятой защите.
- **Модули разбора не обращаются к часам и к диску.** Дата приходит параметром, как уже сделано в `generatorProfile.ts`.
- **Персонализация попадает в то, какие темы появятся, а не в то, насколько они трудны.** Сложность калибруется на весь стол.
- Комментарии и текст — по-русски. Prettier + ESLint, 2 пробела, одинарные кавычки, точки с запятой.
- Готово — только когда зелено `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Файловая структура

| Файл                                     | Что делает                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `server/src/markdownSection.ts`          | **создаётся** — общие `sectionEnd` и `findSectionRange`, вынесенные из `profileSection.ts` |
| `server/src/profileSection.ts`           | **изменяется** — берёт `findSectionRange` из общего модуля                                 |
| `server/src/playerCard.ts`               | **создаётся** — разбор кода анкеты и разметка раздела игрока, чистые функции               |
| `server/src/playersFile.ts`              | **создаётся** — чтение и атомарная запись `docs/players.md`                                |
| `server/src/protocol.ts`                 | **изменяется** — два клиентских и три серверных сообщения                                  |
| `server/src/server.ts`                   | **изменяется** — обработчики, `playersPath` в опциях                                       |
| `server/src/index.ts`                    | **изменяется** — `PLAYERS_PATH` и проводка                                                 |
| `client/src/useAdminConnection.ts`       | **изменяется** — отправка кода и состояние списка                                          |
| `client/src/Admin.tsx`                   | **изменяется** — раздел «Анкеты игроков»                                                   |
| `docs/anketa.html`                       | **создаётся** — страница анкеты                                                            |
| `docs/players.md`                        | **создаётся** — заготовка с вводным текстом                                                |
| `.claude/skills/pack-generator/SKILL.md` | **изменяется** — Шаг 0 и Шаг 1                                                             |
| `docs/ideas.md`                          | **изменяется** — статус слайса D                                                           |

---

### Task 1: Разбор и разметка анкеты

**Files:**

- Create: `server/src/markdownSection.ts`, `server/src/markdownSection.test.ts`
- Modify: `server/src/profileSection.ts`
- Create: `server/src/playerCard.ts`, `server/src/playerCard.test.ts`

**Interfaces:**

- Consumes: ничего нового.
- Produces: `sectionEnd(lines: string[], start: number)` и `findSectionRange(lines: string[], heading: string)` из `markdownSection.ts`; `PlayerCard`, `ParsedCard`, `parsePlayerCard`, `renderPlayerSection`, `upsertPlayerSection`, `listPlayers`, `oneLine` из `playerCard.ts`. Задачи 2–3 работают только с этими именами.

- [ ] **Шаг 1: Вынести `findSectionRange` в общий модуль**

Сейчас функция лежит приватной в `server/src/profileSection.ts` и знает про свой заголовок через замыкание на `AUTO_HEADING`. Разделы игроков ищутся ровно так же, и дублировать вместе с функцией её объяснение нельзя — комментарий про отступ разойдётся с одной из копий при первой же правке.

Создать `server/src/markdownSection.ts`:

```ts
/**
 * Границы раздела markdown в списке строк: [start, end). Конец — первая
 * строка после заголовка, начинающая новый раздел («## ») или разделитель
 * («---»); сама она в раздел не входит и не трогается.
 *
 * Сравнение идёт по началу строки без обрезки отступа — это не небрежность:
 * многострочные значения вставляются в разделы с отступом, и такая строка не
 * должна считаться границей.
 *
 * Общий для профиля генератора (profileSection.ts, слайс B) и анкет игроков
 * (playerCard.ts, слайс D1): один и тот же приём с одним и тем же
 * обоснованием, и вторая копия неизбежно разошлась бы с первой.
 */
export function sectionEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.startsWith('## ') || line.startsWith('---')) break;
    end += 1;
  }
  return end;
}

export function findSectionRange(
  lines: string[],
  heading: string,
): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return null;
  return { start, end: sectionEnd(lines, start) };
}
```

**Две функции, а не одна, и это не дробление ради дробления.** Поиск по началу строки нужен профилю: заголовок там ищется как `## Автособранное`, а в файле может лежать `## Автособранное (будет позже)`. Разделам игроков он опасен: `'## Ваня и Катя'.startsWith('## Ваня')` истинно, и заголовок одного игрока нашёл бы раздел другого. Поэтому `playerCard.ts` находит строку сам, точным сравнением имени, и просит у общего модуля только конец раздела.

В `profileSection.ts` удалить локальную копию, импортировать общую и передавать `AUTO_HEADING` вторым аргументом в обоих местах вызова (`parseAcknowledged`, `spliceAutoSection`).

- [ ] **Шаг 2: Прогнать тесты слайса B — они обязаны остаться зелёными**

Run: `pnpm -C server exec vitest run src/profileSection.test.ts src/generatorProfile.test.ts`
Expected: PASS, без единой правки в тестах. Если что-то покраснело — вынос сделан неверно, чинить вынос, а не тесты.

- [ ] **Шаг 3: Тест общего модуля**

Создать `server/src/markdownSection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findSectionRange, sectionEnd } from './markdownSection.js';

describe('sectionEnd', () => {
  it('доводит раздел до следующего заголовка', () => {
    expect(sectionEnd(['## Ваня', 'тело', '', '## Катя'], 0)).toBe(3);
  });

  it('не путает раздел с тем, чьё имя начинается так же', () => {
    // '## Ваня и Катя'.startsWith('## Ваня') истинно — ради этого случая
    // playerCard.ts находит строку сам и зовёт sectionEnd, а не поиск по
    // началу строки.
    const lines = ['## Ваня и Катя', 'чужое', '## Ваня', 'своё'];
    expect(sectionEnd(lines, 2)).toBe(4);
  });
});

describe('findSectionRange', () => {
  it('находит раздел до следующего заголовка', () => {
    const lines = ['# Файл', '', '## Ваня', 'тело', '', '## Катя', 'тело'];
    expect(findSectionRange(lines, '## Ваня')).toEqual({ start: 2, end: 5 });
  });

  it('доводит последний раздел до конца файла', () => {
    const lines = ['## Ваня', 'тело', ''];
    expect(findSectionRange(lines, '## Ваня')).toEqual({ start: 0, end: 3 });
  });

  it('останавливается на разделителе', () => {
    const lines = ['## Ваня', 'тело', '---', '## Катя'];
    expect(findSectionRange(lines, '## Ваня')).toEqual({ start: 0, end: 2 });
  });

  it('не считает границей строку с отступом', () => {
    const lines = ['## Ваня', '  ## не заголовок', '  ---', '## Катя'];
    expect(findSectionRange(lines, '## Ваня')).toEqual({ start: 0, end: 3 });
  });

  it('отдаёт null, когда заголовка нет', () => {
    expect(findSectionRange(['# Файл', 'тело'], '## Ваня')).toBeNull();
  });
});
```

- [ ] **Шаг 4: Написать падающие тесты разбора и разметки**

Создать `server/src/playerCard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  listPlayers,
  oneLine,
  parsePlayerCard,
  renderPlayerSection,
  upsertPlayerSection,
  type PlayerCard,
} from './playerCard.js';

const CODE = JSON.stringify({
  version: 1,
  name: 'Ваня',
  interests: [
    { area: 'Кино и сериалы', examples: ['Драйв', 'Во все тяжкие'] },
    { area: 'Спорт', examples: ['Формула-1'] },
  ],
  boring: ['Политика', 'Мода'],
});

const CARD: PlayerCard = {
  name: 'Ваня',
  interests: [
    { area: 'Кино и сериалы', examples: ['Драйв', 'Во все тяжкие'] },
    { area: 'Спорт', examples: ['Формула-1'] },
  ],
  boring: ['Политика', 'Мода'],
};

const FILE = [
  '# Анкеты игроков',
  '',
  'Вводный текст.',
  '',
  '---',
  '',
  '## Ваня',
  '',
  '_Анкета от 2026-08-01._',
  '',
  '- **Спорт:** старое',
  '',
  '## Катя',
  '',
  '_Анкета от 2026-08-02._',
  '',
  '- **Музыка:** джаз',
  '',
].join('\n');

describe('parsePlayerCard', () => {
  it('разбирает корректный код', () => {
    const result = parsePlayerCard(CODE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.card).toEqual(CARD);
  });

  it('терпит пробелы и переводы строк вокруг кода', () => {
    expect(parsePlayerCard(`\n  ${CODE}\n `).ok).toBe(true);
  });

  it('отклоняет не-JSON с внятной причиной', () => {
    const result = parsePlayerCard('привет');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('не похоже на код анкеты');
  });

  it('отклоняет чужую версию формы отдельным сообщением', () => {
    const result = parsePlayerCard(
      JSON.stringify({ ...JSON.parse(CODE), version: 2 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('другой версии формы');
  });

  it('требует имя', () => {
    const result = parsePlayerCard(
      JSON.stringify({ version: 1, name: '   ', boring: ['Мода'] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('без имени');
  });

  it('отклоняет пустую анкету — записывать в неё нечего', () => {
    const result = parsePlayerCard(
      JSON.stringify({ version: 1, name: 'Ваня' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('пустая');
  });

  it('выбрасывает области без примеров, а не падает на них', () => {
    const result = parsePlayerCard(
      JSON.stringify({
        version: 1,
        name: 'Ваня',
        interests: [
          { area: 'Спорт', examples: [] },
          { area: 'Музыка', examples: ['джаз'] },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.card.interests).toEqual([
        { area: 'Музыка', examples: ['джаз'] },
      ]);
  });
});

describe('oneLine', () => {
  it('схлопывает любые пробельные символы в один пробел', () => {
    expect(oneLine('  Драйв\n\tи   ещё  ')).toBe('Драйв и ещё');
  });
});

describe('renderPlayerSection', () => {
  it('печатает заголовок, дату и буллеты', () => {
    const text = renderPlayerSection(CARD, '2026-08-26');
    expect(text).toBe(
      [
        '## Ваня',
        '',
        '_Анкета от 2026-08-26._',
        '',
        '- **Кино и сериалы:** Драйв, Во все тяжкие',
        '- **Спорт:** Формула-1',
        '- **Скучно:** Политика, Мода',
      ].join('\n'),
    );
  });

  it('не печатает «Скучно», когда список пуст', () => {
    const text = renderPlayerSection({ ...CARD, boring: [] }, '2026-08-26');
    expect(text).not.toContain('Скучно');
  });

  // Тот же класс дефекта, что дал бесконечный рост файла в слайсе B: чужой
  // текст, попавший в markdown без обработки, становится настоящей границей
  // раздела и рвёт разбор.
  it('не даёт чужому тексту в имени или примере создать новую строку', () => {
    const text = renderPlayerSection(
      {
        name: 'Ваня\n## Катя',
        interests: [{ area: 'Спорт', examples: ['Формула-1\n---\nи ещё'] }],
        boring: [],
      },
      '2026-08-26',
    );
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toHaveLength(1);
    expect(text.split('\n').some((line) => line.startsWith('---'))).toBe(false);
  });
});

describe('upsertPlayerSection', () => {
  it('заменяет раздел существующего игрока, не трогая соседей', () => {
    const updated = upsertPlayerSection(FILE, CARD, '2026-08-26');
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).not.toContain('- **Спорт:** старое');
    expect(updated).toContain('## Катя');
    expect(updated).toContain('- **Музыка:** джаз');
    expect(updated).toContain('Вводный текст.');
  });

  it('добавляет нового игрока в конец', () => {
    const updated = upsertPlayerSection(
      FILE,
      { ...CARD, name: 'Петя' },
      '2026-08-26',
    );
    expect(updated).toContain('## Петя');
    expect(updated).toContain('## Ваня');
    expect(updated.indexOf('## Петя')).toBeGreaterThan(
      updated.indexOf('## Катя'),
    );
  });

  it('узнаёт игрока независимо от регистра и лишних пробелов', () => {
    const updated = upsertPlayerSection(
      FILE,
      { ...CARD, name: '  ваня ' },
      '2026-08-26',
    );
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## ваня', '## Катя']);
    expect(updated).not.toContain('- **Спорт:** старое');
  });

  // '## Ваня и Катя'.startsWith('## Ваня') истинно, и поиск раздела по началу
  // строки нашёл бы чужую анкету. Замена обязана попасть в своего игрока.
  it('не задевает игрока, чьё имя начинается так же', () => {
    const file = [
      '## Ваня и Катя',
      '',
      '- **Музыка:** чужое',
      '',
      '## Ваня',
      '',
      '- **Спорт:** старое',
      '',
    ].join('\n');
    const updated = upsertPlayerSection(file, CARD, '2026-08-26');
    expect(updated).toContain('- **Музыка:** чужое');
    expect(updated).not.toContain('- **Спорт:** старое');
  });

  it('идемпотентна: повторная запись той же анкеты ничего не меняет', () => {
    const once = upsertPlayerSection(FILE, CARD, '2026-08-26');
    expect(upsertPlayerSection(once, CARD, '2026-08-26')).toBe(once);
  });
});

describe('listPlayers', () => {
  it('перечисляет игроков с датами анкет', () => {
    expect(listPlayers(FILE)).toEqual([
      { name: 'Ваня', date: '2026-08-01' },
      { name: 'Катя', date: '2026-08-02' },
    ]);
  });

  it('на файле без игроков отдаёт пустой список', () => {
    expect(listPlayers('# Анкеты игроков\n\nВводный текст.\n')).toEqual([]);
  });
});
```

- [ ] **Шаг 5: Прогнать и убедиться, что тесты падают**

Run: `pnpm -C server exec vitest run src/playerCard.test.ts src/markdownSection.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Шаг 6: Реализовать `playerCard.ts`**

```ts
import { sectionEnd } from './markdownSection.js';

export interface PlayerInterest {
  area: string;
  examples: string[];
}

export interface PlayerCard {
  name: string;
  interests: PlayerInterest[];
  boring: string[];
}

export type ParsedCard =
  { ok: true; card: PlayerCard } | { ok: false; reason: string };

// Версия формата кода анкеты. Растёт, только когда меняется СМЫСЛ полей, а не
// их набор: новая необязательная область старую анкету не ломает.
const CARD_VERSION = 1;

/**
 * Схлопывает любые пробельные символы в один пробел.
 *
 * Не косметика, а защита файла: имя уходит в заголовок раздела, примеры — в
 * буллеты, и то и другое человек печатает свободно. Перенос строки внутри
 * такого значения создал бы новую строку в markdown, а строка «## Катя» или
 * «---» — настоящую границу раздела: разбор файла поехал бы, и следующая
 * замена анкеты затёрла бы кусок чужой. В слайсе B ровно этот дефект давал
 * бесконечный рост файла профиля.
 *
 * Схлопывание, а не отступ (как indentContinuation в profileSection.ts):
 * имя и пример по смыслу однострочные, и переносу там взяться неоткуда,
 * кроме как из случайного Enter или намеренной шалости.
 */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Сравнение имён — как у имён в комнате: без учёта регистра и лишних
// пробелов, иначе «Ваня» и «ваня» заведут двух игроков.
function sameName(a: string, b: string): boolean {
  return oneLine(a).toLowerCase() === oneLine(b).toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(oneLine)
    .filter((item) => item !== '');
}

/**
 * Разбирает код, присланный игроком из docs/anketa.html.
 *
 * Причина отказа возвращается текстом и показывается ведущему как есть:
 * человек, вставивший не то, должен понять что именно не то, а не увидеть
 * «ошибка».
 */
export function parsePlayerCard(code: string): ParsedCard {
  let raw: unknown;
  try {
    raw = JSON.parse(code.trim());
  } catch {
    return { ok: false, reason: 'это не похоже на код анкеты' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'это не похоже на код анкеты' };
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== CARD_VERSION) {
    return { ok: false, reason: 'анкета из другой версии формы' };
  }
  const name = typeof source.name === 'string' ? oneLine(source.name) : '';
  if (name === '') return { ok: false, reason: 'анкета без имени' };

  const interests: PlayerInterest[] = Array.isArray(source.interests)
    ? source.interests
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item),
        )
        .map((item) => ({
          area: typeof item.area === 'string' ? oneLine(item.area) : '',
          examples: asStringArray(item.examples),
        }))
        // Область без примеров не несёт ничего: «спорт» без «Формулы-1» —
        // это ровно та категория вместо примера, от которой спека
        // отказалась.
        .filter((item) => item.area !== '' && item.examples.length > 0)
    : [];
  const boring = asStringArray(source.boring);

  if (interests.length === 0 && boring.length === 0) {
    return { ok: false, reason: 'анкета пустая — ни интересов, ни скучного' };
  }
  return { ok: true, card: { name, interests, boring } };
}

/**
 * Раздел одного игрока — без завершающего перевода строки, его добавляет
 * вставка. Дата приходит параметром: модуль не обращается к часам, тот же
 * приём, что в generatorProfile.ts.
 */
export function renderPlayerSection(card: PlayerCard, date: string): string {
  const lines = [`## ${oneLine(card.name)}`, '', `_Анкета от ${date}._`, ''];
  for (const interest of card.interests) {
    lines.push(
      `- **${oneLine(interest.area)}:** ${interest.examples.map(oneLine).join(', ')}`,
    );
  }
  if (card.boring.length > 0) {
    lines.push(`- **Скучно:** ${card.boring.map(oneLine).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Ставит раздел игрока на место старого или дописывает в конец файла.
 * Остального в файле не трогает — вводный текст и соседние анкеты остаются
 * как были.
 */
export function upsertPlayerSection(
  fileText: string,
  card: PlayerCard,
  date: string,
): string {
  const lines = fileText.split('\n');
  // Точное сравнение имени, а не поиск заголовка по началу строки: раздел
  // «## Ваня и Катя» начинается с «## Ваня», и поиск по префиксу заменил бы
  // чужую анкету.
  const start = lines.findIndex(
    (line) => line.startsWith('## ') && sameName(line.slice(3), card.name),
  );
  const section = renderPlayerSection(card, date).split('\n');
  if (start !== -1) {
    return [
      ...lines.slice(0, start),
      ...section,
      '',
      ...lines.slice(sectionEnd(lines, start)),
    ].join('\n');
  }
  const base = fileText.endsWith('\n') ? fileText : `${fileText}\n`;
  return `${base}\n${section.join('\n')}\n`;
}

/**
 * Имена и даты уже заведённых игроков — материал для списка в /admin.
 * Дата берётся из строки «_Анкета от …._» внутри раздела; её отсутствие не
 * ошибка (файл правится руками), тогда дата пустая.
 */
export function listPlayers(
  fileText: string,
): { name: string; date: string }[] {
  const lines = fileText.split('\n');
  const players: { name: string; date: string }[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('## ')) return;
    const name = oneLine(line.slice(3));
    if (name === '') return;
    const end = sectionEnd(lines, index);
    let date = '';
    for (let i = index + 1; i < end; i += 1) {
      const match = /^_Анкета от (.+)\._$/.exec(lines[i].trim());
      if (match) {
        date = match[1];
        break;
      }
    }
    players.push({ name, date });
  });
  return players;
}
```

- [ ] **Шаг 7: Прогнать тесты**

Run: `pnpm -C server exec vitest run src/playerCard.test.ts src/markdownSection.test.ts src/profileSection.test.ts src/generatorProfile.test.ts`
Expected: PASS во всех четырёх файлах.

- [ ] **Шаг 8: Коммит**

```bash
git add server/src/markdownSection.ts server/src/markdownSection.test.ts server/src/playerCard.ts server/src/playerCard.test.ts server/src/profileSection.ts
git commit -m "feat: разбор и разметка анкеты игрока"
```

---

### Task 2: Запись в файл и обработчики сервера

**Files:**

- Create: `server/src/playersFile.ts`, `server/src/playersFile.test.ts`
- Modify: `server/src/protocol.ts`, `server/src/server.ts`, `server/src/index.ts`
- Test: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `parsePlayerCard`, `upsertPlayerSection`, `listPlayers` из `playerCard.ts` (задача 1).
- Produces: `savePlayerCard(playersPath, card, date)`, `readPlayerList(playersPath)` из `playersFile.ts`; сообщения `admin-get-players`, `admin-save-player`, `admin-players`, `admin-player-exists`, `admin-player-error`; поле `playersPath` в опциях `createServer`. Задача 3 работает только с сообщениями.

- [ ] **Шаг 1: Сообщения протокола**

В `server/src/protocol.ts`, к остальным admin-сообщениям:

```ts
  // Анкеты интересов игроков (design.md, 2026-08-26). Код приходит от
  // ведущего целиком, как его прислал игрок, — разбирает и проверяет его
  // сервер, а не клиент: клиент не должен знать формат анкеты.
  | { type: 'admin-get-players' }
  | {
      type: 'admin-save-player';
      code: string;
      // false — обычная отправка: если игрок с таким именем уже есть, сервер
      // ответит admin-player-exists и НИЧЕГО не запишет. true — ведущий
      // подтвердил замену. Подтверждение спрашивается один раз и на стороне
      // клиента, чтобы сервер оставался без состояния между сообщениями.
      replace: boolean;
    }
```

И к ответам сервера:

```ts
  // Отдаётся и на admin-get-players, и как подтверждение успешной записи —
  // список всегда актуальный, клиенту не нужно догадываться, что изменилось.
  | { type: 'admin-players'; players: { name: string; date: string }[] }
  | { type: 'admin-player-exists'; name: string }
  | { type: 'admin-player-error'; reason: string }
```

- [ ] **Шаг 2: Тесты записи в файл**

Создать `server/src/playersFile.test.ts` по образцу `generatorProfile.test.ts` (временный каталог в `beforeEach`, уборка в `afterEach`):

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPlayerList, savePlayerCard } from './playersFile.js';
import type { PlayerCard } from './playerCard.js';

const CARD: PlayerCard = {
  name: 'Ваня',
  interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
  boring: ['Мода'],
};

describe('playersFile', () => {
  let dir: string;
  let playersPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-players-'));
    playersPath = join(dir, 'players.md');
    await writeFile(
      playersPath,
      '# Анкеты игроков\n\nВводный текст.\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('дописывает анкету и читает её обратно', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('## Ваня');
    expect(content).toContain('- **Спорт:** Формула-1');
    expect(content).toContain('Вводный текст.');
    expect(await readPlayerList(playersPath)).toEqual([
      { name: 'Ваня', date: '2026-08-26' },
    ]);
  });

  it('повторная запись той же анкеты не трогает диск', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const first = await stat(playersPath);
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const second = await stat(playersPath);
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it('на отсутствующем файле отдаёт пустой список, а не падает', async () => {
    expect(await readPlayerList(join(dir, 'нет-такого.md'))).toEqual([]);
  });
});
```

- [ ] **Шаг 3: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/playersFile.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Шаг 4: Реализовать `playersFile.ts`**

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  listPlayers,
  upsertPlayerSection,
  type PlayerCard,
} from './playerCard.js';

/**
 * Кладёт анкету в docs/players.md — новую дописывает, существующую заменяет.
 * Дата приходит параметром: обращение к часам живёт в вызывающем коде
 * (server.ts), как уже сделано для жалоб в generatorProfile.ts.
 *
 * Атомарная запись через temp + rename — тот же приём, что в
 * generatorProfile.ts, snapshot.ts и packs.ts.
 */
export async function savePlayerCard(
  playersPath: string,
  card: PlayerCard,
  date: string,
): Promise<void> {
  const current = await readFile(playersPath, 'utf8');
  const updated = upsertPlayerSection(current, card, date);
  // Ведущий может вставить один и тот же код дважды — тогда менять нечего и
  // трогать файл незачем.
  if (updated === current) return;
  const tmpPath = `${playersPath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, playersPath);
}

/**
 * Список заведённых игроков. Отсутствие файла — не ошибка: анкет может ещё
 * не быть вовсе, и админка обязана открываться и в этом случае.
 */
export async function readPlayerList(
  playersPath: string,
): Promise<{ name: string; date: string }[]> {
  try {
    return listPlayers(await readFile(playersPath, 'utf8'));
  } catch {
    return [];
  }
}
```

- [ ] **Шаг 5: Тест обработчиков в `server.test.ts`**

**Харнесс не писать заново.** В `server.test.ts` уже есть блок `describe`, который поднимает сервер с временным `profilePath` (около строки 2684: `mkdtemp` в `beforeEach`, `writeFile` заготовки, `rm` в `afterEach`) и шлёт admin-сообщения через настоящий websocket — тесты «Пожаловаться» рядом, около строки 2924. Новый блок делается по его образцу: тот же приём, плюс `playersPath` на временный файл с вводным текстом.

```ts
it('admin-save-player пишет анкету и отдаёт обновлённый список', async () => {
  // Отправить admin-save-player с корректным кодом и replace: false.
  // Ожидания:
  expect(message).toEqual({
    type: 'admin-players',
    players: [{ name: 'Ваня', date: expect.any(String) }],
  });
  const content = await readFile(playersPath, 'utf8');
  expect(content).toContain('- **Спорт:** Формула-1');
});

it('повторное имя без подтверждения ничего не пишет', async () => {
  // Сохранить Ваню, затем отправить другую анкету того же Вани с replace: false.
  expect(message).toEqual({ type: 'admin-player-exists', name: 'Ваня' });
  const content = await readFile(playersPath, 'utf8');
  expect(content).not.toContain('новое'); // старая анкета на месте
});

it('replace: true заменяет анкету', async () => {
  // То же самое, но replace: true.
  const content = await readFile(playersPath, 'utf8');
  expect(content).toContain('новое');
  expect(content).not.toContain('Формула-1');
});

it('битый код отдаёт причину, а не молчание', async () => {
  // admin-save-player с code: 'привет'
  expect(message).toEqual({
    type: 'admin-player-error',
    reason: expect.stringContaining('не похоже на код анкеты'),
  });
});
```

- [ ] **Шаг 6: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/server.test.ts`
Expected: FAIL — обработчиков ещё нет.

- [ ] **Шаг 7: Обработчики в `server.ts`**

1. В `CreateServerOptions` добавить и разобрать в деструктуризации:

```ts
  // docs/players.md — анкеты интересов (design.md, 2026-08-26).
  playersPath?: string;
```

2. Рядом с `withProfileWriteLock` завести отдельную блокировку — файл другой, и сериализовать его с профилем незачем:

```ts
const withPlayersWriteLock = createWriteLock();
```

3. Обработчики в `handleMessage`, рядом с остальными admin-сообщениями:

```ts
if (message.type === 'admin-get-players') {
  if (!playersPath) return;
  send(ws, {
    type: 'admin-players',
    players: await readPlayerList(playersPath),
  });
}

if (
  message.type === 'admin-save-player' &&
  typeof message.code === 'string' &&
  typeof message.replace === 'boolean'
) {
  if (!playersPath) return;
  const parsed = parsePlayerCard(message.code);
  if (!parsed.ok) {
    send(ws, { type: 'admin-player-error', reason: parsed.reason });
    return;
  }
  // Проверка «такой уже есть» и сама запись идут ВНУТРИ одной
  // блокировки: между ними файл меняться не должен, иначе два
  // подтверждения подряд затрут друг друга.
  try {
    const conflict = await withPlayersWriteLock(async () => {
      const existing = await readPlayerList(playersPath);
      const same = existing.find(
        (player) =>
          player.name.toLowerCase() === parsed.card.name.toLowerCase(),
      );
      if (same && !message.replace) return same.name;
      await savePlayerCard(
        playersPath,
        parsed.card,
        new Date().toISOString().slice(0, 10),
      );
      return null;
    });
    if (conflict !== null) {
      send(ws, { type: 'admin-player-exists', name: conflict });
      return;
    }
    send(ws, {
      type: 'admin-players',
      players: await readPlayerList(playersPath),
    });
  } catch (err) {
    send(ws, {
      type: 'admin-player-error',
      reason:
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'файл анкет не найден'
          : 'не удалось сохранить анкету',
    });
  }
}
```

- [ ] **Шаг 8: Проводка в `index.ts`**

```ts
const PLAYERS_PATH =
  process.env.PLAYERS_PATH ??
  join(dirname(fileURLToPath(import.meta.url)), '../../docs/players.md');
```

и в вызов `createServer({...})` добавить `playersPath: PLAYERS_PATH`. Константу разместить рядом с уже существующей `PROFILE_PATH` и по её образцу.

- [ ] **Шаг 9: Прогнать весь серверный набор**

Run: `pnpm -C server exec vitest run`
Expected: PASS.

- [ ] **Шаг 10: Коммит**

```bash
git add server/src/playersFile.ts server/src/playersFile.test.ts server/src/protocol.ts server/src/server.ts server/src/server.test.ts server/src/index.ts
git commit -m "feat: сохранение анкет игроков в docs/players.md"
```

---

### Task 3: Раздел «Анкеты игроков» в админке

**Files:**

- Modify: `client/src/useAdminConnection.ts`, `client/src/Admin.tsx`
- Test: `client/src/useAdminConnection.test.ts`, `client/src/Admin.test.tsx`

**Interfaces:**

- Consumes: сообщения `admin-get-players`, `admin-save-player`, `admin-players`, `admin-player-exists`, `admin-player-error` (задача 2).
- Produces: в возвращаемом объекте `useAdminConnection` — `players`, `playerError`, `playerConflictName`, `savePlayer(code, replace)`, `clearPlayerFeedback()`, `refreshPlayers()`.

- [ ] **Шаг 1: Тест хука**

Дописать в `client/src/useAdminConnection.test.ts` по образцу уже существующих тестов: там `renderHook(() => useAdminConnection(factory))` с фейковой фабрикой сокета, отправленное складывается в массив, входящие сообщения подаются вручную внутри `act`. Свою фабрику не заводить — использовать ту, что уже есть в файле.

```ts
it('savePlayer отправляет код и складывает пришедший список', async () => {
  // Поднять хук с фейковым сокетом, вызвать savePlayer('{"...":1}', false),
  // проверить отправленное сообщение:
  expect(sent).toContainEqual({
    type: 'admin-save-player',
    code: '{"...":1}',
    replace: false,
  });
  // Прислать admin-players — список должен появиться в состоянии.
  expect(result.current.players).toEqual([
    { name: 'Ваня', date: '2026-08-26' },
  ]);
});

it('admin-player-exists кладёт имя в playerConflictName, не трогая ошибку', async () => {
  expect(result.current.playerConflictName).toBe('Ваня');
  expect(result.current.playerError).toBeNull();
});

it('admin-player-error кладёт причину в playerError', async () => {
  expect(result.current.playerError).toContain('не похоже на код анкеты');
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/useAdminConnection.test.ts`
Expected: FAIL — `savePlayer is not a function`.

- [ ] **Шаг 3: Расширить хук**

В `client/src/useAdminConnection.ts`: продублировать типы новых сообщений в локальный `ServerMessage`/`ClientMessage` (клиент не импортирует из `server/` — так во всём проекте), завести состояние и обработку:

```ts
const [players, setPlayers] = useState<{ name: string; date: string }[]>([]);
const [playerError, setPlayerError] = useState<string | null>(null);
const [playerConflictName, setPlayerConflictName] = useState<string | null>(
  null,
);
```

В разборе входящих сообщений:

```ts
if (message.type === 'admin-players') {
  setPlayers(message.players);
  // Успешная запись гасит и ошибку, и вопрос про замену: список
  // пришёл — значит всё сохранилось.
  setPlayerError(null);
  setPlayerConflictName(null);
}
if (message.type === 'admin-player-exists') {
  setPlayerConflictName(message.name);
  setPlayerError(null);
}
if (message.type === 'admin-player-error') {
  setPlayerError(message.reason);
  setPlayerConflictName(null);
}
```

Запросить список при подключении — там же, где хук запрашивает остальное начальное состояние. В возвращаемый объект добавить:

```ts
    players,
    playerError,
    playerConflictName,
    clearPlayerFeedback: () => {
      setPlayerError(null);
      setPlayerConflictName(null);
    },
    refreshPlayers: () => send({ type: 'admin-get-players' }),
    savePlayer: (code: string, replace: boolean) =>
      send({ type: 'admin-save-player', code, replace }),
```

- [ ] **Шаг 4: Тест раздела в `Admin.test.tsx`**

В файле уже есть хелпер `connection(overrides)` (около строки 46), собирающий полный `AdminConnection` с заглушками, и `vi.mock('./useAdminConnection')` наверху. Новые поля хука надо добавить в этот хелпер — иначе он перестанет соответствовать типу и не соберётся. Тесты писать по образцу блока «Admin — список и жалобы» (около строки 1030).

```ts
it('показывает список анкет и отправляет вставленный код', async () => {
  // Отрисовать Admin с фейковым хуком, где players = [{ name: 'Ваня', date: '2026-08-26' }].
  expect(screen.getByText('Ваня')).toBeInTheDocument();
  // Вставить код в поле и нажать «Сохранить анкету».
  expect(savePlayer).toHaveBeenCalledWith('{"version":1}', false);
});

it('на конфликт имени показывает вопрос и повторяет отправку с подтверждением', async () => {
  // playerConflictName = 'Ваня'
  expect(screen.getByText(/уже есть/)).toBeInTheDocument();
  // Нажать «Заменить».
  expect(savePlayer).toHaveBeenLastCalledWith('{"version":1}', true);
});
```

- [ ] **Шаг 5: Прогнать и убедиться, что падает**

Run: `pnpm -C client exec vitest run src/Admin.test.tsx`
Expected: FAIL — раздела нет.

- [ ] **Шаг 6: Раздел в `Admin.tsx`**

Новый `<section className="admin-section">` по образцу соседних (каждый — `<h2>` и содержимое). Разместить после раздела «История партий», до раздела «Пакет»: анкеты относятся к подготовке пака, а не к идущей партии.

```tsx
<section className="admin-section">
  <h2>Анкеты игроков</h2>
  <p className="admin-hint">
    Отправь друзьям <code>docs/anketa.html</code>, а присланный код вставь сюда.
    Заполнять необязательно — пришедший без анкеты играет наравне со всеми.
  </p>
  <textarea
    className="admin-player-code"
    rows={4}
    value={playerCode}
    onChange={(e) => {
      setPlayerCode(e.target.value);
      clearPlayerFeedback();
    }}
    placeholder="Вставь код анкеты"
  />
  <div className="admin-actions">
    <button
      type="button"
      onClick={() => savePlayer(playerCode, false)}
      disabled={playerCode.trim() === ''}
    >
      Сохранить анкету
    </button>
  </div>
  {playerConflictName && (
    <div className="admin-player-conflict">
      <p>Игрок «{playerConflictName}» уже есть. Заменить его анкету?</p>
      <div className="admin-actions">
        <button type="button" onClick={() => savePlayer(playerCode, true)}>
          Заменить
        </button>
        <button type="button" onClick={clearPlayerFeedback}>
          Отмена
        </button>
      </div>
    </div>
  )}
  {playerError && <p className="admin-error">{playerError}</p>}
  {players.length === 0 ? (
    <p className="admin-hint">Анкет пока нет.</p>
  ) : (
    <ul className="admin-players">
      {players.map((player) => (
        <li key={player.name}>
          <span className="admin-player-name">{player.name}</span>
          {player.date && (
            <span className="admin-player-date">от {player.date}</span>
          )}
        </li>
      ))}
    </ul>
  )}
</section>
```

Состояние `playerCode` — обычный `useState<string>('')` рядом с остальными в начале компонента. Успешное сохранение (приход нового списка) поле не чистит намеренно: ведущий вставляет анкеты подряд и сам видит, что список пополнился.

Стили дописать в существующий CSS-файл по образцу соседних `admin-*` правил — новых механизмов вёрстки не заводить.

- [ ] **Шаг 7: Прогнать клиентские тесты**

Run: `pnpm -C client exec vitest run`
Expected: PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add client/src/useAdminConnection.ts client/src/useAdminConnection.test.ts client/src/Admin.tsx client/src/Admin.test.tsx client/src/*.css
git commit -m "feat: раздел «Анкеты игроков» в админке"
```

---

### Task 4: Страница анкеты

**Files:**

- Create: `docs/anketa.html`
- Test: `server/src/anketa.test.ts`

**Interfaces:**

- Consumes: формат кода, который разбирает `parsePlayerCard` (задача 1) — совпадение обязательно.
- Produces: ничего для другого кода; страница самостоятельна.

- [ ] **Шаг 1: Написать падающий тест самодостаточности**

Создать `server/src/anketa.test.ts`. Тест живёт на сервере, потому что там окружение Node и чтение файлов не требует настройки:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AREAS = [
  'Кино и сериалы',
  'Музыка',
  'Спорт',
  'Книги',
  'Игры',
  'Еда и путешествия',
  'Увлечения и работа',
];

const BORING = [
  'Спорт',
  'Политика',
  'История',
  'Наука',
  'География',
  'Кино',
  'Музыка',
  'Литература',
  'Искусство',
  'Техника',
  'Мода',
  'Животные',
];

const SOURCE = readFileSync(
  new URL('../../docs/anketa.html', import.meta.url),
  'utf8',
);

describe('docs/anketa.html', () => {
  // Главное требование к странице: она открывается с file:// на чужом
  // телефоне, где интернета может не быть вовсе. Любая внешняя ссылка —
  // шрифт, картинка, скрипт — превращает её в неработающую именно там, где
  // проверить это некому.
  it('не ссылается ни на что снаружи', () => {
    expect(SOURCE).not.toMatch(/https?:\/\//);
    expect(SOURCE).not.toMatch(/<link[^>]+href=/i);
    expect(SOURCE).not.toMatch(/<script[^>]+src=/i);
  });

  it('содержит все области анкеты', () => {
    for (const area of AREAS) expect(SOURCE).toContain(area);
  });

  it('содержит весь список скучного', () => {
    for (const item of BORING) expect(SOURCE).toContain(item);
  });

  // Копирование через navigator.clipboard требует защищённого контекста и на
  // file:// в незнакомом браузере может не сработать (svoya-igra-dev,
  // «Ловушки»: возможности браузера без HTTPS). Поле с кодом обязано быть
  // видимым и выделяемым само по себе.
  it('показывает код в поле, а не только в кнопке', () => {
    expect(SOURCE).toMatch(/<textarea[^>]*id="code"/i);
  });

  it('объявляет ту же версию формата, что разбирает сервер', () => {
    expect(SOURCE).toContain('version: 1');
  });
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Run: `pnpm -C server exec vitest run src/anketa.test.ts`
Expected: FAIL — файла нет.

- [ ] **Шаг 3: Написать страницу**

Создать `docs/anketa.html`. Требования, каждое из которых проверяется тестом выше или спекой:

- один файл, `<style>` и `<script>` только внутри, ни одной внешней ссылки;
- `<meta name="viewport" content="width=device-width, initial-scale=1">` — заполняют с телефона;
- поле «Как тебя записать» (обязательное) и семь областей из `AREAS`, у каждой `<textarea>` с подсказкой «2–3 примера через запятую»;
- блок «Что тебе точно скучно» — двенадцать кнопок-переключателей из `BORING`, множественный выбор;
- кнопка «Готово» собирает JSON и показывает его в `<textarea id="code">` только для чтения, плюс кнопка «Скопировать»;
- кнопка «Скопировать» пробует `navigator.clipboard.writeText`, а при отказе или его отсутствии выделяет содержимое поля и показывает «выдели и скопируй вручную». Промах API не должен выглядеть как поломка страницы;
- пустые области в JSON не попадают;
- JSON строится ровно в форме, которую разбирает `parsePlayerCard`:

```js
const card = {
  version: 1,
  name: nameInput.value.trim(),
  interests: areas
    .map((area) => ({
      area: area.label,
      examples: area.input.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    }))
    .filter((item) => item.examples.length > 0),
  boring: [...selectedBoring],
};
```

Текст на странице — человеческий и объясняющий, зачем это: «чтобы в паке была тема и про тебя». Просить примеры, а не жанры, — прямо в подсказках полей.

- [ ] **Шаг 4: Прогнать тест**

Run: `pnpm -C server exec vitest run src/anketa.test.ts`
Expected: PASS.

- [ ] **Шаг 5: Проверить страницу глазами**

Открыть `docs/anketa.html` в браузере, заполнить, нажать «Готово», скопировать код и прогнать его через разбор:

```bash
pnpm -C server exec tsx -e "import {parsePlayerCard} from './src/playerCard.js'; console.log(parsePlayerCard(process.argv[1]))" '<вставленный код>'
```

Ожидается `{ ok: true, card: … }` с теми полями, что были заполнены. Не сходится — чинить страницу, а не разбор: формат задан задачей 1.

- [ ] **Шаг 6: Коммит**

```bash
git add docs/anketa.html server/src/anketa.test.ts
git commit -m "feat: страница анкеты интересов"
```

---

### Task 5: Документация и правила генератора

**Files:**

- Create: `docs/players.md`
- Modify: `.claude/skills/pack-generator/SKILL.md`, `docs/ideas.md`

Без этой задачи слайс не работает: генератор не узнает, что появился новый источник, и соберёт пак как раньше.

- [ ] **Шаг 1: Заготовка `docs/players.md`**

Вводный текст плюс пустое место под анкеты. Содержание вводной части:

- что это за файл и кто его пишет (сервер по коду из `/admin`, руками тоже можно);
- что раздел на человека — от `## Имя` до следующего `## `;
- что читает его генератор на Шаге 0, а собирает пак по правилам Шага 1;
- ссылка на спеку `docs/superpowers/specs/2026-08-26-player-questionnaire-design.md`;
- ссылка на `docs/anketa.html` — что отправлять игрокам.

Файл заканчивается разделителем `---`, после которого пусто: туда лягут анкеты.

- [ ] **Шаг 2: Шаг 0 в `pack-generator/SKILL.md`**

Дописать чтение `docs/players.md` наравне с профилем компании: это интересы конкретных людей, а не правила письма, и в «Ручные заметки» они не переносятся — файл живёт своей жизнью и правится ведущим.

- [ ] **Шаг 3: Шаг 1 в `pack-generator/SKILL.md` — правила сборки**

Шаг 1 уже спрашивает, кто будет играть. Дописать продолжение этого разговора: генератор показывает, кто есть в `docs/players.md`, и спрашивает, кто из них за столом. **Тема для не пришедшего — испорченная тема.**

Затем правила на 10 тем, дословно из спеки (раздел «Правила генератора»):

1. По одной личной теме на каждого игрока с анкетой.
2. Остальные — жадно по охвату: всем; тройки; пары; одиночки; иначе общечеловеческая.
3. Балансировка выбывания — выбрасывается тот, у кого тем уже больше.
4. Запрет натянутых пересечений — не называется одним понятным словом, значит не тема; охват не самоцель.
5. Вето от двоих — одно «скучно» понижает приоритет, два закрывают тему.
6. Тема не должна быть слишком узкой — нельзя написать вопрос за 100 для большинства, значит расширить или заменить.
7. Сложность калибруется на весь стол, не под автора темы.

Пункт 7 записать как отдельное выделенное правило, а не строкой в списке: это главное правило слайса, и именно оно теряется первым.

- [ ] **Шаг 4: `docs/ideas.md`**

В таблице слайсов блока «Память и обучение генератора»: **D** разбить на D1 (анкета) — `сделано`, со ссылкой на спеку, и D2 (постоянные личности между играми) — `идея`. Под таблицей коротко: почему анкета не потребовала опознания игроков (ведущий — мост) и когда опознание понадобится (когда захочется выводить силу игрока из поведения, а не из его слов).

- [ ] **Шаг 5: Полная проверка и коммит**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Прогнать и **посмотреть вывод**, а не предположить результат.

```bash
git add docs .claude/skills/pack-generator/SKILL.md
git commit -m "docs: правила сборки пака по анкетам игроков"
```

---

## После плана

**Живая проверка обязательна до закрытия** (Шаг 7 в `svoya-igra-dev`). Что она должна показать — в спеке, раздел «Живая проверка». Первый пункт — самый рискованный и дизайном не устраняется: **откроется ли `.html`, присланный в мессенджере, на чужом телефоне.** На iOS вложение сначала надо сохранить в «Файлы». Если люди спотыкаются — запасной ход в спеке описан: ту же страницу отдаёт игровой сервер по локальному адресу, но тогда анкету заполняют уже в гостях.
