import { readFile, rename, writeFile } from 'node:fs/promises';
import type { ProfileAggregate } from './history.js';
import {
  indentContinuation,
  parseAcknowledged,
  renderAutoSection,
  spliceAutoSection,
} from './profileSection.js';

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
// 8): на момент переименования (2026-08-21-question-tags-design.md) в этот
// же раздел писал и разбор в конце партии, не только кнопка «Пожаловаться»
// в редакторе пакетов. С появлением пересчёта «Автособранного»
// (2026-08-25-profile-aggregation-design.md) разбор сюда больше не пишет —
// его оценки попадают в файл пересчётом, в схлопнутом виде, — но название
// оставлено: раздел по-прежнему про жалобы и оценки, просто путь до него
// теперь один, а не два.
const HEADING = '## Жалобы и оценки игроков';

function formatEntry(entry: ComplaintEntry): string {
  // Fix 8 (финальное ревью) — жалоба приходит из <textarea>, где переносы
  // строк разрешены; вставленные как есть, они бы разорвали markdown-список
  // (например «плохо\n## Что-то» превратилось бы в настоящий заголовок
  // посреди файла). Продолжающая строка с тем же отступом, что и у
  // «текст/ответ» строки этого же буллета — держит многострочную жалобу
  // внутри одного элемента списка. Та же функция, что и в profileSection.ts
  // (Fix 7, финальное ревью) — раньше здесь была вторая копия того же
  // `replace(/\n/g, '\n  ')`, хотя этот модуль уже импортирует profileSection.
  const complaint = indentContinuation(entry.complaint);
  return (
    `- **${entry.date}, «${entry.packTitle}» (${entry.packFilename}), ` +
    `тема «${entry.themeName}», вопрос за ${entry.price}:**\n` +
    `  «${entry.questionText}» (ответ: «${entry.answer}») — ${complaint}`
  );
}

/**
 * Дописывает жалобу в конец `profilePath` — раздел «Жалобы и оценки
 * игроков» всегда последний в файле (design.md, 2026-08-15; переименован
 * из «Жалобы из ручного редактора» в design.md, 2026-08-21-question-tags),
 * так что «дописать в раздел» здесь буквально «дописать в конец файла».
 * Дата не вычисляется здесь — вызывающий код (server.ts) собирает её сам,
 * чтобы этот модуль оставался чистой функцией без своего обращения к часам.
 *
 * Единственный вызывающий — кнопка «Пожаловаться» в редакторе пакетов
 * (`/admin`). Разбор в конце партии сюда больше не пишет (финальное ревью
 * ветки, п. 4): его оценки попадают в файл через rewriteAutoSection ниже,
 * пересчётом, в схлопнутом виде.
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

/**
 * Пересчитывает раздел «Автособранное» целиком (design.md, 2026-08-25).
 * Дописывания здесь нет намеренно: раздел — чистая проекция базы, и именно
 * поэтому одна претензия от шестерых игроков даёт одну запись «×6», а не
 * шесть одинаковых буллетов (живая партия 2026-08-21).
 *
 * Порядок обязателен: список «учтено» читается из СТАРОГО текста файла, до
 * того как раздел заменён, — иначе маркер, стоящий рядом с разделом, уже
 * потерян.
 *
 * Тот же атомарный приём записи, что и в appendComplaint: temp + rename.
 */
export async function rewriteAutoSection(
  profilePath: string,
  aggregate: ProfileAggregate,
): Promise<void> {
  const current = await readFile(profilePath, 'utf8');
  const section = renderAutoSection(aggregate, parseAcknowledged(current));
  const updated = spliceAutoSection(current, section);
  // Пересчёт идёт на каждое объяснение причины, то есть несколько раз подряд,
  // пока игроки заполняют экран разбора. Без этой проверки файл переписывался
  // бы и когда в нём нечего менять.
  if (updated === current) return;
  const tmpPath = `${profilePath}.tmp`;
  await writeFile(tmpPath, updated, 'utf8');
  await rename(tmpPath, profilePath);
}
