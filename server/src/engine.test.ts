import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  FINAL_ELIM_TIMER_MS,
  FINAL_WAGER_TIMER_MS,
  FINAL_ANSWER_TIMER_MS,
  FINAL_JUDGING_TIMER_MS,
  FINAL_REVEAL_TIMER_MS,
  CAT_HANDOFF_TIMER_MS,
  type EngineState,
} from './engine.js';
import type { Pack } from './pack.js';

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    title: 'Тест',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема A',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'A1?',
                answer: 'ответ a1',
                type: 'обычный',
              },
              {
                id: 'a2',
                price: 200,
                text: 'A2?',
                answer: 'ответ a2',
                type: 'обычный',
              },
            ],
          },
        ],
      },
      {
        themes: [
          {
            name: 'Тема B',
            questions: [
              {
                id: 'b1',
                price: 100,
                text: 'B1?',
                answer: 'ответ b1',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

const CAT_PACK = makePack({
  rounds: [
    {
      themes: [
        {
          name: 'Тема A',
          questions: [
            {
              id: 'a1',
              price: 100,
              text: 'A1?',
              answer: 'ответ a1',
              type: 'кот',
            },
            {
              id: 'a2',
              price: 200,
              text: 'A2?',
              answer: 'ответ a2',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
});

function selectCat(state: EngineState) {
  return reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
}

const PACK = makePack();

const FINAL_PACK = makePack({
  final: {
    themes: [
      {
        name: 'Финал A',
        question: { id: 'f1', text: 'F1?', answer: 'ответ f1' },
      },
      {
        name: 'Финал B',
        question: { id: 'f2', text: 'F2?', answer: 'ответ f2' },
      },
      {
        name: 'Финал C',
        question: { id: 'f3', text: 'F3?', answer: 'ответ f3' },
      },
    ],
  },
});

// Строит EngineState прямо в final-elim, минуя весь предыдущий раунд —
// unit-тестам финала не нужно доигрывать до него через select/buzz/vote.
function finalElimState(scores: Record<string, number>): EngineState {
  const ordered = Object.keys(scores).sort((a, b) => scores[a] - scores[b]);
  return {
    ...createInitialState(FINAL_PACK, Object.keys(scores), 'judge'),
    phase: 'final-elim',
    scores,
    finalRemainingThemeIndices: [0, 1, 2],
    finalElimCounterId: ordered[0],
  };
}

function selectFirst(state: EngineState) {
  return reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
}

describe('createInitialState', () => {
  it('starts in selecting phase with zeroed scores for every counter', () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    expect(state.phase).toBe('selecting');
    expect(state.roundIndex).toBe(0);
    expect(state.scores).toEqual({ p1: 0, p2: 0 });
    expect(['p1', 'p2']).toContain(state.turnCounterId);
    expect(state.answeredQuestionIds).toEqual([]);
  });
});

describe('select-question', () => {
  it("opens the question and starts the question timer when it is the picker's turn", () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = selectFirst(state);
    expect(next.phase).toBe('question-open');
    expect(next.currentQuestion).toEqual({ themeIndex: 0, questionId: 'a1' });
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it("is a no-op when it is not that counter's turn", () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const otherId = state.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(state, {
      type: 'select-question',
      counterId: otherId,
      themeIndex: 0,
      questionId: 'a1',
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op for an already-answered question', () => {
    const state = {
      ...createInitialState(PACK, ['p1', 'p2']),
      answeredQuestionIds: ['a1'],
    };
    const { state: next } = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    });
    expect(next.phase).toBe('selecting');
  });

  it('is a no-op for an unknown question id', () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const { state: next } = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'not-a-real-id',
    });
    expect(next.phase).toBe('selecting');
  });
});

describe('buzz', () => {
  it('locks the question to the first counter and starts the said-answer timer', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: buzzed, effects } = reduce(opened, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(buzzed.phase).toBe('buzzed');
    expect(buzzed.buzzedCounterId).toBe('p1');
    expect(effects).toEqual([
      { type: 'cancel-timer', timer: 'question' },
      { type: 'start-timer', timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
    ]);
  });

  it('ignores a second buzz once someone already buzzed (race resolved by arrival order)', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: firstBuzz } = reduce(opened, {
      type: 'buzz',
      counterId: 'p1',
    });
    const { state: secondBuzz, effects } = reduce(firstBuzz, {
      type: 'buzz',
      counterId: 'p2',
    });
    expect(secondBuzz).toEqual(firstBuzz);
    expect(effects).toEqual([]);
  });

  it('ignores a buzz from an unknown counter id', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: opened } = selectFirst(initial);
    const { state: next } = reduce(opened, {
      type: 'buzz',
      counterId: 'ghost',
    });
    expect(next.phase).toBe('question-open');
  });

  it('ignores a buzz outside question-open (falsestart), even though Room is expected to filter this earlier', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = reduce(initial, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(next).toEqual(initial);
    expect(effects).toEqual([]);
  });
});

function buzzP1(state: EngineState) {
  return reduce(state, { type: 'buzz', counterId: 'p1' }).state;
}

describe('said-answer', () => {
  it('moves to judging and starts the vote timer', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: judging, effects } = reduce(buzzed, {
      type: 'said-answer',
      counterId: 'p1',
    });
    expect(judging.phase).toBe('judging');
    expect(judging.votes).toEqual({});
    expect(effects).toEqual([
      { type: 'cancel-timer', timer: 'said-answer' },
      { type: 'start-timer', timer: 'vote', ms: VOTE_TIMER_MS },
    ]);
  });

  it('is a no-op from someone other than the buzzed counter', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: next } = reduce(buzzed, {
      type: 'said-answer',
      counterId: 'p2',
    });
    expect(next.phase).toBe('buzzed');
  });
});

