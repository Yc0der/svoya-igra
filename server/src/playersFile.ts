import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  listPlayers,
  upsertPlayerSection,
  type PlayerCard,
} from './playerCard.js';
import type { PlayerStats } from './history.js';
import { renderPlayerStats, spliceStatsSection } from './playerStats.js';

/**
 * Кладёт анкету в docs/players.md — новую дописывает, существующую заменяет.
 * Дата приходит параметром: обращение к часам живёт в вызывающем коде
 * (server.ts), как уже сделано для жалоб в generatorProfile.ts.
 *
 * Атомарная запись через temp + rename — тот же приём, что в
 * generatorProfile.ts, snapshot.ts и packs.ts.
 */
export async function savePlayerCard(
  playersPath: string,
  card: PlayerCard,
  date: string,
): Promise<void> {
  const current = await readFile(playersPath, 'utf8');
  const updated = upsertPlayerSection(current, card, date);
  // Ведущий может вставить один и тот же код дважды — тогда менять нечего и
  // трогать файл незачем.
  if (updated === current) return;
  const tmpPath = `${playersPath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, playersPath);
}

/**
 * Кладёт раздел «Показывает в игре» в docs/players.md — заменяет старый или
 * дописывает в конец. Тот же приём, что у savePlayerCard: атомарная запись
 * через temp + rename, и на диск ничего не пишется, если пересчёт дал тот же
 * текст — сервер вызывает эту функцию на каждый переход партии в game-end, и
 * без проверки файл переписывался бы даже когда в нём нечего менять.
 */
export async function savePlayerStats(
  playersPath: string,
  stats: PlayerStats,
): Promise<void> {
  const current = await readFile(playersPath, 'utf8');
  const updated = spliceStatsSection(current, renderPlayerStats(stats));
  if (updated === current) return;
  const tmpPath = `${playersPath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, playersPath);
}

/**
 * Список заведённых игроков. Отсутствие файла — не ошибка: анкет может ещё
 * не быть вовсе, и админка обязана открываться и в этом случае.
 */
export async function readPlayerList(
  playersPath: string,
): Promise<{ name: string; date: string }[]> {
  try {
    return listPlayers(await readFile(playersPath, 'utf8'));
  } catch {
    return [];
  }
}
