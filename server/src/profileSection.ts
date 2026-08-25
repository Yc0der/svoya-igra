import type {
  DownTaggedQuestion,
  PriceStats,
  ProfileAggregate,
} from './history.js';

// Заголовок раздела. Задача 3 ищет по нему границы заменяемого куска, поэтому
// это одна константа на оба места, а не два одинаковых литерала.
export const AUTO_HEADING = '## Автособранное';

const INTRO =
  '_Раздел пересчитывается сервером после каждой партии. Правки руками не ' +
  'сохранятся — пиши их в «Ручные заметки». Источник — `game-history.db` ' +
  '(слайсы A и C)._';

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
 * formatEntry() из generatorProfile.ts, но здесь он не косметический.
 * Свободный текст приходит из <textarea>, и строка «## Что-то» внутри него,
 * вставленная как есть, стала бы настоящим заголовком: следующий пересчёт
 * принял бы её за границу раздела (задача 3 ищет границу по началу строки) и
 * обрезал бы раздел на середине.
 */
function indentContinuation(value: string): string {
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
  const head =
    `- **${entry.packFilename} · «${entry.themeName}» · ${entry.price}** — ` +
    `«${indentContinuation(entry.text)}» (ответ: «${entry.answer}»)`;
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
  const sample =
    `_Выборка: ${aggregate.games} ${plural(aggregate.games, ['партия', 'партии', 'партий'])}, ` +
    `${aggregate.questions} ${plural(aggregate.questions, [
      'сыгранный вопрос',
      'сыгранных вопроса',
      'сыгранных вопросов',
    ])}, ` +
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
            `- «${theme.themeName}» — ${theme.count} ${plural(theme.count, [
              'раз',
              'раза',
              'раз',
            ])} за ${theme.games} ${plural(theme.games, ['партию', 'партии', 'партий'])}`,
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
