import { mkdtemp, rm } from 'node:fs/promises';
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
});
