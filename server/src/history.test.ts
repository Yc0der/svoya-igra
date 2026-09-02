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
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    });
    expect(id).not.toBeNull();
    expect(history.allGames()).toEqual([
      {
        id,
        startedAt: '2026-08-20T18:00:00.000Z',
        packFilename: 'sport-kino.json',
        packTitle: 'Спорт и кино',
        participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
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
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
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

  it('пустые reason и reasonText приводятся к null', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTagReason(gameId, TAG.questionId, TAG.participantId, '', '');
    const [row] = history.allTags();
    expect(row.reason).toBeNull();
    expect(row.reasonText).toBeNull();
  });

  it('партия с оценками выбрасывается целиком, включая оценки', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.discardGame(gameId);
    expect(history.allGames()).toEqual([]);
    expect(history.allPlayedQuestions()).toEqual([]);
    expect(history.allTags()).toEqual([]);
  });

  it('передумал и сменил палец — причина осталась', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);
    history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Слишком лёгкий',
      'знал с детства',
    );
    // Передумали, сменили палец на up
    history.recordTag(gameId, { ...TAG, thumb: 'up' });
    const [row] = history.allTags();
    expect(row.thumb).toBe('up');
    // Причина должна остаться, не стереться
    expect(row.reason).toBe('Слишком лёгкий');
    expect(row.reasonText).toBe('знал с детства');
  });

  // Финальное ревью ветки, п. 7: guard `AND thumb = 0` защищает профиль
  // генератора от записи по вопросу с пальцем ВВЕРХ. Раньше это проверялось
  // только фейком в room.test.ts, повторяющим ту же логику своими руками, —
  // здесь настоящий SQL.
  it('причина не проходит по вопросу с пальцем вверх', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, { ...TAG, thumb: 'up' });

    const updated = history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Слишком сложный',
      'текст',
    );

    expect(updated).toBe(false);
    const [row] = history.allTags();
    expect(row.reason).toBeNull();
    expect(row.reasonText).toBeNull();
  });

  // Финальное ревью ветки, п. 3: без `AND reason IS NULL AND reason_text IS
  // NULL` в WHERE повторный UPDATE теми же (или другими) значениями снова
  // матчит строку и снова возвращает true — сервер дописал бы в профиль
  // генератора вторую, возможно противоречащую первой, претензию на один и
  // тот же вопрос.
  it('повторная отправка причины по уже разобранному вопросу не проходит и не переписывает её', () => {
    const history = makeHistory();
    const gameId = gameWithQuestion(history);
    history.recordTag(gameId, TAG);

    const first = history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Слишком сложный',
      'первая причина',
    );
    const second = history.recordTagReason(
      gameId,
      TAG.questionId,
      TAG.participantId,
      'Спорный ответ',
      'вторая причина',
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    const [row] = history.allTags();
    expect(row.reason).toBe('Слишком сложный');
    expect(row.reasonText).toBe('первая причина');
  });
});

