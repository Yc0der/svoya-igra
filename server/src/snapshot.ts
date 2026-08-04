import { readFile, rename, writeFile } from 'node:fs/promises';
import type { RoomState } from './room.js';

export function serializeSnapshot(state: RoomState): string {
  return JSON.stringify(state);
}

export function deserializeSnapshot(json: string): RoomState {
  const parsed = JSON.parse(json) as Partial<RoomState>;
  return {
    // `participants` — обязательное поле с самого начала: снапшот без него
    // не является валидным состоянием комнаты, и `.map` на `undefined`
    // должен бросить, а не тихо превращаться в пустое лобби (см. тест
    // 'throws on well-formed JSON that is not a room state').
    // `game` появился позже (Task 4/5), поэтому старые снапшоты на диске
    // его не содержат — для них по умолчанию `null` (без активной игры).
    participants: parsed.participants!.map((p) => ({
      ...p,
      connected: false,
    })),
    game: parsed.game ?? null,
  };
}

export async function writeSnapshot(
  path: string,
  state: RoomState,
): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, serializeSnapshot(state), 'utf8');
  await rename(tmpPath, path);
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
