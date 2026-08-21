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
  answeredByCounterId: 'p1',
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
      answeredByCounterId: null,
      correct: null,
      contested: null,
    });
    const [row] = history.allPlayedQuestions();
    expect(row.answeredBy).toBeNull();
    expect(row.answeredByCounterId).toBeNull();
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

describe('GameHistory.recentPlayed', () => {
  // Хелпер заводит партию и сразу пишет в неё один вопрос с заданным
  // questionId — по questionId в тестах видно, из какой по счёту партии
  // строка, без сверки по gameId напрямую.
  function startGameWithQuestion(
    history: GameHistory,
    questionId: string,
  ): number {
    const id = history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, { ...QUESTION, questionId });
    return id;
  }

  it('партий больше лимита — возвращает вопросы только последних gameLimit партий', () => {
    const history = makeHistory();
    startGameWithQuestion(history, 'q1');
    startGameWithQuestion(history, 'q2');
    startGameWithQuestion(history, 'q3');

    const rows = history.recentPlayed(2);

    // Ровно две последние заведённые партии, не любые две — так тест ловит и
    // перепутанное направление ORDER BY (ASC вместо DESC вернул бы q1, q2), и
    // off-by-one в LIMIT.
    expect(rows.map((r) => r.questionId).sort()).toEqual(['q2', 'q3']);
  });

  it('партий меньше лимита — возвращает вопросы всех партий', () => {
    const history = makeHistory();
    startGameWithQuestion(history, 'q1');
    startGameWithQuestion(history, 'q2');

    const rows = history.recentPlayed(5);
    expect(rows.map((r) => r.questionId).sort()).toEqual(['q1', 'q2']);
  });

  it('на пустой базе возвращает пустой массив', () => {
    const history = makeHistory();
    expect(history.recentPlayed(5)).toEqual([]);
  });

  it('не роняет вызов, когда база недоступна', () => {
    const history = makeHistory();
    startGameWithQuestion(history, 'q1');
    history.close();
    expect(() => history.recentPlayed(5)).not.toThrow();
    expect(history.recentPlayed(5)).toEqual([]);
  });

  // Регрессия финального ревью ветки, п. 3: startGame() создаёт строку
  // games на каждый запуск партии, включая фальстарты (отвалился игрок, не
  // тот пакет, поздно подключился телефон), которые тут же бросают, так и
  // не записав ни одного вопроса. Раньше окно набиралось по ROWID `games`
  // напрямую — несколько таких фальстартов подряд вытесняли бы из окна
  // партии, которые реально игрались, даже если в базе таких партий полно.
  it('партии без сыгранных вопросов не занимают место в окне', () => {
    const history = makeHistory();
    startGameWithQuestion(history, 'q1');
    // Фальстарт: партия заведена (строка games есть), но ни одного вопроса
    // в неё не записано — ровно то, что оставляет брошенный сразу старт.
    history.startGame({
      startedAt: '2026-08-20T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    });
    startGameWithQuestion(history, 'q2');

    // Лимит 2 — если бы фальстарт занимал место в окне, вернулась бы только
    // q2 (лимит съели «партия с q1» и пустая), а не обе сыгранные партии.
    const rows = history.recentPlayed(2);
    expect(rows.map((r) => r.questionId).sort()).toEqual(['q1', 'q2']);
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
  answeredByCounterId: null,
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

  // Финальное ревью ветки, п. 6 — дедупликация была по сырой строке
  // (answers.includes(row.answer)), и «Канберра»/«канберра» из разных
  // партий занимали два места. Печатается при этом ИСХОДНОЕ написание, а не
  // нормализованное — normalizeForCompare нужна только для сравнения.
  it('считает разным оформлением один и тот же ответ и печатает первое встреченное написание', () => {
    const text = formatRecentWindow([
      row('География', 'Канберра'),
      row('География', 'канберра', 2),
      row('География', 'КАНБЕРРА  ', 3),
    ]);
    expect(text).toBe('География: Канберра');
  });

  it('на пустой истории возвращает пустую строку', () => {
    expect(formatRecentWindow([])).toBe('');
  });
});

import { findRepeats, type QuestionTagInput } from './history.js';
import type { Pack } from './pack.js';

// image задаётся отдельным аргументом, потому что именно наличие картинки
// решает, чем findRepeats опознаёт вопрос: у медиа-вопроса — парой «текст +
// ответ», у текстового — одним текстом.
const packWith = (text: string, answer: string, image?: string): Pack => ({
  title: 'Т',
  author: 'а',
  createdAt: '2026-08-20',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            {
              id: 'r1-t-100',
              price: 100,
              text,
              answer,
              type: 'обычный',
              image,
            },
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

  // Живая проверка, 2026-08-21. У всех вопросов фото-темы формулировка
  // дословно одна и та же — вся суть в картинке. Сравнение по одному тексту
  // объявляло бы свежий вопрос про капибару повтором сыгранного пингвина и
  // браковало насмерть, то есть выкашивало бы весь тип вопросов целиком.
  it('не считает повтором медиа-вопрос с той же формулировкой, но другим ответом', () => {
    const report = findRepeats(
      packWith(
        'Какое животное изображено на фотографии?',
        'Капибара',
        'capybara.jpg',
      ),
      [
        {
          ...row('Животные', 'Пингвин'),
          text: 'Какое животное изображено на фотографии?',
        },
      ],
    );
    expect(report.sameQuestion).toEqual([]);
    expect(report.sameAnswer).toEqual([]);
  });

  it('считает повтором медиа-вопрос, у которого совпали и формулировка, и ответ', () => {
    const report = findRepeats(
      packWith(
        'Какое животное изображено на фотографии?',
        'Пингвин',
        'penguin.jpg',
      ),
      [
        {
          ...row('Животные', 'Пингвин'),
          text: 'Какое животное изображено на фотографии?',
        },
      ],
    );
    expect(report.sameQuestion).toHaveLength(1);
    expect(report.sameQuestion[0].previous.answer).toBe('Пингвин');
  });

  // Обратная сторона того же правила: у текстового вопроса личность как раз в
  // формулировке, а ответ к ней записывают по-разному. «1939» и «В 1939» —
  // один и тот же сыгранный вопрос (живая проверка, 2026-08-21), и требовать
  // совпадения ответа значило бы пропустить настоящий повтор из-за предлога.
  it('считает повтором текстовый вопрос с той же формулировкой, но иначе записанным ответом', () => {
    const report = findRepeats(
      packWith('В каком году началась Вторая мировая война?', '1939'),
      [
        {
          ...row('История', 'В 1939'),
          text: 'В каком году началась Вторая мировая война?',
        },
      ],
    );
    expect(report.sameQuestion).toHaveLength(1);
    expect(report.sameQuestion[0].previous.answer).toBe('В 1939');
  });

  // Ключ склеивает нормализованные текст и ответ, поэтому разделитель обязан
  // быть символом, которого нормализация не оставляет. На пробеле эта пара
  // совпала бы сама с собой наоборот и дала ложный повтор.
  it('не путает пару «текст + ответ», сдвинутую по границе слов', () => {
    const report = findRepeats(packWith('а', 'б в'), [
      { ...row('Тема', 'в'), text: 'а б' },
    ]);
    expect(report.sameQuestion).toEqual([]);
  });
});

describe('GameHistory: оценки вопросов', () => {
  function gameWithQuestion(history: GameHistory): number {
    const id = history.startGame({
      startedAt: '2026-08-21T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [{ counterId: 'p1', name: 'Ваня' }],
    })!;
    history.recordQuestion(id, QUESTION);
    return id;
  }

  const TAG: QuestionTagInput = {
    questionId: 'r1-geo-100',
    participantId: 'p1',
    participantName: 'Ваня',
    thumb: 'down',
  };

  it('записывает оценку', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    expect(history.allTags()).toEqual([
      { gameId, ...TAG, reason: null, reasonText: null },
    ]);
  });

  it('«передумал» обновляет строку, а не плодит вторую', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTag(gameId, { ...TAG, thumb: 'up' });
    const tags = history.allTags();
    expect(tags).toHaveLength(1);
    expect(tags[0].thumb).toBe('up');
  });

  it('оценки разных игроков по одному вопросу не мешают друг другу', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTag(gameId, {
      ...TAG,
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'up',
    });
    expect(history.allTags()).toHaveLength(2);
  });

  it('снятая оценка удаляется', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.clearTag(gameId, TAG.questionId, TAG.participantId);
    expect(history.allTags()).toEqual([]);
  });

  it('причина дописывается к уже поставленной оценке', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Слишком сложный',
      'вообще не слышал про это',
    );
    const [row] = history.allTags();
    expect(row.reason).toBe('Слишком сложный');
    expect(row.reasonText).toBe('вообще не слышал про это');
  });

  it('не роняет вызовы, когда база недоступна', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.close();
    expect(() => history.recordTag(gameId, TAG)).not.toThrow();
    expect(() =>
      history.clearTag(gameId, TAG.questionId, TAG.participantId),
    ).not.toThrow();
    expect(() =>
      history.recordTagReason(
        gameId,
        TAG.questionId,
        TAG.participantId,
        'X',
        '',
      ),
    ).not.toThrow();
    expect(history.allTags()).toEqual([]);
  });
});
