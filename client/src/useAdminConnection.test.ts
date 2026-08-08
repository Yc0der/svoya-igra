import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminConnection } from './useAdminConnection';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close', {});
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

describe('useAdminConnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function factory(url: string): WebSocket {
    return new FakeWebSocket(url) as unknown as WebSocket;
  }

  it('starts disconnected with no participants and no game', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    expect(result.current.connected).toBe(false);
    expect(result.current.participants).toEqual([]);
    expect(result.current.game).toBeNull();
  });

  it('never sends a join or reconnect message — the admin socket does not join the room', () => {
    localStorage.setItem('svoya-igra-token', 'tok-1'); // even if a player token exists in this browser
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());

    expect(result.current.connected).toBe(true);
    expect(socket.sent).toEqual([]);
    localStorage.clear();
  });

  it('picks up lanUrl from hello and room state from state broadcasts', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({ type: 'hello', lanUrl: 'http://192.168.1.5:8080/' }),
    );
    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
        hostParticipantId: 'p1',
        game: null,
      }),
    );

    expect(result.current.lanUrl).toBe('http://192.168.1.5:8080/');
    expect(result.current.participants).toEqual([
      { id: 'p1', name: 'Ваня', connected: true },
    ]);
    expect(result.current.hostParticipantId).toBe('p1');
  });

  it('sends admin-start-game/admin-reset-game/admin-reset-room as the matching messages', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.startGame());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-start-game' }),
    );

    act(() => result.current.resetGame());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-reset-game' }),
    );

    act(() => result.current.resetRoom());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-reset-room' }),
    );
  });

  it('sends kick with the target participantId', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.kick('p1'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-kick', participantId: 'p1' }),
    );
  });

  it('sends setHost with a participantId or null', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.setHost('p1'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-set-host', participantId: 'p1' }),
    );

    act(() => result.current.setHost(null));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-set-host', participantId: null }),
    );
  });

  it('surfaces a start-game-error reason from the server', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'start-game-error',
        reason: 'not-enough-players',
      }),
    );

    expect(result.current.startGameError).toBe('not-enough-players');
  });

  it('reconnects automatically after the socket closes', () => {
    vi.useFakeTimers();
    renderHook(() => useAdminConnection(factory));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].close());
    act(() => vi.advanceTimersByTime(2000));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