describe('timer-expired: said-answer', () => {
  it('advances to judging exactly like an explicit said-answer, so bystanders can still judge what was said aloud', () => {
    const opened = selectFirst(createInitialState(PACK, ['p1', 'p2'])).state;
    const buzzed = buzzP1(opened);
    const { state: next } = reduce(buzzed, {
      type: 'timer-expired',
      timer: 'said-answer',
    });
    expect(next.phase).toBe('judging');
  });
});

function toJudging(state: EngineState) {
  const opened = selectFirst(state).state;
  const buzzed = buzzP1(opened);
  return reduce(buzzed, { type: 'said-answer', counterId: 'p1' }).state;
}

describe('vote', () => {
  it('records a vote from an eligible counter without resolving yet', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    });
    expect(next.phase).toBe('judging');
    expect(next.votes).toEqual({ p2: true });
    expect(effects).toEqual([]);
  });

  it('ignores a vote from the counter who answered', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'p1',
      correct: true,
    });
    expect(next.votes).toEqual({});
  });

  it('ignores a vote from outside the game', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'ghost',
      correct: true,
    });
    expect(next.votes).toEqual({});
  });
});

describe('vote — host mode', () => {
  // hostId — не counterId (design.md, «Ведущий»): ни в scores, ни среди тех,
  // кому select-question/buzz дали бы что-то сделать. 'judge' здесь — id
  // участника-ведущего, не счётчика.
  it("resolves immediately on the host's vote, without waiting for the timer", () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: true,
    });
    expect(next.phase).toBe('reveal');
    expect(next.scores.p1).toBe(100);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });

  it('ignores a vote from anyone other than the host, even an eligible non-answering counter', () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    });
    expect(next.phase).toBe('judging');
    expect(next.votes).toEqual({});
    expect(effects).toEqual([]);
  });
});

describe('timer-expired: vote — correct', () => {
  it('awards the price, advances the turn to the answerer, marks the question answered, and reveals', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: voted } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: true,
    });
    const { state: next, effects } = reduce(voted, {
      type: 'timer-expired',
      timer: 'vote',
    });

    expect(next.phase).toBe('reveal');
    expect(next.scores.p1).toBe(100);
    expect(next.turnCounterId).toBe('p1');
    expect(next.lastCorrectCounterId).toBe('p1');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.buzzedCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });

  it('treats a tie as correct — the benefit of the doubt goes to the answerer', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2', 'p3']));
    const withVotes = [
      { counterId: 'p2', correct: true },
      { counterId: 'p3', correct: false },
    ].reduce((s, v) => reduce(s, { type: 'vote', ...v }).state, judging);
    const { state: next } = reduce(withVotes, {
      type: 'timer-expired',
      timer: 'vote',
    });
    expect(next.scores.p1).toBe(100);
  });

  it('treats no votes at all as correct', () => {
    const judging = toJudging(createInitialState(PACK, ['p1', 'p2']));
    const { state: next } = reduce(judging, {
      type: 'timer-expired',
      timer: 'vote',
    });
    expect(next.scores.p1).toBe(100);
  });
});

