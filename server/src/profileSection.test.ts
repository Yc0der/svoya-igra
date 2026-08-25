import { describe, expect, it } from 'vitest';
import {
  renderAutoSection,
  parseAcknowledged,
  spliceAutoSection,
} from './profileSection.js';
import type { ProfileAggregate } from './history.js';

const EMPTY: ProfileAggregate = {
  games: 0,
  questions: 0,
  tags: 0,
  downTagged: [],
  prices: [],
  boringThemes: [],
};

const QUESTION = {
  packFilename: 'photo-test.json',
  questionId: 'r1-kino-400',
  themeName: 'Кино',
  price: 400,
  text: 'Опера «Кармен» какого композитора?',
  answer: 'Жорж Бизе',
  down: 3,
  up: 1,
  reasons: [
    { reason: 'Неинтересная тема', count: 2 },
    { reason: 'Слишком сложный', count: 1 },
  ],
  texts: ['вообще не про кино'],
  lastGameId: 2,
};

describe('renderAutoSection', () => {
  it('на пустой базе печатает заголовок и «пока пусто»', () => {
    const text = renderAutoSection(EMPTY, new Set());
    expect(text).toContain('## Автособранное');
    expect(text).toContain('Пока пусто — в базе нет сыгранных партий.');
    expect(text).not.toContain('###');
  });

  it('склоняет числительные в шапке выборки', () => {
    const one = renderAutoSection(
      { ...EMPTY, games: 1, questions: 1, tags: 1 },
      new Set(),
    );
    expect(one).toContain('1 партия, 1 сыгранный вопрос');
    expect(one).toContain(', 1 оценка от игроков');
    const few = renderAutoSection(
      { ...EMPTY, games: 3, questions: 22, tags: 12 },
      new Set(),
    );
    expect(few).toContain('3 партии, 22 сыгранных вопроса');
    expect(few).toContain(', 12 оценок от игроков');
    const many = renderAutoSection(
      { ...EMPTY, games: 5, questions: 147, tags: 25 },
      new Set(),
    );
    expect(many).toContain('5 партий, 147 сыгранных вопросов');
    expect(many).toContain(', 25 оценок от игроков');
  });

  it('печатает запись вопроса с пальцами, причинами и текстом', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).toContain(
      '- **photo-test.json#r1-kino-400 · «Кино» · 400** —',
    );
    expect(text).toContain('(ответ: «Жорж Бизе»)');
    expect(text).toContain(
      '👎 3 · 👍 1 · причины: «Неинтересная тема» ×2, «Слишком сложный» ×1',
    );
    expect(text).toContain('Текстом: «вообще не про кино»');
  });

  it('не печатает 👍, когда его нет, и говорит прямо, что причин не указали', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, up: 0, reasons: [], texts: [] }],
      },
      new Set(),
    );
    expect(text).toContain('👎 3 · причины не указаны');
    expect(text).not.toContain('👍');
    expect(text).not.toContain('Текстом:');
  });

  it('пропускает записи из списка «учтено» по паре пак+вопрос', () => {
    const other = { ...QUESTION, packFilename: 'other.json' };
    const text = renderAutoSection(
      { ...EMPTY, games: 2, downTagged: [QUESTION, other] },
      new Set(['photo-test.json#r1-kino-400']),
    );
    expect(text).not.toContain('photo-test.json');
    expect(text).toContain('other.json');
  });

  it('не даёт свободному тексту разорвать раздел заголовком или разделителем', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [{ ...QUESTION, texts: ['плохо\n## Заголовок\n---\nещё'] }],
      },
      new Set(),
    );
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Автособранное');
      expect(line.startsWith('---')).toBe(false);
    }
  });

  // Финальное ревью ветки, п. 1 (CRITICAL) — indentContinuation() раньше
  // применялась только к entry.text и entry.texts, но не к entry.answer и
  // entry.themeName: перенос строки в любом из них (поле «Ответ» в редакторе
  // пакетов — обычный <textarea>, где Enter ничем не запрещён) пробивал
  // раздел ровно так же, как перенос в тексте вопроса.
  it('не даёт переносу строки в ответе или названии темы разорвать раздел', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        downTagged: [
          {
            ...QUESTION,
            answer: 'Жорж Бизе\n---\nвторая строка',
            themeName: 'Кино\n## Подложный заголовок',
          },
        ],
      },
      new Set(),
    );
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Автособранное');
      expect(line.startsWith('---')).toBe(false);
    }
  });

  // Третье место того же дефекта, оставшееся без прицельного теста при
  // починке (точечное ревью волны правок): в блоке тем имя темы приходит из
  // отдельного поля boringThemes, а не из downTagged, поэтому тест выше его
  // не задевает — там защиту сняли бы, а он остался бы зелёным.
  it('не даёт переносу строки в названии темы разорвать блок тем', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        boringThemes: [
          {
            themeName: 'Спорт\n## Подложный заголовок\n---',
            count: 4,
            games: 2,
          },
        ],
      },
      new Set(),
    );
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Автособранное');
      expect(line.startsWith('---')).toBe(false);
    }
  });

  it('печатает цены списком по возрастанию', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 1,
        prices: [
          { price: 500, correct: 15, wrong: 2, untaken: 3, noVerdict: 1 },
          { price: 100, correct: 18, wrong: 1, untaken: 1, noVerdict: 0 },
        ],
      },
      new Set(),
    );
    const prices = text.split('\n').filter((line) => line.startsWith('- **'));
    expect(prices[0]).toBe(
      '- **100** — верно 18, неверно 1, не взял никто 1, без вердикта 0',
    );
    expect(prices[1]).toBe(
      '- **500** — верно 15, неверно 2, не взял никто 3, без вердикта 1',
    );
  });

  it('печатает сводку тем со склонением', () => {
    const text = renderAutoSection(
      {
        ...EMPTY,
        games: 2,
        boringThemes: [
          { themeName: 'Спорт', count: 4, games: 2 },
          { themeName: 'Литература', count: 1, games: 1 },
        ],
      },
      new Set(),
    );
    expect(text).toContain('- «Спорт» — 4 раза за 2 партии');
    expect(text).toContain('- «Литература» — 1 раз за 1 партию');
  });

  it('не печатает пустых блоков', () => {
    const text = renderAutoSection(
      { ...EMPTY, games: 1, downTagged: [QUESTION] },
      new Set(),
    );
    expect(text).toContain('### Вопросы, помеченные пальцем вниз');
    expect(text).not.toContain('### Как берутся вопросы по ценам');
    expect(text).not.toContain('### Темы, названные неинтересными');
  });
});

