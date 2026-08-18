# Фаза проигрывания медиа + правки плеера — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Таймер вопроса стартует только после того, как видеоклип доиграл, а сам плеер грузится заранее, останавливается вовремя и не показывает название ролика.

**Architecture:** Новая фаза движка `question-media` между открытием вопроса и `question-open`. Движок остаётся чистым: «клип доиграл» приходит событием `media-finished`, ровно как «истёк таймер N». Табло — единственный, кто это событие порождает (по собственному опросу `getCurrentTime()`); Комната страхует его таймером на случай молчания.

**Tech Stack:** TypeScript, Node, Vitest (сервер), React + Vite, Testing Library (клиент), YouTube IFrame Player API.

**Спека:** `docs/superpowers/specs/2026-08-18-video-questions-design.md`, разделы «Фаза проигрывания медиа» и «Сервер и клиент». Спека — источник правды; расхождение плана со спекой решается в пользу спеки, с остановкой и вопросом.

## Global Constraints

- **Инвариант 1 (движок не знает про сеть, диск и часы) не нарушается.** В `engine.ts` не появляется ни `Date.now()`, ни `setTimeout`, ни `fetch`, ни знания про YouTube. Только новое событие и новый `start-timer`.
- **Инвариант 3 (стабильный id вопроса) используется здесь напрямую:** сигнал «клип доиграл» несёт `questionId` и сверяется с текущим вопросом.
- **Видео — только на табло.** В `Player.tsx` не появляется ни плеера, ни `youtubeId`; телефон в новой фазе показывает только текст-подсказку.
- **Вопрос без `video` ведёт себя ровно как раньше** — сразу `question-open`, таймер идёт. Картинки эта веха не трогает.
- **Переоткрытие после неверного ответа при ведущем медиа-фазу не проходит** — клип второй раз не играет.
- **Страховочный таймер:** `MEDIA_TIMER_MS = 45_000`.
- Тесты движка не используют настоящие таймеры и настоящую сеть; тесты клиента не грузят настоящий скрипт YouTube.
- Комментарии и сообщения — по-русски, как во всём проекте.

---

### Task 1: Движок — фаза `question-media`

**Files:**

- Modify: `server/src/engine.ts`
- Test: `server/src/engine.test.ts`

**Interfaces:**

- Consumes: существующие `Phase`, `TimerName`, `EngineEvent`, `EngineState`, `Effect`.
- Produces: `Phase` пополняется `'question-media'`; `TimerName` — `'media'`; `EngineEvent` — `{ type: 'media-finished'; questionId: string }`; экспортируется `MEDIA_TIMER_MS = 45_000`.

- [ ] **Шаг 1: Написать падающие тесты**

В `engine.test.ts`, рядом с существующими тестами выбора вопроса. Пак-фикстуру с видео собрать по образцу уже имеющихся фикстур файла, добавив вопросу поле `video: { youtubeId: 'abc', startSeconds: 0, durationSeconds: 8 }`.

Покрыть ровно эти поведения:

1. `select-question` на вопрос **с** `video` → `phase === 'question-media'`, среди эффектов `{ type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS }`, и **нет** `start-timer` с `timer: 'question'`.
2. `select-question` на вопрос **без** `video` → `phase === 'question-open'` и таймер `question` (регрессия — поведение не должно измениться).
3. `media-finished` с верным `questionId` в фазе `question-media` → `phase === 'question-open'` и `start-timer` с `timer: 'question'`, `ms: QUESTION_TIMER_MS`.
4. `media-finished` с **чужим** `questionId` → состояние не меняется (`unchanged`).
5. `media-finished` в фазе `question-open` → состояние не меняется.
6. `timer-expired` с `timer: 'media'` → тот же результат, что у поведения 3.
7. `buzz` в фазе `question-media` → состояние не меняется (кнопка «Ответ» не принимается).
8. Вопрос-«кот» с `video`: `assign-cat` → `question-media`, а не `question-open`.
9. Вопрос-аукцион с `video`: победа в торгах → `question-media`, а не `question-open`.
10. Переоткрытие после неверного ответа при ведущем (`vote` → неверно, `hostId` не `null`, вопрос с `video`) → `question-open` напрямую, **без** медиа-фазы.
11. `cancel-question` ведущим в фазе `question-media` закрывает вопрос так же, как из `question-open`.

