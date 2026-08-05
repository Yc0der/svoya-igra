import type { Pack, Question } from './pack.js';

export type Phase =
  | 'selecting'
  | 'question-open'
  | 'buzzed'
  | 'judging'
  | 'reveal'
  | 'round-end'
  | 'game-end';

export type TimerName =
  'question' | 'said-answer' | 'vote' | 'reveal' | 'round-end';

export const QUESTION_TIMER_MS = 30_000;
export const SAID_ANSWER_TIMER_MS = 10_000;
export const VOTE_TIMER_MS = 10_000;
export const REVEAL_TIMER_MS = 4_000;
export const ROUND_END_TIMER_MS = 5_000;

// Плоские массивы/объекты, а не Set/Map — EngineState целиком проходит через
// JSON.stringify в снапшоте комнаты (Task 4), а Map/Set сериализуются в '{}'.
export interface EngineState {
  pack: Pack;
  roundIndex: number;
  answeredQuestionIds: string[];
  phase: Phase;
  turnCounterId: string;
  currentQuestion: { themeIndex: number; questionId: string } | null;
  buzzedCounterId: string | null;
  votes: Record<string, boolean>;
  scores: Record<string, number>;
  lastCorrectCounterId: string | null;
  // Не counterId — ведущий не в scores, не выбирает и не жмёт. null означает
  // двоих и открытое судейство голосованием; иначе — судит только этот
  // счётчик... то есть на самом деле не счётчик вовсе (design.md, «Ведущий»).
  hostId: string | null;
}

export type EngineEvent =
  | {
      type: 'select-question';
      counterId: string;
      themeIndex: number;
      questionId: string;
    }
  | { type: 'buzz'; counterId: string }
  | { type: 'said-answer'; counterId: string }
  | { type: 'vote'; counterId: string; correct: boolean }
  | { type: 'timer-expired'; timer: TimerName }
  // Панель ведущего (design.md, «Ведущий»): доступна только hostId, движок
  // сам это проверяет — requesterId, не counterId, ведущий не счётчик.
  | {
      type: 'adjust-score';
      requesterId: string;
      targetCounterId: string;
      delta: number;
    }
  | { type: 'cancel-question'; requesterId: string };

export type Effect =
  | { type: 'start-timer'; timer: TimerName; ms: number }
  | { type: 'cancel-timer'; timer: TimerName };

type Result = { state: EngineState; effects: Effect[] };

export function createInitialState(
  pack: Pack,
  counterIds: string[],
  hostId: string | null = null,
): EngineState {
  if (counterIds.length === 0) {
    throw new Error('Нужен хотя бы один счётчик, чтобы начать партию');
  }
  const scores: Record<string, number> = {};
  for (const id of counterIds) scores[id] = 0;
  return {
    pack,
    roundIndex: 0,
    answeredQuestionIds: [],
    phase: 'selecting',
    turnCounterId: counterIds[Math.floor(Math.random() * counterIds.length)],
    currentQuestion: null,
    buzzedCounterId: null,
    votes: {},
    scores,
    lastCorrectCounterId: null,
    hostId,
  };
}

function findQuestion(
  pack: Pack,
  roundIndex: number,
  themeIndex: number,
  questionId: string,
): Question | undefined {
  return pack.rounds[roundIndex]?.themes[themeIndex]?.questions.find(
    (q) => q.id === questionId,
  );
}

function isRoundComplete(
  pack: Pack,
  roundIndex: number,
  answeredQuestionIds: string[],
): boolean {
  const answered = new Set(answeredQuestionIds);
  return pack.rounds[roundIndex].themes.every((theme) =>
    theme.questions.every((q) => answered.has(q.id)),
  );
}

function unchanged(state: EngineState): Result {
  return { state, effects: [] };
}

export function reduce(state: EngineState, event: EngineEvent): Result {
  switch (event.type) {
    case 'select-question':
      return handleSelectQuestion(state, event);
    case 'buzz':
      return handleBuzz(state, event);
    case 'said-answer':
      return handleSaidAnswer(state, event);
    case 'vote':
      return handleVote(state, event);
    case 'timer-expired':
      return handleTimerExpired(state, event);
    case 'adjust-score':
      return handleAdjustScore(state, event);
    case 'cancel-question':
      return handleCancelQuestion(state, event);
  }
}