const FILE = [
  '# Профиль компании',
  '',
  '## Ручные заметки (сейчас)',
  '',
  '<!-- учтено: photo-test.json#r1-kino-400 -->',
  '',
  '- правило про скобки',
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
].join('\n');

describe('parseAcknowledged', () => {
  it('читает идентификаторы из маркера', () => {
    expect(parseAcknowledged(FILE)).toEqual(
      new Set(['photo-test.json#r1-kino-400']),
    );
  });

  it('читает несколько идентификаторов и несколько маркеров', () => {
    const text = [
      '## Ручные заметки (сейчас)',
      '<!-- учтено: a.json#q1, b.json#q2 -->',
      '<!-- учтено: c.json#q3 -->',
    ].join('\n');
    expect(parseAcknowledged(text)).toEqual(
      new Set(['a.json#q1', 'b.json#q2', 'c.json#q3']),
    );
  });

  it('не подхватывает маркер, лежащий внутри заменяемого раздела', () => {
    const text = [
      '## Ручные заметки (сейчас)',
      '',
      '---',
      '',
      '## Автособранное',
      '',
      '<!-- учтено: a.json#q1 -->',
      '',
    ].join('\n');
    expect(parseAcknowledged(text)).toEqual(new Set());
  });

  it('на пустом маркере отдаёт пустое множество', () => {
    expect(parseAcknowledged('<!-- учтено: -->')).toEqual(new Set());
  });
});

