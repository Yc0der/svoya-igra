export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export type ClientMessage =
  { type: 'join'; name: string } | { type: 'reconnect'; token: string };

export type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | { type: 'state'; participants: ParticipantView[] };
