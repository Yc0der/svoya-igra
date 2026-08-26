import { describe, expect, it } from 'vitest';
import {
  listPlayers,
  oneLine,
  parsePlayerCard,
  renderPlayerSection,
  upsertPlayerSection,
  type PlayerCard,
} from './playerCard.js';

const CODE = JSON.stringify({
  version: 1,
  name: 'Ваня',
  interests: [
    { area: 'Кино и сериалы', examples: ['Драйв', 'Во все тяжкие'] },
    { area: 'Спорт', examples: ['Формула-1'] },
  ],
  boring: ['Политика', 'Мода'],
});

const CARD: PlayerCard = {
  name: 'Ваня',
  interests: [
    { area: 'Кино и сериалы', examples: ['Драйв', 'Во все тяжкие'] },
    { area: 'Спорт', examples: ['Формула-1'] },
  ],
  boring: ['Политика', 'Мода'],
};

const FILE = [
  '# Анкеты игроков',
  '',
  'Вводный текст.',
  '',
  '---',
  '',
  '## Ваня',
  '',
  '_Анкета от 2026-08-01._',
  '',
  '- **Спорт:** старое',
  '',
  '## Катя',
  '',
  '_Анкета от 2026-08-02._',
  '',
  '- **Музыка:** джаз',
  '',
].join('\n');

describe('parsePlayerCard', () => {
  it('разбирает корректный код', () => {
    const result = parsePlayerCard(CODE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.card).toEqual(CARD);
  });

  it('терпит пробелы и переводы строк вокруг кода', () => {
    expect(parsePlayerCard(`\n  ${CODE}\n `).ok).toBe(true);
  });

  it('отклоняет не-JSON с внятной причиной', () => {
    const result = parsePlayerCard('привет');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('не похоже на код анкеты');
  });

  it('отклоняет чужую версию формы отдельным сообщением', () => {
    const result = parsePlayerCard(
      JSON.stringify({ ...JSON.parse(CODE), version: 2 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('другой версии формы');
  });

  it('требует имя', () => {
    const result = parsePlayerCard(
      JSON.stringify({ version: 1, name: '   ', boring: ['Мода'] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('без имени');
  });

  it('отклоняет пустую анкету — записывать в неё нечего', () => {
    const result = parsePlayerCard(
      JSON.stringify({ version: 1, name: 'Ваня' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('пустая');
  });

  it('выбрасывает области без примеров, а не падает на них', () => {
    const result = parsePlayerCard(
      JSON.stringify({
        version: 1,
        name: 'Ваня',
        interests: [
          { area: 'Спорт', examples: [] },
          { area: 'Музыка', examples: ['джаз'] },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.card.interests).toEqual([
        { area: 'Музыка', examples: ['джаз'] },
      ]);
  });
});

describe('oneLine', () => {
  it('схлопывает любые пробельные символы в один пробел', () => {
    expect(oneLine('  Драйв\n\tи   ещё  ')).toBe('Драйв и ещё');
  });
});

describe('renderPlayerSection', () => {
  it('печатает заголовок, дату и буллеты', () => {
    const text = renderPlayerSection(CARD, '2026-08-26');
    expect(text).toBe(
      [
        '## Ваня',
        '',
        '_Анкета от 2026-08-26._',
        '',
        '- **Кино и сериалы:** Драйв, Во все тяжкие',
        '- **Спорт:** Формула-1',
        '- **Скучно:** Политика, Мода',
      ].join('\n'),
    );
  });

  it('не печатает «Скучно», когда список пуст', () => {
    const text = renderPlayerSection({ ...CARD, boring: [] }, '2026-08-26');
    expect(text).not.toContain('Скучно');
  });

  // Тот же класс дефекта, что дал бесконечный рост файла в слайсе B: чужой
  // текст, попавший в markdown без обработки, становится настоящей границей
  // раздела и рвёт разбор.
  it('не даёт чужому тексту в имени или примере создать новую строку', () => {
    const text = renderPlayerSection(
      {
        name: 'Ваня\n## Катя',
        interests: [{ area: 'Спорт', examples: ['Формула-1\n---\nи ещё'] }],
        boring: [],
      },
      '2026-08-26',
    );
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toHaveLength(1);
    expect(text.split('\n').some((line) => line.startsWith('---'))).toBe(false);
  });
});

describe('upsertPlayerSection', () => {
  it('заменяет раздел существующего игрока, не трогая соседей', () => {
    const updated = upsertPlayerSection(FILE, CARD, '2026-08-26');
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).not.toContain('- **Спорт:** старое');
    expect(updated).toContain('## Катя');
    expect(updated).toContain('- **Музыка:** джаз');
    expect(updated).toContain('Вводный текст.');
  });

  it('добавляет нового игрока в конец', () => {
    const updated = upsertPlayerSection(
      FILE,
      { ...CARD, name: 'Петя' },
      '2026-08-26',
    );
    expect(updated).toContain('## Петя');
    expect(updated).toContain('## Ваня');
    expect(updated.indexOf('## Петя')).toBeGreaterThan(
      updated.indexOf('## Катя'),
    );
  });

  it('узнаёт игрока независимо от регистра и лишних пробелов', () => {
    const updated = upsertPlayerSection(
      FILE,
      { ...CARD, name: '  ваня ' },
      '2026-08-26',
    );
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## ваня', '## Катя']);
    expect(updated).not.toContain('- **Спорт:** старое');
  });

  // '## Ваня и Катя'.startsWith('## Ваня') истинно, и поиск раздела по началу
  // строки нашёл бы чужую анкету. Замена обязана попасть в своего игрока.
  it('не задевает игрока, чьё имя начинается так же', () => {
    const file = [
      '## Ваня и Катя',
      '',
      '- **Музыка:** чужое',
      '',
      '## Ваня',
      '',
      '- **Спорт:** старое',
      '',
    ].join('\n');
    const updated = upsertPlayerSection(file, CARD, '2026-08-26');
    expect(updated).toContain('- **Музыка:** чужое');
    expect(updated).not.toContain('- **Спорт:** старое');
  });

  it('идемпотентна: повторная запись той же анкеты ничего не меняет', () => {
    const once = upsertPlayerSection(FILE, CARD, '2026-08-26');
    expect(upsertPlayerSection(once, CARD, '2026-08-26')).toBe(once);
  });
});

describe('listPlayers', () => {
  it('перечисляет игроков с датами анкет', () => {
    expect(listPlayers(FILE)).toEqual([
      { name: 'Ваня', date: '2026-08-01' },
      { name: 'Катя', date: '2026-08-02' },
    ]);
  });

  it('на файле без игроков отдаёт пустой список', () => {
    expect(listPlayers('# Анкеты игроков\n\nВводный текст.\n')).toEqual([]);
  });
});
