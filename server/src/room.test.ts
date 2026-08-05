import { describe, expect, it, vi } from 'vitest';
import { Room } from './room.js';
import { deserializeSnapshot, serializeSnapshot } from './snapshot.js';

describe('Room.join', () => {
  it('adds a new participant', () => {
    const room = new Room();
    const result = room.join('Ваня');
    expect(result).toMatchObject({
      participant: { name: 'Ваня', connected: true },
    });
  });

  it('rejects a case-insensitive, whitespace-insensitive duplicate name', () => {
    const room = new Room();
    room.join('Ваня');
    const result = room.join('  ваня ');
    expect(result).toEqual({ error: 'name-taken' });
  });

  it('allows two different names', () => {
    const room = new Room();
    room.join('Ваня');
    const result = room.join('Катя');
    expect('participant' in result).toBe(true);
  });

  it('notifies listeners on successful join', () => {
    const room = new Room();
    const listener = vi.fn();
    room.onChange(listener);
    room.join('Ваня');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      participants: [expect.objectContaining({ name: 'Ваня' })],
      game: null,
    });
  });

  it('does not notify listeners on a rejected join', () => {
    const room = new Room();
    room.join('Ваня');
    const listener = vi.fn();
    room.onChange(listener);
    room.join('ваня');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Room.reconnect', () => {
  it('marks a disconnected participant as connected again, keeping id and name', () => {
    const room = new Room();
    const joined = room.join('Ваня');
    if (!('participant' in joined)) throw new Error('expected join to succeed');
    room.disconnect(joined.participant.id);

    const result = room.reconnect(joined.participant.token);

    expect(result).toEqual({
      participant: { ...joined.participant, connected: true },
    });
  });

  it('rejects an unknown token', () => {
    const room = new Room();
    const result = room.reconnect('not-a-real-token');
    expect(result).toEqual({ error: 'invalid-token' });
  });
});

describe('Room restored from a snapshot', () => {
  // Вторая ключевая гарантия вехи («сервер переживает перезапуск») целиком:
  // снапшот на диске -> new Room(initial) -> reconnect по токену, выданному
  // ДО перезапуска -> тот же участник, тот же id и имя. По частям это уже
  // покрыто (room.test.ts и snapshot.test.ts), но сама цепочка целиком —
  // единственное, что задача 10 проверяет живьём — не была покрыта ничем.
  it('restores a participant from a snapshot and lets them reconnect by token', () => {
    const first = new Room();
    const joined = first.join('Ваня');
    if (!('participant' in joined)) throw new Error('expected join to succeed');

    const restored = new Room(
      deserializeSnapshot(serializeSnapshot(first.getState())),
    );

    expect(restored.getState().participants[0].connected).toBe(false);
    expect(restored.reconnect(joined.participant.token)).toEqual({
      participant: { ...joined.participant, connected: true },
    });
  });
});

describe('Room.disconnect', () => {
  it('marks a participant as disconnected without removing them', () => {
    const room = new Room();
    const joined = room.join('Ваня');
    if (!('participant' in joined)) throw new Error('expected join to succeed');

    room.disconnect(joined.participant.id);

    expect(room.getState().participants).toEqual([
      { ...joined.participant, connected: false },
    ]);
  });

  it('does nothing for an unknown participant id', () => {
    const room = new Room();
    const listener = vi.fn();
    room.onChange(listener);
    room.disconnect('unknown-id');
    expect(listener).not.toHaveBeenCalled();
  });
});

import type { Pack } from './pack.js';

const TEST_PACK: Pack = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            {
              id: 'q1',
              price: 100,
              text: 'Вопрос 1?',
              answer: 'ответ 1',
              type: 'обычный',
            },
            {
              id: 'q2',
              price: 200,
              text: 'Вопрос 2?',
              answer: 'ответ 2',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
};

// Пакет из одного вопроса: единственный раунд, единственная тема — раскрытие
// этого вопроса завершает и раунд, и партию сразу (regression-тест на
// timerDeadline в фазе 'game-end').
const ONE_QUESTION_PACK: Pack = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            {
              id: 'q1',
              price: 100,
              text: 'Вопрос 1?',
              answer: 'ответ 1',
              type: 'обычный',
            },
          ],
        },
      ],
    },
  ],
};

