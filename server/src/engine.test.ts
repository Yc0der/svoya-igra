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
  AUCTION_BID_TIMER_MS,
  MEDIA_TIMER_MS,
  TEXT_REVEAL_FALLBACK_MS,
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

const AUCTION_PACK = makePack({
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
              type: 'аукцион',
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

function selectAuction(state: EngineState) {
  const opened = reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
  if (opened.state.phase !== 'question-reveal') return opened;
  return reduce(opened.state, { type: 'timer-expired', timer: 'text-reveal' });
}

function selectCat(state: EngineState) {
  const opened = reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
  if (opened.state.phase !== 'question-reveal') return opened;
  return reduce(opened.state, { type: 'timer-expired', timer: 'text-reveal' });
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
  const opened = reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
  if (opened.state.phase !== 'question-reveal') return opened;
  return reduce(opened.state, { type: 'timer-expired', timer: 'text-reveal' });
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
  it("opens the question into question-reveal when it is the picker's turn", () => {
    const state = createInitialState(PACK, ['p1', 'p2']);
    // Прямой reduce(), не selectFirst() — сам хелпер (Step 5) намеренно
    // всегда доводит вопрос без video до question-open, чтобы остальным
    // тестам не пришлось знать о показе; проверить сам факт остановки в
    // question-reveal можно только в обход хелпера.
    const { state: next, effects } = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    });
    expect(next.phase).toBe('question-reveal');
    expect(next.currentQuestion).toEqual({ themeIndex: 0, questionId: 'a1' });
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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

  it('closes the question when the requester is the admin panel (requesterId: null)', () => {
    const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const opened = selectFirst(initial).state;
    const { state: next } = reduce(opened, {
      type: 'cancel-question',
      requesterId: null,
    });
    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(next.scores).toEqual(initial.scores);
  });

  // Ровно тот случай, ради которого правило и менялось: играли вдвоём,
  // ведущего никто не назначал, и пропустить вопрос было нечем.
  it('works from the admin panel even with no host assigned', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const opened = selectFirst(initial).state;
    expect(opened.hostId).toBeNull();
    const { state: next } = reduce(opened, {
      type: 'cancel-question',
      requesterId: null,
    });
    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
  });

  it('is still a no-op for a player who is not the host', () => {
    const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const opened = selectFirst(initial).state;
    const { state: next } = reduce(opened, {
      type: 'cancel-question',
      requesterId: 'p1',
    });
    expect(next).toEqual(opened);
  });

  it('is a no-op from the admin panel when there is no open question', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const { state: next, effects } = reduce(state, {
      type: 'cancel-question',
      requesterId: null,
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  // revealQuestion держит currentQuestion заполненным все 4 секунды фазы
  // reveal (обнуляется только при переходе в selecting), так что охрана
  // "!state.currentQuestion" её не ловит — вторая отмена того же вопроса
  // задваивала бы его в answeredQuestionIds и стирала бы уже поставленные
  // оценки.
  it('is a no-op in the reveal phase so a second cancel cannot double-record the answered question', () => {
    const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const opened = selectFirst(initial).state;
    const revealed = reduce(opened, {
      type: 'cancel-question',
      requesterId: 'judge',
    }).state;
    expect(revealed.phase).toBe('reveal');
    const { state: next, effects } = reduce(revealed, {
      type: 'cancel-question',
      requesterId: 'judge',
    });
    expect(next).toBe(revealed);
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(effects).toEqual([]);
  });

  it('is a no-op in the reveal phase from the admin panel too', () => {
    const initial = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const opened = selectFirst(initial).state;
    const revealed = reduce(opened, {
      type: 'cancel-question',
      requesterId: null,
    }).state;
    expect(revealed.phase).toBe('reveal');
    const { state: next, effects } = reduce(revealed, {
      type: 'cancel-question',
      requesterId: null,
    });
    expect(next).toBe(revealed);
    expect(next.answeredQuestionIds).toEqual(['a1']);
    expect(effects).toEqual([]);
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
    state = reduce(state, { type: 'timer-expired', timer: 'reveal' }).state;
    state = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a2',
    }).state;
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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
    state = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
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

  it('leaves exclusiveAnswererCounterId null until a recipient is assigned', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const { state: next } = selectCat(state);
    expect(next.exclusiveAnswererCounterId).toBeNull();
  });
});

describe('assign-cat', () => {
  it('assigns the recipient and opens the question into question-reveal', () => {
    const state = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(state).state;
    const recipientId = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    });
    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(recipientId);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
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
    const revealing = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    }).state;
    return reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
  }

  it('only the recipient can buzz', () => {
    const opened = assignedState();
    const giverId = opened.exclusiveAnswererCounterId === 'p1' ? 'p2' : 'p1';
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
      counterId: opened.exclusiveAnswererCounterId!,
    });
    expect(next.phase).toBe('buzzed');
    expect(next.buzzedCounterId).toBe(opened.exclusiveAnswererCounterId);
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
    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).not.toBe(handoff.turnCounterId);
    expect(['p1', 'p2']).toContain(next.exclusiveAnswererCounterId);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
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
    const revealing = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipientId,
    }).state;
    const opened = reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
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

  it('resets exclusiveAnswererCounterId to null after the question resolves', () => {
    const judging = catJudging('judge', ['p1', 'p2']);
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });
    expect(next.exclusiveAnswererCounterId).toBeNull();
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

