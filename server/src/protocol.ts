import type { Phase } from './engine.js';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase: Phase;
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
  | { type: 'cancel-question' };

export type StartGameErrorReason =
  'not-enough-players' | 'no-pack' | 'game-in-progress' | 'host-required';

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