describe('timer-expired: vote — incorrect, open mode (two counters, no host)', () => {
  it('penalizes the answerer and closes the question immediately, without reopening for anyone', () => {
    // До 2026-08-05 здесь проверялось переоткрытие — убрано как дефект
    // спеки, найденный на первой живой проверке: единственный голосующий на
    // двоих уже видел ответ на табло, так что повторное «Жать!» для него не
    // было бы честным. См. design.md, «СУДЕЙСТВО».
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const judging = toJudging(initial);
    const { state: voted } = reduce(judging, {
      type: 'vote',
      counterId: 'p2',
      correct: false,
    });
    const { state: next, effects } = reduce(voted, {
      type: 'timer-expired',
      timer: 'vote',
    });

    expect(next.phase).toBe('reveal');
    expect(next.scores.p1).toBe(-100);
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.buzzedCounterId).toBeNull();
    expect(next.turnCounterId).toBe(initial.turnCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });
});

describe('vote — incorrect, host mode (three or more counters)', () => {
  // Кто именно временно не может жать повторно — с 2026-08-05 не забота
  // движка вообще (design.md, «СУДЕЙСТВО»): это транспортное ограничение
  // Комнаты, тем же паттерном, что и фальстарт (Room.test.ts проверяет его
  // отдельно). Движок здесь отвечает только за то, что вопрос честно
  // переоткрывается сразу же — без какой-либо промежуточной паузы —
  // тем же именованным таймером 'question', с которого начинался (Комната
  // сама решает, сколько миллисекунд туда реально подставить).
  it('penalizes the answerer and reopens the question immediately with a question-timer effect', () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });

    expect(next.phase).toBe('question-open');
    expect(next.scores.p1).toBe(-100);
    expect(next.answeredQuestionIds).toEqual([]);
    expect(next.buzzedCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('lets anyone, including the counter who just answered wrong, buzz again — the engine itself excludes nobody', () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const reopened = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    }).state;

    const { state: next } = reduce(reopened, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(next.phase).toBe('buzzed');
    expect(next.buzzedCounterId).toBe('p1');
  });
});

describe('timer-expired: question — nobody buzzed', () => {
  it('reveals with no score change and keeps the same picker', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const opened = selectFirst(initial).state;
    const { state: next, effects } = reduce(opened, {
      type: 'timer-expired',
      timer: 'question',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.scores).toEqual(initial.scores);
    expect(next.turnCounterId).toBe(initial.turnCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });
});

describe('timer-expired: reveal', () => {
  it('returns to selecting when the round still has unanswered questions', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const opened = selectFirst(initial).state;
    const revealed = reduce(opened, {
      type: 'timer-expired',
      timer: 'question',
    }).state;
    const { state: next, effects } = reduce(revealed, {
      type: 'timer-expired',
      timer: 'reveal',
    });
    expect(next.phase).toBe('selecting');
    expect(next.currentQuestion).toBeNull();
    expect(effects).toEqual([]);
  });

  it('moves to round-end when the round is complete and more rounds remain', () => {
    let state = createInitialState(PACK, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('round-end');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'round-end', ms: ROUND_END_TIMER_MS },
    ]);
  });

  it('ends the game when the last round is complete', () => {
    const onlyRoundPack = makePack({
      rounds: [
        {
          themes: [
            {
              name: 'Тема A',
              questions: [
                {
                  id: 'a1',
                  price: 100,
                  text: 'A1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
      ],
    });
    let state = createInitialState(onlyRoundPack, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
    expect(effects).toEqual([]);
  });
});

describe('timer-expired: round-end', () => {
  it('advances to the next round in selecting phase', () => {
    let state = createInitialState(PACK, ['p1', 'p2']);
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'round-end',
    });

    expect(next.phase).toBe('selecting');
    expect(next.roundIndex).toBe(1);
  });
});

describe('adjust-score', () => {
  it("lets the host adjust any counter's score, in any phase", () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const { state: next, effects } = reduce(state, {
      type: 'adjust-score',
      requesterId: 'judge',
      targetCounterId: 'p2',
      delta: -100,
    });
    expect(next.scores.p2).toBe(-100);
    expect(next.scores.p1).toBe(0);
    expect(effects).toEqual([]);
  });

  it('ignores the request from anyone other than the host', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const { state: next } = reduce(state, {
      type: 'adjust-score',
      requesterId: 'p1',
      targetCounterId: 'p2',
      delta: 100,
    });
    expect(next.scores.p2).toBe(0);
  });

  it('is a no-op in open mode, where there is no host', () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    const { state: next } = reduce(state, {
      type: 'adjust-score',
      requesterId: 'p1',
      targetCounterId: 'p2',
      delta: 100,
    });
    expect(next.scores.p2).toBe(0);
  });

  it('ignores an unknown target counter', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const { state: next } = reduce(state, {
      type: 'adjust-score',
      requesterId: 'judge',
      targetCounterId: 'ghost',
      delta: 100,
    });
    expect(next.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
  });
});