describe('GameHistory.downTagsForReview', () => {
  function gameWithTwoQuestions(history: GameHistory): number {
    const id = history.startGame({
      startedAt: '2026-08-21T18:00:00.000Z',
      packFilename: 'p.json',
      packTitle: 'П',
      participants: [],
    })!;
    history.recordQuestion(id, { ...QUESTION, questionId: 'q1' });
    history.recordQuestion(id, {
      ...QUESTION,
      questionId: 'q2',
      text: 'Второй вопрос?',
      answer: 'Второй ответ',
    });
    return id;
  }

  it('возвращает только пальцы вниз этого игрока, с текстом и ответом', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.recordTag(gameId, {
      questionId: 'q1',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTag(gameId, {
      questionId: 'q2',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'up',
    });
    history.recordTag(gameId, {
      questionId: 'q2',
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'down',
    });

    const items = history.downTagsForReview(gameId, 'p1', 5);

    expect(items).toEqual([
      {
        questionId: 'q1',
        themeName: 'География',
        price: 100,
        text: 'Столица Австралии?',
        answer: 'Канберра',
      },
    ]);
  });

  it('уже разобранный вопрос из списка уходит', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.recordTag(gameId, {
      questionId: 'q1',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTagReason(gameId, 'q1', 'p1', 'Слишком сложный', null);

    expect(history.downTagsForReview(gameId, 'p1', 5)).toEqual([]);
  });

  it('соблюдает потолок', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    for (const questionId of ['q1', 'q2']) {
      history.recordTag(gameId, {
        questionId,
        participantId: 'p1',
        participantName: 'Ваня',
        thumb: 'down',
      });
    }

    expect(history.downTagsForReview(gameId, 'p1', 1)).toHaveLength(1);
  });

  it('не роняет вызов, когда база недоступна', () => {
    const history = makeHistory();
    const gameId = gameWithTwoQuestions(history);
    history.close();
    expect(() => history.downTagsForReview(gameId, 'p1', 5)).not.toThrow();
    expect(history.downTagsForReview(gameId, 'p1', 5)).toEqual([]);
  });
});

describe('GameHistory.profileAggregate', () => {
  it('схлопывает один вопрос из двух партий в одну запись', () => {
    const history = makeHistory();
    const g1 = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    })!;
    const g2 = history.startGame({
      startedAt: '2026-08-02',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    })!;
    history.recordQuestion(g1, QUESTION);
    history.recordQuestion(g2, QUESTION);
    history.recordTag(g1, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTag(g2, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTagReason(
      g1,
      QUESTION.questionId,
      'p1',
      'Слишком сложный',
      '',
    );
    history.recordTagReason(
      g2,
      QUESTION.questionId,
      'p1',
      'Слишком сложный',
      '',
    );

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged).toHaveLength(1);
    expect(aggregate.downTagged[0]).toMatchObject({
      packFilename: 'pack.json',
      questionId: QUESTION.questionId,
      down: 2,
      up: 0,
      reasons: [{ reason: 'Слишком сложный', count: 2 }],
      lastGameId: g2,
    });
  });

  it('включает палец вниз без разбора и не выдумывает ему причину', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    })!;
    history.recordQuestion(gameId, QUESTION);
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged[0].down).toBe(1);
    expect(aggregate.downTagged[0].reasons).toEqual([]);
    expect(aggregate.downTagged[0].texts).toEqual([]);
  });

  it('считает палец вверх рядом с пальцем вниз, но сам по себе записи не создаёт', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'p1', name: 'Ваня', personId: null },
        { counterId: 'p2', name: 'Катя', personId: null },
      ],
    })!;
    history.recordQuestion(gameId, QUESTION);
    history.recordQuestion(gameId, { ...QUESTION, questionId: 'r1-geo-200' });
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'down',
    });
    history.recordTag(gameId, {
      questionId: QUESTION.questionId,
      participantId: 'p2',
      participantName: 'Катя',
      thumb: 'up',
    });
    history.recordTag(gameId, {
      questionId: 'r1-geo-200',
      participantId: 'p1',
      participantName: 'Ваня',
      thumb: 'up',
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.downTagged).toHaveLength(1);
    expect(aggregate.downTagged[0]).toMatchObject({ down: 1, up: 1 });
  });

  it('различает «не взял никто» и «без вердикта»', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    })!;
    // Верный, неверный, никто не нажал, ведущий отменил после нажатия.
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'a',
      correct: true,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'b',
      correct: false,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'c',
      answeredBy: null,
      answeredByCounterId: null,
      correct: null,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'd',
      correct: null,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.prices).toEqual([
      { price: 100, correct: 1, wrong: 1, untaken: 1, noVerdict: 1 },
    ]);
  });

  it('исключает из цен финальные вопросы и аукционы, но оставляет котов', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'p1', name: 'Ваня', personId: null }],
    })!;
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'кот',
      type: 'кот',
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'аукцион',
      type: 'аукцион',
      price: 700,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'финал',
      roundIndex: -1,
      price: 0,
    });

    const aggregate = history.profileAggregate();
    expect(aggregate.prices).toEqual([
      { price: 100, correct: 1, wrong: 0, untaken: 0, noVerdict: 0 },
    ]);
  });

  it('считает темы только по причине «Неинтересная тема»', () => {
    const history = makeHistory();
    const gameId = history.startGame({
      startedAt: '2026-08-01',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'p1', name: 'Ваня', personId: null },
        { counterId: 'p2', name: 'Катя', personId: null },
      ],
    })!;
    history.recordQuestion(gameId, QUESTION);
    for (const participantId of ['p1', 'p2']) {
      history.recordTag(gameId, {
        questionId: QUESTION.questionId,
        participantId,
        participantName: participantId,
        thumb: 'down',
      });
    }
    history.recordTagReason(
      gameId,
      QUESTION.questionId,
      'p1',
      'Неинтересная тема',
      '',
    );
    history.recordTagReason(
      gameId,
      QUESTION.questionId,
      'p2',
      'Непонятная формулировка',
      '',
    );

    const aggregate = history.profileAggregate();
    expect(aggregate.boringThemes).toEqual([
      { themeName: 'География', count: 1, games: 1 },
    ]);
  });

  it('на пустой базе отдаёт нули и пустые списки', () => {
    const aggregate = makeHistory().profileAggregate();
    expect(aggregate).toEqual({
      games: 0,
      questions: 0,
      tags: 0,
      downTagged: [],
      prices: [],
      boringThemes: [],
    });
  });
});

