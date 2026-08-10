import type { Phase } from './engine.js';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase: Phase;
  // Замороженный на время партии ведущий, НЕ то же самое, что лобби-флаг
  // StateMessage.hostParticipantId (см. Room.toGameStateView).
  hostId: string | null;
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  currentQuestion: { text: string; price: number } | null;
  buzzedParticipantId: string | null;
  // На judging непустой только для одного получателя за раз: при
  // hostParticipantId === null — для всех (двое, открытое судейство), иначе
  // — только для сокета с этим participantId (см. Room.toGameStateView).
  correctAnswer: { text: string; comment?: string } | null;
  // Не секрет ни от кого (в отличие от correctAnswer), одинаковы для всех
  // получателей. Не поле движка — Room-состояние (design.md, «СУДЕЙСТВО»,
  // 2026-08-05: временное исключение после неверного ответа — транспортное
  // ограничение, как фальстарт, не игровое правило). graceExcludedUntil —
  // ОТДЕЛЬНЫЙ от timerDeadline дедлайн: исключение идёт параллельно с уже
  // возобновившимся отсчётом вопроса, а не вместо него, поэтому у них разные
  // числа и client должен показывать оба независимо.
  graceExcludedParticipantId: string | null;
  graceExcludedUntil: number | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  // Персональные поля, как correctAnswer: обычному игроку — только его
  // собственная запись (или пустой массив, пока не отправил); ведущему на
  // final-judging и всем на final-reveal — все (см. Room.toGameStateView).
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
  // Тот же принцип видимости, что и у showAllFinal (см. finalWagers выше):
  // ведущему на final-judging, всем на final-reveal, иначе null.
  finalCorrectAnswer: { text: string; comment?: string } | null;
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'toggle-host' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean }
  // Панель ведущего — сервер сам проверяет, что отправитель и есть hostId,
  // клиентскому participantId в поле не доверяет.
  | { type: 'adjust-score'; participantId: string; delta: number }
  | { type: 'cancel-question' }
  // Сбрасывает текущую партию в пустое лобби — см. Room.resetGame().
  | { type: 'reset-game' }
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean }
  // Админ-панель (design.md, «Админ-панель») — отдельный тип сообщений, не
  // привязанный к участнику: сокет админки не присоединяется к комнате
  // (никогда не шлёт 'join'), поэтому эти сообщения сервер обрабатывает без
  // поиска в connections/participants, в отличие от всего выше.
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  | { type: 'admin-skip-to-final' };

export type StartGameErrorReason =
  | 'not-enough-players'
  | 'no-pack'
  | 'game-in-progress'
  | 'host-required'
  | 'host-only';

export type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason };
