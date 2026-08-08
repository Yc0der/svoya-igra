import type { Pack, Question } from './pack.js';

export type Phase =
  | 'selecting'
  | 'question-open'
  | 'buzzed'
  | 'judging'
  | 'reveal'
  | 'round-end'
  | 'final-elim'
  | 'final-wager'
  | 'final-answer'
  | 'final-judging'
  | 'final-reveal'
  | 'game-end';

export type TimerName =
  | 'question'
  | 'said-answer'
  | 'vote'
  | 'reveal'
  | 'round-end'
  | 'final-elim'
  | 'final-wager'
  | 'final-answer'
  | 'final-judging'
  | 'final-reveal';

export const QUESTION_TIMER_MS = 30_000;
export const SAID_ANSWER_TIMER_MS = 10_000;
export const VOTE_TIMER_MS = 10_000;
export const REVEAL_TIMER_MS = 4_000;
export const ROUND_END_TIMER_MS = 5_000;
export const FINAL_ELIM_TIMER_MS = 20_000;
export const FINAL_WAGER_TIMER_MS = 20_000;
export const FINAL_ANSWER_TIMER_MS = 45_000;
export const FINAL_JUDGING_TIMER_MS = 60_000;
export const FINAL_REVEAL_TIMER_MS = 10_000;

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
  finalRemainingThemeIndices: number[] | null;
  finalElimCounterId: string | null;
  finalThemeIndex: number | null;
  finalWagers: Record<string, number>;
  finalAnswers: Record<string, string>;
  finalVerdicts: Record<string, boolean>;
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
  | { type: 'cancel-question'; requesterId: string }
  // ВРЕМЕННО — для ручного тестирования финала без прохождения всех
  // раундов пакета. Не часть спеки, убрать вместе с кнопкой в Player.tsx,
  // когда финал будет проверен вживую.
  | { type: 'skip-to-final'; requesterId: string }
  | { type: 'eliminate-final-theme'; counterId: string; themeIndex: number }
  | { type: 'submit-wager'; counterId: string; amount: number }
  | { type: 'submit-final-answer'; counterId: string; text: string }
  | {
      type: 'final-vote';
      requesterId: string;
      counterId: string;
      correct: boolean;
    };

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
    finalRemainingThemeIndices: null,
    finalElimCounterId: null,
    finalThemeIndex: null,
    finalWagers: {},
    finalAnswers: {},
    finalVerdicts: {},
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
    case 'skip-to-final':
      return handleSkipToFinal(state, event);
    case 'eliminate-final-theme':
      return handleEliminateFinalTheme(state, event);
    case 'submit-wager':
      return handleSubmitWager(state, event);
    case 'submit-final-answer':
      return handleSubmitFinalAnswer(state, event);
    case 'final-vote':
      return handleFinalVote(state, event);
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

// ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final. Форсирует переход
// в финал из любой фазы обычного раунда, тем же путём (startFinalOrEnd), что
// и естественное завершение последнего раунда — не отдельная ветка правил.
function handleSkipToFinal(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'skip-to-final' }>,
): Result {
  if (state.hostId === null || event.requesterId !== state.hostId) {
    return unchanged(state);
  }
  if (
    state.phase === 'final-elim' ||
    state.phase === 'final-wager' ||
    state.phase === 'final-answer' ||
    state.phase === 'final-judging' ||
    state.phase === 'final-reveal' ||
    state.phase === 'game-end'
  ) {
    return unchanged(state);
  }
  return startFinalOrEnd({
    ...state,
    currentQuestion: null,
    buzzedCounterId: null,
    votes: {},
  });
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
    case 'final-elim': {
      const remaining = state.finalRemainingThemeIndices!;
      const randomIndex =
        remaining[Math.floor(Math.random() * remaining.length)];
      return eliminateFinalTheme(state, randomIndex);
    }
    case 'final-wager':
      return resolveWagers(state);
    case 'final-answer':
      return resolveAnswers(state);
    case 'final-judging':
      return resolveFinalVerdicts(state);
    case 'final-reveal':
      return { state: { ...state, phase: 'game-end' }, effects: [] };
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
  return startFinalOrEnd(base);
}

// Финал требует ведущего всегда, даже при двух счётчиках — это отдельное
// правило от стартового (design.md, финал-спека, «Правила финала»). Партия
// на двоих без ведущего или партия по пакету без final играется как раньше,
// без изменений.
function startFinalOrEnd(state: EngineState): Result {
  if (!state.pack.final || state.hostId === null) {
    return { state: { ...state, phase: 'game-end' }, effects: [] };
  }
  const ordered = ascendingByScore(state);
  return {
    state: {
      ...state,
      phase: 'final-elim',
      finalRemainingThemeIndices: state.pack.final.themes.map((_, i) => i),
      finalElimCounterId: ordered[0],
    },
    effects: [
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ],
  };
}

function startNextRound(state: EngineState): Result {
  return {
    state: { ...state, phase: 'selecting', roundIndex: state.roundIndex + 1 },
    effects: [],
  };
}

