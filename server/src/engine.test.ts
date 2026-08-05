import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  reduce,
  QUESTION_TIMER_MS,
  SAID_ANSWER_TIMER_MS,
  VOTE_TIMER_MS,
  REVEAL_TIMER_MS,
  ROUND_END_TIMER_MS,
  REOPEN_GRACE_MS,
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

const PACK = makePack();

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
  it('penalizes the answerer and reopens the question immediately, starting a 10s grace timer', () => {
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
    expect(next.graceExcludedCounterId).toBe('p1');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'reopen-grace', ms: REOPEN_GRACE_MS },
    ]);
  });

  it('blocks a buzz from the just-excluded answerer during the grace period, but lets everyone else through', () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const { state: reopened } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });

    const { state: blocked, effects: blockedEffects } = reduce(reopened, {
      type: 'buzz',
      counterId: 'p1',
    });
    expect(blocked.phase).toBe('question-open');
    expect(blockedEffects).toEqual([]);

    const { state: admitted } = reduce(reopened, {
      type: 'buzz',
      counterId: 'p2',
    });
    expect(admitted.phase).toBe('buzzed');
    expect(admitted.buzzedCounterId).toBe('p2');
  });

  it('re-admits the excluded answerer once the grace period expires, with a fresh full question timer', () => {
    const judging = toJudging(
      createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge'),
    );
    const reopened = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    }).state;

    const { state: graceOver, effects } = reduce(reopened, {
      type: 'timer-expired',
      timer: 'reopen-grace',
    });
    expect(graceOver.phase).toBe('question-open');
    expect(graceOver.graceExcludedCounterId).toBeNull();
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);

    const { state: next } = reduce(graceOver, {
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