function handleSelectQuestion(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'select-question' }>,
): Result {
  if (state.phase !== 'selecting' || event.counterId !== state.turnCounterId) {
    return unchanged(state);
  }
  const question = findQuestion(
    state.pack,
    state.roundIndex,
    event.themeIndex,
    event.questionId,
  );
  if (!question || state.answeredQuestionIds.includes(question.id)) {
    return unchanged(state);
  }
  return {
    state: {
      ...state,
      phase: 'question-open',
      currentQuestion: {
        themeIndex: event.themeIndex,
        questionId: event.questionId,
      },
    },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}

function handleBuzz(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'buzz' }>,
): Result {
  if (state.phase !== 'question-open' || !(event.counterId in state.scores)) {
    return unchanged(state);
  }
  return {
    state: { ...state, phase: 'buzzed', buzzedCounterId: event.counterId },
    effects: [
      { type: 'cancel-timer', timer: 'question' },
      { type: 'start-timer', timer: 'said-answer', ms: SAID_ANSWER_TIMER_MS },
    ],
  };
}

function handleSaidAnswer(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'said-answer' }>,
): Result {
  if (state.phase !== 'buzzed' || event.counterId !== state.buzzedCounterId) {
    return unchanged(state);
  }
  return startJudging(state);
}

function startJudging(state: EngineState): Result {
  return {
    state: { ...state, phase: 'judging', votes: {} },
    effects: [
      { type: 'cancel-timer', timer: 'said-answer' },
      { type: 'start-timer', timer: 'vote', ms: VOTE_TIMER_MS },
    ],
  };
}

function handleVote(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'vote' }>,
): Result {
  if (state.phase !== 'judging' || event.counterId === state.buzzedCounterId) {
    return unchanged(state);
  }

  if (state.hostId !== null) {
    // Судейство с ведущим: решает один голос, и решает сразу — ждать
    // VOTE_TIMER_MS незачем, это не голосование. Таймер остаётся взведённым
    // как подстраховка на случай, если ведущий вообще не нажмёт (design.md,
    // «ни одно состояние не ждёт человека бесконечно»); resolveVote() ниже
    // сам вернёт новый start-timer (или ни одного, если партия кончилась),
    // и Room.applyEffects снимет прежний таймер 'vote' как побочный эффект
    // непустого списка эффектов — отдельный cancel-timer не нужен.
    if (event.counterId !== state.hostId) {
      return unchanged(state);
    }
    return resolveVote({
      ...state,
      votes: { [event.counterId]: event.correct },
    });
  }

  if (!(event.counterId in state.scores)) {
    return unchanged(state);
  }
  return unchanged({
    ...state,
    votes: { ...state.votes, [event.counterId]: event.correct },
  });
}

// Панель ведущего: доступна в любой фазе, не только во время судейства —
// ошибку в счёте естественно захотеть поправить в любой момент (design.md,
// «Ведущий»). Не через unchanged() формально — эффекты пустые, но состояние
// (scores) реально меняется; сам helper просто означает «без start/cancel
// timer», а не «без изменений вообще».
function handleAdjustScore(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'adjust-score' }>,
): Result {
  if (state.hostId === null || event.requesterId !== state.hostId) {
    return unchanged(state);
  }
  if (!(event.targetCounterId in state.scores)) {
    return unchanged(state);
  }
  return unchanged({
    ...state,
    scores: {
      ...state.scores,
      [event.targetCounterId]:
        state.scores[event.targetCounterId] + event.delta,
    },
  });
}

// Закрывает текущий вопрос без начисления очков — тем же путём, что и
// «никто не нажал за 25 секунд» (revealQuestion(state, null)): вопрос
// помечается отвеченным, ход остаётся у того же счётчика. Для кривого
// вопроса из пакета или зависшей по факту партии.
function handleCancelQuestion(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'cancel-question' }>,
): Result {
  if (state.hostId === null || event.requesterId !== state.hostId) {
    return unchanged(state);
  }
  if (!state.currentQuestion) {
    return unchanged(state);
  }
  return revealQuestion(state, null);
}

