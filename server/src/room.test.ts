import { describe, expect, it, vi } from 'vitest';
import { Room, type PackInfo } from './room.js';
import { deserializeSnapshot, serializeSnapshot } from './snapshot.js';
import {
  QUESTION_TIMER_MS,
  REVEAL_TIMER_MS,
  CAT_HANDOFF_TIMER_MS,
  AUCTION_BID_TIMER_MS,
} from './engine.js';

// Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — кандидаты и
// текущий адрес не часть RoomState (см. room.ts, LanInfo), поэтому и
// проверяются отдельно от снапшот-теста ниже.
describe('Room.getLanInfo / setLanAddress / onLanChange', () => {
  it('defaults to no candidates and no address when none is given', () => {
    const room = new Room();
    expect(room.getLanInfo()).toEqual({ candidates: [], address: null });
  });

  it('exposes the candidates and address passed at construction', () => {
    const room = new Room(undefined, undefined, {
      candidates: [{ address: '10.0.0.1', interfaceName: 'eth0' }],
      address: '10.0.0.1',
    });
    expect(room.getLanInfo()).toEqual({
      candidates: [{ address: '10.0.0.1', interfaceName: 'eth0' }],
      address: '10.0.0.1',
    });
  });

  it('setLanAddress switches to another candidate and notifies onLanChange listeners', () => {
    const room = new Room(undefined, undefined, {
      candidates: [
        { address: '10.0.0.1', interfaceName: 'eth0' },
        { address: '192.168.1.5', interfaceName: 'wifi0' },
      ],
      address: '10.0.0.1',
    });
    const seen: (string | null)[] = [];
    room.onLanChange((address) => seen.push(address));

    room.setLanAddress('192.168.1.5');

    expect(room.getLanInfo().address).toBe('192.168.1.5');
    expect(seen).toEqual(['192.168.1.5']);
  });

  it('ignores an address that is not among the known candidates', () => {
    const room = new Room(undefined, undefined, {
      candidates: [{ address: '10.0.0.1', interfaceName: 'eth0' }],
      address: '10.0.0.1',
    });
    const seen: (string | null)[] = [];
    room.onLanChange((address) => seen.push(address));

    room.setLanAddress('9.9.9.9');

    expect(room.getLanInfo().address).toBe('10.0.0.1');
    expect(seen).toEqual([]);
  });
});