describe('cancel-question — во время auction-bidding', () => {
  it('lets the host cancel an auction question mid-bidding, closing it like a timeout and resetting every auction field', () => {
    const initial = createInitialState(
      AUCTION_PACK,
      ['p1', 'p2', 'p3'],
      'judge',
    );
    const funded = { ...initial, scores: { p1: 1000, p2: 1000, p3: 1000 } };
    let state = selectAuction(funded).state;
    const picker = state.turnCounterId;
    state = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: 150,
    }).state;

    const { state: next } = reduce(state, {
      type: 'cancel-question',
      requesterId: 'judge',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toContain('a1');
    expect(next.turnCounterId).toBe(picker);
    expect(next.auctionOrder).toBeNull();
    expect(next.auctionTurnCounterId).toBeNull();
    expect(next.auctionPassedCounterIds).toEqual([]);
    expect(next.auctionHighestBid).toBe(0);
    expect(next.auctionHighestBidderCounterId).toBeNull();
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

describe('select-question — вопрос-аукцион', () => {
  it('opens into auction-bidding, builds auctionOrder starting from the picker, and starts the auction-bid timer', () => {
    const state = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const { state: next, effects } = selectAuction(state);
    expect(next.phase).toBe('auction-bidding');
    expect(next.auctionOrder).toHaveLength(3);
    expect(next.auctionOrder![0]).toBe(state.turnCounterId);
    expect(new Set(next.auctionOrder)).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(next.auctionTurnCounterId).toBe(state.turnCounterId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'auction-bid', ms: AUCTION_BID_TIMER_MS },
    ]);
  });

  it('includes the picker in auctionOrder, unlike the cat mechanic', () => {
    const state = createInitialState(AUCTION_PACK, ['p1', 'p2']);
    const { state: next } = selectAuction(state);
    expect(next.auctionOrder).toContain(state.turnCounterId);
  });
});

describe('place-bid', () => {
  function biddingState(): EngineState {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const funded = { ...initial, scores: { p1: 1000, p2: 1000, p3: 1000 } };
    return selectAuction(funded).state;
  }

  it('is a no-op outside auction-bidding', () => {
    const state = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const { state: next, effects } = reduce(state, {
      type: 'place-bid',
      counterId: state.turnCounterId,
      amount: 100,
    });
    expect(next).toEqual(state);
    expect(effects).toEqual([]);
  });

  it('is a no-op from someone other than the current bidder', () => {
    const state = biddingState();
    const otherId = state.auctionOrder!.find(
      (id) => id !== state.auctionTurnCounterId,
    )!;
    const { state: next } = reduce(state, {
      type: 'place-bid',
      counterId: otherId,
      amount: 100,
    });
    expect(next).toEqual(state);
  });

  it('is a no-op for a first bid below the pack price', () => {
    const state = biddingState();
    const { state: next } = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: 99,
    });
    expect(next).toEqual(state);
  });

  it('is a no-op for a bid not exceeding the current highest', () => {
    const state = biddingState();
    const afterFirst = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: 150,
    }).state;
    const { state: next } = reduce(afterFirst, {
      type: 'place-bid',
      counterId: afterFirst.auctionTurnCounterId!,
      amount: 150,
    });
    expect(next).toEqual(afterFirst);
  });

  it('is a no-op for a bid above the bidder’s own score', () => {
    const state = biddingState();
    const { state: next } = reduce(state, {
      type: 'place-bid',
      // 1001 — строго выше и своего счёта (1000), и цены пакета (100),
      // так что «дневной дубль» (первая ставка до цены пакета) этот случай
      // не покрывает, и отказ остаётся настоящим отказом по потолку.
      counterId: state.auctionTurnCounterId!,
      amount: state.scores[state.auctionTurnCounterId!] + 1,
    });
    expect(next).toEqual(state);
  });

  // «Дневной дубль» (design.md, «Правило», дополнено на финальном ревью
  // 2026-08-14): первую ставку можно сделать по цене пакета даже без этих
  // очков на счету — иначе аукцион в начале раунда, пока у всех 0,
  // неиграбелен.
  it('lets a broke bidder open the auction at exactly the pack price, even above their own score', () => {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const state = selectAuction(initial).state;
    const bidderId = state.auctionTurnCounterId!;
    expect(state.scores[bidderId]).toBe(0);
    const { state: next } = reduce(state, {
      type: 'place-bid',
      counterId: bidderId,
      amount: 100,
    });
    expect(next.auctionHighestBid).toBe(100);
    expect(next.auctionHighestBidderCounterId).toBe(bidderId);
  });

  it('still caps that first-bid exception at the pack price — a broke bidder cannot go above it', () => {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const state = selectAuction(initial).state;
    const { state: next } = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: 101,
    });
    expect(next).toEqual(state);
  });

  it('is a no-op for a fractional bid — prices and scores are integers everywhere else', () => {
    const state = biddingState();
    const { state: next } = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: 100.5,
    });
    expect(next).toEqual(state);
  });

  it('is a no-op for NaN or Infinity', () => {
    const state = biddingState();
    const nanResult = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: NaN,
    });
    expect(nanResult.state).toEqual(state);
    const infResult = reduce(state, {
      type: 'place-bid',
      counterId: state.auctionTurnCounterId!,
      amount: Infinity,
    });
    expect(infResult.state).toEqual(state);
  });

  it('accepts a valid bid, records it, and advances the turn to the next bidder', () => {
    const state = biddingState();
    const bidderId = state.auctionTurnCounterId!;
    const { state: next, effects } = reduce(state, {
      type: 'place-bid',
      counterId: bidderId,
      amount: 150,
    });
    expect(next.auctionHighestBid).toBe(150);
    expect(next.auctionHighestBidderCounterId).toBe(bidderId);
    expect(next.phase).toBe('auction-bidding');
    expect(next.auctionTurnCounterId).not.toBe(bidderId);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'auction-bid', ms: AUCTION_BID_TIMER_MS },
    ]);
  });
});

