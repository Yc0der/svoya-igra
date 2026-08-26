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
      // Человек у участника (2026-08-26-player-identity) появился позже —
      // снапшоты, записанные до него, этого поля не содержат вовсе.
      personId: p.personId ?? null,
    })),
    game: parsed.game
      ? {
          ...parsed.game,
          // Финал (2026-08-05) появился позже — снапшоты, записанные до
          // него, не содержат этих полей вовсе. Без дефолтов
          // toGameStateView() падает на Object.entries(undefined) уже на
          // первой рассылке состояния.
          finalRemainingThemeIndices:
            parsed.game.finalRemainingThemeIndices ?? null,
          finalElimCounterId: parsed.game.finalElimCounterId ?? null,
          finalThemeIndex: parsed.game.finalThemeIndex ?? null,
          finalWagers: parsed.game.finalWagers ?? {},
          finalAnswers: parsed.game.finalAnswers ?? {},
          finalVerdicts: parsed.game.finalVerdicts ?? {},
          // "Кот в мешке" (2026-08-12) появился позже — снапшоты, записанные
          // до него, не содержат этого поля вовсе.
          exclusiveAnswererCounterId:
            parsed.game.exclusiveAnswererCounterId ?? null,
          // "Вопрос-аукцион" (веха 5) появился позже — снапшоты, записанные
          // до него, не содержат этих пяти полей вовсе.
          auctionOrder: parsed.game.auctionOrder ?? null,
          auctionTurnCounterId: parsed.game.auctionTurnCounterId ?? null,
          auctionPassedCounterIds: parsed.game.auctionPassedCounterIds ?? [],
          auctionHighestBid: parsed.game.auctionHighestBid ?? 0,
          auctionHighestBidderCounterId:
            parsed.game.auctionHighestBidderCounterId ?? null,
        }
      : null,
    // Тот же паттерн, что у `game` строкой выше: снапшоты, записанные до
    // появления ведущего, этого поля не содержат — по умолчанию его нет.
    hostParticipantId: parsed.hostParticipantId ?? null,
    // История партий (2026-08-20) появилась позже — снапшоты, записанные до
    // неё, этого поля не содержат.
    historyGameId: parsed.historyGameId ?? null,
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
