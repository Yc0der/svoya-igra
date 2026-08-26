import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AREAS = [
  'Кино и сериалы',
  'Музыка',
  'Спорт',
  'Книги',
  'Игры',
  'Еда и путешествия',
  'Увлечения и работа',
];

const BORING = [
  'Спорт',
  'Политика',
  'История',
  'Наука',
  'География',
  'Кино',
  'Музыка',
  'Литература',
  'Искусство',
  'Техника',
  'Мода',
  'Животные',
];

const SOURCE = readFileSync(
  new URL('../../docs/anketa.html', import.meta.url),
  'utf8',
);

describe('docs/anketa.html', () => {
  // Главное требование к странице: она открывается с file:// на чужом
  // телефоне, где интернета может не быть вовсе. Любая внешняя ссылка —
  // шрифт, картинка, скрипт — превращает её в неработающую именно там, где
  // проверить это некому.
  it('не ссылается ни на что снаружи', () => {
    expect(SOURCE).not.toMatch(/https?:\/\//);
    expect(SOURCE).not.toMatch(/<link[^>]+href=/i);
    expect(SOURCE).not.toMatch(/<script[^>]+src=/i);
  });

  it('содержит все области анкеты', () => {
    for (const area of AREAS) expect(SOURCE).toContain(area);
  });

  it('содержит весь список скучного', () => {
    for (const item of BORING) expect(SOURCE).toContain(item);
  });

  // Копирование через navigator.clipboard требует защищённого контекста и на
  // file:// в незнакомом браузере может не сработать (svoya-igra-dev,
  // «Ловушки»: возможности браузера без HTTPS). Поле с кодом обязано быть
  // видимым и выделяемым само по себе.
  it('показывает код в поле, а не только в кнопке', () => {
    expect(SOURCE).toMatch(/<textarea[^>]*id="code"/i);
  });

  it('объявляет ту же версию формата, что разбирает сервер', () => {
    expect(SOURCE).toContain('version: 1');
  });
});