Пример формы теста (остальные — по этому же образцу):

```ts
it('вопрос с видео уходит в question-media, а таймер вопроса ещё не идёт', () => {
  const state = stateWithVideoQuestion();
  const { state: next, effects } = reduce(state, {
    type: 'select-question',
    counterId: 'c1',
    themeIndex: 0,
    questionId: 'r1-kino-100',
  });
  expect(next.phase).toBe('question-media');
  expect(effects).toContainEqual({
    type: 'start-timer',
    timer: 'media',
    ms: MEDIA_TIMER_MS,
  });
  expect(effects.some((e) => 'timer' in e && e.timer === 'question')).toBe(
    false,
  );
});
```

- [ ] **Шаг 2: Прогнать тесты, убедиться что падают**

Run: `pnpm -C server test -- engine`
Expected: FAIL — `'question-media'` не существует как фаза, `media-finished` не обрабатывается.

- [ ] **Шаг 3: Реализовать в `engine.ts`**

1. В `Phase` добавить `'question-media'` (после `'auction-bidding'`, перед `'question-open'` — порядок в объединении отражает порядок в партии).
2. В `TimerName` добавить `'media'`.
3. Рядом с прочими константами таймеров:

```ts
// Аварийный выход, а не рабочий сценарий: если табло не прислало «клип
// доиграл» (закрыли вкладку, отвалилась сеть, ролик не загрузился), партия
// обязана поехать дальше сама. Заведомо больше самого длинного разумного
// клипа плюс загрузка — в нормальной партии срабатывать не должен
// (design.md, 2026-08-18-video-questions-design.md, «Фаза проигрывания медиа»).
export const MEDIA_TIMER_MS = 45_000;
```

4. В `EngineEvent` добавить `| { type: 'media-finished'; questionId: string }`, с комментарием, что событие порождает табло, а движок про YouTube ничего не знает.
5. Завести общий хелпер входа в вопрос — чтобы три точки входа не разъехались:

```ts
// Единая точка входа в открытый вопрос: с видео — сперва фаза проигрывания
// медиа (таймер вопроса ещё не идёт), без видео — сразу question-open, как
// было всегда. Три вызывающих (обычный выбор, «кот», победа в торгах)
// обязаны идти через неё, иначе поведение разъедется между механиками.
function openQuestion(
  state: EngineState,
  extra: Partial<EngineState> = {},
): Result {
  // extra применяется ДО чтения currentQuestion: при обычном выборе вопроса
  // он приходит именно здесь и в state ещё не лежит.
  const next = { ...state, ...extra };
  const question = findQuestion(
    next.pack,
    next.roundIndex,
    next.currentQuestion!.themeIndex,
    next.currentQuestion!.questionId,
  )!;
  if (question.video) {
    return {
      state: { ...next, phase: 'question-media' },
      effects: [{ type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS }],
    };
  }
  return {
    state: { ...next, phase: 'question-open' },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}
```

6. Перевести на `openQuestion` три места: конец `handleSelectQuestion` (обычный вопрос — там `currentQuestion` уже посчитан, передать его через `extra`), `handleAssignCat` (`extra` — `exclusiveAnswererCounterId`), ветку победы в торгах внутри обработчика ставок (`extra` — `exclusiveAnswererCounterId` и сброс аукционных полей). **`resolveVote` не трогать** — переоткрытие остаётся прямым `question-open`, с комментарием почему.
7. Добавить обработчик:

