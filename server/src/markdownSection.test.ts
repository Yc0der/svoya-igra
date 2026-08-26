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
