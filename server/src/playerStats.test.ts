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
});