```ts
function handleMediaFinished(
  state: EngineState,
  event: Extract<EngineEvent, { type: 'media-finished' }>,
): Result {
  if (
    state.phase !== 'question-media' ||
    state.currentQuestion?.questionId !== event.questionId
  ) {
    // Опоздавший сигнал от предыдущего вопроса или дубль от второго
    // открытого табло — молчаливый no-op (design.md, «Фаза проигрывания медиа»).
    return unchanged(state);
  }
  return {
    state: { ...state, phase: 'question-open' },
    effects: [
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ],
  };
}
```

8. Подключить его в `switch` в `reduce`, а в `handleTimerExpired` добавить `case 'media':` — он должен привести ровно к тому же результату, что и сигнал от табло (переиспользовать общий код, а не дублировать переход).
9. Проверить `cancel-question` и любые другие места, перечисляющие фазы вопроса: если где-то стоит проверка `phase === 'question-open'`, решить осознанно, должна ли она принимать и `question-media`, и записать решение комментарием.

- [ ] **Шаг 4: Прогнать тесты**

Run: `pnpm -C server test -- engine`
Expected: PASS, включая все ранее существовавшие тесты движка.

- [ ] **Шаг 5: Коммит**

```bash
git add server/src/engine.ts server/src/engine.test.ts
git commit -m "feat: фаза question-media — таймер вопроса ждёт конца клипа"
```

---

### Task 2: Комната, протокол, сервер — доставка сигнала

**Files:**

- Modify: `server/src/room.ts`, `server/src/protocol.ts`, `server/src/server.ts`
- Test: `server/src/room.test.ts`, `server/src/server.test.ts`

**Interfaces:**

- Consumes: из Task 1 — `'question-media'`, `'media'`, `MEDIA_TIMER_MS`, событие `{ type: 'media-finished'; questionId: string }`.
- Produces: `ClientMessage` пополняется `{ type: 'media-finished'; questionId: string }`; `Room` получает метод `mediaFinished(questionId: string): void`.

- [ ] **Шаг 1: Написать падающие тесты**

В `room.test.ts`:

1. `PHASE_TIMER` покрывает новую фазу: комната, восстановленная из снапшота в фазе `question-media`, заводит таймер — по образцу уже существующего теста восстановления таймеров (найти его по `PHASE_TIMER`/восстановлению и повторить форму). Без этого партия зависла бы после перезапуска сервера.
2. `room.mediaFinished(questionId)` в фазе `question-media` переводит партию в `question-open`.
3. `room.mediaFinished('чужой-id')` ничего не меняет.
4. `toGameStateView` в фазе `question-media` отдаёт `currentQuestion` с заполненными `text` и `video` (вопрос уже виден) и `timerDeadline`, соответствующий медиа-таймеру.

В `server.test.ts`: сообщение `{ type: 'media-finished', questionId }` от сокета, который **не делал `join`** (табло), доводит партию до `question-open` — по образцу уже существующих тестов `admin-*`-сообщений.

- [ ] **Шаг 2: Прогнать, убедиться что падают**

Run: `pnpm -C server test -- room server`
Expected: FAIL.

- [ ] **Шаг 3: Реализовать**

1. `protocol.ts`: в `ClientMessage` добавить

```ts
// Шлёт табло по окончании клипа — оно не участник партии (никогда не делает
// 'join'), поэтому сообщение не привязано к личности отправителя, как admin-*.
// questionId — защита от опоздавшего сигнала по предыдущему вопросу
// (design.md, 2026-08-18-video-questions-design.md, «Фаза проигрывания медиа»).
| { type: 'media-finished'; questionId: string }
```

2. `room.ts`: в `PHASE_TIMER` добавить `'question-media': { timer: 'media', ms: MEDIA_TIMER_MS }` (импортировав константу), и метод:

```ts
mediaFinished(questionId: string): void {
  if (!this.game) return;
  this.dispatch({ type: 'media-finished', questionId });
}
```

3. `server.ts`: обработать новое сообщение там же, где обрабатываются сообщения, не требующие участника, вызвав `room.mediaFinished(msg.questionId)`.

