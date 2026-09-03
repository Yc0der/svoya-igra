import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './atomicWrite.js';
import {
  listPlayers,
  parsePlayerSection,
  removePlayerSection,
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
 * Атомарная запись — через общий writeFileAtomic (atomicWrite.ts), тот же
 * приём, что в generatorProfile.ts, snapshot.ts и packs.ts.
 */
export async function savePlayerCard(
  playersPath: string,
  card: PlayerCard,
  date: string,
  // Имя, под которым анкета лежит в файле сейчас: при переименовании оно не
  // совпадает с card.name. По нему находятся ручные строки старого раздела —
  // они переезжают в новый, а не пропадают от того, что ведущий нажал
  // «Сохранить» (спека анкет, «Правка — форма, а не сырой markdown»).
  keepNotesFrom: string = card.name,
): Promise<void> {
  const current = await readFile(playersPath, 'utf8');
  const previous = parsePlayerSection(current, keepNotesFrom);
  const updated = upsertPlayerSection(
    current,
    card,
    date,
    previous?.extraLines ?? [],
  );
  // Ведущий может вставить один и тот же код дважды — тогда менять нечего и
  // трогать файл незачем.
  if (updated === current) return;
  await writeFileAtomic(playersPath, updated);
}

/**
 * Кладёт раздел «Показывает в игре» в docs/players.md — заменяет старый или
 * дописывает в конец. Тот же приём, что у savePlayerCard: атомарная запись
 * через writeFileAtomic, и на диск ничего не пишется, если пересчёт дал тот же
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
  await writeFileAtomic(playersPath, updated);
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

/**
 * Анкета игрока так, как она лежит в файле, — этим форма правки в /admin
 * заполняет свои поля. Отсутствие файла и отсутствие раздела — одинаково не
 * ошибка: анкету могли удалить с другого устройства, пока ведущий смотрел на
 * список, и валиться на этом нечестно.
 */
export async function readPlayerCard(
  playersPath: string,
  name: string,
): Promise<{ card: PlayerCard; extraLines: string[] } | null> {
  try {
    return parsePlayerSection(await readFile(playersPath, 'utf8'), name);
  } catch {
    return null;
  }
}

/**
 * Убирает анкету из файла. false — удалять было нечего: раздела с таким
 * именем в файле нет. Диск в этом случае не трогается вовсе, тем же приёмом,
 * что и в savePlayerCard: писать файл, чтобы записать в него то же самое, —
 * лишний повод потерять его при сбое.
 */
export async function deletePlayerCard(
  playersPath: string,
  name: string,
): Promise<boolean> {
  const current = await readFile(playersPath, 'utf8');
  const updated = removePlayerSection(current, name);
  if (updated === current) return false;
  await writeFileAtomic(playersPath, updated);
  return true;
}
