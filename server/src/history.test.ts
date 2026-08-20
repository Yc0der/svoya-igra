import { describe, expect, it } from 'vitest';
import { normalizeForCompare } from './history.js';

describe('normalizeForCompare', () => {
  it('приводит регистр, ё и пунктуацию к общему виду', () => {
    expect(normalizeForCompare('Кто написал «Ёлки»?')).toBe('кто написал елки');
  });

  it('схлопывает пробелы и обрезает края', () => {
    expect(normalizeForCompare('  Лев   Толстой  ')).toBe('лев толстой');
  });

  it('считает одинаковыми записи, отличающиеся только оформлением', () => {
    expect(normalizeForCompare('Пётр I')).toBe(normalizeForCompare('петр i'));
  });
});

import { GameHistory } from './history.js';

function makeHistory(): GameHistory {
  return new GameHistory(':memory:');
}

const QUESTION = {
  questionId: 'r1-geo-100',
  roundIndex: 0,
  themeName: 'География',
  price: 100,
  type: 'обычный',
  text: 'Столица Австралии?',
  answer: 'Канберра',
  answeredBy: 'Ваня',
  correct: true,
  contested: false,
};

describe('GameHistory', () => {
  it('заводит партию и возвращает её id', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'sport-kino.json',
      packTitle: 'Спорт и кино',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    });
    expect(id).not.toBeNull();
    expect(history.allGames()).toEqual([
      {
        id,
        startedAt: '2026-08-20T18:00:00.000Z',
        packFilename: 'sport-kino.json',
        packTitle: 'Спорт и кино',
        participants: [{ counterId: 'p1', name: 'Ваня' }],
        finalScores: null,
      },
    ]);
  });

  it('записывает сыгранный вопрос со всеми полями', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'sport-kino.json',
      packTitle: 'Спорт и кино',
      participants: [],
    })!;
    history.recordQuestion(id, QUESTION);
    expect(history.allPlayedQuestions()).toEqual([{ gameId: id, ...QUESTION }]);
  });

  it('сохраняет null-поля вопроса, который никто не взял', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, {
      ...QUESTION,
      answeredBy: null,
      correct: null,
      contested: null,
    });
    const [row] = history.allPlayedQuestions();
    expect(row.answeredBy).toBeNull();
    expect(row.correct).toBeNull();
    expect(row.contested).toBeNull();
  });

  it('проставляет итоговый счёт при завершении партии', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.finishGame(id, { p1: 700, p2: 300 });
    expect(history.allGames()[0].finalScores).toEqual({ p1: 700, p2: 300 });
  });

  it('удаляет партию вместе с её вопросами', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, QUESTION);
    history.discardGame(id);
    expect(history.allGames()).toEqual([]);
    expect(history.allPlayedQuestions()).toEqual([]);
  });

  it('не роняет партию, когда база недоступна', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.close();
    expect(() => history.recordQuestion(id, QUESTION)).not.toThrow();
    expect(() =>
      history.startGame({
        startedAt: '2026-08-20T18:00:00.000Z',
        packFilename: 'p.json',
        packTitle: 'П',
        participants: [],
      }),
    ).not.toThrow();
    expect(() => history.finishGame(id, {})).not.toThrow();
    expect(() => history.discardGame(id)).not.toThrow();
    expect(history.allPlayedQuestions()).toEqual([]);
  });
});

import { formatRecentWindow, type PlayedQuestionRow } from './history.js';

const row = (
  themeName: string,
  answer: string,
  gameId = 1,
): PlayedQuestionRow => ({
  gameId,
  questionId: 'q',
  roundIndex: 0,
  themeName,
  price: 100,
  type: 'обычный',
  text: 'вопрос',
  answer,
  answeredBy: null,
  correct: null,
  contested: null,
});

describe('formatRecentWindow', () => {
  it('группирует ответы по темам, по строке на тему', () => {
    const text = formatRecentWindow([
      row('Кино 90-х', 'Тарантино'),
      row('География', 'Канберра'),
      row('Кино 90-х', 'Матрица'),
    ]);
    expect(text).toBe('Кино 90-х: Тарантино, Матрица\nГеография: Канберра');
  });

  it('не повторяет один и тот же ответ внутри темы', () => {
    const text = formatRecentWindow([
      row('Кино 90-х', 'Тарантино'),
      row('Кино 90-х', 'Тарантино', 2),
    ]);
    expect(text).toBe('Кино 90-х: Тарантино');
  });

  it('на пустой истории возвращает пустую строку', () => {
    expect(formatRecentWindow([])).toBe('');
  });
});

import { findRepeats } from './history.js';
import type { Pack } from './pack.js';

const packWith = (text: string, answer: string): Pack => ({
  title: 'Т',
  author: 'а',
  createdAt: '2026-08-20',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            { id: 'r1-t-100', price: 100, text, answer, type: 'обычный' },
          ],
        },
      ],
    },
  ],
});

describe('findRepeats', () => {
  it('находит буквально тот же вопрос', () => {
    const report = findRepeats(packWith('Столица Австралии?', 'Канберра'), [
      { ...row('География', 'Канберра'), text: 'столица австралии' },
    ]);
    expect(report.sameQuestion).toHaveLength(1);
    expect(report.sameQuestion[0].questionId).toBe('r1-t-100');
    expect(report.sameAnswer).toHaveLength(0);
  });

  it('находит тот же ответ при другом вопросе', () => {
    const report = findRepeats(
      packWith('Какой город стал столицей Австралии в 1913 году?', 'Канберра'),
      [{ ...row('География', 'Канберра'), text: 'столица австралии' }],
    );
    expect(report.sameQuestion).toHaveLength(0);
    expect(report.sameAnswer).toHaveLength(1);
    expect(report.sameAnswer[0].previous.answer).toBe('Канберра');
  });

  it('проверяет и финальные вопросы пакета', () => {
    const pack = packWith('Новый вопрос', 'Новый ответ');
    pack.final = {
      themes: [
        {
          name: 'Финал',
          question: { id: 'final-x', text: 'Ф', answer: 'Канберра' },
        },
      ],
    };
    const report = findRepeats(pack, [row('География', 'Канберра')]);
    expect(report.sameAnswer.map((f) => f.questionId)).toEqual(['final-x']);
  });

  it('на чистом пакете не находит ничего', () => {
    const report = findRepeats(packWith('Совсем новое?', 'Новое'), [
      row('География', 'Канберра'),
    ]);
    expect(report.sameQuestion).toEqual([]);
    expect(report.sameAnswer).toEqual([]);
  });
});
