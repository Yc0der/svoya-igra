import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPack, validatePack, type Pack, type Question } from './pack.js';

export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}

/**
 * Все валидные пакеты в директории `dir` — для списка в интерфейсе (Admin.tsx, Player.tsx),
 * из которого ведущий или админ-панель выбирают активный пакет.
 *
 * Не роняет весь список из-за одного плохого файла: битый JSON или файл, не прошедший
 * validatePack, тихо пропускается — такой файл всё равно нельзя было бы выбрать, но не
 * должен мешать увидеть остальные. console.error — для диагностики на сервере, не для
 * клиента: то, почему конкретного файла нет в списке, не то, что должно решаться в
 * интерфейсе разбором сообщений об ошибках.
 *
 * `*.example.json` в список не попадают. Это файлы репозитория, а не пакеты этой компании:
 * из `current.example.json` сервер заводит рабочий `current.json`
 * (`ensureFileFromExample` в index.ts), и пока список показывал оба, один и тот же пак
 * стоял в выборе дважды под одним названием. Сыграть пример по-прежнему можно — скопировав
 * его под обычным именем, ровно как это делает сам сервер с `current.json`.
 */
export async function listAvailablePacks(dir: string): Promise<PackSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    console.error(`Не удалось прочитать папку с пакетами ${dir}:`, err);
    return [];
  }
  const summaries: PackSummary[] = [];
  for (const filename of entries) {
    if (!filename.endsWith('.json')) continue;
    if (filename.endsWith('.example.json')) continue;
    const path = join(dir, filename);
    try {
      const raw = await readFile(path, 'utf8');
      const pack = validatePack(JSON.parse(raw));
      summaries.push({
        filename,
        title: pack.title,
        description: pack.description ?? null,
      });
    } catch (err) {
      console.error(`Пропускаю невалидный пакет ${path}:`, err);
    }
  }
  summaries.sort((a, b) => a.filename.localeCompare(b.filename));
  return summaries;
}

// Тот же паттерн, что уже есть в snapshot.ts (writeFileAtomic) — temp-файл
// + rename, а не прямая перезапись: половина записанного файла на диске
// после сбоя посреди write() хуже отсутствия записи вовсе. Отдельного
// общего хелпера с snapshot.ts не заводим — два похожих места, лишняя
// абстракция ради них не оправдана (YAGNI).
//
// null, 2 — а не компактный JSON.stringify, как в serializeSnapshot: пакет,
// в отличие от снапшота комнаты, человекочитаемый формат, который
// открывают и правят в текстовом редакторе (design.md пакет-генератора,
// «человекочитаемый формат»). Перезаписать его компактной строкой значило
// бы сломать эту читаемость для всего остального файла, не только для
// изменённого вопроса.
async function writePackAtomic(path: string, pack: Pack): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(pack, null, 2), 'utf8');
  await rename(tmpPath, path);
}

function findQuestion(pack: Pack, questionId: string): Question | undefined {
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const found = theme.questions.find((q) => q.id === questionId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Как `findQuestion`, но публичная и возвращает ещё и название темы —
 * нужно для жалобы на вопрос (server.ts, admin-report-question), где текст
 * записи требует «тема «…»». Не объединяется с приватной `findQuestion`
 * внутри update/deleteQuestion — та возвращает только вопрос, этой нужен ещё
 * контекст темы, а трогать уже проверенный код ради двух похожих сигнатур
 * не оправдано (YAGNI).
 */
export function findQuestionLocation(
  pack: Pack,
  questionId: string,
): { themeName: string; question: Question } | undefined {
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const found = theme.questions.find((q) => q.id === questionId);
      if (found) return { themeName: theme.name, question: found };
    }
  }
  return undefined;
}

/**
 * Правит существующий вопрос по его `id` и сразу пишет результат на диск.
 * `id` не редактируется — вопрос ищется по нему, не переименовывается
 * (design.md, «Правило»: id — служебное поле движка, менять его человеку
 * незачем).
 *
 * Перечитывает файл заново с диска перед правкой (не доверяет тому, что
 * было в памяти вызывающего) и возвращает свежепрочитанное содержимое
 * после записи — источник истины всегда файл на диске.
 */
export async function updateQuestion(
  dir: string,
  filename: string,
  questionId: string,
  fields: {
    price: number;
    text: string;
    answer: string;
    comment?: string;
    questionType: Question['type'];
  },
): Promise<Pack> {
  const path = join(dir, filename);
  const pack = await loadPack(path);
  const question = findQuestion(pack, questionId);
  if (!question) {
    throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
  }
  question.price = fields.price;
  question.text = fields.text;
  question.answer = fields.answer;
  question.comment = fields.comment;
  question.type = fields.questionType;
  // Валидируем результат целиком, не только изменённое поле — дёшево
  // (пакет ≤ 50 вопросов) и заодно ловит структурные проблемы, которых
  // локальная проверка одного вопроса не увидела бы.
  const validated = validatePack(pack);
  await writePackAtomic(path, validated);
  return loadPack(path);
}

/**
 * Убирает вопрос по его `id` и сразу пишет результат на диск. Бросает,
 * если после удаления в какой-то теме не осталось вопросов —
 * `validatePack` это уже проверяет (`requireArray` требует непустой
 * массив), явного ручного счётчика тут не нужно.
 */
export async function deleteQuestion(
  dir: string,
  filename: string,
  questionId: string,
): Promise<Pack> {
  const path = join(dir, filename);
  const pack = await loadPack(path);
  let found = false;
  for (const round of pack.rounds) {
    for (const theme of round.themes) {
      const index = theme.questions.findIndex((q) => q.id === questionId);
      if (index !== -1) {
        theme.questions.splice(index, 1);
        found = true;
      }
    }
  }
  if (!found) {
    throw new Error(`вопрос с id "${questionId}" не найден в пакете`);
  }
  const validated = validatePack(pack);
  await writePackAtomic(path, validated);
  return loadPack(path);
}
