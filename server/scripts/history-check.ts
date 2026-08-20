// Тонкая CLI-обёртка над findRepeats() — Шаг 6 генератора пакетов
// (.claude/skills/pack-generator/). Отдельного теста нет по той же причине,
// что и у validate-pack.ts: здесь только argv/IO вокруг уже протестированной
// функции.
//
// Намеренно отдельный скрипт, а не флаг внутри validate-pack.ts: валидатор
// проверяет ФОРМАТ, а пакет с повтором формально валиден — и валидатор должен
// оставаться пригодным на машине, где базы истории нет вовсе.
import { readFile } from 'node:fs/promises';
import { GameHistory, findRepeats } from '../src/history.js';
import { validatePack } from '../src/pack.js';

const path = process.argv[2];
if (!path) {
  console.error(
    'Использование (из директории server/): npx tsx scripts/history-check.ts <путь-к-файлу>',
  );
  process.exit(1);
}

let pack;
try {
  pack = validatePack(JSON.parse(await readFile(path, 'utf-8')));
} catch (err) {
  console.error(
    `${path}: не удалось прочитать пакет — ${(err as Error).message}`,
  );
  process.exit(1);
}

const historyPath = process.env.HISTORY_PATH ?? '../game-history.db';
let history: GameHistory;
try {
  history = new GameHistory(historyPath);
} catch (err) {
  console.error(
    `${historyPath}: не удалось открыть историю — ${(err as Error).message}`,
  );
  process.exit(1);
}

const report = findRepeats(pack, history.allPlayedQuestions());
history.close();

for (const finding of report.sameAnswer) {
  console.warn(
    `⚠ ${finding.questionId}: ответ «${finding.answer}» уже был — ` +
      `тогда спрашивали «${finding.previous.text}». Переписать вопрос или ` +
      `явно объяснить, почему он остаётся.`,
  );
}

for (const finding of report.sameQuestion) {
  console.error(
    `✗ ${finding.questionId}: этот вопрос уже игрался — «${finding.previous.text}» ` +
      `(ответ «${finding.previous.answer}»). Переписать обязательно.`,
  );
}

if (report.sameQuestion.length > 0) {
  process.exit(1);
}

console.log(
  `OK: ${path} — повторов сыгранных вопросов нет` +
    (report.sameAnswer.length > 0
      ? `, но ${report.sameAnswer.length} предупреждени(й) по повторам ответов выше`
      : ''),
);