describe('spliceAutoSection', () => {
  it('заменяет раздел, не трогая соседние', () => {
    const updated = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    expect(updated).toContain('- правило про скобки');
    expect(updated).toContain('<!-- учтено: photo-test.json#r1-kino-400 -->');
    expect(updated).toContain('новое');
    expect(updated).not.toContain('Пока пусто.');
    expect(updated).not.toContain('(будет позже)');
  });

  it('оставляет раздел жалоб последним в файле', () => {
    const updated = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings[headings.length - 1]).toBe('## Жалобы и оценки игроков');
    expect(updated.trimEnd().endsWith('- старая жалоба')).toBe(true);
  });

  it('идемпотентна: повторная вставка того же раздела ничего не меняет', () => {
    const once = spliceAutoSection(FILE, '## Автособранное\n\nновое');
    expect(spliceAutoSection(once, '## Автособранное\n\nновое')).toBe(once);
  });

  // Финальное ревью ветки, п. 1 (CRITICAL) — регрессионный тест на весь
  // конвейер (renderAutoSection + spliceAutoSection), не на статичную
  // строку раздела, как тест идемпотентности выше: тот прогоняет один и тот
  // же ГОТОВЫЙ текст раздела и не ловит дыру, потому что дыра — в том, КАК
  // раздел строится из данных с переносом строки, а не в самой вставке.
  // Здесь ответ в данных содержит `\n---\n` — без фикса indentContinuation()
  // в renderQuestion() эта строка не получает отступа, findSectionRange()
  // принимает её за границу раздела, и раздел на каждом пересчёте обрезается
  // на середине, а хвост дублируется рядом (проверено на настоящем файле
  // профиля: 8213 → 8269 → 8325 → 8381 байт, без предела). Пять пересчётов
  // подряд на реалистичном тексте файла — и текст обязан перестать расти уже
  // после второго прохода.
  it('устойчива к повторению даже с переносом строки в ответе: после второго прохода текст перестаёт меняться', () => {
    const poisonedAggregate: ProfileAggregate = {
      ...EMPTY,
      games: 1,
      questions: 5,
      tags: 3,
      downTagged: [{ ...QUESTION, answer: 'Жорж Бизе\n---\nвторая строка' }],
    };
    const section = renderAutoSection(poisonedAggregate, new Set());

    let fileText = FILE;
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      fileText = spliceAutoSection(fileText, section);
      sizes.push(fileText.length);
    }

    expect(sizes[2]).toBe(sizes[1]);
    expect(sizes[3]).toBe(sizes[2]);
    expect(sizes[4]).toBe(sizes[3]);
    // Раздел жалоб остаётся последним даже после пяти пересчётов подряд с
    // ядовитым значением в данных.
    expect(fileText.trimEnd().endsWith('- старая жалоба')).toBe(true);
    // Заголовок раздела встречается ровно один раз — ни одной осиротевшей
    // копии рядом.
    expect(fileText.split('## Автособранное').length - 1).toBe(1);
  });

  it('вставляет раздел перед жалобами, если его в файле нет', () => {
    const text = [
      '# Профиль',
      '',
      '---',
      '',
      '## Жалобы и оценки игроков',
      '',
      '- жалоба',
      '',
    ].join('\n');
    const updated = spliceAutoSection(text, '## Автособранное\n\nновое');
    expect(updated.indexOf('## Автособранное')).toBeLessThan(
      updated.indexOf('## Жалобы и оценки игроков'),
    );
    expect(updated).toContain('- жалоба');
  });

  it('дописывает раздел в конец, если нет ни его, ни жалоб', () => {
    const updated = spliceAutoSection(
      '# Профиль\n',
      '## Автособранное\n\nновое',
    );
    expect(updated.trimEnd().endsWith('новое')).toBe(true);
    expect(updated).toContain('# Профиль');
  });
});
