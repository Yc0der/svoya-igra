import { describe, expect, it, vi } from 'vitest';
import { Room } from './room.js';
import { deserializeSnapshot, serializeSnapshot } from './snapshot.js';
import { QUESTION_TIMER_MS, REVEAL_TIMER_MS } from './engine.js';

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

  it('reopens the question immediately on a wrong verdict — no separate pause before the question timer resumes', () => {
    // 2026-08-05, второй заход: раньше здесь была отдельная 10-секундная
    // пауза («грейс») ПЕРЕД тем, как отсчёт вопроса возобновлялся — то есть
    // на вопрос реально уходило больше времени, чем должно было. По фидбэку
    // с живой проверки это переделано: отсчёт вопроса возобновляется
    // мгновенно в момент неверного вердикта, а временная блокировка того,
    // кто ошибся, идёт ПАРАЛЛЕЛЬНО ему, а не перед ним.
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

      // Никакого advanceTimersByTime между вердиктом и проверкой — фаза
      // обязана быть 'question-open' сразу же.
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');
      expect(room.toGameStateView(petya)?.graceExcludedParticipantId).toBe(
        answerer,
      );
      expect(room.toGameStateView(petya)?.graceExcludedUntil).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks only the just-wrong answerer for 5s (in parallel with the resumed question timer), lets everyone else buzz right away', () => {
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
      room.buzz(answerer);
      room.saidAnswer(answerer);
      room.vote(petya, false);

      // Тот, кто только что ошибся — блокирован, фаза не меняется.
      expect(room.buzz(answerer)).toBe('ok');
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');

      // Кто угодно другой — жмёт сразу же, без ожидания.
      expect(room.buzz(other)).toBe('ok');
      expect(room.toGameStateView(petya)?.phase).toBe('buzzed');
      expect(room.toGameStateView(petya)?.buzzedParticipantId).toBe(other);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-admits the excluded answerer once the 5s block expires', () => {
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

      vi.advanceTimersByTime(5_000); // GRACE_EXCLUSION_MS
      expect(
        room.toGameStateView(petya)?.graceExcludedParticipantId,
      ).toBeNull();
      expect(room.toGameStateView(petya)?.graceExcludedUntil).toBeNull();

      expect(room.buzz(answerer)).toBe('ok');
      expect(room.toGameStateView(petya)?.phase).toBe('buzzed');
      expect(room.toGameStateView(petya)?.buzzedParticipantId).toBe(answerer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens the question with the time remaining when it was buzzed, not a fresh 30s', () => {
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
      vi.advanceTimersByTime(20_000); // 20s of the 30s question timer pass
      room.buzz(answerer); // ~10s of open-question budget left, captured here
      room.saidAnswer(answerer);
      room.vote(petya, false); // wrong — reopens immediately with ~10s left

      // Should have ~10s left, not a fresh 30s: advancing just short of 10s
      // must not have timed out yet...
      vi.advanceTimersByTime(9_900);
      expect(room.toGameStateView(petya)?.phase).toBe('question-open');

      // ...but crossing the ~10s mark should reveal with no answerer, exactly
      // like the original question genuinely ran out of time.
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
      vi.advanceTimersByTime(QUESTION_TIMER_MS); // question timer -> reveal
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

      vi.advanceTimersByTime(QUESTION_TIMER_MS);
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

      vi.advanceTimersByTime(QUESTION_TIMER_MS); // question timer expires -> reveal
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
      vi.advanceTimersByTime(QUESTION_TIMER_MS); // question timer expires -> reveal
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

      vi.advanceTimersByTime(QUESTION_TIMER_MS);
      expect(restored.toGameStateView()?.phase).toBe('reveal');
    } finally {
      vi.useRealTimers();
    }
  });
});

const FINAL_PACK: Pack = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            { id: 'q1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
          ],
        },
      ],
    },
  ],
  final: {
    themes: [
      {
        name: 'Финал A',
        question: { id: 'f1', text: 'F1?', answer: 'ответ f1' },
      },
      {
        name: 'Финал B',
        question: { id: 'f2', text: 'F2?', answer: 'ответ f2' },
      },
    ],
  },
};

