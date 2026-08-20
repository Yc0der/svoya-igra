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
