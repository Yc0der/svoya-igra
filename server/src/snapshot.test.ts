import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deserializeSnapshot,
  readSnapshot,
  serializeSnapshot,
  writeSnapshot,
} from './snapshot.js';
import { Room, type RoomState } from './room.js';
import { createInitialState } from './engine.js';
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
            { id: 'q1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
          ],
        },
      ],
    },
  ],
};

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

describe('serializeSnapshot / deserializeSnapshot', () => {
  it('round-trips a room state, forcing all participants to disconnected', () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: false },
      ],
      game: null,
      hostParticipantId: null,
    };

    const restored = deserializeSnapshot(serializeSnapshot(state));

    expect(restored).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
        { id: '2', name: 'Катя', token: 'tok-2', connected: false },
      ],
      game: null,
      hostParticipantId: null,
    });
  });
});

describe('writeSnapshot / readSnapshot', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-snapshot-'));
    path = join(dir, 'room-snapshot.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist yet', async () => {
    const result = await readSnapshot(path);
    expect(result).toBeNull();
  });

  it('writes and reads back the same state', async () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
      ],
      game: null,
      hostParticipantId: null,
    };

    await writeSnapshot(path, state);
    const result = await readSnapshot(path);

    expect(result).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
      game: null,
      hostParticipantId: null,
    });
  });

  // Документирует ровно тот отказ, ради которого в `index.ts` появился
  // try/catch вокруг загрузки снапшота: битый файл — не ENOENT, поэтому
  // `readSnapshot` пробрасывает исключение, а не возвращает null. Получить
  // такой файл легко: `writeSnapshot` пишет одним `writeFile`, и Ctrl+C
  // посреди записи обрезает JSON на середине.
  it('throws on a truncated file instead of silently returning null', async () => {
    await writeFile(path, '{"participants":[{"id":"1","na', 'utf8');
    await expect(readSnapshot(path)).rejects.toThrow();
  });

  it('throws on well-formed JSON that is not a room state', async () => {
    await writeFile(path, '{"not-participants":[]}', 'utf8');
    await expect(readSnapshot(path)).rejects.toThrow(TypeError);
  });

  // Регрессия: `writeSnapshot` раньше писала одним `writeFile` прямо в
  // целевой путь, так что обрыв записи (Ctrl+C, падение процесса) обрезал
  // сам снапшот на диске. Мок `writeFile` здесь имитирует именно обрыв —
  // на диск попадает не весь JSON, а затем бросается исключение, — и
  // проверяет, что в итоге на целевом пути остался старый, полностью
  // валидный снапшот, а не обрезанный мусор.
  it('does not truncate the existing snapshot when the write is interrupted', async () => {
    const initial: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
      ],
      game: null,
      hostParticipantId: null,
    };
    await writeSnapshot(path, initial);

    const { writeFile: actualWriteFile } =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    vi.mocked(writeFile).mockImplementationOnce(async (target, data) => {
      await actualWriteFile(target as string, String(data).slice(0, 5), 'utf8');
      throw new Error('simulated crash mid-write');
    });

    const next: RoomState = {
      participants: [
        { id: '2', name: 'Катя', token: 'tok-2', connected: true },
      ],
      game: null,
      hostParticipantId: null,
    };
    await expect(writeSnapshot(path, next)).rejects.toThrow(
      'simulated crash mid-write',
    );

    const result = await readSnapshot(path);
    expect(result).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
      game: null,
      hostParticipantId: null,
    });
  });
});

describe('serializeSnapshot / deserializeSnapshot with game state', () => {
  it('round-trips a null game unchanged', () => {
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
      ],
      game: null,
      hostParticipantId: null,
    };
    expect(deserializeSnapshot(serializeSnapshot(state))).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
      game: null,
      hostParticipantId: null,
    });
  });

  it('round-trips an in-progress game exactly', () => {
    const game = createInitialState(TEST_PACK, ['1', '2']);
    const state: RoomState = {
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: true },
      ],
      game,
      hostParticipantId: null,
    };
    const restored = deserializeSnapshot(serializeSnapshot(state));
    expect(restored.game).toEqual(game);
  });

  it('treats a snapshot written before this feature (no game field) as lobby-only', () => {
    const restored = deserializeSnapshot(
      JSON.stringify({
        participants: [
          { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        ],
      }),
    );
    expect(restored.game).toBeNull();
  });

  // Регрессия (I4, финальное ревью 2026-08-05): снапшот, записанный сервером
  // ДО появления финала, содержит `game`, но без шести финальных полей
  // (finalRemainingThemeIndices/finalElimCounterId/finalThemeIndex/
  // finalWagers/finalAnswers/finalVerdicts) — их тогда ещё не существовало.
  // Без миграции toGameStateView() падает на Object.entries(undefined) уже
  // на первой рассылке состояния после restart.
  it('migrates a pre-final-round snapshot (game missing the six final fields) to safe defaults and does not crash toGameStateView', () => {
    const game = createInitialState(TEST_PACK, ['1', '2']);
    const preFinal = { ...game } as Record<string, unknown>;
    delete preFinal.finalRemainingThemeIndices;
    delete preFinal.finalElimCounterId;
    delete preFinal.finalThemeIndex;
    delete preFinal.finalWagers;
    delete preFinal.finalAnswers;
    delete preFinal.finalVerdicts;

    const rawJson = JSON.stringify({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: true },
      ],
      game: preFinal,
      hostParticipantId: null,
    });

    const restored = deserializeSnapshot(rawJson);
    expect(restored.game).toMatchObject({
      finalRemainingThemeIndices: null,
      finalElimCounterId: null,
      finalThemeIndex: null,
      finalWagers: {},
      finalAnswers: {},
      finalVerdicts: {},
    });

    const room = new Room(restored, TEST_PACK);
    expect(() => room.toGameStateView()).not.toThrow();
  });

  // Регрессия (финальное ревью, 2026-08-12): снапшот, записанный ДО появления
  // «кота в мешке», содержит `game`, но без `catRecipientCounterId` — тогда
  // этого поля ещё не существовало. Без дефолта поле остаётся `undefined`, а
  // `handleBuzz` в engine.ts сравнивает его с `null` — `undefined !== null`
  // истинно, так что первый же вопрос после рестарта с такого снапшота молча
  // отклоняет buzz от всех игроков.
  it('migrates a pre-cat-in-bag snapshot (game missing catRecipientCounterId) to null', () => {
    const game = createInitialState(TEST_PACK, ['1', '2']);
    const preCat = { ...game } as Record<string, unknown>;
    delete preCat.catRecipientCounterId;

    const rawJson = JSON.stringify({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: true },
        { id: '2', name: 'Катя', token: 'tok-2', connected: true },
      ],
      game: preCat,
      hostParticipantId: null,
    });

    const restored = deserializeSnapshot(rawJson);
    expect(restored.game).toMatchObject({ catRecipientCounterId: null });
  });
});