describe('Room final round', () => {
  // turnCounterId (кто выбирает первый вопрос) выбирается движком случайно
  // между двумя счётчиками (engine.ts, createInitialState) — нельзя жёстко
  // считать picker'ом конкретного из a/b, иначе тест плавает примерно в
  // половине прогонов. driveToFinalWager сам определяет, чей ход, доигрывает
  // единственный вопрос пакета верным ответом от него (получает +100),
  // гасит reveal-таймер и вычёркивает вторую тему от имени того, кто не
  // отвечал (у него счёт меньше — он и ходит первым в final-elim), приводя
  // партию к final-wager. Возвращает { picker, other }, чтобы вызывающий тест
  // не гадал, кто есть кто.
  function driveToFinalWager(
    room: Room,
    a: string,
    b: string,
    host: string,
  ): { picker: string; other: string } {
    const picker = room.getState().game?.turnCounterId === a ? a : b;
    const other = picker === a ? b : a;
    room.selectQuestion(picker, 0, 'q1');
    room.buzz(picker);
    room.saidAnswer(picker);
    room.vote(host, true); // судейство с ведущим — решает сразу
    vi.advanceTimersByTime(REVEAL_TIMER_MS);
    room.eliminateFinalTheme(other, 0);
    return { picker, other };
  }

  it('submitWager clamps and reflects in scores only once judged', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);

    expect(room.getState().game?.phase).toBe('final-wager');
    room.submitWager(picker, 999); // клэмп до текущего счёта picker'а (100)
    room.submitWager(other, 0);
    expect(room.getState().game?.phase).toBe('final-answer');
    expect(room.getState().game?.finalWagers).toEqual({
      [picker]: 100,
      [other]: 0,
    });

    vi.useRealTimers();
  });

  it('submitFinalAnswer moves to final-judging once everyone answered', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);

    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');
    expect(room.getState().game?.phase).toBe('final-judging');

    vi.useRealTimers();
  });

  it('finalVote from the host applies scores and reaches final-reveal', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    room.finalVote(host, picker, true);
    room.finalVote(host, other, false);

    const state = room.getState();
    expect(state.game?.phase).toBe('final-reveal');
    expect(state.game?.scores[picker]).toBe(150);
    expect(state.game?.scores[other]).toBe(0);

    vi.useRealTimers();
  });

  it('finalVote from someone other than the host is ignored', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 0);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    room.finalVote(picker, other, true); // picker не ведущий
    expect(room.getState().game?.phase).toBe('final-judging');

    vi.useRealTimers();
  });

  it("toGameStateView hides other counters' wagers and answers from a non-host viewer, but shows everything to the host on final-judging and to everyone on final-reveal", () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 20);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    const pickerView = room.toGameStateView(picker);
    expect(pickerView?.finalWagers).toEqual([
      { participantId: picker, amount: 50 },
    ]);
    expect(pickerView?.finalAnswers).toEqual([
      { participantId: picker, text: 'ответ picker' },
    ]);

    const hostView = room.toGameStateView(host);
    expect(hostView?.finalWagers).toHaveLength(2);
    expect(hostView?.finalAnswers).toHaveLength(2);

    room.finalVote(host, picker, true);
    room.finalVote(host, other, true);

    const pickerRevealView = room.toGameStateView(picker);
    expect(pickerRevealView?.finalWagers).toHaveLength(2);
    expect(pickerRevealView?.finalVerdicts).toHaveLength(2);

    vi.useRealTimers();
  });

  it('toGameStateView shows finalCorrectAnswer only to the host on final-judging and to everyone on final-reveal', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const { picker, other } = driveToFinalWager(room, a, b, host);
    room.submitWager(picker, 50);
    room.submitWager(other, 20);
    room.submitFinalAnswer(picker, 'ответ picker');
    room.submitFinalAnswer(other, 'ответ other');

    expect(room.getState().game?.phase).toBe('final-judging');
    const themeIndex = room.getState().game!.finalThemeIndex!;
    const expectedAnswer = FINAL_PACK.final!.themes[themeIndex].question.answer;

    expect(room.toGameStateView(host)?.finalCorrectAnswer).toEqual({
      text: expectedAnswer,
      comment: undefined,
    });
    expect(room.toGameStateView(picker)?.finalCorrectAnswer).toBeNull();
    expect(room.toGameStateView(other)?.finalCorrectAnswer).toBeNull();

    room.finalVote(host, picker, true);
    room.finalVote(host, other, true);
    expect(room.getState().game?.phase).toBe('final-reveal');

    expect(room.toGameStateView(picker)?.finalCorrectAnswer).toEqual({
      text: expectedAnswer,
      comment: undefined,
    });
    expect(room.toGameStateView(other)?.finalCorrectAnswer).toEqual({
      text: expectedAnswer,
      comment: undefined,
    });
    expect(room.toGameStateView(null)?.finalCorrectAnswer).toEqual({
      text: expectedAnswer,
      comment: undefined,
    });

    vi.useRealTimers();
  });

  it('restores the final-elim timer after restoring from a snapshot mid-final', () => {
    vi.useFakeTimers();
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [a, b, host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame();
    const picker = room.getState().game?.turnCounterId === a ? a : b;
    const other = picker === a ? b : a;
    room.selectQuestion(picker, 0, 'q1');
    room.buzz(picker);
    room.saidAnswer(picker);
    room.vote(host, true);
    vi.advanceTimersByTime(REVEAL_TIMER_MS);
    const snapshot = room.getState();
    expect(snapshot.game?.phase).toBe('final-elim');

    const restored = new Room(snapshot, FINAL_PACK);
    // Сработает только если таймер/фаза восстановлены штатно — other ходит
    // первым (счёт 0 против picker'а 100).
    restored.eliminateFinalTheme(other, 0);
    expect(restored.getState().game?.phase).toBe('final-wager');

    vi.useRealTimers();
  });
});
