# Заметный отклик на клик — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить мгновенный визуальный отклик на нажатие кнопки (`:active`) и усилить
существующее состояние «уже выбрано» (`.is-selected`) — чистая CSS-полировка без изменения
логики.

**Architecture:** Правки только в `client/src/index.css`. Три байт-в-байт одинаковых правила
`.is-selected` (голосование, выбор LAN-адреса, выбор пакета) объединяются в одно общее
`.button.is-selected`. Никакой `.tsx`-файл не меняется — существующие компоненты уже
проставляют класс `is-selected` там, где нужно.

**Tech Stack:** Чистый CSS, без изменений в стеке.

## Global Constraints

- Изменения только в `client/src/index.css` — ни один `.tsx`-файл не трогается.
- `:active` не должен применяться к задизейбленным кнопкам (`:not(:disabled)`), иначе
  задизейбленная кнопка визуально «проседает» при клике, хотя обработчик не вызывается.
- Вибрация (`navigator.vibrate`) в этот заход не входит — откладывается в `docs/ideas.md` до
  живой проверки на телефоне по `http://` (project doctrine, «Ловушки», «Возможности
  браузера без HTTPS»).
- `prefers-reduced-motion` не учитывается — проект нигде ещё не поддерживает эту настройку,
  заводить её только для этой фичи было бы непоследовательным решением вне рамок задачи.

---

### Task 1: `:active` и усиленный `.is-selected` в `index.css`

**Files:**

- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: ничего нового — класс `is-selected` уже проставляется существующими компонентами
  (`Player.tsx`, `Admin.tsx`) на элементы с классом `button`.
- Produces: ничего наружу — конец цепочки, чистая стилизация.

- [ ] **Step 1: Добавить `transition` и `:active` в базовый класс `.button`**

`client/src/index.css`, строки 264–273 — текущее содержимое:

```css
.button {
  font-size: 24px;
  font-weight: 600;
  padding: 16px 32px;
  border-radius: 12px;
  border: 2px solid var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent);
  min-height: 56px;
}
```

Заменить на:

```css
.button {
  font-size: 24px;
  font-weight: 600;
  padding: 16px 32px;
  border-radius: 12px;
  border: 2px solid var(--accent-border);
  background: var(--accent-bg);
  color: var(--accent);
  min-height: 56px;
  transition: transform 0.1s ease;
}

.button:active:not(:disabled) {
  transform: scale(0.96);
}
```

(Существующее правило `.button:disabled { opacity: 0.4; }` сразу следом — не трогать, `:not(:disabled)`
в новом правиле работает независимо от него.)

- [ ] **Step 2: Объединить три правила `.is-selected` в одно, с усилением**

Удалить первое из трёх правил — `client/src/index.css`, строки 316–320:

```css
.button--yes.is-selected,
.button--no.is-selected {
  outline: 4px solid var(--text-h);
  outline-offset: 2px;
}
```

Удалить второе — рядом с `.admin-lan-candidates`:

```css
.admin-lan-candidates .button.is-selected {
  outline: 4px solid var(--text-h);
  outline-offset: 2px;
}
```

Удалить третье — рядом с `.admin-packs`/`.player-packs`:

```css
.admin-packs .button.is-selected,
.player-packs .button.is-selected {
  outline: 4px solid var(--text-h);
  outline-offset: 2px;
}
```

На место **первого** из трёх (там, где была пара `.button--yes.is-selected,
.button--no.is-selected`) вставить одно общее правило:

```css
.button.is-selected {
  outline: 4px solid var(--text-h);
  outline-offset: 2px;
  transform: scale(1.05);
}
```

(Правило действует на все три места сразу — `.button--yes`/`.button--no` это модификаторы
класса `.button`, а `.admin-lan-candidates .button`/`.admin-packs .button`/`.player-packs
.button` уже несут класс `.button` напрямую на кнопке. Четвёртое место, где реально
встречается `is-selected` в разметке — кнопка подтверждения сброса комнаты в `Admin.tsx`
(`className="button button--no...is-selected"`) — тоже покрывается автоматически, оно и
раньше совпадало с этим же CSS-правилом, просто через модификатор `--no`.)

- [ ] **Step 3: Проверить, что ничего не сломалось**

```bash
cd client
npx vitest run
```

Expected: все существующие тесты зелёные, включая те, что проверяют присутствие класса
`is-selected` на кнопках (`Player.test.tsx`, `Admin.test.tsx`) — эта задача не меняет, какой
класс к чему применяется, только CSS-правила для уже существующего класса, так что assertions
на `toHaveClass('is-selected')` не могут сломаться.

- [ ] **Step 4: Полная проверка проекта**

```bash
cd ..
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

(`oxlint`/`eslint` не проверяют CSS — эта задача не тронет ни typecheck, ни lint содержательно,
но полный прогон подтверждает, что `vite build` собирает изменённый `index.css` без ошибок и
ничего другого не задето.)

- [ ] **Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "feat: add instant click feedback and a stronger selected-state style to buttons"
```

---

## После плана

Живая проверка на реальных телефонах (не отдельный вечер игры — короткая полировочная
проверка): нажать несколько кнопок подряд (голосование, buzz, выбор вопроса) и убедиться, что
отклик ощущается мгновенным, а увеличенный `.is-selected` действительно виден издалека, не
выглядит навязчивым или дёрганым. Заодно — первая возможность честно проверить, работает ли
`navigator.vibrate` по `http://` на реальном устройстве (если да, эта запись в `docs/ideas.md`
разблокируется и может пойти в отдельный маленький заход).