describe('pass-bid', () => {
  function biddingState(): EngineState {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const funded = { ...initial, scores: { p1: 1000, p2: 1000, p3: 1000 } };
    return selectAuction(funded).state;
  }

  it('is a no-op outside auction-bidding', () => {
    const state = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']);
    const { state: next } = reduce(state, {
      type: 'pass-bid',
      counterId: state.turnCounterId,
    });
    expect(next).toEqual(state);
  });

  it('is a no-op from someone other than the current bidder', () => {
    const state = biddingState();
    const otherId = state.auctionOrder!.find(
      (id) => id !== state.auctionTurnCounterId,
    )!;
    const { state: next } = reduce(state, {
      type: 'pass-bid',
      counterId: otherId,
    });
    expect(next).toEqual(state);
  });

  it('is permanent — a passed bidder cannot bid or pass again even while bidding continues', () => {
    let state = biddingState();
    const firstBidder = state.auctionTurnCounterId!;
    state = reduce(state, { type: 'pass-bid', counterId: firstBidder }).state;
    expect(state.auctionPassedCounterIds).toContain(firstBidder);
    const { state: next } = reduce(state, {
      type: 'pass-bid',
      counterId: firstBidder,
    });
    expect(next).toEqual(state);
  });

  it('does not end the auction when one bidder remains but nobody has bid yet — gives them their own turn', () => {
    let state = biddingState();
    const order = state.auctionOrder!;
    state = reduce(state, { type: 'pass-bid', counterId: order[0] }).state;
    state = reduce(state, { type: 'pass-bid', counterId: order[1] }).state;
    expect(state.phase).toBe('auction-bidding');
    expect(state.auctionTurnCounterId).toBe(order[2]);
    expect(state.auctionHighestBidderCounterId).toBeNull();
  });

  it('closes the question unanswered when everyone passes without ever bidding', () => {
    let state = biddingState();
    const order = state.auctionOrder!;
    state = reduce(state, { type: 'pass-bid', counterId: order[0] }).state;
    state = reduce(state, { type: 'pass-bid', counterId: order[1] }).state;
    const { state: next } = reduce(state, {
      type: 'pass-bid',
      counterId: order[2],
    });
    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toContain('a1');
    expect(next.turnCounterId).toBe(state.turnCounterId);
    expect(next.auctionOrder).toBeNull();
    expect(next.auctionTurnCounterId).toBeNull();
    expect(next.auctionPassedCounterIds).toEqual([]);
    expect(next.auctionHighestBid).toBe(0);
    expect(next.auctionHighestBidderCounterId).toBeNull();
  });

  it('lets the last remaining bidder win after everyone else passes following a bid', () => {
    let state = biddingState();
    const order = state.auctionOrder!;
    state = reduce(state, {
      type: 'place-bid',
      counterId: order[0],
      amount: 150,
    }).state;
    state = reduce(state, { type: 'pass-bid', counterId: order[1] }).state;
    const { state: next, effects } = reduce(state, {
      type: 'pass-bid',
      counterId: order[2],
    });
    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(order[0]);
    expect(next.auctionOrder).toBeNull();
    expect(next.auctionHighestBid).toBe(150);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  // Регрессия (финальное ревью, 2026-08-14): цикл перехода хода в
  // afterBidOrPass (модуло + пропуск спасовавших) ни один прежний тест не
  // прогонял ни через край массива, ни через уже спасовавшего — все они
  // шли строго по порядку и заканчивались раньше. Здесь четверо: сначала
  // ход обязан завернуться с последнего на первого, потом — перескочить
  // через спасовавшего order[1].
  it('wraps the bidding turn around the end of the order and skips whoever already passed', () => {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3', 'p4']);
    const funded = {
      ...initial,
      scores: { p1: 1000, p2: 1000, p3: 1000, p4: 1000 },
    };
    let state = selectAuction(funded).state;
    const order = state.auctionOrder!;
    expect(order).toHaveLength(4);

    state = reduce(state, {
      type: 'place-bid',
      counterId: order[0],
      amount: 150,
    }).state;
    expect(state.auctionTurnCounterId).toBe(order[1]);
    state = reduce(state, { type: 'pass-bid', counterId: order[1] }).state;
    expect(state.auctionTurnCounterId).toBe(order[2]);
    state = reduce(state, {
      type: 'place-bid',
      counterId: order[2],
      amount: 200,
    }).state;
    expect(state.auctionTurnCounterId).toBe(order[3]);

    // Заворот через конец массива обратно на order[0].
    state = reduce(state, { type: 'pass-bid', counterId: order[3] }).state;
    expect(state.phase).toBe('auction-bidding');
    expect(state.auctionTurnCounterId).toBe(order[0]);

    // Пропуск уже спасовавшего order[1] — ход уходит сразу к order[2].
    state = reduce(state, {
      type: 'place-bid',
      counterId: order[0],
      amount: 250,
    }).state;
    expect(state.auctionTurnCounterId).toBe(order[2]);
  });

  it('lets the picker win their own auction', () => {
    let state = biddingState();
    const picker = state.turnCounterId;
    const order = state.auctionOrder!;
    expect(order[0]).toBe(picker);
    state = reduce(state, {
      type: 'place-bid',
      counterId: picker,
      amount: 150,
    }).state;
    state = reduce(state, { type: 'pass-bid', counterId: order[1] }).state;
    const { state: next } = reduce(state, {
      type: 'pass-bid',
      counterId: order[2],
    });
    expect(next.exclusiveAnswererCounterId).toBe(picker);
  });
});

describe('timer-expired: auction-bid', () => {
  it('auto-passes for whoever’s turn it is', () => {
    const state = selectAuction(
      createInitialState(AUCTION_PACK, ['p1', 'p2', 'p3']),
    ).state;
    const bidderId = state.auctionTurnCounterId!;
    const { state: next } = reduce(state, {
      type: 'timer-expired',
      timer: 'auction-bid',
    });
    expect(next.auctionPassedCounterIds).toContain(bidderId);
    expect(next.auctionTurnCounterId).not.toBe(bidderId);
  });
});

describe('resolveVote — вопрос-аукцион', () => {
  function auctionJudging(
    hostId: string | null,
    counterIds: string[],
    winningBid: number,
  ): EngineState {
    const initial = createInitialState(AUCTION_PACK, counterIds, hostId);
    const scores = Object.fromEntries(counterIds.map((id) => [id, 1000]));
    let state = selectAuction({ ...initial, scores }).state;
    const order = state.auctionOrder!;
    state = reduce(state, {
      type: 'place-bid',
      counterId: order[0],
      amount: winningBid,
    }).state;
    for (const id of order.slice(1)) {
      state = reduce(state, { type: 'pass-bid', counterId: id }).state;
    }
    const winnerId = state.exclusiveAnswererCounterId!;
    const opened = reduce(state, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    const buzzed = reduce(opened, { type: 'buzz', counterId: winnerId }).state;
    return reduce(buzzed, { type: 'said-answer', counterId: winnerId }).state;
  }

  it('credits the winner with their winning bid amount, not the pack price, on a correct answer', () => {
    const judging = auctionJudging('judge', ['p1', 'p2'], 350);
    const winnerId = judging.buzzedCounterId!;
    const before = judging.scores[winnerId];
    const { state: next } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: true,
    });
    expect(next.scores[winnerId]).toBe(before + 350);
  });

  it('deducts the winning bid amount, not the pack price, on an incorrect answer, and does not reopen', () => {
    const judging = auctionJudging('judge', ['p1', 'p2'], 350);
    const winnerId = judging.buzzedCounterId!;
    const before = judging.scores[winnerId];
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });
    expect(next.phase).toBe('reveal');
    expect(next.scores[winnerId]).toBe(before - 350);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS },
    ]);
  });
});

