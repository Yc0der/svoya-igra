// Нарезка docs/anketa.html на картинки по пунктам.
//
// Зачем. Спека анкеты (docs/superpowers/specs/2026-08-26-player-questionnaire-design.md,
// «Живая проверка») предупреждала: на iOS присланный в мессенджере .html
// сначала надо сохранить в «Файлы» и только оттуда открыть в браузере. Это
// ровно тот случай, когда человек бросает анкету, не начав. Запасной ход:
// прислать ему картинки, он отвечает обычным сообщением, а анкету за него
// заполняет ведущий у себя на ноутбуке и вставляет код в /admin.
//
// Картинки собираются ИЗ САМОЙ СТРАНИЦЫ — подписи, подсказки и примеры
// вытаскиваются из её разметки, оформление берётся из её же <style>. Иначе
// через месяц правки в анкете и картинки в мессенджере разъедутся, и никто
// этого не заметит.
//
// Перегенерировать после любой правки docs/anketa.html:
//   pnpm run anketa:screens

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs', 'anketa.html');
const OUT_DIR = join(ROOT, 'docs', 'anketa-screens');

// Слаг файла по id поля в анкете: area-cinema -> cinema. Латиница, потому что
// имя файла едет в мессенджер и на чужой телефон.
const SLUGS = {
  name: 'name',
  'area-cinema': 'cinema',
  'area-music': 'music',
  'area-sport': 'sport',
  'area-books': 'books',
  'area-games': 'games',
  'area-food': 'food',
  'area-hobbies': 'hobbies',
  boring: 'boring',
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 760, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(pathToFileURL(SOURCE).href);

const { style, items } = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.card'))
    // Карточка с кодом — часть флоу «заполнил сам», в картинках её быть не
    // должно: отвечающий по картинкам никакого кода не увидит.
    .filter((card) => card.id !== 'result');

  const collected = cards.map((card) => {
    const label = card.querySelector('label');
    const hint = card.querySelector('.hint');
    const field = card.querySelector('input, textarea');
    const chips = Array.from(card.querySelectorAll('.boring-grid .toggle'));

    return {
      id: field ? field.id : 'boring',
      label: label ? label.textContent.trim() : '',
      hint: hint ? hint.textContent.trim() : '',
      example: field ? field.getAttribute('placeholder') : '',
      chips: chips.map((chip) => chip.textContent.trim()),
    };
  });

  return {
    style: document.querySelector('style').textContent,
    items: collected,
  };
});

const total = items.length;

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cover = `
  <div class="shot">
    <div class="card">
      <h1>Анкета интересов</h1>
      <p class="hint">Своя игра — набор вопросов собирается под тех, кто будет за столом.</p>
      <p>
        Дальше ${total} картинок с вопросами. Ответь одним сообщением: номер пункта
        и ответ. Любой пункт можно пропустить — заполнять всё необязательно.
      </p>
      <p>
        Чем конкретнее примеры, тем лучше выйдет пак: не «люблю кино», а какие
        именно фильмы.
      </p>
    </div>
  </div>
`;

const cards = items
  .map((item, index) => {
    const number = index + 1;
    const body = item.chips.length
      ? `<div class="boring-grid">${item.chips
          .map(
            (chip) =>
              `<button type="button" class="toggle">${escape(chip)}</button>`,
          )
          .join('')}</div>`
      : `<p class="example">Например: ${escape(item.example ?? '')}</p>`;

    return `
      <div class="shot">
        <div class="card">
          <div class="num">Пункт ${number} из ${total}</div>
          <label>${escape(item.label)}</label>
          <p class="hint">${escape(item.hint)}</p>
          ${body}
        </div>
      </div>
    `;
  })
  .join('');

await page.setContent(`
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<style>
${style}
/* Поверх стилей самой анкеты — только то, что нужно картинке: рамка вокруг
   карточки, номер пункта и пример вместо пустого поля ввода. */
body { padding: 0; max-width: none; }
.shot { width: 640px; padding: 20px; background: var(--bg); }
.shot .card { margin: 0; }
.shot h1 { margin-top: 0; }
.num {
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.example {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--muted);
}
</style>
</head>
<body>
${cover}
${cards}
</body>
</html>
`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const shots = await page.locator('.shot').all();
const names = [
  '00-cover',
  ...items.map((item, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `${number}-${SLUGS[item.id] ?? item.id}`;
  }),
];

for (const [index, shot] of shots.entries()) {
  await shot.screenshot({ path: join(OUT_DIR, `${names[index]}.png`) });
}

// Текстовая копия — на случай, когда картинки не нужны и проще прислать
// сообщением текстом. Генерируется отсюда же, чтобы не разъехалась с анкетой.
const readme = `# Анкета в картинках

Картинки в этой папке — те же пункты, что в [\`../anketa.html\`](../anketa.html),
нарезанные по одному. Они для тех, кому неудобно открывать присланный файл —
чаще всего это iPhone: вложение сначала надо сохранить в «Файлы» и только оттуда
открыть в браузере.

**Как это работает.** Ведущий шлёт картинки (\`00-cover\` первой). Человек
отвечает обычным сообщением — номер пункта и ответ. Ведущий открывает
\`anketa.html\` у себя на ноутбуке, заполняет её за человека, жмёт «Готово» и
вставляет код в \`/admin\` → «Анкеты игроков».

Папка **собирается скриптом**, править картинки руками бессмысленно — после
любой правки \`anketa.html\` перегенерировать:

\`\`\`
pnpm run anketa:screens
\`\`\`

## Тот же текст сообщением

${items
  .map((item, index) => {
    const number = index + 1;
    const tail = item.chips.length
      ? item.chips.map((chip) => `\`${chip}\``).join(' · ')
      : `_Например: ${item.example ?? ''}_`;
    return `**${number}. ${item.label}**\n${item.hint}\n${tail}`;
  })
  .join('\n\n')}
`;

writeFileSync(join(OUT_DIR, 'README.md'), readme, 'utf8');

await browser.close();

console.log(
  `Готово: ${shots.length} картинок и README.md в docs/anketa-screens/`,
);
