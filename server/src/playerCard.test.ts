import { describe, expect, it } from 'vitest';
import {
  listPlayers,
  parsePlayerSection,
  removePlayerSection,
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

  // Катя — последний раздел файла: sectionEnd для ннего идёт до конца
  // массива строк, не до следующего «## », и это отдельный путь от замены
  // раздела где-то в середине, уже покрытой тестами выше.
  it('заменяет последний раздел файла, не оставляя хвостов старого', () => {
    const updated = upsertPlayerSection(
      FILE,
      { ...CARD, name: 'Катя' },
      '2026-08-26',
    );
    expect(updated).not.toContain('- **Музыка:** джаз');
    expect(updated).toContain('## Катя');
    expect(updated).toContain('- **Спорт:** Формула-1');
    // Сосед перед заменяемым разделом и сама замена — единственные два
    // раздела, ничего не задвоилось и не потерялось.
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Ваня', '## Катя']);
  });

  // Файл без завершающего перевода строки — отдельный путь от ветки
  // «дописать в конец» (там base сам добавляет \n), здесь же замена
  // читает lines = fileText.split('\n') на входе без финальной пустой
  // строки.
  it('заменяет раздел в файле без завершающего перевода строки', () => {
    const fileWithoutTrailingNewline = FILE.replace(/\n$/, '');
    expect(fileWithoutTrailingNewline.endsWith('\n')).toBe(false);
    const updated = upsertPlayerSection(
      fileWithoutTrailingNewline,
      CARD,
      '2026-08-26',
    );
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).not.toContain('- **Спорт:** старое');
    expect(updated).toContain('## Катя');
    expect(updated).toContain('- **Музыка:** джаз');
  });

  // Финальное ревью ветки, п. 5: если ведущий руками продублировал раздел
  // одного и того же игрока, замена одним findIndex попадала бы только в
  // первую копию — вторая молча оставалась бы со старыми данными.
  it('сносит все разделы с этим именем, а не только первый, если игрок задвоен вручную', () => {
    const file = [
      '## Ваня',
      '',
      '- **Спорт:** старое сверху',
      '',
      '## Катя',
      '',
      '- **Музыка:** джаз',
      '',
      '## Ваня',
      '',
      '- **Спорт:** старое снизу',
      '',
    ].join('\n');
    const updated = upsertPlayerSection(file, CARD, '2026-08-26');
    const headings = updated
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Ваня', '## Катя']);
    expect(updated).not.toContain('старое сверху');
    expect(updated).not.toContain('старое снизу');
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).toContain('- **Музыка:** джаз');
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
  it('не считает машинный раздел «Показывает в игре» анкетой', () => {
    const file = [
      '## Ваня',
      '',
      '- **Спорт:** хоккей',
      '',
      '## Показывает в игре',
      '',
      '### Ваня',
      '',
      'Всего: нажимал 1 из 2.',
      '',
    ].join('\n');
    expect(listPlayers(file).map((player) => player.name)).toEqual(['Ваня']);
  });

  // Файл заявлен как правимый руками, а до этой правки анкета, сохранённая
  // после первой же партии, ложилась НИЖЕ машинного раздела и пропадала из
  // списка совсем: чтение останавливалось на нём.
  it('находит анкету, оказавшуюся ниже машинного раздела', () => {
    const file = [
      '## Показывает в игре',
      '',
      '### Ваня',
      '',
      'Всего: нажимал 1 из 2.',
      '',
      '## Катя',
      '',
      '_Анкета от 2026-08-02._',
      '',
      '- **Спорт:** хоккей',
      '',
    ].join('\n');
    expect(listPlayers(file)).toEqual([{ name: 'Катя', date: '2026-08-02' }]);
  });
});

describe('upsertPlayerSection и машинный раздел', () => {
  const WITH_STATS = [
    FILE,
    '',
    '---',
    '',
    '## Показывает в игре',
    '',
    '### Ваня',
    '',
    'Всего: нажимал 1 из 2.',
    '',
  ].join('\n');

  // «Показывает в игре» дописывается в конец файла, поэтому дописать туда же
  // новую анкету значит положить её под машинный раздел — там ей не место ни
  // по документации файла, ни для того, кто правит его руками.
  it('новую анкету кладёт выше «Показывает в игре», а не в конец файла', () => {
    const updated = upsertPlayerSection(
      WITH_STATS,
      {
        name: 'Петя',
        interests: [{ area: 'Спорт', examples: ['хоккей'] }],
        boring: [],
      },
      '2026-09-02',
    );
    expect(updated.indexOf('## Петя')).toBeLessThan(
      updated.indexOf('## Показывает в игре'),
    );
    expect(listPlayers(updated).map((player) => player.name)).toEqual([
      'Ваня',
      'Катя',
      'Петя',
    ]);
  });

  // Замена существующей анкеты и раньше попадала в своё место; тест держит
  // это на месте, чтобы правка вставки не начала таскать разделы в конец.
  it('замену существующей анкеты оставляет на её месте', () => {
    const updated = upsertPlayerSection(WITH_STATS, CARD, '2026-09-02');
    expect(listPlayers(updated).map((player) => player.name)).toEqual([
      'Ваня',
      'Катя',
    ]);
    expect(updated.indexOf('## Ваня')).toBeLessThan(
      updated.indexOf('## Показывает в игре'),
    );
  });
});