describe('skip-to-final', () => {
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final. Только с
  // админ-панели, поэтому без requesterId — проверять тут нечего, кроме фаз.
  it('forces a transition to the final round from a normal round phase, when a host exists', () => {
    const state = createInitialState(FINAL_PACK, ['p1', 'p2'], 'judge');
    const { state: next, effects } = reduce(state, { type: 'skip-to-final' });
    expect(next.phase).toBe('final-elim');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });

  it('is a no-op with no host — the final round always requires one, same as a natural transition', () => {
    const state = createInitialState(FINAL_PACK, ['p1', 'p2']);
    const { state: next } = reduce(state, { type: 'skip-to-final' });
    expect(next).toEqual(state);
  });

  it('is a no-op once already in the final round', () => {
    const state = finalElimState({ p1: 0, p2: 0 });
    const { state: next } = reduce(state, { type: 'skip-to-final' });
    expect(next).toEqual(state);
  });

  it('is a no-op after the game has already ended', () => {
    const state: EngineState = {
      ...createInitialState(PACK, ['p1', 'p2'], 'judge'),
      phase: 'game-end',
    };
    const { state: next } = reduce(state, { type: 'skip-to-final' });
    expect(next).toEqual(state);
  });
});

describe('cancel-question', () => {
  it('closes the open question with no score change and keeps the same picker, like a timeout', () => {
    const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const opened = selectFirst(initial).state;
    const { state: next, effects } = reduce(opened, {
      type: 'cancel-question',
      requesterId: 'judge',
    });
    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.scores).toEqual(initial.scores);
    expect(next.turnCounterId).toBe(initial.turnCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });

  it('also cancels mid-buzz or mid-judging, not only while merely open', () => {
    const state = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const { state: next } = reduce(state, {
      type: 'cancel-question',
      requesterId: 'judge',
    });
    expect(next.phase).toBe('reveal');
    expect(next.scores.p1).toBe(0);
  });

  it('is a no-op when there is no open question (e.g. still selecting)', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const { state: next, effects } = reduce(state, {
      type: 'cancel-question',
      requesterId: 'judge',
    });
    expect(next).toBe(state);
    expect(effects).toEqual([]);
  });

  it('ignores the request from anyone other than the host', () => {
    const opened = selectFirst(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    ).state;
    const { state: next } = reduce(opened, {
      type: 'cancel-question',
      requesterId: 'p1',
    });
    expect(next.phase).toBe('question-open');
  });
});

