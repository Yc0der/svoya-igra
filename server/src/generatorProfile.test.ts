import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendComplaint,
  rewriteAutoSection,
  type ComplaintEntry,
} from './generatorProfile.js';
import type { ProfileAggregate } from './history.js';

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
    expect(content).toContain('## Жалобы и оценки игроков');
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
    const headingCount = content.split('## Жалобы и оценки игроков').length - 1;
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

  it('starts the new bullet on its own line even if the file was missing a trailing newline', async () => {
    // Fix 6 (финальное ревью) — файл без хвостового \n перед разделом
    // «Жалобы и оценки игроков» не должен склеивать новый буллет с
    // последней существующей строкой.
    const withoutTrailingNewline =
      '# Профиль компании\n\nВступление.\n\n---\n\n## Жалобы и оценки игроков\n\n' +
      '- **2026-08-14, «Старый пак» (old.json), тема «Старое», вопрос за 100:**\n' +
      '  «Старый вопрос?» (ответ: «Старый ответ») — старая жалоба без переноса в конце';
    await writeFile(profilePath, withoutTrailingNewline, 'utf8');

    await appendComplaint(profilePath, ENTRY);

    const content = await readFile(profilePath, 'utf8');
    const lines = content.split('\n');
    const newBulletLineIndex = lines.findIndex((line) =>
      line.startsWith('- **2026-08-15,'),
    );
    expect(newBulletLineIndex).toBeGreaterThan(-1);
    // Новый буллет — самостоятельная строка, а не хвост предыдущей.
    expect(lines[newBulletLineIndex]).not.toContain('старая жалоба');
    expect(
      lines[newBulletLineIndex - 1].endsWith(
        'старая жалоба без переноса в конце',
      ),
    ).toBe(true);
  });

  it('keeps a multi-line complaint as an indented continuation, not a top-level markdown break', async () => {
    // Fix 8 (финальное ревью) — перенос строки внутри жалобы не должен
    // вырваться из буллета (например превратиться в собственный
    // markdown-заголовок посреди файла).
    await writeFile(profilePath, '# Профиль компании\n\nВступление.\n', 'utf8');

    await appendComplaint(profilePath, {
      ...ENTRY,
      complaint: 'плохо сформулировано\n## Что-то постороннее',
    });

    const content = await readFile(profilePath, 'utf8');
    expect(content).not.toMatch(/^## Что-то постороннее/m);
    expect(content).toContain('плохо сформулировано\n  ## Что-то постороннее');
    // Ровно один заголовок раздела «Жалобы» — инъекция не создала второй.
    const headingCount = content.split('## Жалобы и оценки игроков').length - 1;
    expect(headingCount).toBe(1);
  });
});

describe('rewriteAutoSection', () => {
  let dir: string;
  let profilePath: string;

  const EMPTY: ProfileAggregate = {
    games: 0,
    questions: 0,
    tags: 0,
    downTagged: [],
    prices: [],
    boringThemes: [],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-auto-section-'));
    profilePath = join(dir, 'profile.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('переписывает раздел, не трогая ручные заметки и жалобы', async () => {
    await writeFile(
      profilePath,
      [
        '## Ручные заметки (сейчас)',
        '',
        '- правило',
        '',
        '---',
        '',
        '## Автособранное (будет позже)',
        '',
        'Пока пусто.',
        '',
        '---',
        '',
        '## Жалобы и оценки игроков',
        '',
        '- старая жалоба',
        '',
      ].join('\n'),
      'utf8',
    );

    await rewriteAutoSection(profilePath, {
      ...EMPTY,
      games: 1,
      questions: 1,
      prices: [{ price: 100, correct: 1, wrong: 0, untaken: 0, noVerdict: 0 }],
    });

    const content = await readFile(profilePath, 'utf8');
    expect(content).toContain('- **100** — верно 1, неверно 0');
    expect(content).toContain('- правило');
    expect(content).toContain('- старая жалоба');
    expect(content).not.toContain('Пока пусто.');
    // Жалобы обязаны остаться последними — appendComplaint пишет в конец файла.
    expect(content.trimEnd().endsWith('- старая жалоба')).toBe(true);
  });

  it('не пишет на диск, когда пересчёт ничего не изменил', async () => {
    await writeFile(
      profilePath,
      '# Профиль\n\n## Автособранное\n\nстарое\n',
      'utf8',
    );

    await rewriteAutoSection(profilePath, EMPTY);
    const first = await stat(profilePath);
    await rewriteAutoSection(profilePath, EMPTY);
    const second = await stat(profilePath);

    // Пересчёт идёт на каждое объяснение причины — файл не должен
    // переписываться, когда в нём нечего менять.
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it('исключает записи, помеченные маркером «учтено»', async () => {
    await writeFile(
      profilePath,
      [
        '## Ручные заметки (сейчас)',
        '',
        '<!-- учтено: pack.json#q1 -->',
        '',
        '---',
        '',
        '## Автособранное',
        '',
        'Пока пусто.',
        '',
      ].join('\n'),
      'utf8',
    );

    await rewriteAutoSection(profilePath, {
      ...EMPTY,
      games: 1,
      downTagged: [
        {
          packFilename: 'pack.json',
          questionId: 'q1',
          themeName: 'Тема',
          price: 100,
          text: 'Вопрос?',
          answer: 'Ответ',
          down: 1,
          up: 0,
          reasons: [],
          texts: [],
          lastGameId: 1,
        },
      ],
    });

    const content = await readFile(profilePath, 'utf8');
    expect(content).not.toContain('Вопрос?');
    expect(content).toContain('<!-- учтено: pack.json#q1 -->');
  });
});