// Порядок счётчиков по возрастанию счёта — общий helper, используется и при
// старте финала, и при передаче хода.
function ascendingByScore(state: EngineState): string[] {
  return [...Object.keys(state.scores)].sort(
    (a, b) => state.scores[a] - state.scores[b],
  );
}

function handleEliminateFinalTheme(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'eliminate-final-theme' }>,
): Result {
  if (
    state.phase !== 'final-elim' ||
    event.counterId !== state.finalElimCounterId ||
    !state.finalRemainingThemeIndices?.includes(event.themeIndex)
  ) {
    return unchanged(state);
  }
  return eliminateFinalTheme(state, event.themeIndex);
}

function eliminateFinalTheme(state: EngineState, themeIndex: number): Result {
  const remaining = state.finalRemainingThemeIndices!.filter(
    (i) => i !== themeIndex,
  );
  if (remaining.length === 1) {
    return {
      state: {
        ...state,
        phase: 'final-wager',
        finalRemainingThemeIndices: remaining,
        finalThemeIndex: remaining[0],
        finalElimCounterId: null,
      },
      effects: [
        { type: 'start-timer', timer: 'final-wager', ms: FINAL_WAGER_TIMER_MS },
      ],
    };
  }
  const ordered = ascendingByScore(state);
  const turnIndex = ordered.indexOf(state.finalElimCounterId!);
  const nextCounterId = ordered[(turnIndex + 1) % ordered.length];
  return {
    state: {
      ...state,
      finalRemainingThemeIndices: remaining,
      finalElimCounterId: nextCounterId,
    },
    effects: [
      { type: 'start-timer', timer: 'final-elim', ms: FINAL_ELIM_TIMER_MS },
    ],
  };
}

function handleSubmitWager(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'submit-wager' }>,
): Result {
  if (state.phase !== 'final-wager' || !(event.counterId in state.scores)) {
    return unchanged(state);
  }
  const max = Math.max(0, state.scores[event.counterId]);
  const rawAmount = Number.isFinite(event.amount) ? event.amount : 0;
  const amount = Math.min(max, Math.max(0, rawAmount));
  const wagers = { ...state.finalWagers, [event.counterId]: amount };
  if (Object.keys(wagers).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalWagers: wagers });
  }
  return startFinalAnswer({ ...state, finalWagers: wagers });
}

function startFinalAnswer(state: EngineState): Result {
  return {
    state: { ...state, phase: 'final-answer' },
    effects: [
      { type: 'start-timer', timer: 'final-answer', ms: FINAL_ANSWER_TIMER_MS },
    ],
  };
}

function resolveWagers(state: EngineState): Result {
  const wagers = { ...state.finalWagers };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in wagers)) wagers[counterId] = 0;
  }
  return startFinalAnswer({ ...state, finalWagers: wagers });
}

function handleSubmitFinalAnswer(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'submit-final-answer' }>,
): Result {
  if (state.phase !== 'final-answer' || !(event.counterId in state.scores)) {
    return unchanged(state);
  }
  const answers = { ...state.finalAnswers, [event.counterId]: event.text };
  if (Object.keys(answers).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalAnswers: answers });
  }
  return startFinalJudging({ ...state, finalAnswers: answers });
}

function startFinalJudging(state: EngineState): Result {
  return {
    state: { ...state, phase: 'final-judging' },
    effects: [
      {
        type: 'start-timer',
        timer: 'final-judging',
        ms: FINAL_JUDGING_TIMER_MS,
      },
    ],
  };
}

function resolveAnswers(state: EngineState): Result {
  const answers = { ...state.finalAnswers };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in answers)) answers[counterId] = '';
  }
  return startFinalJudging({ ...state, finalAnswers: answers });
}

function handleFinalVote(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'final-vote' }>,
): Result {
  if (
    state.phase !== 'final-judging' ||
    state.hostId === null ||
    event.requesterId !== state.hostId ||
    !(event.counterId in state.scores)
  ) {
    return unchanged(state);
  }
  const verdicts = { ...state.finalVerdicts, [event.counterId]: event.correct };
  if (Object.keys(verdicts).length < Object.keys(state.scores).length) {
    return unchanged({ ...state, finalVerdicts: verdicts });
  }
  return applyFinalVerdicts({ ...state, finalVerdicts: verdicts });
}

function applyFinalVerdicts(state: EngineState): Result {
  const scores = { ...state.scores };
  for (const counterId of Object.keys(scores)) {
    const wager = state.finalWagers[counterId] ?? 0;
    const correct = state.finalVerdicts[counterId] ?? false;
    scores[counterId] = scores[counterId] + (correct ? wager : -wager);
  }
  return {
    state: { ...state, phase: 'final-reveal', scores },
    effects: [
      { type: 'start-timer', timer: 'final-reveal', ms: FINAL_REVEAL_TIMER_MS },
    ],
  };
}

function resolveFinalVerdicts(state: EngineState): Result {
  const verdicts = { ...state.finalVerdicts };
  for (const counterId of Object.keys(state.scores)) {
    if (!(counterId in verdicts)) verdicts[counterId] = false;
  }
  return applyFinalVerdicts({ ...state, finalVerdicts: verdicts });
}
