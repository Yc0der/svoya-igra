import { mkdirSync, rmSync } from 'node:fs';

// Каждый webServer из playwright.config.ts работает в собственном каталоге
// данных: снапшот комнаты, история партий, анкеты, профиль генератора,
// текущий пакет. Без этого сервер e2e стартовал с путями по умолчанию — с
// настоящими game-history.db, docs/players.md и docs/pack-generator-profile.md
// компании, и final.spec.ts, доиграв партию, переписывал анкеты и профиль.
//
// Каталог пересоздаётся перед каждым стартом сервера, а не чистится после:
// оставшийся от прошлого прогона снапшот или человек в истории меняет
// экран лобби и ломает вход (участник «Ваня» уже есть — name-taken).
//
// Playwright `globalSetup` здесь не подходит: webServer стартует раньше него,
// и к моменту globalSetup сервер уже загрузил старое состояние.
const dir = process.argv[2];
if (!dir) {
  throw new Error('usage: node e2e/reset-data.mjs <каталог данных>');
}
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
