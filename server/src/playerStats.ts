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
  return [STATS_HEADING, '', sample, '', body].join('\n');
}

/**
 * Ставит готовый раздел на место старого или дописывает в конец файла.
 * Остального в файле не трогает — анкеты выше остаются как были.
 *
 * В отличие от spliceAutoSection в profileSection.ts, здесь не нужно искать
 * якорь перед другим разделом: «Показывает в игре» — машинный раздел, в
 * который никто не дописывает построчно (в отличие от «Жалоб и оценок
 * игроков», которые appendComplaint кладёт буквально в конец файла), поэтому
 * он всегда последний, и «дописать» здесь буквально «дописать в конец файла».
 */
export function spliceStatsSection(fileText: string, section: string): string {
  const lines = fileText.split('\n');
  const sectionLines = section.split('\n');
  const range = findSectionRange(lines, STATS_HEADING);
  if (range) {
    return [
      ...lines.slice(0, range.start),
      ...sectionLines,
      '',
      ...lines.slice(range.end),
    ].join('\n');
  }
  const base = fileText.endsWith('\n') ? fileText : `${fileText}\n`;
  return `${base}\n---\n\n${sectionLines.join('\n')}\n`;
}
