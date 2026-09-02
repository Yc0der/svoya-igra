import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deletePlayerCard,
  readPlayerCard,
  readPlayerList,
  savePlayerCard,
  savePlayerStats,
} from './playersFile.js';
import type { PlayerCard } from './playerCard.js';
import type { PlayerStats } from './history.js';

const CARD: PlayerCard = {
  name: 'Ваня',
  interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
  boring: ['Мода'],
};

const STATS: PlayerStats = {
  games: 1,
  people: [
    {
      id: 1,
      name: 'Ваня',
      games: 1,
      played: 5,
      buzzes: 3,
      correct: 2,
      themes: [{ themeName: 'Спорт', played: 5, buzzes: 3, correct: 2 }],
    },
  ],
};

describe('playersFile', () => {
  let dir: string;
  let playersPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-players-'));
    playersPath = join(dir, 'players.md');
    await writeFile(
      playersPath,
      '# Анкеты игроков\n\nВводный текст.\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('дописывает анкету и читает её обратно', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('## Ваня');
    expect(content).toContain('- **Спорт:** Формула-1');
    expect(content).toContain('Вводный текст.');
    expect(await readPlayerList(playersPath)).toEqual([
      { name: 'Ваня', date: '2026-08-26' },
    ]);
  });

  it('повторная запись той же анкеты не трогает диск', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const first = await stat(playersPath);
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const second = await stat(playersPath);
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it('на отсутствующем файле отдаёт пустой список, а не падает', async () => {
    expect(await readPlayerList(join(dir, 'нет-такого.md'))).toEqual([]);
  });

  it('пересчитывает раздел «Показывает в игре», не трогая анкеты', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    await savePlayerStats(playersPath, STATS);
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('## Ваня');
    expect(content).toContain('- **Спорт:** Формула-1');
    expect(content).toContain('## Показывает в игре');
    expect(content).toContain('### Ваня');
    expect(content).toContain(
      'Всего: нажимал 3 из 5 сыгранных при нём вопросов, верно 2.',
    );
  });

  it('повторный пересчёт с теми же числами не трогает диск', async () => {
    await savePlayerStats(playersPath, STATS);
    const first = await stat(playersPath);
    await savePlayerStats(playersPath, STATS);
    const second = await stat(playersPath);
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });
  it('отдаёт анкету обратно так, как её записали', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const read = await readPlayerCard(playersPath, 'ваня');
    expect(read?.card).toEqual(CARD);
    expect(read?.extraLines).toEqual([]);
  });

  it('на незнакомое имя и на отсутствующий файл отдаёт null', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    expect(await readPlayerCard(playersPath, 'Пётр')).toBeNull();
    expect(await readPlayerCard(join(dir, 'нет.md'), 'Ваня')).toBeNull();
  });

  it('удаляет анкету и говорит, что удалила', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    expect(await deletePlayerCard(playersPath, 'Ваня')).toBe(true);
    expect(await readPlayerList(playersPath)).toEqual([]);
  });

  it('повторное удаление не трогает диск и возвращает false', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    await deletePlayerCard(playersPath, 'Ваня');
    const first = await stat(playersPath);
    expect(await deletePlayerCard(playersPath, 'Ваня')).toBe(false);
    const second = await stat(playersPath);
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });
  it('удаление анкеты не трогает раздел «Показывает в игре»', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    await savePlayerStats(playersPath, STATS);

    expect(await deletePlayerCard(playersPath, 'Ваня')).toBe(true);

    const content = await readFile(playersPath, 'utf8');
    // Заголовки различаются уровнем: анкета — «## Ваня», блок статистики —
    // «### Ваня». Проверять подстрокой нельзя: «### Ваня» содержит «## Ваня».
    expect(content).not.toMatch(/^## Ваня$/m);
    expect(content).toMatch(/^### Ваня$/m);
  });
  it('ручные строки раздела переживают замену анкеты', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const withNote = (await readFile(playersPath, 'utf8')).replace(
      '- **Скучно:** Мода',
      '- **Скучно:** Мода\nПометка ведущего.',
    );
    await writeFile(playersPath, withNote, 'utf8');

    await savePlayerCard(
      playersPath,
      { ...CARD, boring: ['Политика'] },
      '2026-09-02',
    );
    const content = await readFile(playersPath, 'utf8');
    expect(content).toContain('- **Скучно:** Политика');
    expect(content).toContain('Пометка ведущего.');
  });

  it('при переименовании ручные строки переезжают со старым именем', async () => {
    await savePlayerCard(playersPath, CARD, '2026-08-26');
    const withNote = (await readFile(playersPath, 'utf8')).replace(
      '- **Скучно:** Мода',
      '- **Скучно:** Мода\nПометка ведущего.',
    );
    await writeFile(playersPath, withNote, 'utf8');

    await savePlayerCard(
      playersPath,
      { ...CARD, name: 'Иван' },
      '2026-09-02',
      'Ваня',
    );
    expect(await readFile(playersPath, 'utf8')).toContain('Пометка ведущего.');
  });
});