describe('a full two-question game, played end to end', () => {
  it('produces the expected final scores and reaches game-end', () => {
    const twoQuestionPack = makePack({
      rounds: [
        {
          themes: [
            {
              name: 'Тема A',
              questions: [
                {
                  id: 'a1',
                  price: 100,
                  text: 'A1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
        {
          themes: [
            {
              name: 'Тема B',
              questions: [
                {
                  id: 'b1',
                  price: 200,
                  text: 'B1?',
                  answer: 'x',
                  type: 'обычный',
                },
              ],
            },
          ],
        },
      ],
    });
    // Трое счётчиков + ведущий: только с ведущим "Незачёт" переоткрывает
    // вопрос для перехвата (design.md, «СУДЕЙСТВО») — без него, как в
    // отдельном тесте открытого режима выше, вопрос закрылся бы сразу.
    let state = createInitialState(
      twoQuestionPack,
      ['p1', 'p2', 'p3'],
      'judge',
    );
    const firstPicker = state.turnCounterId;

    // Раунд 1: p1 берёт вопрос верно, ведущий решает сразу.
    state = reduce(state, {
      type: 'select-question',
      counterId: firstPicker,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'buzz', counterId: 'p1' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p1' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'judge',
      correct: true,
    }).state;
    expect(state.scores).toEqual({ p1: 100, p2: 0, p3: 0 });
    expect(state.phase).toBe('reveal');
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    expect(state.phase).toBe('round-end');
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    expect(state.phase).toBe('selecting');
    expect(state.roundIndex).toBe(1);
    // Правильно ответивший выбирает следующим.
    expect(state.turnCounterId).toBe('p1');

    // Раунд 2: p2 берёт вопрос неверно, затем p1 берёт перехватом верно.
    state = reduce(state, {
      type: 'select-question',
      counterId: 'p1',
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'buzz', counterId: 'p2' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p2' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    }).state;
    expect(state.scores).toEqual({ p1: 100, p2: -200, p3: 0 });
    expect(state.phase).toBe('question-open');

    state = reduce(state, { type: 'buzz', counterId: 'p1' }).state;
    state = reduce(state, { type: 'said-answer', counterId: 'p1' }).state;
    state = reduce(state, {
      type: 'vote',
      counterId: 'judge',
      correct: true,
    }).state;
    expect(state.scores).toEqual({ p1: 300, p2: -200, p3: 0 });

    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    expect(state.phase).toBe('game-end');
  });
});

describe('final round transition', () => {
  it('starts final-elim after the last round when a final pack and a host exist', () => {
    let state = createInitialState(FINAL_PACK, ['p1', 'p2'], 'judge');
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('final-elim');
    expect(next.finalRemainingThemeIndices).toEqual([0, 1, 2]);
    expect(['p1', 'p2']).toContain(next.finalElimCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });

  it('goes straight to game-end after the last round when the pack has no final block', () => {
    let state = createInitialState(PACK, ['p1', 'p2'], 'judge');
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
  });

  it('goes straight to game-end after the last round when there is no host (two counters)', () => {
    let state = createInitialState(FINAL_PACK, ['p1', 'p2']); // hostId по умолчанию null
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    // hostId === null: голосует единственный не отвечавший, разрешается
    // немедленно тем же путём, что уже покрыт в 'vote' — здесь важен только
    // конечный переход после последнего раунда, поэтому идём по тайм-ауту.
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'round-end' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'b1',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'vote' }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'reveal',
    });

    expect(next.phase).toBe('game-end');
  });
});

describe('eliminate-final-theme', () => {
  it('removes the theme and advances the turn to the next counter by ascending score', () => {
    const state = finalElimState({ p1: 100, p2: 0, p3: 50 });
    expect(state.finalElimCounterId).toBe('p2');
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p2',
      themeIndex: 0,
    });
    expect(next.phase).toBe('final-elim');
    expect(next.finalRemainingThemeIndices).toEqual([1, 2]);
    expect(next.finalElimCounterId).toBe('p3');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });

  it('moves to final-wager once a single theme remains', () => {
    const state = {
      ...finalElimState({ p1: 0, p2: 100 }),
      finalRemainingThemeIndices: [1, 2],
    };
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 1,
    });
    expect(next.phase).toBe('final-wager');
    expect(next.finalRemainingThemeIndices).toEqual([2]);
    expect(next.finalThemeIndex).toBe(2);
    expect(next.finalElimCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
    ]);
  });

  it('is a no-op from someone other than finalElimCounterId', () => {
    const state = finalElimState({ p1: 100, p2: 0 });
    const { state: next, effects } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 0,
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op for an already-eliminated theme', () => {
    const state = {
      ...finalElimState({ p1: 0, p2: 100 }),
      finalRemainingThemeIndices: [1, 2],
    };
    const { state: next } = reduce(state, {
      type: 'eliminate-final-theme',
      counterId: 'p1',
      themeIndex: 0,
    });
    expect(next).toEqual(state);
  });
});

