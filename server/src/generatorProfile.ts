import { readFile, rename, writeFile } from 'node:fs/promises';

export interface ComplaintEntry {
  date: string;
  packFilename: string;
  packTitle: string;
  themeName: string;
  price: number;
  questionText: string;
  answer: string;
  complaint: string;
}

const HEADING = '## Жалобы из ручного редактора';

function formatEntry(entry: ComplaintEntry): string {
  return (
    `- **${entry.date}, «${entry.packTitle}» (${entry.packFilename}), ` +
    `тема «${entry.themeName}», вопрос за ${entry.price}:**\n` +
    `  «${entry.questionText}» (ответ: «${entry.answer}») — ${entry.complaint}`
  );
}

/**
 * Дописывает жалобу на вопрос в конец `profilePath` — раздел «Жалобы из
 * ручного редактора» всегда последний в файле (design.md, 2026-08-15), так
 * что «дописать в раздел» здесь буквально «дописать в конец файла». Дата не
 * вычисляется здесь — вызывающий код (server.ts) собирает её сам, чтобы этот
 * модуль оставался чистой функцией без своего обращения к часам.
 *
 * Тот же паттерн атомарной записи, что уже есть в snapshot.ts/packs.ts —
 * temp-файл + rename, не прямая перезапись.
 */
export async function appendComplaint(
  profilePath: string,
  entry: ComplaintEntry,
): Promise<void> {
  const current = await readFile(profilePath, 'utf8');
  const bullet = formatEntry(entry);
  const updated = current.includes(HEADING)
    ? `${current}${bullet}\n`
    : `${current}\n---\n\n${HEADING}\n\n${bullet}\n`;
  const tmpPath = `${profilePath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, profilePath);
}
