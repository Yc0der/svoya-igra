// Тонкая CLI-обёртка над GameHistory.recentPlayed()/formatRecentWindow() —
// Шаг 0 генератора пакетов (.claude/skills/pack-generator/). Отдельного теста
// нет по той же причине, что и у validate-pack.ts: здесь только argv/IO
// вокруг уже протестированных функций.
import { GameHistory, formatRecentWindow } from '../src/history.js';

const RECENT_GAMES = 5;

const path = process.env.HISTORY_PATH ?? '../game-history.db';

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
