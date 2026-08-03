import { readFile, writeFile } from 'node:fs/promises';
import type { RoomState } from './room.js';

export function serializeSnapshot(state: RoomState): string {
  return JSON.stringify(state);
}

export function deserializeSnapshot(json: string): RoomState {
  const parsed = JSON.parse(json) as RoomState;
  return {
    participants: parsed.participants.map((p) => ({ ...p, connected: false })),
  };
}

export async function writeSnapshot(
  path: string,
  state: RoomState,
): Promise<void> {
  await writeFile(path, serializeSnapshot(state), 'utf8');
}

export async function readSnapshot(path: string): Promise<RoomState | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return deserializeSnapshot(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}
