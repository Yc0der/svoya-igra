// Тонкая CLI-обёртка над GameHistory.recentPlayed()/formatRecentWindow() —
// Шаг 0 генератора пакетов (.claude/skills/pack-generator/). Отдельного теста
// нет по той же причине, что и у validate-pack.ts: здесь только argv/IO
// вокруг уже протестированных функций.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameHistory, formatRecentWindow } from '../src/history.js';

const RECENT_GAMES = 5;

// Резолвится от import.meta.url, а не от cwd — тем же приёмом, что
// server/src/index.ts (HISTORY_PATH). Дефолт '../game-history.db' от cwd
// совпадал с корнем репозитория только при запуске из server/; запусти
// этот скрипт из другого каталога — и GameHistory тихо создаст рядом
// пустую базу вместо настоящей: конструктор создаёт файл, если его нет
// (финальное ревью ветки, п. 4).
const path =
  process.env.HISTORY_PATH ??
  join(dirname(fileURLToPath(import.meta.url)), '../../game-history.db');

let history: GameHistory;
try {
  history = new GameHistory(path);
} catch (err) {
  console.error(
    `${path}: не удалось открыть историю — ${(err as Error).message}`,
  );
  process.exit(1);
}

const rows = history.recentPlayed(RECENT_GAMES);
history.close();

if (rows.length === 0) {
  console.log(
    'История пуста — сыгранных партий ещё нет, повторяться пока не с чем.',
  );
} else {
  console.log(
    `Уже игралось за последние ${RECENT_GAMES} партий (${rows.length} вопрос(ов)) — не повторять эти факты:`,
  );
  console.log(formatRecentWindow(rows));
}
