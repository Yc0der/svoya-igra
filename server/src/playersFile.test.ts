import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPlayerList, savePlayerCard } from './playersFile.js';
import type { PlayerCard } from './playerCard.js';

const CARD: PlayerCard = {
  name: 'Ваня',
  interests: [{ area: 'Спорт', examples: ['Формула-1'] }],
  boring: ['Мода'],
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
});
