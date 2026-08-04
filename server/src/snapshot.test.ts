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
import type { RoomState } from './room.js';

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
    };

    const restored = deserializeSnapshot(serializeSnapshot(state));

    expect(restored).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
        { id: '2', name: 'Катя', token: 'tok-2', connected: false },
      ],
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
    };

    await writeSnapshot(path, state);
    const result = await readSnapshot(path);

    expect(result).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
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
    };
    await expect(writeSnapshot(path, next)).rejects.toThrow(
      'simulated crash mid-write',
    );

    const result = await readSnapshot(path);
    expect(result).toEqual({
      participants: [
        { id: '1', name: 'Ваня', token: 'tok-1', connected: false },
      ],
    });
  });
});
