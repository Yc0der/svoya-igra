import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomConnection } from './useRoomConnection';

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

describe('useRoomConnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function factory(url: string): WebSocket {
    return new FakeWebSocket(url) as unknown as WebSocket;
  }

  it('starts in connecting status with no participants', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    expect(result.current.status).toBe('connecting');
    expect(result.current.participants).toEqual([]);
  });

  it('sends a join message when join() is called after the socket opens', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'join', name: 'Ваня' }),
    );
    expect(result.current.status).toBe('joining');
  });

  it('stores the token and moves to joined on a joined message', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));
    act(() =>
      socket.emitMessage({
        type: 'joined',
        participantId: 'p1',
        token: 'tok-1',
        name: 'Ваня',
      }),
    );

    expect(result.current.status).toBe('joined');
    expect(result.current.selfId).toBe('p1');
    expect(localStorage.getItem('svoya-igra-token')).toBe('tok-1');
  });

  it('moves to name-taken status without touching localStorage', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => result.current.join('Ваня'));
    act(() => socket.emitMessage({ type: 'name-taken' }));

    expect(result.current.status).toBe('name-taken');
    expect(localStorage.getItem('svoya-igra-token')).toBeNull();
  });

  it('sends a reconnect message on open when a token is already stored', () => {
    localStorage.setItem('svoya-igra-token', 'tok-1');
    renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'reconnect', token: 'tok-1' }),
    );
  });

  it('updates participants on a state message', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
      }),
    );

    expect(result.current.participants).toEqual([
      { id: 'p1', name: 'Ваня', connected: true },
    ]);
  });

  it('reconnects automatically after the socket closes', () => {
    vi.useFakeTimers();
    renderHook(() => useRoomConnection(factory));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0].close());
    act(() => vi.advanceTimersByTime(2000));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
