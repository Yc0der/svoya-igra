import { rename, writeFile } from 'node:fs/promises';
// Именно node:timers/promises, а не глобальный setTimeout: тесты сервера
// подменяют глобальные часы (vi.useFakeTimers), и пауза между попытками,
// взятая оттуда, зависла бы навсегда в тесте, который фейковое время не
// проматывает. Этот таймер настоящий и от подмены не зависит.
import { setTimeout as delay } from 'node:timers/promises';

// Windows отказывает в rename на файл, который в этот момент кто-то открыл на
// чтение: MoveFileEx возвращает отказ в доступе, Node показывает его как
// EPERM. Отказ мгновенный и временный — читатель закрывает файл через
// доли миллисекунды. Проверено замером на этой машине: при читателе в тесном
// цикле 785 из 1000 попыток rename падали с EPERM, без читателя — ни одной.
//
// На это налетал не только тест: раздел «Показывает в игре» и «Автособранное»
// сервер пересчитывает в game-end, а админка в это же время читает те же
// файлы. Ошибка там проглатывается с записью в лог (партия важнее файла), то
// есть правка просто пропадала молча.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
// Бюджет на повторы: секунда с шагом, растущим от миллисекунды до сотни. Тот
// же приём, что у graceful-fs, только с потолком — сервер держит партию, и
// ждать файл минутами, как это делает graceful-fs, здесь нельзя.
const RETRY_BUDGET_MS = 1000;
const MAX_DELAY_MS = 100;

/**
 * Атомарная запись файла: temp + rename. Читатель никогда не видит половины
 * текста — он видит либо старый файл целиком, либо новый целиком, и оборванная
 * посреди write() запись не превращает файл в мусор.
 *
 * Общий хелпер на все восемь мест записи (`packs.ts`, `snapshot.ts`,
 * `playersFile.ts`, `generatorProfile.ts`, `lan-host.ts`), где раньше стояли
 * одинаковые три строки. До появления EPERM-повтора отдельный хелпер и правда
 * не был нужен (комментарий в packs.ts так и говорил — YAGNI); теперь у приёма
 * появилась платформенная тонкость, и восемь её копий разъехались бы в первой
 * же правке.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  let waited = 0;
  let nextDelay = 1;
  for (;;) {
    try {
      await rename(tmpPath, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code !== undefined && RETRY_CODES.has(code);
      if (!retryable || waited >= RETRY_BUDGET_MS) throw err;
      await delay(nextDelay);
      waited += nextDelay;
      nextDelay = Math.min(nextDelay * 2, MAX_DELAY_MS);
    }
  }
}