describe('Room.getPackInfo / refreshAvailablePacks / selectPack / onPackChange', () => {
  const PACK_A = {
    title: 'Пак А',
    author: 'Автор',
    createdAt: '2026-08-04',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'a1',
                price: 100,
                text: 'В?',
                answer: 'О',
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };
  const PACK_B = {
    ...PACK_A,
    title: 'Пак Б',
    rounds: [
      {
        themes: [
          {
            name: 'Тема',
            questions: [
              {
                id: 'b1',
                price: 100,
                text: 'В2?',
                answer: 'О2',
                type: 'обычный' as const,
              },
            ],
          },
        ],
      },
    ],
  };

  it('defaults to no available packs and no active filename', () => {
    const room = new Room();
    expect(room.getPackInfo()).toEqual({ available: [], activeFilename: null });
  });

  it('exposes the initial pack filename passed at construction', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('refreshAvailablePacks (admin, requesterId null) updates the list and notifies', () => {
    const room = new Room();
    const seen: PackInfo[] = [];
    room.onPackChange((info) => seen.push(info));

    room.refreshAvailablePacks(null, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toEqual([
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);
    expect(seen).toHaveLength(1);
  });

  it('refreshAvailablePacks from the host (matching hostParticipantId) succeeds', () => {
    const room = new Room();
    room.join('Ваня');
    const hostId = room.getState().participants[0].id;
    room.toggleHost(hostId);

    room.refreshAvailablePacks(hostId, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toHaveLength(1);
  });

  it('refreshAvailablePacks from a non-host participant is a silent no-op', () => {
    const room = new Room();
    room.join('Ваня');
    const other = room.join('Катя');
    const otherId = (other as { participant: { id: string } }).participant.id;

    room.refreshAvailablePacks(otherId, [
      { filename: 'a.json', title: 'Пак А', description: null },
    ]);

    expect(room.getPackInfo().available).toEqual([]);
  });

  it('selectPack switches the active pack and notifies onPackChange', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.refreshAvailablePacks(null, [
      { filename: 'a.json', title: 'Пак А', description: null },
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);
    const seen: PackInfo[] = [];
    room.onPackChange((info) => seen.push(info));

    const result = room.selectPack(null, 'b.json', PACK_B);

    expect(result).toEqual({ ok: true });
    expect(room.getPackInfo().activeFilename).toBe('b.json');
    expect(seen).toHaveLength(1);
  });

  it('selectPack from the host (matching hostParticipantId) succeeds', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.join('Ваня');
    const hostId = room.getState().participants[0].id;
    room.toggleHost(hostId);
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);

    const result = room.selectPack(hostId, 'b.json', PACK_B);

    expect(result).toEqual({ ok: true });
    expect(room.getPackInfo().activeFilename).toBe('b.json');
  });

  it('selectPack from a non-host participant is a silent no-op returning not-host', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.join('Ваня');
    const other = room.join('Катя');
    const otherId = (other as { participant: { id: string } }).participant.id;
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);

    const result = room.selectPack(otherId, 'b.json', PACK_B);

    expect(result).toEqual({ error: 'not-host' });
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('selectPack with a filename not in the known list returns unknown-file', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');

    const result = room.selectPack(null, 'ghost.json', PACK_B);

    expect(result).toEqual({ error: 'unknown-file' });
    expect(room.getPackInfo().activeFilename).toBe('a.json');
  });

  it('selecting a pack makes it the pack used by the next startGame()', () => {
    const room = new Room(undefined, PACK_A, undefined, 'a.json');
    room.refreshAvailablePacks(null, [
      { filename: 'b.json', title: 'Пак Б', description: null },
    ]);
    room.selectPack(null, 'b.json', PACK_B);
    room.join('Ваня');
    room.join('Катя');

    room.startGame(null);

    expect(room.getState().game?.pack.title).toBe('Пак Б');
  });
});

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

const CAT_PACK: Pack = {
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
              id: 'cat1',
              price: 100,
              text: 'Вопрос-кот?',
              answer: 'ответ кота',
              type: 'кот',
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

const AUCTION_PACK: Pack = {
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
              id: 'auc1',
              price: 100,
              text: 'Вопрос-аукцион?',
              answer: 'ответ аукциона',
              type: 'аукцион',
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

function joinedId(room: Room, name: string): string {
  const result = room.join(name);
  if (!('participant' in result)) throw new Error('expected join to succeed');
  return result.participant.id;
}

describe('Room.startGame', () => {
  it('fails with not-enough-players when fewer than two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    expect(room.startGame('requester')).toEqual({
      error: 'not-enough-players',
    });
  });

  it('fails with no-pack when the room was built without one', () => {
    const room = new Room();
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    expect(room.startGame('requester')).toEqual({ error: 'no-pack' });
  });

  it('starts the game and exposes a game state view once two have joined', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');

    expect(room.startGame('requester')).toEqual({ ok: true });

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
    expect(room.startGame('requester')).toEqual({
      error: 'not-enough-players',
    });

    const petya = joinedId(room, 'Петя');
    expect(room.startGame('requester')).toEqual({ ok: true });

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
    room.startGame('requester');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects starting a new game while one is already in progress, leaving the existing game untouched', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame('requester');
    const before = room.toGameStateView();
    // Any phase other than 'game-end' counts as "in progress" — 'selecting'
    // right after start is enough to exercise the guard.
    expect(before?.phase).toBe('selecting');

    expect(room.startGame('requester')).toEqual({ error: 'game-in-progress' });
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
    room.startGame('requester');
    const picker = room.toGameStateView()!.turnParticipantId;

    vi.useFakeTimers();
    try {
      room.selectQuestion(picker, 0, 'q1');
      const before = room.toGameStateView();
      expect(before?.phase).toBe('question-open');
      expect(before?.timerDeadline).not.toBeNull();

      expect(room.startGame('requester')).toEqual({
        error: 'game-in-progress',
      });

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
    expect(room.startGame('requester')).toEqual({ error: 'host-required' });
  });

  it('starts with a host once someone is marked host, excluding the host from counters and scores', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);

    expect(room.startGame(petya)).toEqual({ ok: true });

    const view = room.toGameStateView(petya);
    expect(view?.scores.map((s) => s.participantId).sort()).toEqual(
      [vanya, katya].sort(),
    );
    expect(view?.turnParticipantId).not.toBe(petya);
  });

  it('rejects a start attempt from someone other than the marked host, leaving the lobby untouched', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.toggleHost(katya);

    expect(room.startGame(vanya)).toEqual({ error: 'host-only' });
    expect(room.getState().game).toBeNull();
  });

  it('null requesterId bypasses the host-only check — admin-panel start (design.md, «Админ-панель»)', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);

    expect(room.startGame(null)).toEqual({ ok: true });
  });

  it('ignores a stale host marking for someone who disconnected before start', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    joinedId(room, 'Петя');
    const dasha = joinedId(room, 'Даша');
    room.toggleHost(dasha);
    room.disconnect(dasha);

    expect(room.startGame('requester')).toEqual({ error: 'host-required' });
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
    room.startGame(petya);
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
    open.startGame('requester');
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
    hosted.startGame(p2);
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
      room.startGame(petya);
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
      room.startGame(petya);
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
      room.startGame(petya);
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

  it('proactively notifies listeners the moment the 5s block expires, not only lazily on the next unrelated broadcast', () => {
    // Regression (живая проверка 2026-08-06): toGameStateView() честно
    // пересчитывает graceExcludedParticipantId по Date.now(), но без
    // настоящего таймера здесь клиент узнаёт об этом только со СЛЕДУЮЩЕЙ
    // рассылкой — а если после исключения больше ничего не происходит
    // (никто больше не жмёт), рассылки не будет вообще, и кнопка «Ответ» у
    // исключённого остаётся задизейбленной вечно, хотя счётчик на экране уже
    // показывает 0с.
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      const petya = joinedId(room, 'Петя');
      room.toggleHost(petya);
      room.startGame(petya);
      const picker = room.toGameStateView(petya)!.turnParticipantId;
      const answerer = picker === vanya ? vanya : katya;

      room.selectQuestion(picker, 0, 'q1');
      room.buzz(answerer);
      room.saidAnswer(answerer);
      room.vote(petya, false);

      const listener = vi.fn();
      room.onChange(listener);
      // Единственное, что происходит между исключением и проверкой —
      // течение времени. Никакого нового события от игроков.
      vi.advanceTimersByTime(5_000); // GRACE_EXCLUSION_MS

      expect(listener).toHaveBeenCalledOnce();
      const notifiedState = listener.mock.calls[0][0];
      expect(notifiedState.game.phase).toBe('question-open'); // партия не сломалась заодно
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending grace-exclusion timer instead of letting it later clear the NEXT one, when a second wrong answer excludes someone else first', () => {
    // Regression guard: graceExcludedCounterId/Until are scalar (one per
    // room, not per game/participant) — an unclosed earlier setTimeout would
    // eventually fire and null out whoever is excluded NOW, even though it
    // was scheduled for someone else's exclusion window.
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      const petya = joinedId(room, 'Петя');
      room.toggleHost(petya);
      room.startGame(petya);
      const picker = room.toGameStateView(petya)!.turnParticipantId;
      const first = picker === vanya ? vanya : katya;
      const second = first === vanya ? katya : vanya;

      room.selectQuestion(picker, 0, 'q1');
      room.buzz(first);
      room.saidAnswer(first);
      room.vote(petya, false); // excludes `first`, schedules a 5s timer for them

      vi.advanceTimersByTime(3_000); // partway through `first`'s exclusion window
      room.buzz(second);
      room.saidAnswer(second);
      room.vote(petya, false); // excludes `second` instead, should cancel first's timer
      expect(room.toGameStateView(petya)?.graceExcludedParticipantId).toBe(
        second,
      );

      // If `first`'s stale timer (due 2s from here) weren't cancelled, it
      // would fire now and null out `second`'s still-active exclusion.
      vi.advanceTimersByTime(2_000);
      expect(room.toGameStateView(petya)?.graceExcludedParticipantId).toBe(
        second,
      );
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
      room.startGame(petya);
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
    room.startGame('requester');
    const picker = room.toGameStateView()!.turnParticipantId;

    vi.useFakeTimers();
    try {
      room.selectQuestion(picker, 0, 'q1');
      vi.advanceTimersByTime(QUESTION_TIMER_MS); // question timer -> reveal
      vi.advanceTimersByTime(4_000); // reveal timer -> game-end (only round, only question)
      expect(room.toGameStateView()?.phase).toBe('game-end');

      expect(room.startGame('requester')).toEqual({ ok: true });
      const view = room.toGameStateView();
      expect(view?.phase).toBe('selecting');
      expect([vanya, katya]).toContain(view?.turnParticipantId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Room.resetGame', () => {
  it('clears an in-progress game back to an empty lobby', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame(vanya);
    expect(room.getState().game).not.toBeNull();

    room.resetGame(vanya);
    expect(room.getState().game).toBeNull();
  });

  it('notifies listeners on reset', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame(vanya);
    const listener = vi.fn();
    room.onChange(listener);

    room.resetGame(vanya);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does nothing when there is no game to reset', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const listener = vi.fn();
    room.onChange(listener);

    room.resetGame(vanya);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is restricted to the marked host, same as startGame', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame(petya);

    room.resetGame(vanya); // не ведущий — игнорируется
    expect(room.getState().game).not.toBeNull();

    room.resetGame(petya);
    expect(room.getState().game).toBeNull();
  });

  it('null requesterId bypasses the host-only check — admin-panel reset (design.md, «Админ-панель»)', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame(petya);

    room.resetGame(null);
    expect(room.getState().game).toBeNull();
  });

  it('lets a fresh game be started again after a reset', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame(vanya);

    room.resetGame(vanya);
    expect(room.startGame(vanya)).toEqual({ ok: true });
  });

  it('kills any live timer of the reset game so it cannot resurrect it', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      joinedId(room, 'Катя');
      room.startGame(vanya);
      const picker = room.toGameStateView()!.turnParticipantId;
      room.selectQuestion(picker, 0, 'q1'); // взводит таймер вопроса

      room.resetGame(vanya);
      expect(room.getState().game).toBeNull();

      vi.advanceTimersByTime(QUESTION_TIMER_MS);
      expect(room.getState().game).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('kills a pending grace-exclusion timer too, so it cannot fire against the NEXT game', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      const katya = joinedId(room, 'Катя');
      room.startGame(vanya);
      const picker = room.toGameStateView()!.turnParticipantId;
      const answerer = picker === vanya ? vanya : katya;
      const other = answerer === vanya ? katya : vanya;

      room.selectQuestion(picker, 0, 'q1');
      room.buzz(answerer);
      room.saidAnswer(answerer);
      room.vote(other, false); // excludes `answerer`, schedules a 5s timer

      room.resetGame(vanya);
      const listener = vi.fn();
      room.onChange(listener);

      // If the old timer weren't cancelled, it would fire here and call
      // notify() against a room that has moved on entirely.
      vi.advanceTimersByTime(5_000);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Три метода ниже — только для админ-панели (design.md, «Админ-панель»):
// никакой авторизации по личности вызывающего у них нет вообще, в отличие
// от startGame/resetGame выше. Они существуют именно на случай, когда
// обычная авторизация зашла в тупик (осиротевший ведущий, мусорные
// участники), поэтому её здесь и не проверяют.
describe('Room.resetRoom', () => {
  it('wipes participants, host and game back to a genuinely empty room', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame(vanya);
    expect(room.getState().game).not.toBeNull();

    room.resetRoom();

    expect(room.getState()).toEqual({
      participants: [],
      hostParticipantId: null,
      game: null,
    });
  });

  it('notifies listeners even when the room was already empty', () => {
    const room = new Room(undefined, TEST_PACK);
    const listener = vi.fn();
    room.onChange(listener);

    room.resetRoom();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('kills any live timer so a wiped game cannot resurrect', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, TEST_PACK);
      const vanya = joinedId(room, 'Ваня');
      joinedId(room, 'Катя');
      room.startGame(vanya);
      const picker = room.toGameStateView()!.turnParticipantId;
      room.selectQuestion(picker, 0, 'q1');

      room.resetRoom();
      vi.advanceTimersByTime(QUESTION_TIMER_MS);

      expect(room.getState().game).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a brand new game be started with newly joined participants afterwards', () => {
    const room = new Room(undefined, TEST_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.resetRoom();

    const vanya2 = joinedId(room, 'Ваня');
    const katya2 = joinedId(room, 'Катя');
    expect(room.startGame(vanya2)).toEqual({ ok: true });
    expect([vanya2, katya2]).toContain(
      room.toGameStateView()!.turnParticipantId,
    );
  });
});

describe('Room.kickParticipant', () => {
  it('removes the participant from the room entirely, not just marking them disconnected', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');

    expect(room.kickParticipant(vanya)).toBe('ok');
    expect(room.getState().participants.map((p) => p.id)).not.toContain(vanya);
  });

  it('reports not-found for an unknown id and leaves the room untouched', () => {
    const room = new Room();
    joinedId(room, 'Ваня');
    const listener = vi.fn();
    room.onChange(listener);

    expect(room.kickParticipant('unknown-id')).toBe('not-found');
    expect(listener).not.toHaveBeenCalled();
  });

  it('invalidates their reconnect token — kicked means gone, not disconnected', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');
    const joined = room.getState().participants[0];
    room.kickParticipant(vanya);

    expect(room.reconnect(joined.token)).toEqual({ error: 'invalid-token' });
  });

  it('clears the lobby host flag when the kicked participant was marked host', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.toggleHost(vanya);

    room.kickParticipant(vanya);
    expect(room.getState().hostParticipantId).toBeNull();
  });

  it('leaves an unrelated bystander kick without touching an in-progress game', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame(vanya);
    const bystander = joinedId(room, 'Опоздавший'); // joined after start, never a counter

    room.kickParticipant(bystander);

    expect(room.getState().game).not.toBeNull();
    expect(room.getState().participants.map((p) => p.id)).toEqual(
      expect.arrayContaining([vanya, katya]),
    );
  });

  it('resets the game when kicking a counter who is actually part of it, rather than leaving dangling references', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame(vanya);
    expect(room.getState().game).not.toBeNull();

    room.kickParticipant(katya);

    expect(room.getState().game).toBeNull();
    expect(room.getState().participants.map((p) => p.id)).toEqual([vanya]);
  });

  it('resets the game when kicking the frozen game host', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame(petya);
    expect(room.getState().game).not.toBeNull();

    room.kickParticipant(petya);

    expect(room.getState().game).toBeNull();
    expect(room.getState().participants.map((p) => p.id)).toEqual([
      vanya,
      katya,
    ]);
  });
});

