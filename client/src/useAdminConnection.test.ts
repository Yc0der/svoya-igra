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
    // Хук шлёт admin-get-players сразу после подключения (запрос анкет —
    // задача 3), но ни 'join', ни 'reconnect' — единственное, что здесь
    // проверяется.
    expect(socket.sent).not.toContainEqual(
      expect.stringContaining('"type":"join"'),
    );
    expect(socket.sent).not.toContainEqual(
      expect.stringContaining('"type":"reconnect"'),
    );
    localStorage.clear();
  });

  it('picks up lanUrl, lanCandidates and room state from state broadcasts', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];

    act(() => socket.emitOpen());
    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [{ id: 'p1', name: 'Ваня', connected: true }],
        hostParticipantId: 'p1',
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        lanCandidates: [{ address: '192.168.1.5', interfaceName: 'Wi-Fi' }],
      }),
    );

    expect(result.current.lanUrl).toBe('http://192.168.1.5:8080/');
    expect(result.current.lanCandidates).toEqual([
      { address: '192.168.1.5', interfaceName: 'Wi-Fi' },
    ]);
    expect(result.current.participants).toEqual([
      { id: 'p1', name: 'Ваня', connected: true },
    ]);
    expect(result.current.hostParticipantId).toBe('p1');
  });

  it('sends admin-set-lan-address with the chosen address', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.setLanAddress('192.168.31.179'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'admin-set-lan-address',
        address: '192.168.31.179',
      }),
    );
  });

  it('picks up availablePacks and activePackFilename from state broadcasts', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [],
        hostParticipantId: null,
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        lanCandidates: [],
        availablePacks: [
          { filename: 'a.json', title: 'Пак А', description: 'Описание' },
        ],
        activePackFilename: 'a.json',
      }),
    );

    expect(result.current.availablePacks).toEqual([
      { filename: 'a.json', title: 'Пак А', description: 'Описание' },
    ]);
    expect(result.current.activePackFilename).toBe('a.json');
  });

  it('sends admin-refresh-packs and admin-select-pack', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.refreshPacks());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-refresh-packs' }),
    );

    act(() => result.current.selectPack('b.json'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-select-pack', filename: 'b.json' }),
    );
  });

  it('surfaces a select-pack-error reason from the server', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'select-pack-error', reason: 'unknown-file' }),
    );

    expect(result.current.selectPackError).toBe('unknown-file');
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

  it('sends admin-skip-to-final', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.skipToFinal());
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-skip-to-final' }),
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

  it('sends admin-get-pack and picks up the returned pack', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.getPack('a.json'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-get-pack', filename: 'a.json' }),
    );

    const pack = {
      title: 'Пак',
      author: 'Автор',
      createdAt: '2026-08-04',
      rounds: [],
    };
    act(() =>
      socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
    );
    expect(result.current.editedPack).toEqual(pack);
    expect(result.current.editedPackFilename).toBe('a.json');
    expect(result.current.editedPackError).toBeNull();
  });

  it('sends admin-update-question with all fields, including the optional comment', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      result.current.updateQuestion('a.json', 'q1', {
        price: 200,
        text: 'Текст?',
        answer: 'Ответ',
        comment: 'Комментарий',
        questionType: 'обычный',
      }),
    );
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'admin-update-question',
        filename: 'a.json',
        questionId: 'q1',
        price: 200,
        text: 'Текст?',
        answer: 'Ответ',
        comment: 'Комментарий',
        questionType: 'обычный',
      }),
    );
  });

  it('sends admin-delete-question', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.deleteQuestion('a.json', 'q1'));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'admin-delete-question',
        filename: 'a.json',
        questionId: 'q1',
      }),
    );
  });

  it('surfaces an admin-pack-error reason and filename from the server', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-pack-error',
        filename: 'a.json',
        reason: 'вопрос с id "ghost" не найден в пакете',
      }),
    );
    expect(result.current.editedPackError).toBe(
      'вопрос с id "ghost" не найден в пакете',
    );
    expect(result.current.editedPackFilename).toBe('a.json');
  });

  it('clears editedPackError once a later admin-pack arrives', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-pack-error',
        filename: 'a.json',
        reason: 'ошибка',
      }),
    );
    expect(result.current.editedPackError).toBe('ошибка');

    const pack = {
      title: 'Пак',
      author: 'Автор',
      createdAt: '2026-08-04',
      rounds: [],
    };
    act(() =>
      socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
    );
    expect(result.current.editedPackError).toBeNull();
    expect(result.current.editedPack).toEqual(pack);
  });

  it('increments editedPackVersion on every admin-pack, but not on admin-pack-error', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());
    expect(result.current.editedPackVersion).toBe(0);

    const pack = {
      title: 'Пак',
      author: 'Автор',
      createdAt: '2026-08-04',
      rounds: [],
    };
    act(() =>
      socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
    );
    expect(result.current.editedPackVersion).toBe(1);

    act(() =>
      socket.emitMessage({
        type: 'admin-pack-error',
        filename: 'a.json',
        reason: 'ошибка',
      }),
    );
    expect(result.current.editedPackVersion).toBe(1);

    act(() =>
      socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
    );
    expect(result.current.editedPackVersion).toBe(2);
  });

  it('clearPackError resets editedPackError to null locally, without a server round-trip', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-pack-error',
        filename: 'a.json',
        reason: 'ошибка',
      }),
    );
    expect(result.current.editedPackError).toBe('ошибка');

    const sentBefore = socket.sent.length;
    act(() => result.current.clearPackError());
    expect(result.current.editedPackError).toBeNull();
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it('resetPackEditor clears editedPack, editedPackFilename and editedPackError', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    const pack = {
      title: 'Пак',
      author: 'Автор',
      createdAt: '2026-08-04',
      rounds: [],
    };
    act(() =>
      socket.emitMessage({ type: 'admin-pack', filename: 'a.json', pack }),
    );
    expect(result.current.editedPack).toEqual(pack);

    act(() => result.current.resetPackEditor());
    expect(result.current.editedPack).toBeNull();
    expect(result.current.editedPackFilename).toBeNull();
    expect(result.current.editedPackError).toBeNull();
  });

  it('sends admin-report-question with the complaint text', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      result.current.reportQuestion('a.json', 'q1', 'непонятная формулировка'),
    );
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'admin-report-question',
        filename: 'a.json',
        questionId: 'q1',
        complaint: 'непонятная формулировка',
      }),
    );
  });

  it('increments reportAckVersion and clears reportError on admin-report-ack', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-report-error',
        filename: 'a.json',
        questionId: 'q1',
        reason: 'ошибка',
      }),
    );
    expect(result.current.reportError).toBe('ошибка');

    act(() =>
      socket.emitMessage({
        type: 'admin-report-ack',
        filename: 'a.json',
        questionId: 'q1',
      }),
    );
    expect(result.current.reportError).toBeNull();
    expect(result.current.reportAckVersion).toBe(1);
  });

  it('surfaces the reason from admin-report-error', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-report-error',
        filename: 'a.json',
        questionId: 'q1',
        reason: 'вопрос с таким id не найден',
      }),
    );
    expect(result.current.reportError).toBe('вопрос с таким id не найден');
  });

  it('clearReportError resets reportError locally without waiting for the server', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-report-error',
        filename: 'a.json',
        questionId: 'q1',
        reason: 'ошибка',
      }),
    );
    act(() => result.current.clearReportError());
    expect(result.current.reportError).toBeNull();
  });

  it('requests the player list right after connecting', () => {
    const { result: _result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-get-players' }),
    );
  });

  it('savePlayer отправляет код и складывает пришедший список', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.savePlayer('{"...":1}', false));
    expect(socket.sent).toContainEqual(
      JSON.stringify({
        type: 'admin-save-player',
        code: '{"...":1}',
        replace: false,
      }),
    );

    act(() =>
      socket.emitMessage({
        type: 'admin-players',
        players: [{ name: 'Ваня', date: '2026-08-26' }],
      }),
    );
    expect(result.current.players).toEqual([
      { name: 'Ваня', date: '2026-08-26' },
    ]);
  });

  it('admin-players гасит и playerError, и playerConflictName', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'admin-player-exists', name: 'Ваня' }),
    );
    expect(result.current.playerConflictName).toBe('Ваня');

    act(() =>
      socket.emitMessage({
        type: 'admin-players',
        players: [{ name: 'Ваня', date: '2026-08-26' }],
      }),
    );
    expect(result.current.playerConflictName).toBeNull();
    expect(result.current.playerError).toBeNull();
  });

  it('admin-player-exists кладёт имя в playerConflictName, не трогая ошибку', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'admin-player-exists', name: 'Ваня' }),
    );
    expect(result.current.playerConflictName).toBe('Ваня');
    expect(result.current.playerError).toBeNull();
  });

  it('admin-player-error кладёт причину в playerError', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-player-error',
        reason: 'это не похоже на код анкеты',
      }),
    );
    expect(result.current.playerError).toContain('не похоже на код анкеты');
    expect(result.current.playerConflictName).toBeNull();
  });

  it('clearPlayerFeedback сбрасывает playerError и playerConflictName локально', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({ type: 'admin-player-exists', name: 'Ваня' }),
    );
    act(() => result.current.clearPlayerFeedback());
    expect(result.current.playerConflictName).toBeNull();
    expect(result.current.playerError).toBeNull();
  });

  // Слияние расщепившихся профилей (задача 4, sdd/2026-08-26-player-identity).
  it('picks up people from state broadcasts', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'state',
        participants: [],
        hostParticipantId: null,
        game: null,
        lanUrl: 'http://192.168.1.5:8080/',
        lanCandidates: [],
        people: [
          { id: 1, name: 'Ваня', games: 5 },
          { id: 2, name: 'Катя', games: 1 },
        ],
      }),
    );

    expect(result.current.people).toEqual([
      { id: 1, name: 'Ваня', games: 5 },
      { id: 2, name: 'Катя', games: 1 },
    ]);
  });

  it('mergePeople отправляет admin-merge-people с fromId/intoId', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() => result.current.mergePeople(1, 2));
    expect(socket.sent).toContainEqual(
      JSON.stringify({ type: 'admin-merge-people', fromId: 1, intoId: 2 }),
    );
  });

  it('admin-people кладёт обновлённый список и гасит peopleError', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-people-error',
        reason: 'нельзя сливать игроков, пока идёт партия',
      }),
    );
    expect(result.current.peopleError).toBe(
      'нельзя сливать игроков, пока идёт партия',
    );

    act(() =>
      socket.emitMessage({
        type: 'admin-people',
        people: [{ id: 2, name: 'Катя', games: 6 }],
      }),
    );
    expect(result.current.people).toEqual([{ id: 2, name: 'Катя', games: 6 }]);
    expect(result.current.peopleError).toBeNull();
  });

  it('admin-people-error кладёт причину в peopleError', () => {
    const { result } = renderHook(() => useAdminConnection(factory));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());

    act(() =>
      socket.emitMessage({
        type: 'admin-people-error',
        reason: 'не удалось слить — выбраны один и тот же игрок?',
      }),
    );
    expect(result.current.peopleError).toBe(
      'не удалось слить — выбраны один и тот же игрок?',
    );
  });
});
