import { sectionEnd } from './markdownSection.js';

/**
 * Заголовок машинного раздела в конце docs/players.md: его пишет сервер по
 * сыгранным партиям (playerStats.ts), а не ведущий. Живёт здесь, а не там,
 * потому что это часть структуры файла, которую разбирает этот модуль:
 * listPlayers обязан отличать его от анкеты, иначе «Показывает в игре»
 * появляется в /admin как игрок, которого можно править и удалять.
 */
export const STATS_HEADING = '## Показывает в игре';

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

// Сравнение имён без учёта регистра, а также лишних пробелов по краям И
// внутри строки (через oneLine — тем же приёмом, каким имя уходит в файл).
// Строже, чем Room.normalizeName (trim + toLowerCase, внутренние пробелы не
// трогает): здесь сравнивается ровно то значение, что попадёт в заголовок
// раздела, а туда оно уже приходит схлопнутым.
export function sameName(a: string, b: string): boolean {
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
export function renderPlayerSection(
  card: PlayerCard,
  date: string,
  extraLines: string[] = [],
): string {
  const lines = [`## ${oneLine(card.name)}`, '', `_Анкета от ${date}._`, ''];
  for (const interest of card.interests) {
    lines.push(
      `- **${oneLine(interest.area)}:** ${interest.examples.map(oneLine).join(', ')}`,
    );
  }
  if (card.boring.length > 0) {
    lines.push(`- **Скучно:** ${card.boring.map(oneLine).join(', ')}`);
  }
  // Строки, которых форма не знает (ручные пометки ведущего), возвращаются на
  // место как есть — иначе правка анкеты через /admin молча стирала бы то,
  // что человек дописал в файл руками. Экранирование им не нужно и вредно:
  // это текст, который ведущий уже написал прямо в markdown.
  lines.push(...extraLines.map(oneLine));
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
  extraLines: string[] = [],
): string {
  const lines = fileText.split('\n');
  // Все разделы с этим именем, а не только первый: файл заявлен как правимый
  // руками, и ведущий может случайно продублировать «## Ваня». Замена одним
  // findIndex попадала бы только в верхнюю копию — нижняя молча оставалась
  // бы со старыми данными, listPlayers продолжал бы отдавать обе, а
  // генератор читал бы два противоречащих друг другу набора интересов.
  //
  // Точное сравнение имени, а не поиск заголовка по началу строки: раздел
  // «## Ваня и Катя» начинается с «## Ваня», и поиск по префиксу заменил бы
  // чужую анкету.
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('## ') && sameName(line.slice(3), card.name)) {
      starts.push(index);
    }
  });
  const section = renderPlayerSection(card, date, extraLines).split('\n');
  if (starts.length > 0) {
    const result: string[] = [];
    let cursor = 0;
    starts.forEach((start, i) => {
      result.push(...lines.slice(cursor, start));
      // Новый раздел вставляется один раз, на месте первого совпадения;
      // остальные совпавшие разделы просто вырезаются.
      if (i === 0) result.push(...section, '');
      cursor = sectionEnd(lines, start);
    });
    result.push(...lines.slice(cursor));
    return result.join('\n');
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
  // Всё ниже машинного раздела — не анкеты: там числа по партиям, и раздел
  // всегда последний в файле (spliceStatsSection). Поэтому не «пропустить
  // один заголовок», а остановиться: анкет за ним не бывает по построению.
  const statsAt = lines.findIndex((line) => line.trim() === STATS_HEADING);
  const end = statsAt === -1 ? lines.length : statsAt;
  lines.slice(0, end).forEach((line, index) => {
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

/**
 * Раздел одного игрока обратно в анкету — то, чем форма правки в /admin
 * заполняет свои поля. Обратная сторона renderPlayerSection: круговой тест
 * «отрендерили → разобрали → то же самое» держит их в согласии.
 *
 * `extraLines` — всё непустое, чего форма не знает: файл заявлен как правимый
 * руками, и ведущий мог дописать в раздел свою пометку. Она возвращается на
 * место при записи, а не пропадает от того, что кто-то нажал «Сохранить».
 * Строка «_Анкета от …._» служебная — её пишет рендер, и в extraLines ей
 * делать нечего, иначе она задваивалась бы с каждой правкой.
 *
 * Примеры разбираются делением по запятой — ровно так же, как рендер их
 * склеивает. Пример с запятой внутри («Кино, которое я люблю») разъедется на
 * два; в формате файла эти два случая неразличимы в принципе, и выбирать
 * приходится между потерей запятой и потерей читаемости файла. Файл важнее.
 */
export function parsePlayerSection(
  fileText: string,
  name: string,
): { card: PlayerCard; extraLines: string[] } | null {
  const lines = fileText.split('\n');
  const start = lines.findIndex(
    (line) => line.startsWith('## ') && sameName(line.slice(3), name),
  );
  if (start === -1) return null;
  const end = sectionEnd(lines, start);
  const interests: PlayerInterest[] = [];
  const boring: string[] = [];
  const extraLines: string[] = [];
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (/^_Анкета от (.+)\._$/.test(line)) continue;
    const bullet = /^- \*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (!bullet) {
      extraLines.push(line);
      continue;
    }
    const area = oneLine(bullet[1]);
    const values = bullet[2]
      .split(',')
      .map(oneLine)
      .filter((value) => value !== '');
    if (sameName(area, 'Скучно')) {
      boring.push(...values);
      continue;
    }
    interests.push({ area, examples: values });
  }
  return {
    card: { name: oneLine(lines[start].slice(3)), interests, boring },
    extraLines,
  };
}

/**
 * Убирает разделы игрока из файла. Все с этим именем, а не первый — по той же
 * причине, что и в upsertPlayerSection: файл правится руками, и «## Ваня»
 * может оказаться в нём дважды. Оставить нижнюю копию значило бы показать
 * ведущему, что анкета удалена, и продолжать кормить ею генератор.
 *
 * Соседние разделы и вводная часть не трогаются: вырезаются ровно границы
 * раздела, которые sectionEnd и так считает для всех остальных операций.
 */
export function removePlayerSection(fileText: string, name: string): string {
  const lines = fileText.split('\n');
  const result: string[] = [];
  let cursor = 0;
  lines.forEach((line, index) => {
    if (index < cursor) return;
    if (!line.startsWith('## ') || !sameName(line.slice(3), name)) return;
    result.push(...lines.slice(cursor, index));
    cursor = sectionEnd(lines, index);
  });
  if (cursor === 0) return fileText;
  result.push(...lines.slice(cursor));
  return result.join('\n');
}