describe('люди и состав партии', () => {
  it('заводит человека и возвращает его в списке', () => {
    const history = makeHistory();
    const id = history.createPerson('Ваня', '2026-08-26');
    expect(id).not.toBeNull();
    expect(history.listPeople()).toEqual([{ id, name: 'Ваня', games: 0 }]);
  });

  it('сортирует список по числу партий убыванием', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const katya = history.createPerson('Катя', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Катя', personId: katya }],
    });
    expect(history.listPeople().map((p) => p.name)).toEqual(['Катя', 'Ваня']);
    expect(history.listPeople()[0].games).toBe(1);
    expect(vanya).not.toBe(katya);
  });

  it('пишет состав только для участников с человеком', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'c1', name: 'Ваня', personId: vanya },
        { counterId: 'c2', name: 'Гость', personId: null },
      ],
    });
    expect(history.listPeople()).toEqual([
      { id: vanya, name: 'Ваня', games: 1 },
    ]);
  });

  // Ревью задачи 1, Important 1: запись games уже состоялась к моменту
  // записи состава, и сбой при записи состава (здесь — нарушение внешнего
  // ключа на несуществующий personId, ровно то, что могло бы случиться со
  // слитым и удалённым человеком в задаче 2) не должен ронять уже заведённую
  // партию — иначе Room получила бы null и перестала бы писать в неё вопросы,
  // оценки и итог, при живой строке games в базе.
  it('сбой при записи состава не мешает startGame вернуть id партии', () => {
    const history = makeHistory();
    const id = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: 999 }],
    });
    expect(id).not.toBeNull();
    expect(history.allGames()).toHaveLength(1);
    // Состав при этом не записался — personId 999 не существовал.
    expect(history.listPeople()).toEqual([]);
  });

  // Финальное ревью ветки, п. 1 (Critical): discardGame() не знал про
  // game_people. Внешние ключи в node:sqlite включены по умолчанию, и
  // DELETE FROM games при живой ссылке из game_people бросает FOREIGN KEY
  // constraint failed — ошибка ловится и уходит в лог, а строка games и
  // состав партии остаются. Итог: выброшенная партия продолжает считаться
  // сыгранной — фантомная партия в listPeople() у человека, которого
  // ведущий явно выбросил из истории.
  it('выброшенная партия с составом людей удаляется полностью — призрака в listPeople не остаётся', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const id = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanya }],
    })!;
    history.discardGame(id);
    expect(history.allGames()).toEqual([]);
    expect(history.listPeople()).toEqual([
      { id: vanya, name: 'Ваня', games: 0 },
    ]);
  });

  // Финальное ревью ветки, п. 2 (Important), часть (а): участники живут в
  // лобби между партиями дольше, чем действует блокировка слияния (та
  // держит только идущую партию) — personId может протухнуть между слиянием
  // профилей и следующим стартом. Раньше вставка состава шла под ОДНИМ
  // try/catch на весь цикл: сбой на протухшем personId одного участника
  // прерывал цикл целиком и терял ВСЕХ участников ПОСЛЕ него, даже с живым
  // personId.
  it('сбойный personId одного участника не мешает записать остальных после него', () => {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const id = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        // Протухший personId (человек уже слит/удалён) — идёт ПЕРВЫМ.
        { counterId: 'c1', name: 'Призрак', personId: 999 },
        { counterId: 'c2', name: 'Ваня', personId: vanya },
      ],
    });
    expect(id).not.toBeNull();
    // Ваня — участник ПОСЛЕ сбойного — обязан попасть в состав, несмотря на
    // то что перед ним стоял участник с несуществующим personId.
    expect(history.listPeople()).toEqual([
      { id: vanya, name: 'Ваня', games: 1 },
    ]);
  });
});