function joinedId(room: Room, name: string): string {
  const result = room.join(name);
  if (!('participant' in result)) throw new Error('expected join to succeed');
  return result.participant.id;
}

describe('Room.startGame', () => {
  it('fails with not-enough-players when fewer than two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    expect(room.startGame()).toEqual({ error: 'not-enough-players' });
  });

  it('fails with no-pack when the room was built without one', () => {
    const room = new Room();
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    expect(room.startGame()).toEqual({ error: 'no-pack' });
  });

  it('starts the game and exposes a game state view once two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');

    expect(room.startGame()).toEqual({ ok: true });

    const view = room.toGameStateView();
    expect(view).not.toBeNull();
    expect(view?.phase).toBe('selecting');
    expect(view?.grid).toEqual([
      {
        themeName: 'Тема',
        questions: [
          { id: 'q1', price: 100, answered: false },
          { id: 'q2', price: 200, answered: false },
        ],
      },
    ]);
    expect([vanya, katya]).toContain(view?.turnParticipantId);
    expect(view?.scores).toEqual(
      expect.arrayContaining([
        { participantId: vanya, score: 0 },
        { participantId: katya, score: 0 },
      ]),
    );
  });

  it('excludes a disconnected participant from the game and from the minimum-players count', () => {
    // Кто-то зашёл в лобби и ушёл до начала игры — не должен остаться
    // фантомным счётчиком со случайным шансом на первый ход, и не должен
    // засчитываться в «минимум два игрока».
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.disconnect(vanya);

    // Осталась только Катя реально подключённой — меньше двух.
    expect(room.startGame()).toEqual({ error: 'not-enough-players' });

    const petya = joinedId(room, 'Петя');
    expect(room.startGame()).toEqual({ ok: true });

    const view = room.toGameStateView();
    expect(view?.scores.map((s) => s.participantId)).not.toContain(vanya);
    expect(view?.scores.map((s) => s.participantId)).toContain(petya);
  });

  it('notifies listeners on a successful start', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const listener = vi.fn();
    room.onChange(listener);
    room.startGame();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects starting a new game while one is already in progress, leaving the existing game untouched', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame();
    const before = room.toGameStateView();
    // Any phase other than 'game-end' counts as "in progress" — 'selecting'
    // right after start is enough to exercise the guard.
    expect(before?.phase).toBe('selecting');

    expect(room.startGame()).toEqual({ error: 'game-in-progress' });
    expect(room.toGameStateView()).toEqual(before);
  });

  it('allows starting a fresh game once the previous one reached game-end', () => {
    const room = new Room(undefined, ONE_QUESTION_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame();
    const picker = room.toGameStateView()!.turnParticipantId;

    vi.useFakeTimers();
    try {
      room.selectQuestion(picker, 0, 'q1');
      vi.advanceTimersByTime(25_000); // question timer -> reveal
      vi.advanceTimersByTime(4_000); // reveal timer -> game-end (only round, only question)
      expect(room.toGameStateView()?.phase).toBe('game-end');

      expect(room.startGame()).toEqual({ ok: true });
      const view = room.toGameStateView();
      expect(view?.phase).toBe('selecting');
      expect([vanya, katya]).toContain(view?.turnParticipantId);
    } finally {
      vi.useRealTimers();
    }
  });
});

function startedRoom(): { room: Room; picker: string; other: string } {
  const room = new Room(undefined, TEST_PACK);
  const vanya = joinedId(room, 'Ваня');
  const katya = joinedId(room, 'Катя');
  room.startGame();
  const view = room.toGameStateView()!;
  const picker = view.turnParticipantId;
  const other = picker === vanya ? katya : vanya;
  return { room, picker, other };
}

