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

// Переименован из «Жалобы из ручного редактора» (финальное ревью ветки, п.
// 8): с 2026-08-21-question-tags-design.md в этот же раздел пишет и разбор
// в конце партии, не только кнопка «Пожаловаться» в редакторе пакетов —
// старое название перестало описывать содержимое.
const HEADING = '## Жалобы и оценки игроков';

function formatEntry(entry: ComplaintEntry): string {
  // Fix 8 (финальное ревью) — жалоба приходит из <textarea>, где переносы
  // строк разрешены; вставленные как есть, они бы разорвали markdown-список
  // (например «плохо\n## Что-то» превратилось бы в настоящий заголовок
  // посреди файла). Продолжающая строка с тем же отступом, что и у
  // «текст/ответ» строки этого же буллета — держит многострочную жалобу
  // внутри одного элемента списка.
  const complaint = entry.complaint.replace(/\n/g, '\n  ');
  return (
    `- **${entry.date}, «${entry.packTitle}» (${entry.packFilename}), ` +
    `тема «${entry.themeName}», вопрос за ${entry.price}:**\n` +
    `  «${entry.questionText}» (ответ: «${entry.answer}») — ${complaint}`
  );
}

/**
 * Дописывает жалобу (или разобранную оценку игрока — server.ts вызывает эту
 * же функцию из обоих мест) в конец `profilePath` — раздел «Жалобы и оценки
 * игроков» всегда последний в файле (design.md, 2026-08-15; переименован
 * из «Жалобы из ручного редактора» в design.md, 2026-08-21-question-tags),
 * так что «дописать в раздел» здесь буквально «дописать в конец файла».
 * Дата не вычисляется здесь — вызывающий код (server.ts) собирает её сам,
 * чтобы этот модуль оставался чистой функцией без своего обращения к часам.
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
  // Fix 6 (финальное ревью) — обе ветки ниже полагаются на то, что current
  // уже заканчивается переводом строки (иначе новый буллет приклеится к
  // концу последней существующей строки). Это верно для каждой записи,
  // которую делает сама эта функция, но не гарантировано, если файл кто-то
  // отредактировал руками и обрезал хвостовой \n.
  const base = current.endsWith('\n') ? current : `${current}\n`;
  const updated = base.includes(HEADING)
    ? `${base}${bullet}\n`
    : `${base}\n---\n\n${HEADING}\n\n${bullet}\n`;
  const tmpPath = `${profilePath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, profilePath);
}
