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
  // Не секрет ни от кого (в отличие от correctAnswer) — прямая копия
  // EngineState.graceExcludedCounterId, одинакова для всех получателей.
  graceExcludedParticipantId: string | null;
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
  | { type: 'vote'; correct: boolean };

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