describe('Room.setHost', () => {
  it('assigns the host flag directly, without needing the target to click anything themselves', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');

    expect(room.setHost(vanya)).toBe('ok');
    expect(room.getState().hostParticipantId).toBe(vanya);
  });

  it('clears the host flag when given null', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');
    room.setHost(vanya);

    expect(room.setHost(null)).toBe('ok');
    expect(room.getState().hostParticipantId).toBeNull();
  });

  it('reports not-found for an unknown id and leaves the host flag untouched', () => {
    const room = new Room();
    const vanya = joinedId(room, 'Ваня');
    room.setHost(vanya);

    expect(room.setHost('unknown-id')).toBe('not-found');
    expect(room.getState().hostParticipantId).toBe(vanya);
  });

  it('works even while a game is in progress — unlike toggleHost, which is locked out then', () => {
    const room = new Room(undefined, TEST_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame(vanya);
    expect(room.getState().game?.phase).toBe('selecting');

    expect(room.setHost(katya)).toBe('ok');
    expect(room.getState().hostParticipantId).toBe(katya);
    // Замороженный ведущий уже идущей партии не меняется задним числом —
    // это влияет только на СЛЕДУЮЩИЙ запуск.
    expect(room.getState().game?.hostId).toBeNull();
  });
});

function startedRoom(): { room: Room; picker: string; other: string } {
  const room = new Room(undefined, TEST_PACK);
  const vanya = joinedId(room, 'Ваня');
  const katya = joinedId(room, 'Катя');
  room.startGame('requester');
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
      themeName: 'Тема',
      image: null,
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

  it('exposes the media URL for a question with an image, built from the active pack filename', () => {
    const packWithImage: Pack = {
      ...TEST_PACK,
      rounds: [
        {
          themes: [
            {
              name: 'Тема',
              questions: [
                {
                  ...TEST_PACK.rounds[0].themes[0].questions[0],
                  image: 'photo.jpg',
                },
                TEST_PACK.rounds[0].themes[0].questions[1],
              ],
            },
          ],
        },
      ],
    };
    const room = new Room(undefined, packWithImage, undefined, 'sport.json');
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame('requester');
    const picker = room.toGameStateView()!.turnParticipantId;
    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.currentQuestion?.image).toBe(
      '/media/sport/photo.jpg',
    );
  });

  it('does not build a media URL for a question without an image', () => {
    const { room, picker } = startedRoom();
    room.selectQuestion(picker, 0, 'q1');
    expect(room.toGameStateView()?.currentQuestion?.image).toBeNull();
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
      room.startGame('requester');
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
    first.startGame('requester');
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

describe('Room.skipToFinal', () => {
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  // Только с админ-панели — без параметра, никакой личности отправителя.
  it('forces a transition to the final round, skipping the rest of the current one', () => {
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.join('C');
    const [, , host] = room.getState().participants.map((p) => p.id);
    room.toggleHost(host);
    room.startGame(host);
    expect(room.getState().game?.phase).toBe('selecting');

    room.skipToFinal();

    expect(room.getState().game?.phase).toBe('final-elim');
  });

  it('is a no-op without a host', () => {
    const room = new Room(undefined, FINAL_PACK);
    room.join('A');
    room.join('B');
    room.startGame(null);
    expect(room.getState().game?.phase).toBe('selecting');

    room.skipToFinal();

    expect(room.getState().game?.phase).toBe('selecting');
  });
});

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
    room.startGame(host);
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
    room.startGame(host);
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
    room.startGame(host);
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
    room.startGame(host);
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
    room.startGame(host);
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
    room.startGame(host);
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
    room.startGame(host);
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

describe('Room — вопрос-«кот» (онлайн-проверки)', () => {
  it('rejects selecting a cat question when no one else is online', () => {
    const room = new Room(undefined, CAT_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame('requester');
    const view = room.toGameStateView()!;
    const picker = view.turnParticipantId;
    const other = picker === vanya ? katya : vanya;
    room.disconnect(other);

    const result = room.selectQuestion(picker, 0, 'cat1');

    expect(result).toEqual({ error: 'no-recipient' });
    expect(room.toGameStateView()?.phase).toBe('selecting');
  });

  it('allows selecting a cat question when at least one other participant is online', () => {
    const room = new Room(undefined, CAT_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    room.startGame('requester');
    const view = room.toGameStateView()!;
    const picker = view.turnParticipantId;

    const result = room.selectQuestion(picker, 0, 'cat1');

    expect(result).toEqual({ ok: true });
    expect(room.toGameStateView()?.phase).toBe('cat-handoff');
  });

  it('rejects assignCat to an offline participant', () => {
    const room = new Room(undefined, CAT_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame('requester');
    const view = room.toGameStateView()!;
    const picker = view.turnParticipantId;
    const other = picker === vanya ? katya : vanya;
    room.selectQuestion(picker, 0, 'cat1');
    room.disconnect(other);

    room.assignCat(picker, other);

    expect(room.toGameStateView()?.phase).toBe('cat-handoff');
    expect(room.toGameStateView()?.exclusiveAnswererParticipantId).toBeNull();
  });

  it('allows assignCat to an online participant', () => {
    const room = new Room(undefined, CAT_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame('requester');
    const view = room.toGameStateView()!;
    const picker = view.turnParticipantId;
    const other = picker === vanya ? katya : vanya;
    room.selectQuestion(picker, 0, 'cat1');

    room.assignCat(picker, other);

    expect(room.toGameStateView()?.phase).toBe('question-open');
    expect(room.toGameStateView()?.exclusiveAnswererParticipantId).toBe(other);
  });

  it('hides the question text but shows the price while cat-handoff is in progress, and reveals the text once assigned', () => {
    const room = new Room(undefined, CAT_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    room.startGame('requester');
    const view = room.toGameStateView()!;
    const picker = view.turnParticipantId;
    const other = picker === vanya ? katya : vanya;
    room.selectQuestion(picker, 0, 'cat1');

    expect(room.toGameStateView()?.currentQuestion).toEqual({
      text: null,
      price: 100,
      themeName: 'Тема',
      image: null,
    });

    room.assignCat(picker, other);

    expect(room.toGameStateView()?.currentQuestion).toEqual({
      text: 'Вопрос-кот?',
      price: 100,
      themeName: 'Тема',
      image: null,
    });
  });

  it('re-arms the cat-handoff timer after restoring from a snapshot mid-handoff', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, CAT_PACK);
      joinedId(room, 'Ваня');
      joinedId(room, 'Катя');
      room.startGame('requester');
      const view = room.toGameStateView()!;
      const picker = view.turnParticipantId;
      room.selectQuestion(picker, 0, 'cat1');

      const snapshot = room.getState();
      const restored = new Room(snapshot, CAT_PACK);

      vi.advanceTimersByTime(CAT_HANDOFF_TIMER_MS);
      expect(restored.toGameStateView()?.phase).toBe('question-open');
    } finally {
      vi.useRealTimers();
    }
  });

  // Регрессия (финальное ревью, 2026-08-12): ведущий — participant, но
  // никогда не counter (не входит в game.scores), поэтому одного
  // `connected` для кандидатности недостаточно. Три участника: один
  // ведущий, два счётчика. Отключаем одного из счётчиков (в т.ч., возможно,
  // и самого выбирающего — Room не проверяет онлайн-статус отправителя,
  // только получателя) так, что онлайн остаются ведущий и ровно один
  // счётчик. Раз этот оставшийся счётчик — не сам выбирающий, он валидный
  // получатель, и выбор клетки-«кота» проходит.
  it('allows selecting a cat question when a host and exactly one non-host counter remain online', () => {
    const room = new Room(undefined, CAT_PACK);
    joinedId(room, 'Ваня');
    joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame(petya);
    const picker = room.toGameStateView()!.turnParticipantId!;

    // Отключаем самого выбирающего — остаются онлайн ведущий и второй
    // счётчик (тот, что не `picker`).
    room.disconnect(picker);

    room.selectQuestion(picker, 0, 'cat1');

    expect(room.toGameStateView(petya)?.phase).toBe('cat-handoff');
  });

  // То же построение, но офлайн оба счётчика (и выбирающий, и `other`) —
  // онлайн остаётся только ведущий. До фикса ведущий засчитывался как
  // «есть кому отдать» (participants.some без проверки scores), и выбор
  // молча проходил бы; после фикса ведущий не counter — выбор отклоняется,
  // как будто вообще никого нет онлайн.
  it('rejects selecting a cat question when only the host remains online, even though the host is connected', () => {
    const room = new Room(undefined, CAT_PACK);
    const vanya = joinedId(room, 'Ваня');
    const katya = joinedId(room, 'Катя');
    const petya = joinedId(room, 'Петя');
    room.toggleHost(petya);
    room.startGame(petya);
    const picker = room.toGameStateView()!.turnParticipantId!;
    const other = picker === vanya ? katya : vanya;

    room.disconnect(picker);
    room.disconnect(other);

    const result = room.selectQuestion(picker, 0, 'cat1');

    expect(result).toEqual({ error: 'no-recipient' });
    expect(room.toGameStateView(petya)?.phase).toBe('selecting');
  });
});

describe('Room — вопрос-аукцион', () => {
  it('placeBid and passBid reach the engine and drive the auction to a winner', () => {
    const lobby = new Room(undefined, AUCTION_PACK);
    const vanya = joinedId(lobby, 'Ваня');
    const katya = joinedId(lobby, 'Катя');
    lobby.startGame('requester');

    // Фандим счета через снапшот, прежде чем торговаться — handlePlaceBid
    // отклоняет ставку выше собственного счёта (design.md, «ва-банк» —
    // потолок, не пол), а startGame() всегда начинает с 0 у всех, тем же
    // способом, каким engine.test.ts фандит EngineState.scores напрямую в
    // своих auction-тестах (Task 3, describe('place-bid')/describe('pass-bid')).
    const snapshot = lobby.getState();
    snapshot.game!.scores = { [vanya]: 1000, [katya]: 1000 };
    const room = new Room(snapshot, AUCTION_PACK);

    const picker = room.toGameStateView()!.turnParticipantId;
    const other = picker === vanya ? katya : vanya;

    room.selectQuestion(picker, 0, 'auc1');
    expect(room.toGameStateView()?.phase).toBe('auction-bidding');
    expect(room.toGameStateView()?.auctionTurnParticipantId).toBe(picker);

    room.placeBid(picker, 150);
    expect(room.toGameStateView()?.auctionHighestBid).toBe(150);
    expect(room.toGameStateView()?.auctionHighestBidderParticipantId).toBe(
      picker,
    );
    expect(room.toGameStateView()?.auctionTurnParticipantId).toBe(other);

    room.passBid(other);
    expect(room.toGameStateView()?.phase).toBe('question-open');
    expect(room.toGameStateView()?.exclusiveAnswererParticipantId).toBe(picker);
  });

  // Регрессия (финальное ревью, 2026-08-14): auctionOrder обнуляется в тот
  // же момент, когда победитель определён, и гейт по нему прятал выигрышную
  // сумму от клиентов ровно на время ответа — там, где она и нужна.
  it('keeps the winning bid visible after the auction resolves into question-open', () => {
    const lobby = new Room(undefined, AUCTION_PACK);
    const vanya = joinedId(lobby, 'Ваня');
    const katya = joinedId(lobby, 'Катя');
    lobby.startGame('requester');
    const snapshot = lobby.getState();
    snapshot.game!.scores = { [vanya]: 1000, [katya]: 1000 };
    const room = new Room(snapshot, AUCTION_PACK);
    const picker = room.toGameStateView()!.turnParticipantId;
    const other = picker === vanya ? katya : vanya;

    room.selectQuestion(picker, 0, 'auc1');
    room.placeBid(picker, 350);
    room.passBid(other);

    const view = room.toGameStateView()!;
    expect(view.phase).toBe('question-open');
    expect(view.auctionHighestBid).toBe(350);
    expect(view.auctionHighestBidderParticipantId).toBe(picker);
  });

  it('hides the question text while bidding is in progress and reveals it once the auction resolves', () => {
    const lobby = new Room(undefined, AUCTION_PACK);
    const vanya = joinedId(lobby, 'Ваня');
    const katya = joinedId(lobby, 'Катя');
    lobby.startGame('requester');
    const snapshot = lobby.getState();
    snapshot.game!.scores = { [vanya]: 1000, [katya]: 1000 };
    const room = new Room(snapshot, AUCTION_PACK);
    const picker = room.toGameStateView()!.turnParticipantId;
    const other = picker === vanya ? katya : vanya;

    room.selectQuestion(picker, 0, 'auc1');
    expect(room.toGameStateView()?.phase).toBe('auction-bidding');
    expect(room.toGameStateView()!.currentQuestion!.text).toBeNull();
    expect(room.toGameStateView()?.currentQuestion).toEqual({
      text: null,
      price: 100,
      themeName: 'Тема',
      image: null,
    });

    room.placeBid(picker, 150);
    room.passBid(other);

    expect(room.toGameStateView()?.phase).toBe('question-open');
    expect(room.toGameStateView()!.currentQuestion!.text).toBe(
      'Вопрос-аукцион?',
    );
  });

  it('re-arms the auction-bid timer after restoring from a snapshot mid-auction', () => {
    vi.useFakeTimers();
    try {
      const room = new Room(undefined, AUCTION_PACK);
      joinedId(room, 'Ваня');
      joinedId(room, 'Катя');
      room.startGame('requester');
      const picker = room.toGameStateView()!.turnParticipantId;
      room.selectQuestion(picker, 0, 'auc1');

      const snapshot = room.getState();
      const restored = new Room(snapshot, AUCTION_PACK);

      vi.advanceTimersByTime(AUCTION_BID_TIMER_MS);
      // Авто-пас за того, чей был ход — торги продолжаются со вторым
      // участником, фаза остаётся 'auction-bidding' (двое участников,
      // после одного паса без ставки остаётся один активный, но ставок
      // ещё не было — см. design.md, «Общий переход хода торгов»).
      expect(restored.toGameStateView()?.phase).toBe('auction-bidding');
    } finally {
      vi.useRealTimers();
    }
  });
});
