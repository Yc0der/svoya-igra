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
