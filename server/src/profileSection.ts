import type {
  DownTaggedQuestion,
  PriceStats,
  ProfileAggregate,
} from './history.js';
import { findSectionRange } from './markdownSection.js';

// Заголовок раздела. Задача 3 ищет по нему границы заменяемого куска, поэтому
// это одна константа на оба места, а не два одинаковых литерала.
export const AUTO_HEADING = '## Автособранное';

const COMPLAINTS_HEADING = '## Жалобы и оценки игроков';

// Глобальный флаг не ставится: regex с /g несёт состояние lastIndex между
// вызовами, и второй разбор того же текста начинался бы с середины. Перебор
// идёт по строкам, поэтому /g не нужен.
const MARKER = /<!--\s*учтено:([^>]*)-->/;

// Fix 6 (финальное ревью) — «после каждой партии» неполно: пересчёт идёт и
// на каждое объяснение причины на экране разбора (server.ts). Формулировка
// важна не только для точности: прочитавший «пересчёт после партии»
// решит, что его ручная правка доживёт до конца следующей игры, хотя
// сотрёт её первый же разбор в текущей же партии.
const INTRO =
  '_Раздел пересчитывается сервером после каждой партии и после того, как ' +
  'игрок объясняет причину на экране разбора. Правки руками не сохранятся ' +
  '— пиши их в «Ручные заметки». Источник — `game-history.db` (слайсы A и ' +
  'C)._';

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
 * formatEntry() из generatorProfile.ts (импортирует эту же функцию), но
 * здесь он не косметический. Применяется КО ВСЕМ значениям из базы, которые
 * интерполируются в раздел, — не только к тексту и свободным комментариям,
 * но и к ответу, названию темы и имени пакета: любое из них может прийти с
 * переносом строки (редактор пакетов в /admin — обычный <textarea>, перенос
 * ставится одним Enter, server/src/pack.ts его не запрещает), и строка
 * «## Что-то» или «---» внутри него, вставленная как есть, стала бы
 * настоящей границей раздела (findSectionRange ищет её по началу строки).
 * Пропущенное здесь значение обрезало бы раздел на середине, а следующий
 * пересчёт дописывал бы новую копию рядом — раздел растёт без предела
 * (финальное ревью ветки, п. 1).
 */
export function indentContinuation(value: string): string {
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
  // Id вопроса печатается в самом заголовке буллета (finalное ревью ветки,
  // п. 3) — без него генератору неоткуда взять вторую половину ключа
  // маркера `<имя пака>#<id вопроса>`, кроме как опознавать вопрос по
  // тексту, а текст в разделе — снимок с экрана на момент партии и после
  // правки пакета уже может не совпадать с текущим содержимым файла.
  const head =
    `- **${indentContinuation(entry.packFilename)}#${indentContinuation(entry.questionId)} · ` +
    `«${indentContinuation(entry.themeName)}» · ${entry.price}** — ` +
    `«${indentContinuation(entry.text)}» (ответ: «${indentContinuation(entry.answer)}»)`;
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
 * Идентификаторы записей, которые генератор уже обобщил в «Ручные заметки»,
 * — из строк вида `<!-- учтено: pack.json#r1-geo-100, other.json#q2 -->`.
 *
 * Маркер ищется ВНЕ заменяемого раздела: положенный внутрь него, он был бы
 * стёрт следующим же пересчётом, и запись вернулась бы (design.md,
 * 2026-08-25, «Разобранное помечается в файле, не в базе»).
 */
export function parseAcknowledged(fileText: string): Set<string> {
  const lines = fileText.split('\n');
  const range = findSectionRange(lines, AUTO_HEADING);
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
  const range = findSectionRange(lines, AUTO_HEADING);
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
  // Fix 9 (финальное ревью) — «сыгранных вопросов» здесь считает ВСЕ строки
  // played_questions, включая финальные вопросы и аукционы, а блок «Как
  // берутся вопросы по ценам» ниже их исключает (design.md, 2026-08-25,
  // «Из таблицы исключаются»). Без оговорки эти два числа выглядят
  // рассинхронизированными — уточнение здесь дешевле, чем менять подсчёт.
  const sample =
    `_Выборка: ${aggregate.games} ${plural(aggregate.games, ['партия', 'партии', 'партий'])}, ` +
    `${aggregate.questions} ${plural(aggregate.questions, [
      'сыгранный вопрос',
      'сыгранных вопроса',
      'сыгранных вопросов',
    ])} (включая финальные и аукционы — их нет в таблице цен ниже), ` +
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
            `- «${indentContinuation(theme.themeName)}» — ${theme.count} ${plural(
              theme.count,
              ['раз', 'раза', 'раз'],
            )} за ${theme.games} ${plural(theme.games, ['партию', 'партии', 'партий'])}`,
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