- [ ] **Шаг 4: Прогнать тесты**

Run: `pnpm -C server test`
Expected: PASS — весь серверный набор, не только новые файлы.

- [ ] **Шаг 5: Коммит**

```bash
git add server/src
git commit -m "feat: доставка сигнала «клип доиграл» от табло до движка"
```

---

### Task 3: Плеер — предзагрузка, автозапуск, свой конец клипа, оверлей

**Files:**

- Modify: `client/src/VideoPlayer.tsx`, `client/src/VideoPlayer.test.tsx`, `client/src/index.css`

**Interfaces:**

- Consumes: `video: { youtubeId, startSeconds, durationSeconds, audioOnly }` — как сейчас.
- Produces: `VideoPlayer` получает новый обязательный проп `onFinished: () => void`, который вызывается ровно один раз за жизнь компонента — по достижении конца клипа либо по ошибке загрузки.

- [ ] **Шаг 1: Написать падающие тесты**

Мок `window.YT.Player` — **функция-конструктор, не стрелочная** (компонент вызывает `new`), с методами `playVideo`, `pauseVideo`, `getCurrentTime`, `getPlayerState`, `destroy`. Тесты:

1. Скрипт IFrame API запрашивается при монтировании, **до** какого-либо клика.
2. Плеер создаётся при монтировании (не по клику), с `playerVars`, где есть `start` и `autoplay: 1` и **нет** `end`.
3. Когда `getCurrentTime()` перевалил за `startSeconds + durationSeconds` — вызывается `pauseVideo()` и ровно один раз `onFinished`.
4. `onError` → `onFinished` вызывается сразу, и показывается «Видео недоступно».
5. Автозапуск не сработал (состояние плеера так и не стало «играет» к моменту проверки) → появляется кнопка «▶ Играть»; клик по ней вызывает `playVideo()`.
6. Автозапуск сработал → кнопки нет.
7. `audioOnly: true` → заглушка `sound-wave.gif` в документе и у контейнера плеера класс `board-video-hidden`.
8. `onFinished` не вызывается дважды, даже если опрос времени успел сработать несколько раз.

Таймеры в этих тестах — фейковые (`vi.useFakeTimers()`), опрос времени продвигать ими; настоящий скрипт YouTube не грузится.

- [ ] **Шаг 2: Прогнать, убедиться что падают**

Run: `pnpm -C client test -- VideoPlayer`
Expected: FAIL.

- [ ] **Шаг 3: Реализовать**

1. Загрузку API поднять на уровень монтирования: `useEffect` без зависимости от `started` вызывает `loadYouTubeApi()` сразу. Сам singleton `apiLoadingPromise` оставить как есть.
2. Плеер создавать сразу после готовности API, не дожидаясь клика. Состояние `started` больше не управляет созданием плеера; вместо него — состояние `needsClick` (по умолчанию `false`), включаемое только если автозапуск не удался.
3. В `playerVars` убрать `end`, оставить `start`, `rel: 0`, `modestbranding: 1`, `autoplay: 1`.
4. Свой контроль конца клипа: после `onReady` завести `setInterval` (~250 мс), сравнивающий `getCurrentTime()` с `startSeconds + durationSeconds`; при достижении — `pauseVideo()`, снять интервал, вызвать `onFinished()`. Защитить одноразовость флагом в `useRef`, а не состоянием.
5. Определение неудавшегося автозапуска: через ~1500 мс после `onReady` проверить `getPlayerState()`; если воспроизведение не идёт — `setNeedsClick(true)`. Клик по кнопке вызывает `playVideo()` и прячет кнопку.
6. `onError` → показать «Видео недоступно» и немедленно вызвать `onFinished()` (тем же одноразовым флагом).
7. Снимать интервалы и таймауты в cleanup-функции `useEffect`, `destroy()` вызывать через `?.` — на тестовых двойниках метода может не быть.
8. Разметка: обёртка над контейнером плеера получает оверлей-полосу `<div className="board-video-titleguard" />`.
9. `index.css`: `.board-video` — `position: relative`; `.board-video-titleguard` — абсолютная полоса по верху (высота порядка 70px, фон под цвет табло, `z-index` выше плеера); `pointer-events: none` на самом эмбеде, чтобы контролы и заголовок не появлялись по наведению и клик не открывал YouTube.

