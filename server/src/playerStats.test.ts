import { describe, expect, it } from 'vitest';
import { renderPlayerStats, spliceStatsSection } from './playerStats.js';
import type { PlayerStats } from './history.js';

const STATS: PlayerStats = {
  games: 7,
  people: [
    {
      id: 1,
      name: 'Ваня',
      games: 7,
      played: 210,
      buzzes: 63,
      correct: 48,
      themes: [
        { themeName: 'История СССР', played: 12, buzzes: 6, correct: 5 },
        { themeName: 'Спорт', played: 10, buzzes: 4, correct: 1 },
      ],
    },
  ],
};

describe('renderPlayerStats', () => {
  it('печатает шапку, итог и темы', () => {
    const text = renderPlayerStats(STATS);
    expect(text).toContain('## Показывает в игре');
    expect(text).toContain('_Выборка: 7 партий с опознанными игроками._');
    expect(text).toContain('### Ваня');
    expect(text).toContain(
      'Всего: нажимал 63 из 210 сыгранных при нём вопросов, верно 48.',
    );
    expect(text).toContain(
      '- **История СССР** — нажимал 6 из 12 вопросов темы, верно 5',
    );
  });

  // Ревью (после сдачи задачи): раздел машинный, но в нём не было ни слова
  // об этом — правка руками молча исчезала на следующем game-end. У
  // «Автособранного» такое предупреждение есть (profileSection.ts), в спеке
  // (docs/superpowers/specs/2026-08-26-player-identity-design.md, пример
  // раздела) оно приведено дословно и для этого раздела — бриф его потерял.
  it('печатает предупреждение, что правки руками не сохранятся', () => {
    const text = renderPlayerStats(STATS);
    expect(text).toContain(
      '_Раздел пересчитывается сервером после каждой партии. Правки руками ' +
        'не сохранятся — пиши их в анкету выше. Источник — `game-history.db`._',
    );
  });

  it('на пустой базе печатает заголовок и «пока пусто»', () => {
    const text = renderPlayerStats({ games: 0, people: [] });
    expect(text).toContain('## Показывает в игре');
    expect(text).toContain('Пока пусто');
    expect(text).not.toContain('###');
  });

  it('печатает не больше десяти тем на человека', () => {
    const themes = Array.from({ length: 15 }, (_, i) => ({
      themeName: `Тема ${i}`,
      played: 10,
      buzzes: 15 - i,
      correct: 1,
    }));
    const text = renderPlayerStats({
      games: 1,
      people: [{ ...STATS.people[0], themes }],
    });
    expect(text.split('\n').filter((l) => l.startsWith('- **'))).toHaveLength(
      10,
    );
  });

  // Тот же класс дефекта, что чинили в слайсах B и D1: чужой текст, попавший
  // в markdown без обработки, становится границей раздела и рвёт разбор.
  // Имя человека приходит из лобби, название темы — из пакета.
  it('не даёт имени или названию темы создать новую строку', () => {
    const text = renderPlayerStats({
      games: 1,
      people: [
        {
          ...STATS.people[0],
          name: 'Ваня\n## Катя',
          themes: [
            { themeName: 'Спорт\n---\nещё', played: 1, buzzes: 1, correct: 1 },
          ],
        },
      ],
    });
    for (const line of text.split('\n')) {
      expect(line.startsWith('## ')).toBe(line === '## Показывает в игре');
      expect(line.startsWith('---')).toBe(false);
    }
  });
});

describe('spliceStatsSection', () => {
  const FILE = [
    '# Анкеты игроков',
    '',
    'Вводный текст.',
    '',
    '---',
    '',
    '## Ваня',
    '',
    '- **Спорт:** Формула-1',
    '',
  ].join('\n');

  it('дописывает раздел в конец, не трогая анкеты', () => {
    const updated = spliceStatsSection(FILE, '## Показывает в игре\n\nтело');
    expect(updated).toContain('- **Спорт:** Формула-1');
    expect(updated).toContain('## Показывает в игре');
    expect(updated.trimEnd().endsWith('тело')).toBe(true);
  });

  it('идемпотентна', () => {
    const once = spliceStatsSection(FILE, '## Показывает в игре\n\nтело');
    expect(spliceStatsSection(once, '## Показывает в игре\n\nтело')).toBe(once);
  });

  it('заменяет старый раздел, а не дописывает второй', () => {
    const once = spliceStatsSection(FILE, '## Показывает в игре\n\nстарое');
    const twice = spliceStatsSection(once, '## Показывает в игре\n\nновое');
    expect(twice).toContain('новое');
    expect(twice).not.toContain('старое');
    expect(twice.split('## Показывает в игре')).toHaveLength(2);
  });

  // Ревью (после сдачи задачи), Important 2: человек без анкеты играет
  // партию — раздел статистики ложится в конец файла. Потом он присылает
  // анкету — savePlayerCard дописывает её в АБСОЛЮТНЫЙ конец, не зная про
  // раздел статистики ниже, и анкета оказывается ПОД машинным разделом.
  // Порядок «анкеты выше, машинное последним» ломается навсегда, если
  // замена держится за старое место раздела. Правильный пересчёт вырезает
  // старое вхождение и дописывает свежий текст в истинный конец файла —
  // тогда первый же следующий game-end возвращает анкету наверх.
  it('самолечит порядок: анкета, дописанная после раздела статистики, пересчётом уходит выше него', () => {
    const once = spliceStatsSection(FILE, '## Показывает в игре\n\nтело');
    // То же самое, что делает savePlayerCard — дописывает анкету в конец
    // файла, не заглядывая в findSectionRange по STATS_HEADING.
    const withLateCard = `${once}\n## Катя\n\n- **Кино:** Тарантино\n`;
    const healed = spliceStatsSection(
      withLateCard,
      '## Показывает в игре\n\nтело',
    );
    expect(healed).toContain('## Катя');
    expect(healed).toContain('- **Кино:** Тарантино');
    const statsIndex = healed.indexOf('## Показывает в игре');
    const katyaIndex = healed.indexOf('## Катя');
    expect(katyaIndex).toBeGreaterThan(-1);
    expect(katyaIndex).toBeLessThan(statsIndex);
    // Раздел статистики по-прежнему один — самолечение не задваивает его.
    expect(healed.split('## Показывает в игре')).toHaveLength(2);
  });

  // Ревью, Minor 3: шаблон docs/players.md уже заканчивается строкой «---»
  // (см. сам файл) — безусловное добавление ещё одной давало на свежем файле
  // два разделителя подряд.
  it('не задваивает разделитель, когда файл уже заканчивается на «---»', () => {
    const template = '# Анкеты игроков\n\nВводный текст.\n\n---\n';
    const updated = spliceStatsSection(
      template,
      '## Показывает в игре\n\nтело',
    );
    expect(updated.match(/^---$/gm)).toHaveLength(1);
  });
});
