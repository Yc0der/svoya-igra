import { describe, expect, it } from 'vitest';
import { renderAutoSection } from './profileSection.js';
import type { ProfileAggregate } from './history.js';

const EMPTY: ProfileAggregate = {
  games: 0,
  questions: 0,
  tags: 0,
  downTagged: [],
  prices: [],
  boringThemes: [],
};

const QUESTION = {
  packFilename: 'photo-test.json',
  questionId: 'r1-kino-400',
  themeName: 'Кино',
  price: 400,
  text: 'Опера «Кармен» какого композитора?',
  answer: 'Жорж Бизе',
  down: 3,
  up: 1,
  reasons: [
    { reason: 'Неинтересная тема', count: 2 },
    { reason: 'Слишком сложный', count: 1 },
  ],
  texts: ['вообще не про кино'],
  lastGameId: 2,
};

describe('renderAutoSection', () => {
  it('на пустой базе печатает заголовок и «пока пусто»', () => {
    const text = renderAutoSection(EMPTY, new Set());
    expect(text).toContain('## Автособранное');
    expect(text).toContain('Пока пусто — в базе нет сыгранных партий.');
    expect(text).not.toContain('###');
  });

  it('склоняет числительные в шапке выборки', () => {
    const one = renderAutoSection(
      { ...EMPTY, games: 1, questions: 1, tags: 1 },
      new Set(),
    );
    expect(one).toContain('1 партия, 1 сыгранный вопрос, 1 оценка от игроков');
    const few = renderAutoSection(
      { ...EMPTY, games: 3, questions: 22, tags: 12 },
      new Set(),
    );
    expect(few).toContain(
      '3 партии, 22 сыгранных вопроса, 12 оценок от игроков',
    );
    const many = renderAutoSection(
      { ...EMPTY, games: 5, questions: 147, tags: 25 },
      new Set(),
    );
    expect(many).toContain(
      '5 партий, 147 сыгранных вопросов, 25 оценок от игроков',
    );
  });

  it('печатает запись вопроса с пальцами, причинами и текстом', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).toContain('- **photo-test.json · «Кино» · 400** —');
    expect(text).toContain('(ответ: «Жорж Бизе»)');
    expect(text).toContain(
      '👎 3 · 👍 1 · причины: «Неинтересная тема» ×2, «Слишком сложный» ×1',
    );
    expect(text).toContain('Текстом: «вообще не про кино»');
  });

  it('не печатает 👍, когда его нет, и говорит прямо, что причин не указали', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, up: 0, reasons: [], texts: [] }],
      },
      new Set(),
    );
    expect(text).toContain('👎 3 · причины не указаны');
    expect(text).not.toContain('👍');
    expect(text).not.toContain('Текстом:');
  });

  it('пропускает записи из списка «учтено» по паре пак+вопрос', () => {
    const other = { ...QUESTION, packFilename: 'other.json' };
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION, other] },
      new Set(['photo-test.json#r1-kino-400']),
    );
    expect(text).not.toContain('photo-test.json');
    expect(text).toContain('other.json');
  });

  it('не даёт свободному тексту разорвать раздел заголовком или разделителем', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, texts: ['плохо\n## Заголовок\n---\nещё'] }],
      },
      new Set(),
    );
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Автособранное');
      expect(line.startsWith('---')).toBe(false);
    }
  });

  it('печатает цены списком по возрастанию', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        prices: [
          { price: 500, correct: 15, wrong: 2, untaken: 3, noVerdict: 1 },
          { price: 100, correct: 18, wrong: 1, untaken: 1, noVerdict: 0 },
        ],
      },
      new Set(),
    );
    const prices = text.split('\n').filter((line) => line.startsWith('- **'));
    expect(prices[0]).toBe(
      '- **100** — верно 18, неверно 1, не взял никто 1, без вердикта 0',
    );
    expect(prices[1]).toBe(
      '- **500** — верно 15, неверно 2, не взял никто 3, без вердикта 1',
    );
  });

  it('печатает сводку тем со склонением', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 2,
        boringThemes: [
          { themeName: 'Спорт', count: 4, games: 2 },
          { themeName: 'Литература', count: 1, games: 1 },
        ],
      },
      new Set(),
    );
    expect(text).toContain('- «Спорт» — 4 раза за 2 партии');
    expect(text).toContain('- «Литература» — 1 раз за 1 партию');
  });

  it('не печатает пустых блоков', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 1, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).not.toContain('### Как берутся вопросы по ценам');
    expect(text).not.toContain('### Темы, названные неинтересными');
  });
});