describe('Room game flow', () => {
  it('walks a question from selection through a correct answer', () => {
    const { room, picker, other } = startedRoom();

    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.phase).toBe('question-open');
    expect(room.toGameStateView()?.currentQuestion).toEqual({
      text: 'Вопрос 1?',
      price: 100,
    });

    expect(room.buzz(picker)).toBe('ok');
    expect(room.toGameStateView()?.phase).toBe('buzzed');
    expect(room.toGameStateView()?.buzzedParticipantId).toBe(picker);

    room.saidAnswer(picker);
    expect(room.toGameStateView()?.phase).toBe('judging');

    room.vote(other, true);
    // Голосование разрешается только по таймеру (Task 2) — до него фаза не
    // меняется, даже когда все имеющие право уже проголосовали.
    expect(room.toGameStateView()?.phase).toBe('judging');
  });

  it('rejects a buzz outside question-open as a falsestart, without touching game state', () => {
    const { room, picker } = startedRoom();
    const before = room.toGameStateView();

    expect(room.buzz(picker)).toBe('falsestart');

    expect(room.toGameStateView()).toEqual(before);
  });

  it('advances the round automatically once the question timer fires', () => {
    vi.useFakeTimers();
    try {
      const { room, picker } = startedRoom();
      room.selectQuestion(picker, 0, 'q1');
      expect(room.toGameStateView()?.phase).toBe('question-open');

      vi.advanceTimersByTime(25_000);
      expect(room.toGameStateView()?.phase).toBe('reveal');

      vi.advanceTimersByTime(4_000);
      expect(room.toGameStateView()?.phase).toBe('selecting');
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: applyEffects раньше сбрасывал gameTimeoutHandle/
  // gameTimerDeadline внутри `for (const effect of effects)`, поэтому при
  // пустом effects[] (обе фазы ниже — 'selecting' и 'game-end' — не заводят
  // свой таймер) сброс не происходил вообще, и toGameStateView().timerDeadline
  // продолжал показывать устаревший, уже прошедший дедлайн от таймера, который
  // только что сработал.
  it('clears timerDeadline once the reveal timer returns the round to selecting', () => {
    vi.useFakeTimers();
    try {
      const { room, picker } = startedRoom();
      room.selectQuestion(picker, 0, 'q1');

      vi.advanceTimersByTime(25_000); // question timer expires -> reveal
      expect(room.toGameStateView()?.phase).toBe('reveal');
      expect(room.toGameStateView()?.timerDeadline).not.toBeNull();

      vi.advanceTimersByTime(4_000); // reveal timer expires -> selecting, effects: []
      expect(room.toGameStateView()?.phase).toBe('selecting');
      expect(room.toGameStateView()?.timerDeadline).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears timerDeadline once the reveal timer ends the game', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, ONE_QUESTION_PACK);
      joinedId(room, 'Ваня');
      joinedId(room, 'Катя');
      room.startGame();
      const picker = room.toGameStateView()!.turnParticipantId;

      room.selectQuestion(picker, 0, 'q1');
      vi.advanceTimersByTime(25_000); // question timer expires -> reveal
      expect(room.toGameStateView()?.phase).toBe('reveal');
      expect(room.toGameStateView()?.timerDeadline).not.toBeNull();

      vi.advanceTimersByTime(4_000); // reveal timer expires -> round complete, last round -> game-end, effects: []
      expect(room.toGameStateView()?.phase).toBe('game-end');
      expect(room.toGameStateView()?.timerDeadline).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clear the vote timer when a vote is cast — judging still resolves via the timeout', () => {
    // Регрессия: 'vote' — не timer-expired событие, и у него всегда пустой
    // effects[] (движок просто копит голос, решение приходит по таймеру).
    // Если applyEffects трогает bookkeeping на КАЖДЫЙ пустой effects[], а не
    // только когда истёк именно текущий таймер, любой голос убивает уже
    // тикающий таймер судейства, и партия зависает навсегда после первого
    // же голоса — ни один будущий 'vote' его не переустановит.
    vi.useFakeTimers();
    try {
      const { room, picker, other } = startedRoom();
      room.selectQuestion(picker, 0, 'q1');
      room.buzz(picker);
      room.saidAnswer(picker);
      expect(room.toGameStateView()?.phase).toBe('judging');
      const deadlineBeforeVote = room.toGameStateView()?.timerDeadline;

      room.vote(other, true);
      expect(room.toGameStateView()?.timerDeadline).toBe(deadlineBeforeVote);

      vi.advanceTimersByTime(10_000);
      expect(room.toGameStateView()?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
  });
});