describe('timer-expired: final-elim', () => {
  it('eliminates a random remaining theme and keeps going', () => {
    const state = finalElimState({ p1: 0, p2: 100 });
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-elim',
    });
    expect(next.finalRemainingThemeIndices).toHaveLength(2);
    expect(next.finalElimCounterId).toBe('p2');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ]);
  });
});

function finalWagerState(scores: Record<string, number>): EngineState {
  return {
    ...finalElimState(scores),
    phase: 'final-wager',
    finalRemainingThemeIndices: [1],
    finalThemeIndex: 1,
    finalElimCounterId: null,
  };
}

describe('submit-wager', () => {
  it('clamps the amount to [0, score]', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 9999,
    });
    expect(next.finalWagers.p1).toBe(300);
  });

  it('clamps a negative amount up to zero', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: -50,
    });
    expect(next.finalWagers.p1).toBe(0);
  });

  it('clamps the maximum to zero when the score is negative', () => {
    const state = finalWagerState({ p1: -100, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    });
    expect(next.finalWagers.p1).toBe(0);
  });

  it('moves to final-answer once every counter has wagered', () => {
    let state = finalWagerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    }).state;
    expect(state.phase).toBe('final-wager');
    const { state: next, effects } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p2',
      amount: 100,
    });
    expect(next.phase).toBe('final-answer');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ]);
  });

  it('is a no-op outside final-wager', () => {
    const state = finalElimState({ p1: 0, p2: 100 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 10,
    });
    expect(next).toEqual(state);
  });

  // M1 (финальное ревью 2026-08-05): движок «не доверяет клиентскому числу»
  // — но Math.min(max, Math.max(0, NaN)) === NaN, так что не-конечное число
  // раньше проходило клэмп невредимым и оседало в scores. Не достижимо через
  // собственный UI проекта (protocol.ts гарантирует typeof === 'number' на
  // границе), но engine.ts не должен полагаться на это — это его собственный
  // заявленный контракт.
  it('treats a non-finite amount (NaN) as 0 instead of letting it through the clamp', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: NaN,
    });
    expect(next.finalWagers.p1).toBe(0);
  });

  it('treats a non-finite amount (Infinity) as 0 instead of letting it through the clamp', () => {
    const state = finalWagerState({ p1: 300, p2: 0 });
    const { state: next } = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: Infinity,
    });
    expect(next.finalWagers.p1).toBe(0);
  });
});

describe('timer-expired: final-wager', () => {
  it('defaults missing wagers to 0 and moves to final-answer', () => {
    let state = finalWagerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-wager',
      counterId: 'p1',
      amount: 50,
    }).state;
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-wager',
    });
    expect(next.phase).toBe('final-answer');
    expect(next.finalWagers).toEqual({ p1: 50, p2: 0 });
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ]);
  });
});

function finalAnswerState(scores: Record<string, number>): EngineState {
  return {
    ...finalWagerState(scores),
    phase: 'final-answer',
    finalWagers: Object.fromEntries(Object.keys(scores).map((id) => [id, 0])),
  };
}

describe('submit-final-answer', () => {
  it('moves to final-judging once every counter has answered', () => {
    let state = finalAnswerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p1',
      text: 'ответ p1',
    }).state;
    expect(state.phase).toBe('final-answer');
    const { state: next, effects } = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p2',
      text: 'ответ p2',
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalAnswers).toEqual({ p1: 'ответ p1', p2: 'ответ p2' });
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'final-judging',
        ms: FINAL_JUDGING_TIMER_MS,
      },
    ]);
  });
});

