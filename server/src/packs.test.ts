import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePack,
  deleteQuestion,
  findQuestionLocation,
  listAvailablePacks,
  updateQuestion,
} from './packs.js';
import type { Pack } from './pack.js';

const VALID_PACK: Pack = {
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

const TWO_QUESTION_PACK = {
  title: 'Тест',
  author: 'Автор',
  createdAt: '2026-08-04',
  rounds: [
    {
      themes: [
        {
          name: 'Тема',
          questions: [
            {
              id: 'q1',
              price: 100,
              text: 'В1?',
              answer: 'О1',
              type: 'обычный',
            },
            {
              id: 'q2',
              price: 200,
              text: 'В2?',
              answer: 'О2',
              type: 'обычный',
            },
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

  it('returns packs sorted by filename regardless of readdir order', async () => {
    // Пишем сначала b.json, потом a.json — readdir на некоторых ФС может
    // вернуть их в порядке создания, а не по алфавиту. Список должен быть
    // отсортирован самой listAvailablePacks, а не зависеть от порядка readdir.
    await writeFile(
      join(dir, 'b.json'),
      JSON.stringify({ ...VALID_PACK, title: 'Б' }),
      'utf8',
    );
    await writeFile(
      join(dir, 'a.json'),
      JSON.stringify({ ...VALID_PACK, title: 'А' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'a.json', title: 'А', description: null },
      { filename: 'b.json', title: 'Б', description: null },
    ]);
  });

  it('skips a non-.json file without erroring', async () => {
    await writeFile(join(dir, 'readme.txt'), 'не пак', 'utf8');
    expect(await listAvailablePacks(dir)).toEqual([]);
  });

  it('skips *.example.json — примеры из репозитория не пакеты для выбора', async () => {
    // current.example.json — источник, из которого сервер заводит рабочий
    // current.json (index.ts, ensureFileFromExample). Пока список показывал
    // оба файла, один и тот же пак стоял в выборе дважды под одним названием.
    await writeFile(
      join(dir, 'current.example.json'),
      JSON.stringify({ ...VALID_PACK, title: 'Общая эрудиция' }),
      'utf8',
    );
    await writeFile(
      join(dir, 'current.json'),
      JSON.stringify({ ...VALID_PACK, title: 'Общая эрудиция' }),
      'utf8',
    );
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'current.json', title: 'Общая эрудиция', description: null },
    ]);
  });

  it('не путает example.json с настоящим паком, имя которого им заканчивается', async () => {
    // Отсекается именно суффикс `.example.json`, не подстрока «example»:
    // «example.json» и «my-example.json» — обычные имена файлов.
    await writeFile(join(dir, 'example.json'), JSON.stringify(VALID_PACK));
    await writeFile(join(dir, 'my-example.json'), JSON.stringify(VALID_PACK));
    expect(await listAvailablePacks(dir)).toEqual([
      { filename: 'example.json', title: 'Тест', description: null },
      { filename: 'my-example.json', title: 'Тест', description: null },
    ]);
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

describe('updateQuestion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-update-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('updates the fields of an existing question and writes them to disk', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const updated = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 200,
      text: 'Новый текст?',
      answer: 'Новый ответ',
      questionType: 'обычный',
    });

    expect(updated.rounds[0].themes[0].questions[0]).toMatchObject({
      id: 'q1',
      price: 200,
      text: 'Новый текст?',
      answer: 'Новый ответ',
      type: 'обычный',
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk.rounds[0].themes[0].questions[0].price).toBe(200);
  });

  it('sets and clears the optional comment field', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const withComment = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      comment: 'Пояснение',
      questionType: 'обычный',
    });
    expect(withComment.rounds[0].themes[0].questions[0].comment).toBe(
      'Пояснение',
    );

    const withoutComment = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      questionType: 'обычный',
    });
    expect(
      withoutComment.rounds[0].themes[0].questions[0].comment,
    ).toBeUndefined();
  });

  it('can change the question type', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    const updated = await updateQuestion(dir, 'sport.json', 'q1', {
      price: 100,
      text: 'В?',
      answer: 'О',
      questionType: 'аукцион',
    });
    expect(updated.rounds[0].themes[0].questions[0].type).toBe('аукцион');
  });

  it('throws and does not write when the question id is not found', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'ghost', {
        price: 100,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow(/не найден/);
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('throws and does not write when the new price is invalid', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'q1', {
        price: 0,
        text: 'В?',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('throws and does not write when the new text is empty', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(
      updateQuestion(dir, 'sport.json', 'q1', {
        price: 100,
        text: '',
        answer: 'О',
        questionType: 'обычный',
      }),
    ).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });

  it('writes the file pretty-printed with 2-space indentation, matching the hand-editable format', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await updateQuestion(dir, 'sport.json', 'q1', {
      price: 200,
      text: 'В?',
      answer: 'О',
      questionType: 'обычный',
    });

    const raw = await readFile(join(dir, 'sport.json'), 'utf8');
    expect(raw).toContain('\n  "title"');
  });
});