function handleTimerExpired(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'timer-expired' }>,
): Result {
  switch (event.timer) {
    case 'question':
      return revealQuestion(state, null);
    case 'said-answer':
      return startJudging(state);
    case 'vote':
      return resolveVote(state);
    case 'reveal':
      return afterReveal(state);
    case 'round-end':
      return startNextRound(state);
  }
}

function resolveVote(state: EngineState): Result {
  const buzzedCounterId = state.buzzedCounterId as string;
  const question = findQuestion(
    state.pack,
    state.roundIndex,
    state.currentQuestion!.themeIndex,
    state.currentQuestion!.questionId,
  )!;
  const yes = Object.values(state.votes).filter((v) => v).length;
  const no = Object.values(state.votes).filter((v) => !v).length;
  const correct = yes >= no;

  if (correct) {
    return revealQuestion(state, {
      counterId: buzzedCounterId,
      delta: question.price,
    });
  }

  const penalizedScores = {
    ...state.scores,
    [buzzedCounterId]: state.scores[buzzedCounterId] - question.price,
  };

  if (state.hostId === null) {
    // Открытое судейство (двое, без ведущего): переоткрыть кнопку нельзя —
    // ответ уже показан на табло единственному, кто голосовал, то есть тому
    // же человеку, кто мог бы жать повторно. Вопрос закрывается сразу, как
    // по тайм-ауту (design.md, «СУДЕЙСТВО», решение от 2026-08-05 после
    // первой живой проверки — до этого здесь было переоткрытие для любого
    // числа игроков).
    return revealQuestion({ ...state, scores: penalizedScores }, null);
  }

  // Судейство с ведущим: ответ никому, кроме ведущего, не показывался —
  // переоткрыть честно и сразу же, тем же 'question'-таймером, с которого
  // всё начиналось (Комната подставит в него не полные QUESTION_TIMER_MS, а
  // реально оставшееся время — см. Room.buzz()/applyEffects — движок этого
  // различия не видит и не должен). Никакой отдельной паузы движок здесь не
  // вводит: кто именно и на сколько временно не может жать повторно — не
  // игровое правило, а транспортное ограничение Комнаты, тем же паттерном,
  // что и фальстарт (design.md, «Комната»; «СУДЕЙСТВО», 2026-08-05).
  return {
    state: {
      ...state,
      phase: 'question-open',
      buzzedCounterId: null,
      votes: {},
      scores: penalizedScores,
    },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}

function revealQuestion(
  state: EngineState,
  correctResult: { counterId: string; delta: number } | null,
): Result {
  const questionId = state.currentQuestion!.questionId;
  return {
    state: {
      ...state,
      phase: 'reveal',
      answeredQuestionIds: [...state.answeredQuestionIds, questionId],
      scores: correctResult
        ? {
            ...state.scores,
            [correctResult.counterId]:
              state.scores[correctResult.counterId] + correctResult.delta,
          }
        : state.scores,
      turnCounterId: correctResult
        ? correctResult.counterId
        : state.turnCounterId,
      lastCorrectCounterId: correctResult
        ? correctResult.counterId
        : state.lastCorrectCounterId,
      buzzedCounterId: null,
      votes: {},
    },
    effects: [{ type: 'start-timer', timer: 'reveal', ms: REVEAL_TIMER_MS }],
  };
}

function afterReveal(state: EngineState): Result {
  const base = { ...state, currentQuestion: null };
  if (
    !isRoundComplete(state.pack, state.roundIndex, state.answeredQuestionIds)
  ) {
    return { state: { ...base, phase: 'selecting' }, effects: [] };
  }
  if (state.roundIndex + 1 < state.pack.rounds.length) {
    return {
      state: { ...base, phase: 'round-end' },
      effects: [
        { type: 'start-timer', timer: 'round-end', ms: ROUND_END_TIMER_MS },
      ],
    };
  }
  return { state: { ...base, phase: 'game-end' }, effects: [] };
}

function startNextRound(state: EngineState): Result {
  return {
    state: { ...state, phase: 'selecting', roundIndex: state.roundIndex + 1 },
    effects: [],
  };
}
