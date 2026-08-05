import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPack, validatePack } from './pack.js';

function validPackData() {
  return {
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
                text: 'Вопрос?',
                answer: 'Ответ',
                type: 'обычный',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('validatePack', () => {
  it('accepts well-formed data and returns it typed', () => {
    const data = validPackData();
    expect(validatePack(data)).toEqual(data);
  });

  it('accepts a question with an optional comment', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { comment?: string }).comment =
      'Комментарий';
    expect(validatePack(data).rounds[0].themes[0].questions[0].comment).toBe(
      'Комментарий',
    );
  });

  it.each([
    ['title', 123],
    ['author', 123],
    ['createdAt', 123],
  ])('rejects a non-string top-level field %s', (field, value) => {
    const data = validPackData() as Record<string, unknown>;
    data[field] = value;
    expect(() => validatePack(data)).toThrow();
  });

  it('rejects an empty rounds array', () => {
    const data = validPackData();
    data.rounds = [];
    expect(() => validatePack(data)).toThrow(/rounds/);
  });

  it('rejects a round with no themes', () => {
    const data = validPackData();
    data.rounds[0].themes = [];
    expect(() => validatePack(data)).toThrow(/themes/);
  });

  it('rejects a theme with an empty name', () => {
    const data = validPackData();
    data.rounds[0].themes[0].name = '';
    expect(() => validatePack(data)).toThrow(/name/);
  });

  it('rejects a theme with no questions', () => {
    const data = validPackData();
    data.rounds[0].themes[0].questions = [];
    expect(() => validatePack(data)).toThrow(/questions/);
  });

  it.each([
    ['id', 123],
    ['price', 'сто'],
    ['text', 123],
    ['answer', 123],
  ])('rejects a question with a bad field %s', (field, value) => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as Record<string, unknown>)[field] =
      value;
    expect(() => validatePack(data)).toThrow();
  });

  it('rejects a non-positive price', () => {
    const data = validPackData();
    data.rounds[0].themes[0].questions[0].price = 0;
    expect(() => validatePack(data)).toThrow(/price/);
  });

  it('rejects an unknown question type', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as { type: string }).type =
      'неизвестный';
    expect(() => validatePack(data)).toThrow(/type/);
  });

  it('rejects a non-string comment when present', () => {
    const data = validPackData();
    (data.rounds[0].themes[0].questions[0] as Record<string, unknown>)[
      'comment'
    ] = 123;
    expect(() => validatePack(data)).toThrow(/comment/);
  });

  it('rejects data that is not an object', () => {
    expect(() => validatePack('строка')).toThrow();
    expect(() => validatePack(null)).toThrow();
  });

  it('rejects duplicate question ids across different themes', () => {
    // The engine uses `id` as a global key across the whole pack
    // (answeredQuestionIds, grid[].answered, findQuestion) — a duplicate id
    // in a hand-written pack would silently corrupt gameplay (a question
    // showing as already-answered before it's ever opened) instead of
    // failing validation up front.
    const data = validPackData();
    data.rounds.push({
      themes: [
        {
          name: 'Другая тема',
          questions: [
            {
              id: 'q1',
              price: 300,
              text: 'Другой вопрос?',
              answer: 'Другой ответ',
              type: 'обычный',
            },
          ],
        },
      ],
    });
    expect(() => validatePack(data)).toThrow(/q1/);
  });
});

describe('validatePack — final', () => {
  function withFinal(themes: unknown) {
    const data = validPackData() as Record<string, unknown>;
    data.final = { themes };
    return data;
  }

  it('accepts a well-formed final block', () => {
    const data = withFinal([
      {
        name: 'Финал A',
        question: { id: 'f1', text: 'F1?', answer: 'ответ f1' },
      },
      {
        name: 'Финал B',
        question: { id: 'f2', text: 'F2?', answer: 'ответ f2', comment: 'к.' },
      },
    ]);
    const pack = validatePack(data);
    expect(pack.final).toEqual({
      themes: [
        {
          name: 'Финал A',
          question: {
            id: 'f1',
            text: 'F1?',
            answer: 'ответ f1',
            comment: undefined,
          },
        },
        {
          name: 'Финал B',
          question: {
            id: 'f2',
            text: 'F2?',
            answer: 'ответ f2',
            comment: 'к.',
          },
        },
      ],
    });
  });

  it('is undefined when the pack has no final block', () => {
    expect(validatePack(validPackData()).final).toBeUndefined();
  });

  it('rejects a final block with fewer than two themes', () => {
    const data = withFinal([
      { name: 'Финал A', question: { id: 'f1', text: 'F1?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/final/);
  });

  it('rejects a final theme with an empty name', () => {
    const data = withFinal([
      { name: '', question: { id: 'f1', text: 'F1?', answer: 'x' } },
      { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/name/);
  });

  it('rejects a final question missing an answer', () => {
    const data = withFinal([
      { name: 'А', question: { id: 'f1', text: 'F1?' } },
      { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
    ]);
    expect(() => validatePack(data)).toThrow(/answer/);
  });

  it('rejects a final question id that collides with a round question id', () => {
    const data = validPackData() as Record<string, unknown>;
    data.final = {
      themes: [
        // 'q1' переиспользует id, уже занятый round[0].themes[0].questions[0]
        // в validPackData() — проверка уникальности должна видеть весь пакет
        // целиком, не только rounds.
        { name: 'А', question: { id: 'q1', text: 'F1?', answer: 'x' } },
        { name: 'Б', question: { id: 'f2', text: 'F2?', answer: 'x' } },
      ],
    };
    expect(() => validatePack(data)).toThrow(/повторяющийся id/);
  });
});

describe('loadPack', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'svoya-igra-pack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads and validates a real file from disk', async () => {
    const path = join(dir, 'pack.json');
    await writeFile(path, JSON.stringify(validPackData()), 'utf8');
    const pack = await loadPack(path);
    expect(pack.title).toBe('Тест');
  });

  it('throws a readable error on invalid JSON', async () => {
    const path = join(dir, 'pack.json');
    await writeFile(path, '{not json', 'utf8');
    await expect(loadPack(path)).rejects.toThrow(/JSON/);
  });

  it('throws when the file does not exist', async () => {
    await expect(loadPack(join(dir, 'missing.json'))).rejects.toThrow();
  });
});

describe('the real packs/current.json', () => {
  it('is a valid pack', async () => {
    const path = fileURLToPath(
      new URL('../../packs/current.json', import.meta.url),
    );
    const pack = await loadPack(path);
    expect(pack.rounds.length).toBeGreaterThan(0);
  });
});
