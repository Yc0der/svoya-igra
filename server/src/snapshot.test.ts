import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deserializeSnapshot,
  readSnapshot,
  serializeSnapshot,
  writeSnapshot,
} from './snapshot.js';
import type { RoomState } from './room.js';

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
});
