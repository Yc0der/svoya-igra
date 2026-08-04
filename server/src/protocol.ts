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
  correctAnswer: { text: string; comment?: string } | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean };

export type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      game: GameStateView | null;
    }
  | { type: 'falsestart' };
