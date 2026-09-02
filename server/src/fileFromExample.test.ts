import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureFileFromExample } from './fileFromExample.js';

const EXAMPLE = `# Анкеты игроков

Пока пусто.
`;

const CARD = `## Ваня
`;

describe('ensureFileFromExample', () => {
  let dir: string;
  let examplePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-example-'));
    examplePath = join(dir, 'players.example.md');
    await writeFile(examplePath, EXAMPLE, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('создаёт рабочий файл из примера, если его ещё нет', async () => {
    const path = join(dir, 'players.md');
    await ensureFileFromExample(path, examplePath);
    expect(await readFile(path, 'utf8')).toBe(EXAMPLE);
  });

  it('не трогает уже существующий файл', async () => {
    const path = join(dir, 'players.md');
    await writeFile(path, CARD, 'utf8');
    await ensureFileFromExample(path, examplePath);
    expect(await readFile(path, 'utf8')).toBe(CARD);
  });

  it('без примера не падает — сервер обязан подняться и без него', async () => {
    const path = join(dir, 'players.md');
    await expect(
      ensureFileFromExample(path, join(dir, 'нет-примера.md')),
    ).resolves.toBeUndefined();
  });
});
