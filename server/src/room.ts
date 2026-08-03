import { randomUUID } from 'node:crypto';

export interface Participant {
  id: string;
  name: string;
  token: string;
  connected: boolean;
}

export interface RoomState {
  participants: Participant[];
}

export type JoinResult = { participant: Participant } | { error: 'name-taken' };
export type ReconnectResult =
  { participant: Participant } | { error: 'invalid-token' };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export class Room {
  private participants: Participant[];
  private listeners = new Set<(state: RoomState) => void>();

  constructor(initial?: RoomState) {
    this.participants = initial
      ? initial.participants.map((p) => ({ ...p }))
      : [];
  }

  join(name: string): JoinResult {
    const trimmed = name.trim();
    const normalized = normalizeName(trimmed);
    const taken = this.participants.some(
      (p) => normalizeName(p.name) === normalized,
    );
    if (taken) {
      return { error: 'name-taken' };
    }
    const participant: Participant = {
      id: randomUUID(),
      name: trimmed,
      token: randomUUID(),
      connected: true,
    };
    this.participants.push(participant);
    this.notify();
    // Defensive copy, matching getState()'s convention below — a caller holding
    // the returned participant must not be able to mutate this.participants
    // directly. Object.freeze() was the other option; a shallow copy was chosen
    // to keep exactly one invariant-enforcing pattern in this class rather than
    // two different mechanisms doing the same job.
    return { participant: { ...participant } };
  }

  reconnect(token: string): ReconnectResult {
    const participant = this.participants.find((p) => p.token === token);
    if (!participant) {
      return { error: 'invalid-token' };
    }
    participant.connected = true;
    this.notify();
    // See the comment in join() above — same defensive-copy reasoning.
    return { participant: { ...participant } };
  }

  disconnect(participantId: string): void {
    const participant = this.participants.find((p) => p.id === participantId);
    if (!participant || !participant.connected) {
      return;
    }
    participant.connected = false;
    this.notify();
  }

  getState(): RoomState {
    return { participants: this.participants.map((p) => ({ ...p })) };
  }

  onChange(listener: (state: RoomState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
