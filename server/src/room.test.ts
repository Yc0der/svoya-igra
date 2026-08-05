import { describe, expect, it, vi } from 'vitest';
import { Room } from './room.js';
import { deserializeSnapshot, serializeSnapshot } from './snapshot.js';
import { QUESTION_TIMER_MS } from './engine.js';

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
      hostParticipantId: null,
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

  it('rejects starting a new game mid-question without killing the live timer of the game in progress', () => {
    // Regression: startGame() used to clear gameTimeoutHandle/gameTimerDeadline
    // unconditionally before checking game-in-progress, so even a REJECTED
    // call would kill the running timer. 'selecting' (the previous version of
    // this test) can't catch that — it has no timer at all, so
    // timerDeadline is null before and after regardless of the bug. Exercise
    // 'question-open' instead, which has a live timer, and prove that timer
    // is still genuinely alive — not just that the field looks non-null — by
    // advancing fake timers past it and confirming the phase still advances.
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame();
    const picker = room.toGameStateView()!.turnParticipantId;

    vi.useFakeTimers();
    try {
      room.selectQuestion(picker, 0, 'q1');
      const before = room.toGameStateView();
      expect(before?.phase).toBe('question-open');
      expect(before?.timerDeadline).not.toBeNull();

      expect(room.startGame()).toEqual({ error: 'game-in-progress' });

      const afterReject = room.toGameStateView();
      expect(afterReject?.timerDeadline).toBe(before?.timerDeadline);

      vi.advanceTimersByTime(QUESTION_TIMER_MS);
      expect(room.toGameStateView()?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with host-required when three or more are present and nobody is marked host', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    joinedId(room, 'Петя');
    expect(room.startGame()).toEqual({ error: 'host-required' });
  });

  it('starts with a host once someone is marked host, excluding the host from counters and scores', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);

    expect(room.startGame()).toEqual({ ok: true });

    const view = room.toGameStateView(petya);
    expect(view?.scores.map((s) => s.participantId).sort()).toEqual(
      [vanya, katya].sort(),
    );
    expect(view?.turnParticipantId).not.toBe(petya);
  });

  it('ignores a stale host marking for someone who disconnected before start', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    joinedId(room, 'Петя');
    const dasha = joinedId(room, 'Даша');
    room.toggleHost(dasha);
    room.disconnect(dasha);

    expect(room.startGame()).toEqual({ error: 'host-required' });
  });

  it('toggleHost is idempotent (marking and unmarking the same participant)', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    joinedId(room, 'Петя');
    room.toggleHost(vanya);
    expect(room.getState().hostParticipantId).toBe(vanya);
    room.toggleHost(vanya);
    expect(room.getState().hostParticipantId).toBeNull();
  });

  it('shows the correct answer during judging only to the host, not to the board or other players', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame();
    const picker = room.toGameStateView(petya)!.turnParticipantId;
    const answerer = picker === vanya ? vanya : katya;

    room.selectQuestion(picker, 0, 'q1');
    room.buzz(answerer);
    room.saidAnswer(answerer);

    expect(room.toGameStateView(petya)?.correctAnswer).not.toBeNull();
    expect(room.toGameStateView(null)?.correctAnswer).toBeNull();
    expect(
      room.toGameStateView(answerer === vanya ? katya : vanya)?.correctAnswer,
    ).toBeNull();
  });

  it('reopens the question for others after an incorrect host verdict, and closes it after an incorrect open-mode verdict', () => {
    // Двое, без ведущего: закрывается сразу.
    const open = new Room(undefined, TEST_PACK);
    const v1 = joinedId(open, 'Ваня');
    const k1 = joinedId(open, 'Катя');
    open.startGame();
    const picker1 = open.toGameStateView()!.turnParticipantId;
    const other1 = picker1 === v1 ? k1 : v1;
    open.selectQuestion(picker1, 0, 'q1');
    open.buzz(picker1);
    open.saidAnswer(picker1);
    open.vote(other1, false);
    expect(open.toGameStateView()?.phase).toBe('judging');

    // Трое с ведущим: переоткрывается сразу же по вердикту ведущего.
    const hosted = new Room(undefined, TEST_PACK);
    const v2 = joinedId(hosted, 'Ваня');
    const k2 = joinedId(hosted, 'Катя');
    const p2 = joinedId(hosted, 'Петя');
    hosted.toggleHost(p2);
    hosted.startGame();
    const picker2 = hosted.toGameStateView(p2)!.turnParticipantId;
    const answerer2 = picker2 === v2 ? v2 : k2;
    hosted.selectQuestion(picker2, 0, 'q1');
    hosted.buzz(answerer2);
    hosted.saidAnswer(answerer2);
    hosted.vote(p2, false);
    expect(hosted.toGameStateView(p2)?.phase).toBe('question-open');
    expect(hosted.toGameStateView(p2)?.graceExcludedParticipantId).toBe(
      answerer2,
    );
  });

  it('re-admits the excluded answerer once the 10s grace period expires', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      const petya = joinedId(room, 'Петя');
      room.toggleHost(petya);
      room.startGame();
      const picker = room.toGameStateView(petya)!.turnParticipantId;
      const answerer = picker === vanya ? vanya : katya;

      room.selectQuestion(picker, 0, 'q1');
      room.buzz(answerer);
      room.saidAnswer(answerer);
      room.vote(petya, false);
      expect(room.toGameStateView(petya)?.graceExcludedParticipantId).toBe(
        answerer,
      );
      // Пока грейс не истёк, повторное нажатие того же счётчика ни к чему не
      // приводит — фаза не меняется.
      expect(room.buzz(answerer)).toBe('ok');
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');

      vi.advanceTimersByTime(10_000); // REOPEN_GRACE_MS
      expect(
        room.toGameStateView(petya)?.graceExcludedParticipantId,
      ).toBeNull();

      expect(room.buzz(answerer)).toBe('ok');
      expect(room.toGameStateView(petya)?.phase).toBe('buzzed');
      expect(room.toGameStateView(petya)?.buzzedParticipantId).toBe(answerer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens the question with the time remaining when it was buzzed, not a fresh 25s, after the grace period', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      const petya = joinedId(room, 'Петя');
      room.toggleHost(petya);
      room.startGame();
      const picker = room.toGameStateView(petya)!.turnParticipantId;
      const answerer = picker === vanya ? vanya : katya;

      room.selectQuestion(picker, 0, 'q1');
      vi.advanceTimersByTime(20_000); // 20s of the 25s question timer pass
      room.buzz(answerer); // ~5s of open-question budget left, captured here
      room.saidAnswer(answerer);
      room.vote(petya, false); // wrong — grace(10s) starts

      vi.advanceTimersByTime(10_000); // grace ends, reopened 'question' timer starts
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');
      expect(
        room.toGameStateView(petya)?.graceExcludedParticipantId,
      ).toBeNull();

      // Should have ~5s left, not a fresh 25s: advancing just short of 5s
      // must not have timed out yet...
      vi.advanceTimersByTime(4_900);
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');

      // ...but crossing the ~5s mark should reveal with no answerer, exactly
      // like the original question genuinely ran out of time.
      vi.advanceTimersByTime(200);
      expect(room.toGameStateView(petya)?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not corrupt the saved remaining time when someone else buzzes during the grace period itself', () => {
    // Регрессия: buzz() раньше захватывал "остаток времени" по одному
    // условию — что фаза 'question-open' — а грейс-период ТОЖЕ идёт в фазе
    // 'question-open' (просто с активным таймером 'reopen-grace', а не
    // 'question'). Без различения этих двух случаев нажатие ВО ВРЕМЯ грейса
    // затирало бы сохранённый остаток вопроса остатком самого грейса.
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      const petya = joinedId(room, 'Петя');
      room.toggleHost(petya);
      room.startGame();
      const picker = room.toGameStateView(petya)!.turnParticipantId;
      const answerer = picker === vanya ? vanya : katya;
      const other = answerer === vanya ? katya : vanya;

      room.selectQuestion(picker, 0, 'q1');
      vi.advanceTimersByTime(20_000); // ~5s of the question's 25s left
      room.buzz(answerer);
      room.saidAnswer(answerer);
      room.vote(petya, false); // wrong — grace(10s) starts, 'other' is free to buzz

      vi.advanceTimersByTime(2_000); // 2s into the grace period
      room.buzz(other); // buzzes while the *grace* timer, not 'question', is active
      room.saidAnswer(other);
      room.vote(petya, false); // also wrong — grace(10s) starts again

      vi.advanceTimersByTime(10_000); // this grace ends, reopened 'question' starts
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');

      // Still the original ~5s, not corrupted by 'other's buzz during grace.
      vi.advanceTimersByTime(4_900);
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');
      vi.advanceTimersByTime(200);
      expect(room.toGameStateView(petya)?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
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

  // PHASE_TIMER в конструкторе Room — единственный механизм, не дающий
  // партии зависнуть навсегда после падения и перезапуска сервера: настоящий
  // setTimeout, который двигал игру дальше, погиб вместе со старым процессом,
  // и движок сам не знает о часах вообще. Раньше это было покрыто только
  // косвенно (timerDeadline не null сразу после конструктора) — здесь же
  // проверяется, что восстановленный таймер реально тикает, а не просто
  // выглядит выставленным.
  it('restarts a live timer for a game restored mid-question from a snapshot', () => {
    const first = new Room(undefined, TEST_PACK);
    const vanya = joinedId(first, 'Ваня');
    const katya = joinedId(first, 'Катя');
    first.startGame();
    const picker = first.toGameStateView()!.turnParticipantId;
    first.selectQuestion(picker, 0, 'q1');
    expect(first.toGameStateView()?.phase).toBe('question-open');
    const snapshot = first.getState();

    vi.useFakeTimers();
    try {
      // Снапшот-цикл без реального файла: тот же RoomState, что и после
      // serializeSnapshot/deserializeSnapshot (Task 10 уже покрывает сам
      // JSON round-trip в snapshot.test.ts), передан как initial новой Room
      // — ровно то, что index.ts делает при старте после падения. Часы
      // должны быть фейковыми уже на момент конструктора: именно там
      // взводится восстановленный таймер.
      const restored = new Room(snapshot, TEST_PACK);
      expect(restored.toGameStateView()?.phase).toBe('question-open');
      expect([vanya, katya]).toContain(picker);

      vi.advanceTimersByTime(25_000); // QUESTION_TIMER_MS
      expect(restored.toGameStateView()?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
  });
});
