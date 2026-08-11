// Тонкая CLI-обёртка над validatePack() — используется генератором пакетов
// (.claude/skills/pack-generator/) для проверки сгенерированного файла перед
// тем, как отдать его как результат. Сама валидация уже покрыта тестами в
// server/src/pack.test.ts — здесь нет отдельного теста, потому что ниже только
// argv/IO вокруг уже протестированной функции: чтение файла, парсинг JSON,
// перевод результата/ошибки в код возврата и сообщение, без новой логики.
import { readFile } from 'node:fs/promises';
import { validatePack } from '../src/pack.js';

const path = process.argv[2];
if (!path) {
  console.error(
    'Использование (из директории server/): npx tsx scripts/validate-pack.ts <путь-к-файлу>',
  );
  process.exit(1);
}

let raw: string;
try {
  raw = await readFile(path, 'utf-8');
} catch (err) {
  console.error(
    `${path}: не удалось прочитать файл — ${(err as Error).message}`,
  );
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`${path}: не JSON — ${(err as Error).message}`);
  process.exit(1);
}

try {
  const pack = validatePack(parsed);
  const questionCount = pack.rounds.reduce(
    (sum, round) =>
      sum + round.themes.reduce((s, theme) => s + theme.questions.length, 0),
    0,
  );
  console.log(
    `OK: ${path} — валидный пакет ("${pack.title}", ${pack.rounds.length} раунд(ов), ` +
      `${questionCount} вопрос(ов), финал: ${pack.final ? pack.final.themes.length + ' тем' : 'нет'})`,
  );
} catch (err) {
  console.error(`${path}: невалидный пакет — ${(err as Error).message}`);
  process.exit(1);
}
