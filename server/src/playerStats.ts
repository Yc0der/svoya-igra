import type { PersonStats, PlayerStats } from './history.js';
import { findSectionRange } from './markdownSection.js';
import { oneLine } from './playerCard.js';

// Заголовок раздела. spliceStatsSection ищет по нему границы заменяемого
// куска, поэтому это одна константа на оба места (задача 3, profileSection.ts
// со своим AUTO_HEADING — тот же приём).
export const STATS_HEADING = '## Показывает в игре';

// Ограничение ПОКАЗА, а не порог вывода: человек, сыгравший десятки партий,
// может набрать сотни разных тем, и полный список не поместился бы в разумный
// markdown-раздел. «Мало данных — не делай вывод» — правило генератора, оно
// живёт в его инструкции, а не здесь: сервер просто обрезает список.
export const MAX_THEMES = 10;

// Предупреждение о том, что раздел машинный. Дословно из спеки (design.md,
// 2026-08-26-player-identity, пример раздела) — в брифе задачи 5 оно было
// потеряно, и без него правка руками молча исчезала на следующем game-end,
// а в самом файле не было ни слова о том, почему. У «Автособранного» такое
// же предупреждение есть в profileSection.ts (своя константа INTRO — не
// экспортирована, поэтому не переиспользуется отсюда, тот же довод, что и у
// plural() ниже).
const INTRO =
  '_Раздел пересчитывается сервером после каждой партии. Правки руками не ' +
  'сохранятся — пиши их в анкету выше. Источник — `game-history.db`._';

/**
 * Русское склонение числительного: 1 партия, 2 партии, 5 партий. Формы —
 * [для 1, для 2–4, для 5 и остальных]. Та же логика, что в profileSection.ts,
 * — не импортируется оттуда: та функция не экспортирована, а заводить
 * экспорт ради одной утилиты в модуле, который эта задача не должна трогать,
 * лишний риск задеть принятый ревью код.
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
 * Раздел одного человека. Все значения из базы, но имя и название темы
 * попадают сюда через oneLine — оба приходят снаружи (имя человека из лобби,
 * название темы из пакета) и оба уже один раз ловились с переносом строки
 * внутри, ломающим разбор markdown (playerCard.ts, profileSection.ts).
 */
function renderPerson(person: PersonStats): string {
  const lines = [
    `### ${oneLine(person.name)}`,
    '',
    `Всего: нажимал ${person.buzzes} из ${person.played} сыгранных при нём ` +
      `вопросов, верно ${person.correct}.`,
  ];
  const themes = person.themes.slice(0, MAX_THEMES);
  if (themes.length > 0) {
    lines.push('');
    for (const theme of themes) {
      lines.push(
        `- **${oneLine(theme.themeName)}** — нажимал ${theme.buzzes} из ` +
          `${theme.played} вопросов темы, верно ${theme.correct}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Раздел «Показывает в игре» целиком, без завершающего перевода строки — его
 * добавляет вставка (spliceStatsSection).
 *
 * Только числа, никаких выводов: толкует их генератор (design.md,
 * 2026-08-26-player-identity). Пустая база печатается заголовком и шапкой
 * так же, как пустое «Автособранное» в profileSection.ts — иначе вставка
 * искала бы границы раздела там, где их нет.
 */
export function renderPlayerStats(stats: PlayerStats): string {
  const sample =
    `_Выборка: ${stats.games} ` +
    `${plural(stats.games, ['партия', 'партии', 'партий'])} с опознанными ` +
    'игроками._';
  const body =
    stats.people.length > 0
      ? stats.people.map(renderPerson).join('\n\n')
      : 'Пока пусто — ни одной партии с опознанным игроком.';
  return [STATS_HEADING, '', INTRO, '', sample, '', body].join('\n');
}

/**
 * Убирает висящую пустую строку и ОДИН завершающий разделитель («---») с
 * конца файла — то, что appendAtEnd ниже сама же кладёт перед разделом.
 * Нужна, чтобы отрезание старого раздела (spliceStatsSection) не оставляло
 * позади себя осиротевший «---» и чтобы шаблон docs/players.md, уже
 * заканчивающийся строкой «---» (см. сам файл), не получал второй разделитель
 * подряд (ревью, Minor 3).
 */
function dropTrailingSeparator(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  if (result.length > 0 && result[result.length - 1] === '---') result.pop();
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result;
}

/**
 * Дописывает раздел в ИСТИННЫЙ конец файла — не ищет якорь перед другим
 * разделом (как spliceAutoSection в profileSection.ts делает для «Жалоб и
 * оценок игроков»): «Показывает в игре» — машинный раздел, в который никто
 * не дописывает построчно, поэтому ему всегда место в самом конце.
 */
function appendAtEnd(fileText: string, section: string): string {
  const withoutTrailingSeparator = dropTrailingSeparator(fileText.split('\n'));
  return [
    ...withoutTrailingSeparator,
    '',
    '---',
    '',
    ...section.split('\n'),
    '',
  ].join('\n');
}

/**
 * Ставит готовый раздел на место старого или дописывает в конец файла.
 * Остального в файле не трогает — анкеты выше остаются как были.
 *
 * Замена НЕ держится за старое место раздела (ревью, Important 2): найденный
 * раздел вырезается целиком, а свежий текст всегда дописывается в конец
 * функцией appendAtEnd. Это не косметика: человек может сыграть партию, ни
 * разу не заполнив анкету, — тогда после первого game-end раздел статистики
 * оказывается в конце файла. Если потом он присылает анкету, savePlayerCard
 * дописывает её в АБСОЛЮТНЫЙ конец, ничего не зная про раздел статистики
 * ниже, — и анкета оказывается ПОД машинным разделом. Замена «на месте»
 * закрепила бы этот сломанный порядок навсегда: каждый следующий пересчёт
 * просто переписывал бы раздел там же, где он и был, — ниже анкеты. Вырезание
 * и дописывание в конец вместо этого лечат порядок сами: первый же game-end
 * после такой анкеты возвращает раздел статистики под неё, откуда он
 * появился бы, не случись рассинхронизации.
 */
export function spliceStatsSection(fileText: string, section: string): string {
  const lines = fileText.split('\n');
  const range = findSectionRange(lines, STATS_HEADING);
  const withoutSection = range
    ? [...lines.slice(0, range.start), ...lines.slice(range.end)].join('\n')
    : fileText;
  return appendAtEnd(withoutSection, section);
}
