import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAvailablePacks } from './packs.js';

const VALID_PACK = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            { id: 'q1', price: 100, text: 'В?', answer: 'О', type: 'обычный' },
          ],
        },
      ],
    },
  ],
};

describe('listAvailablePacks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty list for an empty directory', async () => {
    expect(await listAvailablePacks(dir)).toEqual([]);
  });

  it('returns an empty list and logs when the directory does not exist', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await listAvailablePacks(join(dir, 'nope'));
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('lists a valid pack with its title and description', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify({ ...VALID_PACK, description: 'Про спорт' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: 'Про спорт' },
    ]);
  });

  it('lists a valid pack with description: null when the field is absent', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: null },
    ]);
  });

  it('skips a non-.json file without erroring', async () => {
    await writeFile(join(dir, 'readme.txt'), 'не пак', 'utf8');
    expect(await listAvailablePacks(dir)).toEqual([]);
  });

  it('skips a file with malformed JSON, logs, and still returns the valid ones', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(join(dir, 'broken.json'), '{"title": "об', 'utf8');
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'sport.json', title: 'Тест', description: null },
    ]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('skips a well-formed JSON file that fails validatePack', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(
      join(dir, 'invalid.json'),
      JSON.stringify({ title: 'Неполный' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