const VIDEO_PACK = makePack({
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
              video: { youtubeId: 'abc', startSeconds: 0, durationSeconds: 8 },
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

const VIDEO_CAT_PACK = makePack({
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
              video: { youtubeId: 'abc', startSeconds: 0, durationSeconds: 8 },
            },
          ],
        },
      ],
    },
  ],
});

const VIDEO_AUCTION_PACK = makePack({
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
              type: 'аукцион',
              video: { youtubeId: 'abc', startSeconds: 0, durationSeconds: 8 },
            },
          ],
        },
      ],
    },
  ],
});

// Видео-вопрос уже после того, как клип доиграл: дальше он ведёт себя как
// любой обычный открытый вопрос.
function videoQuestionOpen(state: EngineState) {
  const media = selectFirst(state).state;
  return reduce(media, { type: 'media-finished', questionId: 'a1' }).state;
}

describe('question-media phase', () => {
  it('sends a question with video into question-media and does not start the question timer yet', () => {
    const initial = createInitialState(VIDEO_PACK, ['p1', 'p2']);
    const { state: next, effects } = selectFirst(initial);

    expect(next.phase).toBe('question-media');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS },
    ]);
  });

  it('sends a question without video straight to question-open, exactly as before', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = selectFirst(initial);

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('starts the full question timer once the clip has finished', () => {
    const media = selectFirst(
      createInitialState(VIDEO_PACK, ['p1', 'p2']),
    ).state;
    const { state: next, effects } = reduce(media, {
      type: 'media-finished',
      questionId: 'a1',
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('ignores a media-finished signal naming a different question', () => {
    const media = selectFirst(
      createInitialState(VIDEO_PACK, ['p1', 'p2']),
    ).state;
    const { state: next, effects } = reduce(media, {
      type: 'media-finished',
      questionId: 'a2',
    });

    expect(next.phase).toBe('question-media');
    expect(effects).toEqual([]);
  });

  it('ignores a media-finished signal arriving outside question-media', () => {
    const open = videoQuestionOpen(
      createInitialState(VIDEO_PACK, ['p1', 'p2']),
    );
    const { state: next, effects } = reduce(open, {
      type: 'media-finished',
      questionId: 'a1',
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([]);
  });

  it('falls through to question-open when the safety timer expires instead', () => {
    const media = selectFirst(
      createInitialState(VIDEO_PACK, ['p1', 'p2']),
    ).state;
    const { state: next, effects } = reduce(media, {
      type: 'timer-expired',
      timer: 'media',
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('refuses a buzz while the clip is still playing', () => {
    const media = selectFirst(
      createInitialState(VIDEO_PACK, ['p1', 'p2']),
    ).state;
    const { state: next } = reduce(media, { type: 'buzz', counterId: 'p1' });

    expect(next.phase).toBe('question-media');
    expect(next.buzzedCounterId).toBeNull();
  });

  it('plays the clip after the cat has been handed off, not before', () => {
    const initial = createInitialState(VIDEO_CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(initial).state;
    const recipient = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipient,
    });

    expect(next.phase).toBe('question-media');
    expect(next.exclusiveAnswererCounterId).toBe(recipient);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS },
    ]);
  });

  it('plays the clip once the auction has a winner, not during bidding', () => {
    const initial = createInitialState(VIDEO_AUCTION_PACK, ['p1', 'p2']);
    const bidding = selectAuction(initial).state;
    const bidder = bidding.auctionTurnCounterId!;
    const afterBid = reduce(bidding, {
      type: 'place-bid',
      counterId: bidder,
      amount: 100,
    }).state;
    const other = bidder === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(afterBid, {
      type: 'pass-bid',
      counterId: other,
    });

    expect(next.phase).toBe('question-media');
    expect(next.exclusiveAnswererCounterId).toBe(bidder);
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS },
    ]);
  });

  it('does not replay the clip when a wrong answer reopens the question under a host', () => {
    const open = videoQuestionOpen(
      createInitialState(VIDEO_PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const judging = reduce(buzzP1(open), {
      type: 'said-answer',
      counterId: 'p1',
    }).state;
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('lets the host cancel the question while the clip is playing', () => {
    const media = selectFirst(
      createInitialState(VIDEO_PACK, ['p1', 'p2'], 'judge'),
    ).state;
    const { state: next } = reduce(media, {
      type: 'cancel-question',
      requesterId: 'judge',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
  });
});

describe('question-reveal phase', () => {
  it('sends a question without video into question-reveal, not straight to question-open', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    });

    expect(next.phase).toBe('question-reveal');
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('starts the full question timer once the reveal timer expires', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const revealing = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next, effects } = reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('refuses a buzz while the text is still being revealed', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const revealing = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next } = reduce(revealing, {
      type: 'buzz',
      counterId: 'p1',
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.buzzedCounterId).toBeNull();
  });

  it('reveals the cat question only after the cat has been handed off, not before', () => {
    const initial = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(initial).state;
    const recipient = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipient,
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(recipient);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('reveals the auction question only once the auction has a winner, not during bidding', () => {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2']);
    const bidding = selectAuction(initial).state;
    const bidder = bidding.auctionTurnCounterId!;
    const afterBid = reduce(bidding, {
      type: 'place-bid',
      counterId: bidder,
      amount: 100,
    }).state;
    const other = bidder === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(afterBid, {
      type: 'pass-bid',
      counterId: other,
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(bidder);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('does not replay the reveal when a wrong answer reopens the question under a host', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const revealing = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const open = reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    const judging = reduce(buzzP1(open), {
      type: 'said-answer',
      counterId: 'p1',
    }).state;
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('lets the host cancel the question while the text is still being revealed', () => {
    const state = createInitialState(PACK, ['p1', 'p2'], 'judge');
    const revealing = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next } = reduce(revealing, {
      type: 'cancel-question',
      requesterId: 'judge',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
  });

  it('still sends a video question into question-media, not question-reveal', () => {
    // Регрессия: область действия — только вопросы без video (design.md,
    // 2026-08-19-gradual-text-reveal-design.md, «Правило»).
    const initial = createInitialState(VIDEO_PACK, ['p1', 'p2']);
    const { state: next } = selectFirst(initial);

    // selectFirst для видео проходит только question-media: проверка
    // opened.state.phase !== 'question-reveal' (Step 5) для видео истинна,
    // поэтому selectFirst возвращает результат сразу после select-question и
    // вовсе не шлёт timer-expired/text-reveal в этой ветке — фаза остаётся
    // question-media. (Если бы timer-expired/text-reveal всё же пришёл на
    // question-media, handleTimerExpired обработал бы его тем же
    // непроверяющим фазу case'ом, что и case 'question'/case 'media' в этом
    // же switch, и перевёл бы состояние в question-open — этот case
    // намеренно не проверяет текущую фазу, см. handleTimerExpired.)
    expect(next.phase).toBe('question-media');
  });
});
