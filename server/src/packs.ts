import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePack } from './pack.js';

export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}

/**
 * Все валидные пакеты в директории `dir` — для списка в интерфейсе (Admin.tsx, Player.tsx),
 * из которого ведущий или админ-панель выбирают активный пакет.
 *
 * Не роняет весь список из-за одного плохого файла: битый JSON или файл, не прошедший
 * validatePack, тихо пропускается — такой файл всё равно нельзя было бы выбрать, но не
 * должен мешать увидеть остальные. console.error — для диагностики на сервере, не для
 * клиента: то, почему конкретного файла нет в списке, не то, что должно решаться в
 * интерфейсе разбором сообщений об ошибках.
 */
export async function listAvailablePacks(dir: string): Promise<PackSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    console.error(`Не удалось прочитать папку с пакетами ${dir}:`, err);
    return [];
  }
  const summaries: PackSummary[] = [];
  for (const filename of entries) {
    if (!filename.endsWith('.json')) continue;
    const path = join(dir, filename);
    try {
      const raw = await readFile(path, 'utf8');
      const pack = validatePack(JSON.parse(raw));
      summaries.push({
        filename,
        title: pack.title,
        description: pack.description ?? null,
      });
    } catch (err) {
      console.error(`Пропускаю невалидный пакет ${path}:`, err);
    }
  }
  return summaries;
}