describe('parsePlayerSection', () => {
  it('разбирает обратно то, что записал renderPlayerSection', () => {
    const file = upsertPlayerSection(FILE, CARD, '2026-08-26');
    const parsed = parsePlayerSection(file, CARD.name);
    expect(parsed?.card).toEqual(CARD);
    expect(parsed?.extraLines).toEqual([]);
  });

  it('ручную пометку кладёт в extraLines, а не в интересы', () => {
    const file = [
      '## Ваня',
      '',
      '_Анкета от 2026-08-01._',
      '',
      '- **Спорт:** хоккей',
      'Пришёл через Катю, спросить про сериалы.',
      '',
    ].join('\n');
    const parsed = parsePlayerSection(file, 'Ваня');
    expect(parsed?.card.interests).toEqual([
      { area: 'Спорт', examples: ['хоккей'] },
    ]);
    expect(parsed?.extraLines).toEqual([
      'Пришёл через Катю, спросить про сериалы.',
    ]);
  });

  it('«Скучно» попадает в boring, а не в интересы', () => {
    const file = [
      '## Ваня',
      '',
      '- **Спорт:** хоккей',
      '- **Скучно:** Мода, Политика',
      '',
    ].join('\n');
    const parsed = parsePlayerSection(file, 'Ваня');
    expect(parsed?.card.boring).toEqual(['Мода', 'Политика']);
    expect(parsed?.card.interests).toEqual([
      { area: 'Спорт', examples: ['хоккей'] },
    ]);
  });

  it('имя сравнивает нечувствительно к регистру и лишним пробелам', () => {
    expect(parsePlayerSection(FILE, '  вАНЯ ')?.card.name).toBe('Ваня');
  });

  it('не отдаёт чужой раздел по префиксу имени', () => {
    const file = ['## Ваня и Катя', '', '- **Спорт:** хоккей', ''].join('\n');
    expect(parsePlayerSection(file, 'Ваня')).toBeNull();
  });

  it('на незнакомое имя отдаёт null', () => {
    expect(parsePlayerSection(FILE, 'Пётр')).toBeNull();
  });
});

describe('removePlayerSection', () => {
  it('вырезает раздел, не трогая соседей и вводную часть', () => {
    const result = removePlayerSection(FILE, 'Ваня');
    expect(result).toContain('Вводный текст.');
    expect(result).toContain('## Катя');
    expect(result).not.toContain('## Ваня');
    expect(result).not.toContain('- **Спорт:** старое');
  });

  it('вырезает все разделы с этим именем, а не только первый', () => {
    const doubled = `${FILE}
## Ваня

- **Игры:** дота
`;
    const result = removePlayerSection(doubled, 'Ваня');
    expect(result).not.toContain('## Ваня');
    expect(result).not.toContain('- **Игры:** дота');
  });

  it('на незнакомое имя оставляет файл байт в байт', () => {
    expect(removePlayerSection(FILE, 'Пётр')).toBe(FILE);
  });

  it('не оставляет за собой хвост из пустых строк', () => {
    const result = removePlayerSection(FILE, 'Катя');
    expect(result.endsWith('\n\n\n')).toBe(false);
  });
});

describe('renderPlayerSection с extraLines', () => {
  it('возвращает нераспознанные строки в конец раздела', () => {
    const section = renderPlayerSection(CARD, '2026-08-26', ['Пометка.']);
    expect(section.split('\n').at(-1)).toBe('Пометка.');
  });

  it('переживает круг разбор → правка → запись', () => {
    const file = [
      '## Ваня',
      '',
      '_Анкета от 2026-08-01._',
      '',
      '- **Спорт:** хоккей',
      'Пометка ведущего.',
      '',
    ].join('\n');
    const parsed = parsePlayerSection(file, 'Ваня');
    const updated = upsertPlayerSection(
      file,
      { ...parsed!.card, boring: ['Мода'] },
      '2026-09-02',
      parsed!.extraLines,
    );
    expect(updated).toContain('- **Скучно:** Мода');
    expect(updated).toContain('Пометка ведущего.');
  });
});
