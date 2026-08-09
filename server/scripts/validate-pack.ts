import { readFile } from 'node:fs/promises';
import { validatePack } from '../src/pack.js';

const path = process.argv[2];
if (!path) {
  console.error(
    'Использование (из директории server/): npx tsx scripts/validate-pack.ts <путь-к-файлу>',
  );
  process.exit(1);
}

const raw = await readFile(path, 'utf-8');
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
