import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendComplaint, type ComplaintEntry } from './generatorProfile.js';

const ENTRY: ComplaintEntry = {
  date: '2026-08-15',
  packFilename: 'sport.json',
  packTitle: 'Общая эрудиция',
  themeName: 'Спорт',
  price: 300,
  questionText: 'Сколько колец на олимпийском флаге?',
  answer: '5',
  complaint: 'не понравился, потому что слишком просто для такой цены',
};

describe('appendComplaint', () => {
  let dir: string;
  let profilePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-generator-profile-'));
    profilePath = join(dir, 'profile.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the section heading on the first complaint and appends the entry', async () => {
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);

    const content = await readFile(profilePath, 'utf8');
    expect(content).toContain('## Жалобы из ручного редактора');
    expect(content).toContain(
      '- **2026-08-15, «Общая эрудиция» (sport.json), тема «Спорт», вопрос за 300:**',
    );
    expect(content).toContain(
      '  «Сколько колец на олимпийском флаге?» (ответ: «5») — не понравился, потому что слишком просто для такой цены',
    );
  });

  it('does not duplicate the heading on a second complaint, and preserves the first entry', async () => {
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);
    await appendComplaint(profilePath, {
      ...ENTRY,
      price: 400,
      complaint: 'вторая жалоба',
    });

    const content = await readFile(profilePath, 'utf8');
    const headingCount =
      content.split('## Жалобы из ручного редактора').length - 1;
    expect(headingCount).toBe(1);
    expect(content).toContain('вопрос за 300');
    expect(content).toContain('вопрос за 400');
    expect(content.indexOf('вопрос за 300')).toBeLessThan(
      content.indexOf('вопрос за 400'),
    );
  });

  it('does not leave a .tmp file behind', async () => {
    await writeFile(profilePath, '# Профиль компании\n', 'utf8');

    await appendComplaint(profilePath, ENTRY);

    await expect(readFile(`${profilePath}.tmp`, 'utf8')).rejects.toThrow();
  });
});