describe('timer-expired: final-answer', () => {
  it('defaults missing answers to an empty string and moves to final-judging', () => {
    let state = finalAnswerState({ p1: 100, p2: 200 });
    state = reduce(state, {
      type: 'submit-final-answer',
      counterId: 'p1',
      text: 'ответ p1',
    }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-answer',
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalAnswers).toEqual({ p1: 'ответ p1', p2: '' });
  });
});

function finalJudgingState(
  scores: Record<string, number>,
  wagers: Record<string, number>,
): EngineState {
  return {
    ...finalAnswerState(scores),
    phase: 'final-judging',
    finalWagers: wagers,
    finalAnswers: Object.fromEntries(
      Object.keys(scores).map((id) => [id, 'x']),
    ),
  };
}

describe('final-vote', () => {
  it('is a no-op from someone other than the host', () => {
    const state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 50 });
    const { state: next } = reduce(state, {
      type: 'final-vote',
      requesterId: 'p1',
      counterId: 'p2',
      correct: true,
    });
    expect(next).toEqual(state);
  });

  it('does not resolve on a partial set of verdicts', () => {
    const state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 50 });
    const { state: next, effects } = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    });
    expect(next.phase).toBe('final-judging');
    expect(next.finalVerdicts).toEqual({ p1: true });
    expect(effects).toEqual([]);
  });

  it('applies scores by wager and moves to final-reveal once every counter is judged', () => {
    let state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 80 });
    state = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    }).state;
    const { state: next, effects } = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p2',
      correct: false,
    });
    expect(next.phase).toBe('final-reveal');
    expect(next.scores).toEqual({ p1: 150, p2: 120 });
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'final-reveal',
        ms: FINAL_REVEAL_TIMER_MS,
      },
    ]);
  });
});

describe('timer-expired: final-judging', () => {
  it('defaults missing verdicts to false, applies scores, and moves to final-reveal', () => {
    let state = finalJudgingState({ p1: 100, p2: 200 }, { p1: 50, p2: 80 });
    state = reduce(state, {
      type: 'final-vote',
      requesterId: 'judge',
      counterId: 'p1',
      correct: true,
    }).state;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-judging',
    });
    expect(next.phase).toBe('final-reveal');
    // p1 отмечен верно вручную (+50 -> 150); p2 не отмечен -> незачёт по
    // умолчанию (-80 -> 120).
    expect(next.scores).toEqual({ p1: 150, p2: 120 });
  });
});

describe('timer-expired: final-reveal', () => {
  it('moves to game-end', () => {
    const state: EngineState = {
      ...finalJudgingState({ p1: 150, p2: 120 }, { p1: 50, p2: 80 }),
      phase: 'final-reveal',
    };
    const { state: next, effects } = reduce(state, {
      type: 'timer-expired',
      timer: 'final-reveal',
    });
    expect(next.phase).toBe('game-end');
    expect(effects).toEqual([]);
  });
});

describe('select-question — вопрос-«кот»', () => {
  it('opens into cat-handoff instead of question-open, and starts the cat-handoff timer', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const { state: next, effects } = selectCat(state);
    expect(next.phase).toBe('cat-handoff');
    expect(next.currentQuestion).toEqual({ themeIndex: 0, questionId: 'a1' });
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'cat-handoff', ms: CAT_HANDOFF_TIMER_MS },
    ]);
  });

  it('leaves catRecipientCounterId null until a recipient is assigned', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const { state: next } = selectCat(state);
    expect(next.catRecipientCounterId).toBeNull();
  });
});

describe('assign-cat', () => {
  it('assigns the recipient, opens the question, and starts the question timer', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const recipientId = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    });
    expect(next.phase).toBe('question-open');
    expect(next.catRecipientCounterId).toBe(recipientId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('is a no-op outside cat-handoff', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const { state: next, effects } = reduce(state, {
      type: 'assign-cat',
      counterId: state.turnCounterId,
      recipientCounterId: state.turnCounterId === 'p1' ? 'p2' : 'p1',
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op from someone other than the giver', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const otherId = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next } = reduce(handoff, {
      type: 'assign-cat',
      counterId: otherId,
      recipientCounterId: handoff.turnCounterId,
    });
    expect(next).toEqual(handoff);
  });

  it('is a no-op when the giver tries to keep it for themselves', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const { state: next } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: handoff.turnCounterId,
    });
    expect(next).toEqual(handoff);
  });

  it('is a no-op for an unknown recipient counter id', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const { state: next } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: 'ghost',
    });
    expect(next).toEqual(handoff);
  });
});

