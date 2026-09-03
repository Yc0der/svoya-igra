import {
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomicWrite.js';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-atomic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('записывает содержимое и не оставляет temp-файла', async () => {
    const path = join(dir, 'file.md');
    await writeFileAtomic(path, 'новый текст\n');
    expect(await readFile(path, 'utf8')).toBe('новый текст\n');
    expect(await readdir(dir)).toEqual(['file.md']);
  });

  it('перезаписывает существующий файл целиком', async () => {
    const path = join(dir, 'file.md');
    await writeFile(path, 'старый длинный текст\n', 'utf8');
    await writeFileAtomic(path, 'новый\n');
    expect(await readFile(path, 'utf8')).toBe('новый\n');
  });

  // Регрессия на мигавший тест серверной области («game-end пересчитывает
  // «Автособранное»…»): на Windows rename на файл, который в этот момент
  // кто-то держит открытым на чтение, падает с EPERM — замер на этой машине
  // дал 200 отказов из 200 попыток. Читатель здесь один и держит файл
  // ограниченное время: ровно так ведут себя настоящие читатели этих файлов —
  // опрос файла в тестах и админка, читающая анкеты в момент game-end.
  //
  // Без повтора внутри writeFileAtomic запись падает на первой же попытке и
  // тест красный. На Linux открытый читатель rename не мешает, и тест зелёный
  // в обоих случаях — регрессия именно на Windows, и это нормально: сервер
  // запускают на ноутбуке ведущего, а не только в CI.
  it('дожидается читателя, который держит файл открытым', async () => {
    const path = join(dir, 'file.md');
    await writeFile(path, 'начало\n', 'utf8');
    const handle = await open(path, 'r');
    const write = writeFileAtomic(path, 'новый текст\n');
    // Отпускаем файл заведомо позже первой попытки rename: смысл теста в том,
    // что запись переживает занятый файл, а не в том, что она успела
    // проскочить до читателя.
    await delay(30);
    await handle.close();
    await write;
    expect(await readFile(path, 'utf8')).toBe('новый текст\n');
  });

  it('не повторяет попытку на ошибке, которая сама не пройдёт', async () => {
    const path = join(dir, 'нет-такой-папки', 'file.md');
    await expect(writeFileAtomic(path, 'текст\n')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
