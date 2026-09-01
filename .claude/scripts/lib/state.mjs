import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Файл состояния живёт на сессию, а не на репозиторий: без уборки каталог растёт
 * навсегда. Неделя — с запасом больше любой сессии, которая ещё может вернуться.
 */
export const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Подметаем строго то, что сами и пишем: каталог может оказаться не только нашим,
// а удалять по возрасту всё подряд — значит удалять чужое.
const OWN_FILE = /^checkpoint-.+\.json(\.tmp)?$/;

const DEFAULT_STATE = {
  checks: 'unknown',
  remindedSha: null,
  remindedArtifacts: [],
};

/** Состояние сессии или значения по умолчанию — битый и отсутствующий файл равны. */
export async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function sweepStale(dir, keepPath) {
  const cutoff = Date.now() - STATE_TTL_MS;
  const names = await readdir(dir);
  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      if (path === keepPath || !OWN_FILE.test(name)) return;
      try {
        const { mtimeMs } = await stat(path);
        if (mtimeMs < cutoff) await unlink(path);
      } catch {
        // файл мог исчезнуть сам (другая сессия подмела раньше) — это не ошибка
      }
    }),
  );
}

/**
 * Пишет состояние во временный файл и переименовывает. Прямая запись оставила бы
 * на диске обрезанный JSON, если хук убьют внешним timeout посреди неё, а обрезанный
 * JSON `loadState` молча примет за отсутствующее состояние — и дедуп напоминаний
 * потеряется. Тот же приём, что у `writeSnapshot` в `server/src/snapshot.ts`.
 *
 * Заодно подметает файлы чужих сессий старше TTL. Ошибки глушатся целиком:
 * состояние — оптимизация, а не источник истины, и уборка тем более.
 */
export async function saveState(dir, path, state) {
  try {
    await mkdir(dir, { recursive: true });
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, JSON.stringify(state), 'utf8');
    await rename(tmpPath, path);
    await sweepStale(dir, path);
  } catch {
    // состояние — оптимизация, а не источник истины
  }
}