describe('buzz — вопрос-«кот»', () => {
  function assignedState(): EngineState {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const recipientId = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    return reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    }).state;
  }

  it('only the recipient can buzz', () => {
    const opened = assignedState();
    const giverId = opened.catRecipientCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(opened, {
      type: 'buzz',
      counterId: giverId,
    });
    expect(next).toEqual(opened);
    expect(effects).toEqual([]);
  });

  it('the recipient can buzz normally', () => {
    const opened = assignedState();
    const { state: next } = reduce(opened, {
      type: 'buzz',
      counterId: opened.catRecipientCounterId!,
    });
    expect(next.phase).toBe('buzzed');
    expect(next.buzzedCounterId).toBe(opened.catRecipientCounterId);
  });
});

describe('timer-expired: cat-handoff', () => {
  it('assigns a random recipient other than the giver when the timer fires unassigned', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const { state: next, effects } = reduce(handoff, {
      type: 'timer-expired',
      timer: 'cat-handoff',
    });
    expect(next.phase).toBe('question-open');
    expect(next.catRecipientCounterId).not.toBe(handoff.turnCounterId);
    expect(['p1', 'p2']).toContain(next.catRecipientCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });
});

describe('resolveVote — вопрос-«кот»', () => {
  function catJudging(
    hostId: string | null,
    counterIds: string[],
  ): EngineState {
    const state = createInitialState(CAT_PACK, counterIds, hostId);
    const handoff = selectCat(state).state;
    const recipientId = counterIds.find((id) => id !== handoff.turnCounterId)!;
    const opened = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    }).state;
    const buzzed = reduce(opened, {
      type: 'buzz',
      counterId: recipientId,
    }).state;
    return reduce(buzzed, {
      type: 'said-answer',
      counterId: recipientId,
    }).state;
  }

  it('closes immediately on an incorrect vote even with a host — no reopen, unlike a normal question', () => {
    const judging = catJudging('judge', ['p1', 'p2']);
    const recipientId = judging.buzzedCounterId!;
    const scoreBefore = judging.scores[recipientId];
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });
    expect(next.phase).toBe('reveal');
    expect(next.scores[recipientId]).toBe(scoreBefore - 100);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });

  it('passes the turn to the recipient on a correct answer', () => {
    const judging = catJudging('judge', ['p1', 'p2']);
    const recipientId = judging.buzzedCounterId!;
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: true,
    });
    expect(next.turnCounterId).toBe(recipientId);
  });

  it('leaves the turn with the giver on an incorrect answer', () => {
    const judging = catJudging('judge', ['p1', 'p2']);
    const giverId = judging.turnCounterId;
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });
    expect(next.turnCounterId).toBe(giverId);
  });

  it('resets catRecipientCounterId to null after the question resolves', () => {
    const judging = catJudging('judge', ['p1', 'p2']);
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });
    expect(next.catRecipientCounterId).toBeNull();
  });
});

describe('cancel-question — во время cat-handoff', () => {
  it('lets the host cancel a cat question before it is even handed off', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2'], 'judge');
    const handoff = selectCat(state).state;
    const { state: next } = reduce(handoff, {
      type: 'cancel-question',
      requesterId: 'judge',
    });
    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toContain('a1');
  });
});

describe('select-question — некому отдать кота (только у Комнаты есть онлайн-статус)', () => {
  it('does not itself reject a lone counter — Room is responsible for that check (see room.test.ts)', () => {
    // handleSelectQuestion не знает об онлайн-статусе (design.md, инвариант
    // 1) — оно принимает выбор кота и с одним-единственным счётчиком в игре.
    // «Некому отдать» проверяет Room ДО вызова reduce() (см. Task 2).
    const state = createInitialState(CAT_PACK, ['p1']);
    const { state: next } = selectCat(state);
    expect(next.phase).toBe('cat-handoff');
  });
});
