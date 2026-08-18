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
    vi.unstubAllGlobals();
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

  it('ignores a stray name-taken reply that arrives after a successful join', () => {
    // Two rapid clicks/taps on "Войти" can each fire join() before the first
    // reply comes back (readyState is already OPEN on the second click, so
    // join() sends immediately both times). The server processes them in
    // order: the first succeeds ('joined'), the second is now a genuine
    // duplicate of the just-created name and gets 'name-taken'. That second,
    // stale reply must not undo the first, successful join.
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
    act(() => socket.emitMessage({ type: 'name-taken' }));

    expect(result.current.status).toBe('joined');
    expect(result.current.selfId).toBe('p1');
    expect(localStorage.getItem('svoya-igra-token')).toBe('tok-1');
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

  it('does not reconnect on internal state updates when using the default factory', () => {
    // No explicit factory here: this exercises useRoomConnection()'s default
    // parameter, the exact call shape production code (Tasks 7/8) uses.
    // Regression test for: an inline arrow-function default parameter is a
    // new function object on every call that omits the argument, so every
    // re-render (triggered by the hook's own setState calls) would give the
    // effect a new `wsFactory` dependency identity, tearing down and
    // reopening the socket in a loop. Stubbing the global WebSocket
    // constructor lets the default factory run for real while still using
    // the fake.
    vi.stubGlobal('WebSocket', FakeWebSocket);

    renderHook(() => useRoomConnection());
    expect(FakeWebSocket.instances).toHaveLength(1);

    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
      }),
    );

    // The state update above causes a re-render (and, pre-fix, a fresh
    // default `wsFactory` identity). A stable default must not tear down
    // and reopen the socket as a result.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('exposes game state from a state message and stays null before any game starts', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({ type: 'state', participants: [], game: null }),
    );

    expect(result.current.game).toBeNull();
  });

  it('updates game state on every state broadcast', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    const gameView = {
      phase: 'selecting',
      roundIndex: 0,
      grid: [],
      turnParticipantId: 'p1',
      currentQuestion: null,
      buzzedParticipantId: null,
      correctAnswer: null,
      timerDeadline: null,
      scores: [],
    };

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({ type: 'state', participants: [], game: gameView }),
    );

    expect(result.current.game).toEqual(gameView);
  });

  it('sends start-game/select-question/buzz/said-answer/vote as the matching client messages', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.startGame());
    expect(socket.sent).toContainEqual(JSON.stringify({ type: 'start-game' }));

    act(() => result.current.selectQuestion(1, 'q2'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'select-question',
        themeIndex: 1,
        questionId: 'q2',
      }),
    );

    act(() => result.current.buzz());
    expect(socket.sent).toContainEqual(JSON.stringify({ type: 'buzz' }));

    act(() => result.current.saidAnswer());
    expect(socket.sent).toContainEqual(JSON.stringify({ type: 'said-answer' }));

    act(() => result.current.vote(true));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'vote', correct: true }),
    );

    act(() => result.current.eliminateFinalTheme(1));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'eliminate-final-theme', themeIndex: 1 }),
    );

    act(() => result.current.submitWager(150));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'submit-wager', amount: 150 }),
    );

    act(() => result.current.submitFinalAnswer('мой ответ'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'submit-final-answer', text: 'мой ответ' }),
    );

    act(() => result.current.finalVote('p2', false));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'final-vote',
        participantId: 'p2',
        correct: false,
      }),
    );
  });

  it('sets falsestart on a falsestart message and clears it again after 2 seconds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() => socket.emitMessage({ type: 'falsestart' }));
    expect(result.current.falsestart).toBe(true);

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.falsestart).toBe(false);
  });

  it('sets selectQuestionBlocked on a select-question-error message and clears it again after 5 seconds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({
        type: 'select-question-error',
        reason: 'no-recipient',
      }),
    );
    expect(result.current.selectQuestionBlocked).toBe(true);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.selectQuestionBlocked).toBe(false);
  });

  it('picks up availablePacks and activePackFilename from state broadcasts', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [],
        hostParticipantId: null,
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: null },
        ],
        activePackFilename: 'a.json',
      }),
    );

    expect(result.current.availablePacks).toEqual([
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);
    expect(result.current.activePackFilename).toBe('a.json');
  });

  it('sends refresh-packs and select-pack', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.refreshPacks());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'refresh-packs' }),
    );

    act(() => result.current.selectPack('b.json'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'select-pack', filename: 'b.json' }),
    );
  });

  it('surfaces a select-pack-error reason from the server', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'select-pack-error', reason: 'unknown-file' }),
    );

    expect(result.current.selectPackError).toBe('unknown-file');
  });

  it('sends place-bid with the given amount', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.placeBid(150));

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'place-bid', amount: 150 }),
    );
  });

  it('sends pass-bid', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.passBid());

    expect(socket.sent).toContainEqual(JSON.stringify({ type: 'pass-bid' }));
  });

  it('sends assign-cat with the chosen recipient', () => {
    const { result } = renderHook(() => useRoomConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.assignCat('p2'));

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'assign-cat', recipientParticipantId: 'p2' }),
    );
  });
});