describe('GameHistory.playerStats', () => {
  // Готовит партию: Ваня берёт два вопроса из трёх по «Истории», один верно.
  function seed() {
    const history = makeHistory();
    const vanya = history.createPerson('Ваня', '2026-08-26')!;
    const gameId = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: vanya }],
    })!;
    const base = { ...QUESTION, themeName: 'История' };
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q1',
      answeredByCounterId: 'c1',
      correct: true,
    });
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q2',
      answeredByCounterId: 'c1',
      correct: false,
    });
    history.recordQuestion(gameId, {
      ...base,
      questionId: 'q3',
      answeredBy: null,
      answeredByCounterId: null,
      correct: null,
    });
    return { history, vanya, gameId };
  }

  it('считает нажатия и верные ответы по теме', () => {
    const { history, vanya } = seed();
    const stats = history.playerStats();
    expect(stats.games).toBe(1);
    expect(stats.people).toEqual([
      {
        id: vanya,
        name: 'Ваня',
        games: 1,
        played: 3,
        buzzes: 2,
        correct: 1,
        themes: [{ themeName: 'История', played: 3, buzzes: 2, correct: 1 }],
      },
    ]);
  });

  it('не считает вопросы партий, в которых человека не было', () => {
    const { history, vanya } = seed();
    const other = history.createPerson('Катя', '2026-08-26')!;
    const second = history.startGame({
      startedAt: '2026-08-27',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c9', name: 'Катя', personId: other }],
    })!;
    history.recordQuestion(second, { ...QUESTION, questionId: 'q9' });

    const vanyaStats = history.playerStats().people.find((p) => p.id === vanya);
    expect(vanyaStats?.played).toBe(3);
  });

  it('исключает финальные вопросы', () => {
    const { history, gameId, vanya } = seed();
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'final',
      roundIndex: -1,
      price: 0,
      themeName: 'Финал',
      answeredByCounterId: 'c1',
      correct: true,
    });
    const stats = history.playerStats().people.find((p) => p.id === vanya);
    expect(stats?.played).toBe(3);
    expect(stats?.themes.map((t) => t.themeName)).toEqual(['История']);
  });

  it('не печатает людей без единой партии', () => {
    const { history } = seed();
    history.createPerson('Никогда не играл', '2026-08-26');
    expect(history.playerStats().people).toHaveLength(1);
  });
});