describe('deleteQuestion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-delete-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('removes the question from its theme and writes the result to disk', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(TWO_QUESTION_PACK),
      'utf8',
    );

    const updated = await deleteQuestion(dir, 'sport.json', 'q2');
    expect(updated.rounds[0].themes[0].questions).toHaveLength(1);
    expect(updated.rounds[0].themes[0].questions[0].id).toBe('q1');

    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk.rounds[0].themes[0].questions).toHaveLength(1);
  });

  it('throws and does not write when the question id is not found', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(TWO_QUESTION_PACK),
      'utf8',
    );

    await expect(deleteQuestion(dir, 'sport.json', 'ghost')).rejects.toThrow(
      /не найден/,
    );
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(TWO_QUESTION_PACK);
  });

  it('throws and does not write when deleting would leave the theme with zero questions', async () => {
    await writeFile(
      join(dir, 'sport.json'),
      JSON.stringify(VALID_PACK),
      'utf8',
    );

    await expect(deleteQuestion(dir, 'sport.json', 'q1')).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, 'sport.json'), 'utf8'));
    expect(onDisk).toEqual(VALID_PACK);
  });
});

describe('deletePack', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-packs-delete-pack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('удаляет json и папку с картинками пакета', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await mkdir(join(dir, 'media', 'a'), { recursive: true });
    await writeFile(join(dir, 'media', 'a', 'pic.png'), 'png', 'utf8');

    await deletePack(dir, 'a.json');

    await expect(stat(join(dir, 'a.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(dir, 'media', 'a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('удаляет текстовый пакет без папки медиа без ошибки', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await expect(deletePack(dir, 'a.json')).resolves.toBeUndefined();
  });

  it('не трогает картинки соседнего пакета', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify(VALID_PACK), 'utf8');
    await writeFile(join(dir, 'b.json'), JSON.stringify(VALID_PACK), 'utf8');
    await mkdir(join(dir, 'media', 'b'), { recursive: true });
    await writeFile(join(dir, 'media', 'b', 'pic.png'), 'png', 'utf8');

    await deletePack(dir, 'a.json');

    await expect(
      stat(join(dir, 'media', 'b', 'pic.png')),
    ).resolves.toBeTruthy();
  });

  // Запрос на удаление того, чего нет, — рассинхрон интерфейса, а не
  // штатная ситуация: тихий успех спрятал бы его.
  it('бросает на несуществующем файле, а не заканчивается тихим успехом', async () => {
    await expect(deletePack(dir, 'ghost.json')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('findQuestionLocation', () => {
  it('returns the theme name and the question object for an existing id', () => {
    const location = findQuestionLocation(VALID_PACK, 'q1');
    expect(location).toEqual({
      themeName: 'Тема',
      question: VALID_PACK.rounds[0].themes[0].questions[0],
    });
  });

  it('returns undefined for an unknown id', () => {
    expect(findQuestionLocation(VALID_PACK, 'ghost')).toBeUndefined();
  });
});