- [ ] **Шаг 4: Прогнать тесты**

Run: `pnpm -C client test`
Expected: PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add client/src
git commit -m "fix: плеер грузится заранее, сам останавливает клип и прячет название"
```

---

### Task 4: Табло и телефон в новой фазе

**Files:**

- Modify: `client/src/Board.tsx`, `client/src/Player.tsx`, `client/src/useRoomConnection.ts`
- Test: `client/src/Board.test.tsx`, `client/src/Player.test.tsx`

**Interfaces:**

- Consumes: `onFinished` из Task 3; фаза `'question-media'` из Task 1; сообщение `media-finished` из Task 2.
- Produces: `useRoomConnection` отдаёт `mediaFinished(questionId: string): void`.

- [ ] **Шаг 1: Написать падающие тесты**

`Board.test.tsx`:

1. В фазе `question-media` виден текст вопроса и отрендерен `VideoPlayer`.
2. Когда `VideoPlayer` сообщает об окончании, на сервер уходит `media-finished` с `questionId` текущего вопроса.
3. В фазе `question-open` для того же вопроса с `video` плеер повторно **не** создаётся заново (клип не начинается по второму разу).
4. Обратный отсчёт в фазе `question-media` не показывается.

`Player.test.tsx`: 5. В фазе `question-media` кнопки «Ответ» нет, вместо неё — подсказка вроде «Идёт ролик». 6. В `question-open` кнопка «Ответ» на месте (регрессия).

- [ ] **Шаг 2: Прогнать, убедиться что падают**

Run: `pnpm -C client test -- Board Player`
Expected: FAIL.

- [ ] **Шаг 3: Реализовать**

1. `useRoomConnection.ts`: локальный тип `GameStateView.phase` пополнить `'question-media'`, добавить метод `mediaFinished(questionId)`, шлющий `{ type: 'media-finished', questionId }` — по образцу уже существующих методов файла.
2. `Board.tsx`: рендерить вопрос и в `question-media`, и в `question-open` (условия, завязанные на `question-open`, расширить), плеер монтировать в обеих фазах и **не перемонтировать** при переходе между ними — ключ элемента должен зависеть от id вопроса, а не от фазы. `onFinished` пробросить в `mediaFinished(questionId)`. Обратный отсчёт показывать только когда `timerDeadline` относится к вопросу, то есть в `question-media` не показывать.
3. `Player.tsx`: в `question-media` показать текст вопроса без кнопки «Ответ» и с подсказкой, что идёт ролик.

- [ ] **Шаг 4: Прогнать всё**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: всё зелёное; вывод посмотреть, а не предположить.

- [ ] **Шаг 5: Коммит**

```bash
git add client/src
git commit -m "feat: табло и телефон в фазе проигрывания ролика"
```

---

## Проверка вживую (после всех задач)

Не часть автотестов и не заменяется ими:

1. Пересобрать клиент и **перезапустить сервер** — он раздаёт `client/dist` через `sirv`, который снимает слепок каталога при старте: без перезапуска браузер получит старую сборку и 404 на новый бандл (поймано на прошлом прогоне).
2. Пак `packs/video-test.json`, один вопрос. Проверить глазами: ролик стартует сам, название не видно, клип обрывается на 8-й секунде, и **только после этого** появляется обратный отсчёт и кнопка «Ответ» на телефоне.
3. Отдельно проверить страховку: открыть вопрос и закрыть вкладку табло — партия должна поехать дальше сама, не зависнуть.