describe('GameHistory.forgetPerson', () => {
  it('убирает человека из списка и из статистики, не трогая партию', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const gameId = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: a }],
    })!;
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'q1',
      answeredByCounterId: 'c1',
      correct: true,
    });

    expect(history.forgetPerson(a)).toBe(true);
    expect(history.listPeople()).toEqual([]);
    expect(history.playerStats().people).toEqual([]);
    // Вопрос остаётся: он обезличен и нужен генератору (спека анкет,
    // «Удаление анкеты — это удаление анкеты»).
    expect(history.allPlayedQuestions()).toHaveLength(1);
  });

  it('забывает одного, не трогая соседа по столу', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const b = history.createPerson('Катя', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'c1', name: 'Ваня', personId: a },
        { counterId: 'c2', name: 'Катя', personId: b },
      ],
    });

    expect(history.forgetPerson(a)).toBe(true);
    expect(history.listPeople()).toEqual([{ id: b, name: 'Катя', games: 1 }]);
  });

  it('возвращает false на несуществующего человека, база цела', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    expect(history.forgetPerson(999)).toBe(false);
    expect(history.listPeople()).toEqual([{ id: a, name: 'Ваня', games: 0 }]);
  });
});

describe('GameHistory.mergePeople', () => {
  it('перепривязывает состав и удаляет лишнюю запись', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const b = history.createPerson('ваня', '2026-08-26')!;
    history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c1', name: 'Ваня', personId: a }],
    });
    history.startGame({
      startedAt: '2026-08-27',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [{ counterId: 'c2', name: 'ваня', personId: b }],
    });

    expect(history.mergePeople(b, a)).toBe(true);
    expect(history.listPeople()).toEqual([{ id: a, name: 'Ваня', games: 2 }]);
  });

  it('отказывается сливать человека с самим собой', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    expect(history.mergePeople(a, a)).toBe(false);
    expect(history.listPeople()).toHaveLength(1);
  });

  // Ревью задачи 1, Minor 3: докстринг обещает false, если сливать нечего —
  // несуществующий fromId как раз этот случай (DELETE трогает ноль строк,
  // исключения нет).
  it('возвращает false, если fromId не существует — сливать нечего', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    expect(history.mergePeople(999, a)).toBe(false);
    expect(history.listPeople()).toHaveLength(1);
  });

  it('переживает случай, когда оба были за одним столом', () => {
    const history = makeHistory();
    const a = history.createPerson('Ваня', '2026-08-26')!;
    const b = history.createPerson('ваня', '2026-08-26')!;
    const gameId = history.startGame({
      startedAt: '2026-08-26',
      packFilename: 'pack.json',
      packTitle: 'Пак',
      participants: [
        { counterId: 'c1', name: 'Ваня', personId: a },
        { counterId: 'c2', name: 'ваня', personId: b },
      ],
    })!;
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'q1',
      answeredByCounterId: 'c1',
      correct: true,
    });
    history.recordQuestion(gameId, {
      ...QUESTION,
      questionId: 'q2',
      answeredByCounterId: 'c2',
      correct: false,
    });

    expect(history.mergePeople(b, a)).toBe(true);
    expect(history.listPeople()).toEqual([{ id: a, name: 'Ваня', games: 1 }]);

    // Ревью задачи 1, Minor 4: после слияния у человека a — два счётчика
    // (c1 и c2) одной партии, соединение gp × played_questions выдаёт каждый
    // вопрос дважды, и без COUNT(DISTINCT ...) числа задвоились бы (played
    // стал бы 4 вместо 2, buzzes — 4 вместо 2).
    const stats = history.playerStats().people.find((p) => p.id === a);
    expect(stats).toMatchObject({
      games: 1,
      played: 2,
      buzzes: 2,
      correct: 1,
    });
  });
});
