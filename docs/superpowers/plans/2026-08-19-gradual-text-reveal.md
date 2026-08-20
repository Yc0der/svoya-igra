# Постепенный показ текста вопроса — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обычный текстовый вопрос показывается на табло по словам; кнопка «Ответ» появляется у
игроков только когда показ закончен, и только тогда стартует полный 30-секундный таймер на
ответ.

**Architecture:** Новая фаза движка `question-reveal` между открытием вопроса и `question-open`
— только для вопросов без `video`. Длительность показа не константа движка, а вычисление
Комнаты (число слов / временная настраиваемая скорость), тем же приёмом перехвата
`start-timer`, что уже используется для `pendingReopenBudget`. Табло вычисляет, сколько слов
уже показывать, по `timerDeadline` + новому полю `currentQuestion.revealMs`, без отдельного
сигнала от клиента.

**Tech Stack:** TypeScript, Vitest, React (см. `svoya-igra-dev/SKILL.md`).

## Global Constraints

- Спека: [`docs/superpowers/specs/2026-08-19-gradual-text-reveal-design.md`](../specs/2026-08-19-gradual-text-reveal-design.md)
  — при любом расхождении плана и спеки спека главнее, сообщить и свериться, а не выбирать
  самому.
- Область действия — только вопросы без `video` (включая с `image`, и «кота»/аукцион, как
  только вопрос раскрыт). Вопросы с `video` фазу `question-reveal` не проходят вовсе.
- Дефолт скорости показа — **2.5 слова/сек**. Нижняя граница длительности показа —
  **1200 мс** — экспортируется как `TEXT_REVEAL_MIN_MS` из `engine.ts`.
- Подсчёт слов — везде один и тот же метод: `text.trim().split(/\s+/).filter(Boolean).length`
  (Комната) / `.length` того же `split` (клиент). Расхождение метода — баг.
- Переоткрытие вопроса после неверного ответа при ведущем (`resolveVote`) показ **не**
  повторяет — оно уже сегодня идёт в `question-open` напрямую, минуя `openQuestion()`, никакого
  кода менять не нужно, это уже верно.
- Кнопка «Ответ» в `question-reveal` отклоняется автоматически (`handleBuzz` уже проверяет
  `state.phase !== 'question-open'`) — новой ветки в движке для этого не нужно.
- **Никакого нового клиент→сервер сообщения не вводится.** В отличие от видео, длительность
  показа детерминирована — обычный серверный таймер, тем же паттерном, что `cat-handoff`/
  `round-end`.
- Это ВРЕМЕННАЯ настройка (скорость показа в админке) — как и `videoPrerollMs` раньше, метится
  комментарием «ВРЕМЕННО» везде, где появляется, и удаляется целиком отдельной задачей после
  того, как темп будет подобран на живых партиях (не часть этого плана).

---

### Task 1: Движок — фаза `question-reveal`

**Files:**

- Modify: `server/src/engine.ts`
- Modify: `server/src/engine.test.ts`

**Interfaces:**

- Consumes: ничего нового извне — `findQuestion`, `openQuestion`, `handleTimerExpired`,
  `handleBuzz` уже существуют.
- Produces: `Phase` получает `'question-reveal'`; `TimerName` получает `'text-reveal'`;
  `export const TEXT_REVEAL_FALLBACK_MS`, `export const TEXT_REVEAL_MIN_MS` — оба использует
  Task 2 (`room.ts` импортирует `TEXT_REVEAL_MIN_MS`, `TEXT_REVEAL_FALLBACK_MS` для
  `PHASE_TIMER`).

- [ ] **Step 1: Добавить фазу, таймер и константы**

В `server/src/engine.ts` в `Phase` — вставить между `'question-media'` и `'question-open'`:

```ts
  | 'question-media'
  // Вопрос открыт, текст показывается по словам (design.md,
  // 2026-08-19-gradual-text-reveal-design.md, «Фаза question-reveal»).
  // Кнопка «Ответ» отклоняется той же проверкой phase !== 'question-open',
  // что уже отсекает её в question-media — новой ветки в handleBuzz не
  // нужно. Только для вопросов без video — у тех уже есть question-media.
  | 'question-reveal'
  | 'question-open'
```

В `TimerName` — вставить после `'media'`:

```ts
  | 'media'
  | 'text-reveal'
```

После `MEDIA_TIMER_MS` (после строки `export const MEDIA_TIMER_MS = 45_000;`) добавить:

```ts
// Длительность здесь не рабочая: Room.applyEffects перехватывает именно этот
// таймер (room.ts, «Временная скорость показа») и подставляет настоящее
// значение, посчитанное по числу слов вопроса и текущей скорости. Число ниже
// участвует только в тестах движка без Room (engine.test.ts) — любое
// положительное значение подходит, в реальной игре оно никогда не
// используется.
export const TEXT_REVEAL_FALLBACK_MS = 5_000;
// Нижняя граница настоящей длительности показа (design.md,
// 2026-08-19-gradual-text-reveal-design.md, «Фаза question-reveal») — короткий
// вопрос из одного-двух слов не должен мелькать почти мгновенно. Считает и
// применяет Room (room.ts, computeTextRevealMs), константа здесь — чтобы у
// движка и Room было ровно одно число, а не два синхронизируемых вручную.
export const TEXT_REVEAL_MIN_MS = 1_200;
```

- [ ] **Step 2: Завести вопрос без video в `question-reveal`**

Заменить тело `openQuestion()` (сейчас — единственный `return` без `video`):

```ts
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

на:

```ts
  if (question.video) {
    return {
      state: { ...next, phase: 'question-media' },
      effects: [{ type: 'start-timer', timer: 'media', ms: MEDIA_TIMER_MS }],
    };
  }
  return {
    state: { ...next, phase: 'question-reveal' },
    effects: [
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ],
  };
}
```

- [ ] **Step 3: Обработать истечение таймера показа**

В `handleTimerExpired` добавить `case` сразу после `case 'media': ...` (до `case
'cat-handoff':`):

```ts
    case 'text-reveal':
      // Показ текста закончился — вопрос становится обычным question-open с
      // полными QUESTION_TIMER_MS, раньше ничего не тикало (design.md,
      // 2026-08-19-gradual-text-reveal-design.md, «Фаза question-reveal»).
      return {
        state: { ...state, phase: 'question-open' },
        effects: [
          { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
        ],
      };
```

- [ ] **Step 4: Прогнать существующие тесты, поправить сломанные**

Запуск: `pnpm -C server exec vitest run src/engine.test.ts`

Сейчас упадёт множество тестов — общая причина одна: `PACK`/`CAT_PACK`/`AUCTION_PACK` не
содержат `video`, поэтому раньше `select-question` сразу давал `question-open`, а теперь даёт
`question-reveal`. Это ожидаемо и чинится Step 5 ниже. **Прежде чем чинить остальные,**
исправить сам тест, который проверяет именно это поведение и должен теперь описывать
`question-reveal`, а не `question-open` — `describe('select-question', ...)`, тест `"opens the
question and starts the question timer when it is the picker's turn"`:

```ts
it("opens the question into question-reveal when it is the picker's turn", () => {
  const state = createInitialState(PACK, ['p1', 'p2']);
  const { state: next, effects } = selectFirst(state);
  expect(next.phase).toBe('question-reveal');
  expect(next.currentQuestion).toEqual({ themeIndex: 0, questionId: 'a1' });
  expect(effects).toEqual([
    {
      type: 'start-timer',
      timer: 'text-reveal',
      ms: TEXT_REVEAL_FALLBACK_MS,
    },
  ]);
});
```

Добавить `TEXT_REVEAL_FALLBACK_MS` в импорт из `./engine.js` в начале файла (рядом с
`MEDIA_TIMER_MS`).

- [ ] **Step 5: Починить общие хелперы, чтобы бо́льшая часть остальных тестов заработала сама**

`selectFirst`, `selectCat`, `selectAuction` (определения в начале `engine.test.ts`) сейчас
возвращают `Result` сразу после `select-question`/`assign-cat`/выигранных торгов. Раньше это
означало «вопрос открыт», теперь для вопроса без `video` это означает «вопрос в
`question-reveal`». Большинство тестов, использующих эти хелперы, не интересуются самим показом
— им нужен именно открытый вопрос. Изменить каждый хелпер так, чтобы он сам проходил через
`question-reveal`, когда вопрос его достиг:

```ts
function selectFirst(state: EngineState) {
  const opened = reduce(state, {
    type: 'select-question',
    counterId: state.turnCounterId,
    themeIndex: 0,
    questionId: 'a1',
  });
  if (opened.state.phase !== 'question-reveal') return opened;
  return reduce(opened.state, { type: 'timer-expired', timer: 'text-reveal' });
}
```

Тот же приём для `selectCat`/`selectAuction` — оба сейчас просто вызывают `reduce(state, {
type: 'select-question', ... })` и возвращают результат; обернуть их результат той же проверкой
`if (opened.state.phase !== 'question-reveal') return opened; return reduce(opened.state, {
type: 'timer-expired', timer: 'text-reveal' });` (у `selectCat`/`selectAuction` вопрос всегда
типа `'кот'`/`'аукцион'`, поэтому сразу после `select-question` они попадают в
`cat-handoff`/`auction-bidding`, не в `question-reveal` — проверка на `question-reveal` здесь
просто ничего не сделает и вернёт `opened` как есть; она нужна только когда эти же хелперы в
будущем позовут для вопроса, который сам уже открыт напрямую — сохраняет функции безопасными по
построению, а не только для сегодняшнего набора паков).

Прогнать `pnpm -C server exec vitest run src/engine.test.ts` ещё раз — часть тестов, шедших
только через эти три хелпера, теперь снова зелёная.

- [ ] **Step 6: Пройти оставшиеся тесты, которые зовут `select-question` напрямую**

Найти оставшиеся места: `grep -n "type: 'select-question'" server/src/engine.test.ts` — те, что
не входят в определения хелперов из Step 5. Для каждого: если тест сразу после
`select-question` проверяет `next.phase` равным `'selecting'` (отказ — не тот ход, уже отвечен,
неизвестный id) — это **не-op** случаи, `question-reveal` они не достигают, они уже проходят,
ничего не трогать. Если тест продолжает партию дальше (обычно следующая строка —
`state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;` или похожее,
предполагающее уже открытый вопрос) — вставить строку `state = reduce(state, { type:
'timer-expired', timer: 'text-reveal' }).state;` сразу после `select-question`, перед
следующим действием. Пример (один из нескольких одинаковых мест, `describe('timer-expired:
round-end', ...)`):

```ts
state = reduce(state, {
  type: 'select-question',
  counterId: state.turnCounterId,
  themeIndex: 0,
  questionId: 'a1',
}).state;
state = reduce(state, { type: 'timer-expired', timer: 'text-reveal' }).state; // ← добавить
state = reduce(state, { type: 'timer-expired', timer: 'question' }).state;
```

Прогонять `pnpm -C server exec vitest run src/engine.test.ts` после каждой правки — красный
тест сообщает точную причину (фаза не та, эффекты не те), это и есть чеклист оставшихся мест;
отдельно вести список руками не нужно. Продолжать, пока файл не станет зелёным целиком.

- [ ] **Step 7: Новый блок тестов `question-reveal phase`**

Добавить в конец `engine.test.ts`, после существующего `describe('question-media phase', ...)`
(зеркально её структуре — используются те же `PACK`/`CAT_PACK`/`AUCTION_PACK`, `selectCat`,
`selectAuction`, `buzzP1` из начала файла):

```ts
describe('question-reveal phase', () => {
  it('sends a question without video into question-reveal, not straight to question-open', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const { state: next, effects } = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    });

    expect(next.phase).toBe('question-reveal');
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('starts the full question timer once the reveal timer expires', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const revealing = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next, effects } = reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('refuses a buzz while the text is still being revealed', () => {
    const initial = createInitialState(PACK, ['p1', 'p2']);
    const revealing = reduce(initial, {
      type: 'select-question',
      counterId: initial.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next } = reduce(revealing, {
      type: 'buzz',
      counterId: 'p1',
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.buzzedCounterId).toBeNull();
  });

  it('reveals the cat question only after the cat has been handed off, not before', () => {
    const initial = createInitialState(CAT_PACK, ['p1', 'p2']);
    const handoff = selectCat(initial).state;
    const recipient = handoff.turnCounterId === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(handoff, {
      type: 'assign-cat',
      counterId: handoff.turnCounterId,
      recipientCounterId: recipient,
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(recipient);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('reveals the auction question only once the auction has a winner, not during bidding', () => {
    const initial = createInitialState(AUCTION_PACK, ['p1', 'p2']);
    const bidding = selectAuction(initial).state;
    const bidder = bidding.auctionTurnCounterId!;
    const afterBid = reduce(bidding, {
      type: 'place-bid',
      counterId: bidder,
      amount: 100,
    }).state;
    const other = bidder === 'p1' ? 'p2' : 'p1';
    const { state: next, effects } = reduce(afterBid, {
      type: 'pass-bid',
      counterId: other,
    });

    expect(next.phase).toBe('question-reveal');
    expect(next.exclusiveAnswererCounterId).toBe(bidder);
    expect(effects).toEqual([
      {
        type: 'start-timer',
        timer: 'text-reveal',
        ms: TEXT_REVEAL_FALLBACK_MS,
      },
    ]);
  });

  it('does not replay the reveal when a wrong answer reopens the question under a host', () => {
    const state = createInitialState(PACK, ['p1', 'p2', 'p3'], 'judge');
    const revealing = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const open = reduce(revealing, {
      type: 'timer-expired',
      timer: 'text-reveal',
    }).state;
    const judging = reduce(buzzP1(open), {
      type: 'said-answer',
      counterId: 'p1',
    }).state;
    const { state: next, effects } = reduce(judging, {
      type: 'vote',
      counterId: 'judge',
      correct: false,
    });

    expect(next.phase).toBe('question-open');
    expect(effects).toEqual([
      { type: 'start-timer', timer: 'question', ms: QUESTION_TIMER_MS },
    ]);
  });

  it('lets the host cancel the question while the text is still being revealed', () => {
    const state = createInitialState(PACK, ['p1', 'p2'], 'judge');
    const revealing = reduce(state, {
      type: 'select-question',
      counterId: state.turnCounterId,
      themeIndex: 0,
      questionId: 'a1',
    }).state;
    const { state: next } = reduce(revealing, {
      type: 'cancel-question',
      requesterId: 'judge',
    });

    expect(next.phase).toBe('reveal');
    expect(next.answeredQuestionIds).toEqual(['a1']);
  });

  it('still sends a video question into question-media, not question-reveal', () => {
    // Регрессия: область действия — только вопросы без video (design.md,
    // 2026-08-19-gradual-text-reveal-design.md, «Правило»).
    const initial = createInitialState(VIDEO_PACK, ['p1', 'p2']);
    const { state: next } = selectFirst(initial);

    expect(next.phase).toBe('question-open'); // selectFirst уже доводит клип до конца
  });
});
```

Последний тест использует `selectFirst` на `VIDEO_PACK` — она определена выше в файле
(используется в `describe('question-media phase', ...)`), а `selectFirst` для видео-вопроса
проходит только `question-media` (проверка `opened.state.phase !== 'question-reveal'` из Step 5
для видео-вопроса истинна, но `reduce` с `timer-expired`/`text-reveal` на фазе `question-media`
— no-op, значит `selectFirst` для видео вернёт состояние всё ещё в `question-media`, не
`question-open`). Поправить ожидание на `expect(next.phase).toBe('question-media');` — реальная
цель теста (регрессия: video не задет) от этого не страдает.

- [ ] **Step 8: Финальная проверка и коммит**

`pnpm -C server exec vitest run src/engine.test.ts` — весь файл зелёный.
`pnpm -C server typecheck && pnpm -C server lint`.

```bash
git add server/src/engine.ts server/src/engine.test.ts
git commit -m "feat: постепенный показ текста вопроса — фаза question-reveal в движке"
```

---

### Task 2: Комната — вычисление длительности, снапшот, временная скорость

**Files:**

- Modify: `server/src/room.ts`
- Modify: `server/src/room.test.ts`

**Interfaces:**

- Consumes: `Phase` (`'question-reveal'`), `TimerName` (`'text-reveal'`),
  `TEXT_REVEAL_FALLBACK_MS`, `TEXT_REVEAL_MIN_MS` из Task 1.
- Produces: `Room.getTextRevealWordsPerSecond(): number`,
  `Room.setTextRevealWordsPerSecond(wordsPerSecond: number): void`,
  `Room.onTextRevealRateChange(listener: (wordsPerSecond: number) => void): () => void`;
  `GameStateView.currentQuestion.revealMs: number | null` — использует Task 3
  (`server/src/protocol.ts`, где заводится сам тип поля) и Task 4 (клиент).

- [ ] **Step 1: Импорты и `PHASE_TIMER`**

В начале `server/src/room.ts`, в существующем блоке импорта из `./engine.js`, добавить
`TEXT_REVEAL_FALLBACK_MS` и `TEXT_REVEAL_MIN_MS` (рядом с `MEDIA_TIMER_MS`).

В `PHASE_TIMER` добавить строку после `'question-media': ...`:

```ts
  'question-reveal': { timer: 'text-reveal', ms: TEXT_REVEAL_FALLBACK_MS },
```

(Значение `ms` здесь никогда фактически не используется — Step 3 ниже перехватывает `ms` для
таймера `text-reveal` независимо от того, откуда пришёл эффект, включая рестарт из снапшота в
конструкторе.)

- [ ] **Step 2: Эфемерные поля скорости показа**

После существующего поля `private packListeners = new Set<(info: PackInfo) => void>();`
добавить:

```ts
  // Скорость показа текста вопроса, слов/сек — ВРЕМЕННЫЙ настраиваемый
  // параметр (design.md, 2026-08-19-gradual-text-reveal-design.md,
  // «Временная скорость показа»), не часть RoomState по тому же принципу,
  // что lanAddress/availablePacks: транспортная настройка табло, не игровое
  // состояние, сбрасывается при перезапуске сервера. Убрать вместе с полем и
  // UI в админке, как только число зафиксируется в спеке.
  private textRevealWordsPerSecond = 2.5;
  private textRevealRateListeners = new Set<
    (wordsPerSecond: number) => void
  >();
  // Настоящая длительность показа текущего вопроса — то самое число, которое
  // applyEffects только что подставило в таймер (Step 3 ниже). Не null,
  // только пока идёт question-reveal; отдаётся в toGameStateView, чтобы
  // табло считало прогресс показа по тому же значению, что и реальный
  // серверный таймер — иначе смена скорости админкой прямо посреди показа
  // рассинхронила бы клиент и сервер.
  private currentTextRevealMs: number | null = null;
```

- [ ] **Step 3: Вычисление длительности и перехват в `applyEffects`**

Добавить приватный метод (например, сразу перед `private notify(): void {`):

```ts
  // Число слов текущего вопроса делённое на текущую скорость, не ниже
  // TEXT_REVEAL_MIN_MS (design.md, 2026-08-19-gradual-text-reveal-design.md,
  // «Фаза question-reveal»). Вызывается из applyEffects в момент, когда
  // движок эмитит таймер 'text-reveal' — сам движок этого числа не знает
  // (инвариант 1, и скорость показа — настройка Комнаты, не игровое
  // правило).
  private computeTextRevealMs(): number {
    const question = findQuestion(
      this.game!.pack,
      this.game!.roundIndex,
      this.game!.currentQuestion!.themeIndex,
      this.game!.currentQuestion!.questionId,
    )!;
    const words = question.text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(
      TEXT_REVEAL_MIN_MS,
      Math.round((words / this.textRevealWordsPerSecond) * 1000),
    );
  }
```

В `applyEffects`, в существующем блоке `if (effect.type === 'start-timer') { let ms =
effect.ms; ... }`, сразу после существующего блока про `pendingReopenBudget` (после строки `ms =
this.pendingReopenBudget.remainingMs; this.pendingReopenBudget = null; }`) добавить:

```ts
if (effect.timer === 'text-reveal') {
  ms = this.computeTextRevealMs();
  this.currentTextRevealMs = ms;
} else {
  this.currentTextRevealMs = null;
}
```

(Этот `else` — не только для `question-reveal`: он гарантирует, что `currentTextRevealMs`
корректно обнулится, как только партия эмитит любой ДРУГОЙ таймер, то есть покидает
`question-reveal` — что бы ни случилось: истёк текст-таймер, ведущий отменил вопрос, и т. д.)

- [ ] **Step 4: Геттер/сеттер/подписка**

Рядом с `getPackInfo()` (или сразу после нового `computeTextRevealMs` — расположение внутри
класса не принципиально, главное — рядом с остальными `admin-*`-настройками) добавить:

```ts
  getTextRevealWordsPerSecond(): number {
    return this.textRevealWordsPerSecond;
  }

  // Без проверки отправителя, как и остальные admin-* настройки этого
  // класса — админ-панель не проверяет личность (server.ts).
  setTextRevealWordsPerSecond(wordsPerSecond: number): void {
    if (!Number.isFinite(wordsPerSecond) || wordsPerSecond <= 0) return;
    this.textRevealWordsPerSecond = wordsPerSecond;
    for (const listener of this.textRevealRateListeners) {
      listener(this.textRevealWordsPerSecond);
    }
  }
```

Рядом с существующим `onPackChange(listener: (info: PackInfo) => void): () => void { ... }`
добавить:

```ts
  onTextRevealRateChange(
    listener: (wordsPerSecond: number) => void,
  ): () => void {
    this.textRevealRateListeners.add(listener);
    return () => this.textRevealRateListeners.delete(listener);
  }
```

- [ ] **Step 5: `toGameStateView` — новое поле `revealMs`**

В блоке, строящем `currentQuestion` (объект с `id`/`text`/`price`/`themeName`/`image`/`video`),
добавить `revealMs` сразу после `video: ...`:

```ts
            video:
              game.phase === 'cat-handoff' ||
              game.phase === 'auction-bidding' ||
              !currentQuestionData.video
                ? null
                : {
                    youtubeId: currentQuestionData.video.youtubeId,
                    startSeconds: currentQuestionData.video.startSeconds,
                    durationSeconds: currentQuestionData.video.durationSeconds,
                    audioOnly: currentQuestionData.video.audioOnly ?? false,
                  },
            // Сколько всего мс займёт показ текущего вопроса — то самое
            // значение, что applyEffects только что подставило в таймер
            // (Step 3 выше). Не null только в question-reveal (design.md,
            // 2026-08-19-gradual-text-reveal-design.md, «Сервер и клиент»).
            revealMs: this.currentTextRevealMs,
```

- [ ] **Step 6: Прогнать `room.test.ts`, починить сломанные фикстуры**

Запуск: `pnpm -C server exec vitest run src/room.test.ts`

Причина падений та же, что в Task 1: во всех паках этого файла вопрос `'q1'` (и `'cat1'` и
т. п.) без `video`, поэтому `room.selectQuestion(picker, 0, 'q1')` теперь ведёт в
`question-reveal`, а не в `question-open`. В отличие от `engine.test.ts`, здесь таймеры
настоящие (`setTimeout`), поэтому чинить нужно иначе.

**Правило.** Каждый вызов `room.selectQuestion(...)`, после которого тест ожидает, что вопрос
уже открыт (следующая строка — `room.buzz(...)`, `expect(...phase).toBe('question-open')` без
предварительной проверки на `question-reveal`, и т. п.) — нуждается в правке. Тексты вопросов
во всех паках этого файла короткие (1–4 слова), поэтому при дефолтной скорости 2.5 слова/сек
реальная длительность **всегда** упирается в нижнюю границу `TEXT_REVEAL_MIN_MS` — одно и то же
число подходит для продвижения времени в любом месте файла, отдельно считать точную
длительность под каждый конкретный текст вопроса не нужно.

Добавить `TEXT_REVEAL_MIN_MS` в существующий импорт из `./engine.js` в начале `room.test.ts`.

Если тест **уже** внутри `vi.useFakeTimers()` (обычно оформлено как `try { vi.useFakeTimers();
... } finally { vi.useRealTimers(); }`) — вставить сразу после `room.selectQuestion(...)`:

```ts
vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS);
```

Если тест ещё **не** использует фейковые таймеры (вызывает `room.selectQuestion(...)`, а дальше
сразу `room.buzz(...)` или проверяет состояние синхронно, полагаясь на то, что реальный
`question-open` наступает немедленно) — обернуть минимально необходимый фрагмент теста в тот же
`try { vi.useFakeTimers(); ...; vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS); ...; } finally {
vi.useRealTimers(); }`, что и в остальном файле. Точный код зависит от конкретного теста, форма
всегда та же:

```ts
vi.useFakeTimers();
try {
  room.selectQuestion(picker, 0, 'q1');
  vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS);
  room.buzz(picker);
  expect(room.toGameStateView()?.phase).toBe('buzzed');
} finally {
  vi.useRealTimers();
}
```

Прогонять `pnpm -C server exec vitest run src/room.test.ts` после каждой правки — красный тест
называет точное место и ожидание, это и есть чеклист оставшихся мест. Продолжать, пока файл не
станет зелёным целиком.

- [ ] **Step 7: Новые тесты именно для `question-reveal`/скорости показа**

Добавить отдельный `describe('question-reveal / text reveal speed', ...)` (пак — простой
инлайн-пак с известным числом слов, например вопрос `'Столица Франции сейчас'` — 4 слова):

1. **Вычисление `ms` по числу слов и скорости.** С дефолтной скоростью 2.5 слова/сек 4-словный
   вопрос даёт `Math.round(4 / 2.5 * 1000) = 1600` мс — не задета нижняя граница. Выбрать
   вопрос, для которого 1600 > `TEXT_REVEAL_MIN_MS` (1200), чтобы тест реально проверял формулу,
   а не только клампинг. Через `vi.useFakeTimers()`: `room.selectQuestion(...)`, `expect(
room.toGameStateView()?.game.currentQuestion.revealMs).toBe(1600);` (поле лежит внутри
   `game`, не на верхнем уровне — сверить точный путь с `toGameStateView()`'s actual shape),
   `vi.advanceTimersByTime(1599)` → всё ещё `question-reveal`, `vi.advanceTimersByTime(1)` →
   стало `question-open`.
2. **Нижняя граница.** Однословный вопрос (`'Кто?'`) при дефолтной скорости даёт `revealMs ===
TEXT_REVEAL_MIN_MS`, не меньше.
3. **`revealMs` не `null` только в `question-reveal`.** До выбора вопроса (`selecting`) и после
   раскрытия (`question-open`) — `null`.
4. **Смена скорости через `setTextRevealWordsPerSecond` действует на следующий вопрос, не на
   уже идущий показ.** Выбрать вопрос (зафиксировать `revealMs` первого вызова), затем
   `room.setTextRevealWordsPerSecond(100)` (намного быстрее), проверить, что
   `toGameStateView()?.game.currentQuestion.revealMs` **не изменился** — вычислено один раз при
   входе в фазу, не пересчитывается на лету. Затем довести вопрос до конца, выбрать следующий —
   его `revealMs` уже посчитан по новой скорости (заметно меньше).
5. **`onTextRevealRateChange`/`getTextRevealWordsPerSecond`.** Дефолт `2.5`; после
   `setTextRevealWordsPerSecond(4)` геттер возвращает `4`, подписанный listener получил `4`;
   `setTextRevealWordsPerSecond(0)`/`setTextRevealWordsPerSecond(-1)`/
   `setTextRevealWordsPerSecond(NaN)` — no-op, значение и listener не меняются (тот же паттерн
   валидации, что уже есть у `setVideoPrerollMs` был — `Number.isFinite && > 0`).
6. **Восстановление из снапшота в `question-reveal` не зависает.** Тем же паттерном, что уже
   покрыт для `question-media` в этом файле (найти существующий тест на восстановление
   снапшота в `question-media`/`PHASE_TIMER` и построить по образцу): создать `Room`,
   `selectQuestion`, сериализовать снапшот **до** истечения таймера, создать новый `Room` из
   снапшота, `vi.advanceTimersByTime(TEXT_REVEAL_MIN_MS)` (или больше — вопрос в тесте короткий,
   заведомо на нижней границе) → фаза стала `question-open`, партия не зависла.

- [ ] **Step 8: Финальная проверка и коммит**

`pnpm -C server exec vitest run src/room.test.ts` — весь файл зелёный.
`pnpm -C server typecheck && pnpm -C server lint`.

```bash
git add server/src/room.ts server/src/room.test.ts
git commit -m "feat: Комната считает длительность показа текста и временную скорость"
```

---

### Task 3: Протокол и сервер — поле `revealMs`, временная скорость в админке

**Files:**

- Modify: `server/src/protocol.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/server.test.ts`

**Interfaces:**

- Consumes: `Room.getTextRevealWordsPerSecond`/`setTextRevealWordsPerSecond`/
  `onTextRevealRateChange` из Task 2.
- Produces: `GameStateView.currentQuestion.revealMs: number | null`; `ClientMessage` —
  `{ type: 'admin-set-text-reveal-rate'; wordsPerSecond: number }`; `ServerMessage`'s `'state'`
  variant — `textRevealWordsPerSecond: number` — оба использует Task 4 (клиент).

- [ ] **Step 1: `GameStateView.currentQuestion.revealMs`**

В `server/src/protocol.ts`, в `GameStateView.currentQuestion`, сразу после поля `video: {...} |
null;` добавить:

```ts
// Сколько всего мс займёт постепенный показ текущего вопроса — не null
// только в фазе question-reveal (design.md,
// 2026-08-19-gradual-text-reveal-design.md, «Сервер и клиент»). Табло
// считает по нему и timerDeadline, сколько слов уже показывать, без
// своего независимого отсчёта.
revealMs: number | null;
```

- [ ] **Step 2: `ClientMessage`/`ServerMessage`**

В `ClientMessage`, сразу после `| { type: 'admin-set-lan-address'; address: string }`, добавить:

```ts
  // ВРЕМЕННЫЙ параметр — скорость показа текста вопроса, слов/сек (design.md,
  // 2026-08-19-gradual-text-reveal-design.md, «Временная скорость показа»).
  // Без авторизации, тот же паттерн, что и admin-set-lan-address — доступно
  // только через /admin. Убрать вместе с полем и UI в админке, как только
  // число зафиксируется в спеке.
  | { type: 'admin-set-text-reveal-rate'; wordsPerSecond: number }
```

В `ServerMessage`, в варианте `'state'`, сразу после `activePackFilename: string | null;`
добавить:

```ts
// ВРЕМЕННЫЙ, как lanUrl — текущая скорость показа текста вопроса,
// слов/сек, меняется через admin-set-text-reveal-rate без реконнекта
// (design.md, 2026-08-19-gradual-text-reveal-design.md).
textRevealWordsPerSecond: number;
```

- [ ] **Step 3: Проводка в `server.ts`**

В `stateMessageFor`, в возвращаемом объекте, сразу после `activePackFilename:
packInfo.activeFilename,` добавить:

```ts
      textRevealWordsPerSecond: room.getTextRevealWordsPerSecond(),
```

После `room.onPackChange(broadcastState);` добавить:

```ts
room.onTextRevealRateChange(broadcastState);
```

После блока обработки `admin-set-lan-address` (после `room.setLanAddress(message.address); }`)
добавить:

```ts
// ВРЕМЕННО — см. Room.textRevealWordsPerSecond.
if (
  message.type === 'admin-set-text-reveal-rate' &&
  typeof message.wordsPerSecond === 'number'
) {
  room.setTextRevealWordsPerSecond(message.wordsPerSecond);
}
```

- [ ] **Step 4: Прогнать `server.test.ts`, починить сломанные интеграционные тесты**

Запуск: `pnpm -C server exec vitest run src/server.test.ts`

`TEST_PACK` в этом файле — один вопрос `'Вопрос?'` (одно слово) без `video`. Каждое место, где
тест шлёт `{ type: 'select-question', ... }` через сокет и сразу проверяет
`....game.phase).toBe('question-open')` на **первом** пришедшем после этого broadcast'е — теперь
получит `'question-reveal'` в этом первом broadcast'е, а `'question-open'` придёт **вторым**
broadcast'ом, спустя реальное время (сервер использует настоящий `setTimeout`, это транспортный
интеграционный слой — реальное время здесь уже принятая цена, см. `svoya-igra-dev/SKILL.md`,
«Транспорт — интеграционные»). Тот же двухшаговый паттерн уже есть в этом самом файле для
`question-media` (`describe('createServer media-finished', ...)`, тест `'lets a board socket
that never joined open the question once the clip ends'`, строки с `onClip`/`afterClip`) —
повторить его форму.

Добавить `TEXT_REVEAL_MIN_MS` в импорт из `./engine.js` в начале `server.test.ts` (рядом с
`REVEAL_TIMER_MS`, `VOTE_TIMER_MS`).

Для тестов, уже использующих `vi.useFakeTimers({ shouldAdvanceTime: true })` (например,
`describe('createServer', ...)`, тест на полный игровой цикл) — вставить между отправкой
`select-question` и текущей проверкой `question-open`:

```ts
const onReveal = (await settle(a, b, picker)) as {
  game: { phase: string };
};
expect(onReveal.game.phase).toBe('question-reveal');
await vi.advanceTimersByTimeAsync(TEXT_REVEAL_MIN_MS);
const afterSelect = (await settle(a, b, picker)) as {
  game: { phase: string };
};
expect(afterSelect.game.phase).toBe('question-open');
```

(переименовать переменную, ранее хранившую результат первого `settle` после `select-question`,
если она использовалась дальше по тесту под именем вроде `afterSelect` — сохранить это имя за
вторым, «настоящим» результатом, поскольку остальной тест наверняка продолжает работать именно с
ним).

Для тестов **без** fake timers — простейший рабочий вариант: после отправки `select-question`
дождаться первого broadcast'а (`question-reveal`, можно не проверять явно), затем реальная
пауза `await new Promise((r) => setTimeout(r, TEXT_REVEAL_MIN_MS + 50));`, затем дождаться
второго broadcast'а и проверять на нём `question-open` — по аналогии с уже описанным выше, без
фейковых таймеров. Прогонять `pnpm -C server exec vitest run src/server.test.ts` после каждой
правки, продолжать по красным тестам до зелёного файла.

- [ ] **Step 5: Новый тест на `admin-set-text-reveal-rate`**

По образцу существующего `'admin-set-lan-address switches the LAN url broadcast to everyone
connected'` (тот же файл, `describe('createServer', ...)`, использует `beforeEach`-комнату/
сервер без отдельного `mkdtemp`) — добавить:

```ts
it('admin-set-text-reveal-rate changes the broadcast rate for everyone connected', async () => {
  const admin = await connectAdmin(url);
  await admin.nextMessage(); // начальное состояние

  admin.ws.send(
    JSON.stringify({ type: 'admin-set-text-reveal-rate', wordsPerSecond: 4 }),
  );
  const state = (await admin.nextMessage()) as {
    textRevealWordsPerSecond: number;
  };
  expect(state.textRevealWordsPerSecond).toBe(4);

  admin.ws.close();
});
```

(проверить точный вызов `connectAdmin`/`nextMessage` по уже существующему соседнему тесту —
сигнатура должна совпадать буквально; `url` — уже существующая переменная из `beforeEach` этого
`describe`.)

- [ ] **Step 6: Финальная проверка и коммит**

`pnpm -C server exec vitest run src/server.test.ts` — весь файл зелёный.
`pnpm -C server typecheck && pnpm -C server lint && pnpm -C server exec vitest run` (весь пакет
целиком — Task 1/2/3 вместе).

```bash
git add server/src/protocol.ts server/src/server.ts server/src/server.test.ts
git commit -m "feat: временная скорость показа текста в протоколе и админке"
```

---

### Task 4: Клиент — показ по словам, кнопка на телефоне, админка

**Files:**

- Create: `client/src/useWordReveal.ts`
- Create: `client/src/useWordReveal.test.ts`
- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/useAdminConnection.ts`
- Modify: `client/src/Board.tsx`
- Modify: `client/src/Board.test.tsx`
- Modify: `client/src/Player.tsx`
- Modify: `client/src/Player.test.tsx`
- Modify: `client/src/Admin.tsx`

**Interfaces:**

- Consumes: `GameStateView.currentQuestion.revealMs`, `ServerMessage`'s
  `admin-set-text-reveal-rate`/`textRevealWordsPerSecond` (Task 3, тот же сериализованный
  формат, клиент объявляет свою копию типов по существующему в проекте соглашению — сервер и
  клиент не делят общий модуль протокола).
- Produces: `useWordReveal(deadline, revealMs, text): string` — используется только в
  `Board.tsx`.

- [ ] **Step 1: Хук `useWordReveal`**

Создать `client/src/useWordReveal.ts`:

```ts
import { useEffect, useState } from 'react';

// Табло показывает вопрос по словам, пока идёт постепенный показ (design.md,
// 2026-08-19-gradual-text-reveal-design.md) — темп синхронизирован с
// серверным таймером (deadline/revealMs из GameStateView), а не своим
// независимым отсчётом: иначе табло и правило «кнопка появляется по концу
// показа» (движок) разъедутся. deadline/revealMs — null вне фазы
// question-reveal, тогда возвращается text целиком без подсчёта.
export function useWordReveal(
  deadline: number | null,
  revealMs: number | null,
  text: string,
): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null || revealMs === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline, revealMs]);

  if (deadline === null || revealMs === null || revealMs <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const elapsed = revealMs - (deadline - now);
  const count = Math.max(
    0,
    Math.min(words.length, Math.floor((words.length * elapsed) / revealMs)),
  );
  return words.slice(0, count).join(' ');
}
```

- [ ] **Step 2: Тест хука**

Создать `client/src/useWordReveal.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWordReveal } from './useWordReveal';

describe('useWordReveal', () => {
  it('returns the full text immediately when deadline/revealMs are null', () => {
    const { result } = renderHook(() =>
      useWordReveal(null, null, 'Первое второе третье'),
    );
    expect(result.current).toBe('Первое второе третье');
  });

  it('reveals a growing prefix of words as time passes toward the deadline', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const deadline = now + 4000;
      const { result, rerender } = renderHook(
        ({ d, r }: { d: number; r: number }) =>
          useWordReveal(d, r, 'Первое второе третье четвёртое'),
        { initialProps: { d: deadline, r: 4000 } },
      );
      expect(result.current).toBe('');

      act(() => {
        vi.setSystemTime(now + 2000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      expect(result.current).toBe('Первое второе');

      act(() => {
        vi.setSystemTime(now + 4000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      expect(result.current).toBe('Первое второе третье четвёртое');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Прогон: `pnpm -C client exec vitest run src/useWordReveal.test.ts` — зелёный.

- [ ] **Step 3: `useRoomConnection.ts` — фаза и поле `revealMs`**

В `GameStateView['phase']` вставить `'question-reveal'` между `'question-media'` и
`'question-open'`:

```ts
    | 'question-media'
    | 'question-reveal'
    | 'question-open'
```

В `GameStateView.currentQuestion`, сразу после `video?: {...} | null;`, добавить (`?` — тот же
приём, что у `image`/`video` выше, ради тестовых фикстур, собирающих `currentQuestion` вручную):

```ts
    // Тот же приём, что и у video выше — необязательное поле в этом
    // локальном типе ради тестовых фикстур. Реальные сообщения с сервера
    // всегда содержат revealMs (server/src/protocol.ts).
    revealMs?: number | null;
```

(В `ServerMessage`/`ClientMessage` этого файла ничего менять не нужно — Board/Player не
отправляют и не читают скорость показа напрямую, только уже готовое `revealMs` внутри `game`.)

- [ ] **Step 4: `useAdminConnection.ts` — временная скорость**

В локальном `ServerMessage`, в варианте `'state'`, сразу после `activePackFilename: string |
null;` добавить:

```ts
// ВРЕМЕННО — см. server/src/protocol.ts.
textRevealWordsPerSecond: number;
```

В локальном `ClientMessage`, сразу после `| { type: 'admin-set-lan-address'; address: string }`,
добавить:

```ts
  // ВРЕМЕННО — см. server/src/protocol.ts.
  | { type: 'admin-set-text-reveal-rate'; wordsPerSecond: number }
```

В интерфейсе `AdminConnection`, сразу после `setLanAddress(address: string): void;`, добавить:

```ts
  // ВРЕМЕННО — см. server/src/protocol.ts.
  textRevealWordsPerSecond: number;
  setTextRevealWordsPerSecond(wordsPerSecond: number): void;
```

В теле `useAdminConnection`: добавить состояние (рядом с `activePackFilename`):

```ts
// ВРЕМЕННО — см. server/src/protocol.ts.
const [textRevealWordsPerSecond, setTextRevealWordsPerSecondState] =
  useState(2.5);
```

В обработчике `if (message.type === 'state') { ... }`, сразу после
`setActivePackFilename(message.activePackFilename);`, добавить:

```ts
setTextRevealWordsPerSecondState(message.textRevealWordsPerSecond);
```

В возвращаемом объекте хука, сразу после `setLanAddress: (address) => send({ type:
'admin-set-lan-address', address }),`, добавить:

```ts
    textRevealWordsPerSecond,
    setTextRevealWordsPerSecond: (wordsPerSecond) =>
      send({ type: 'admin-set-text-reveal-rate', wordsPerSecond }),
```

- [ ] **Step 5: `Board.tsx` — показ по словам**

Импортировать хук: `import { useWordReveal } from './useWordReveal';` (рядом с импортом
`useCountdown`).

После строки `const remainingSeconds = useCountdown(game?.timerDeadline ?? null);` добавить:

```ts
const revealedQuestionText = useWordReveal(
  game?.phase === 'question-reveal' ? (game.timerDeadline ?? null) : null,
  game?.currentQuestion?.revealMs ?? null,
  game?.currentQuestion?.text ?? '',
);
```

(Хук вызывается безусловно, до раннего `if (!game) return (...)` — как и `useCountdown` строкой
выше — правило хуков React запрещает условный вызов.)

Заменить блок показа текста:

```tsx
          {game.currentQuestion.text !== null ? (
            <p className="board-question">{game.currentQuestion.text}</p>
          ) : (
```

на:

```tsx
          {game.currentQuestion.text !== null ? (
            <p className="board-question">
              {game.phase === 'question-reveal'
                ? revealedQuestionText
                : game.currentQuestion.text}
            </p>
          ) : (
```

- [ ] **Step 6: `Board.test.tsx` — новые тесты**

Добавить рядом с существующими тестами фазы `question-media` (`describe` для `Board`, там же,
где тест `'shows the question and the player during question-media, but no countdown yet'`):

```ts
  it('shows only the words revealed so far during question-reveal, synced to timerDeadline/revealMs', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      mockedUseRoomConnection.mockReturnValue(
        connection({
          game: baseGame({
            phase: 'question-reveal',
            currentQuestion: {
              id: 'q1',
              text: 'Первое второе третье четвёртое',
              price: 100,
              themeName: 'Тема',
              revealMs: 4000,
            },
            timerDeadline: now + 4000,
          }),
        }),
      );
      render(<Board />);
      expect(screen.queryByText(/Первое/)).not.toBeInTheDocument();

      act(() => {
        vi.setSystemTime(now + 2000);
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Первое второе')).toBeInTheDocument();
      // Отсчёт — по question-таймеру, который в question-reveal ещё не идёт
      // (design.md, 2026-08-19-gradual-text-reveal-design.md).
      expect(document.querySelector('.board-timer')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the full question text once question-open, even if it was revealed only partially before', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-open',
          currentQuestion: {
            id: 'q1',
            text: 'Первое второе третье четвёртое',
            price: 100,
            themeName: 'Тема',
            revealMs: null,
          },
          timerDeadline: Date.now() + 30000,
        }),
      }),
    );
    render(<Board />);
    expect(
      screen.getByText('Первое второе третье четвёртое'),
    ).toBeInTheDocument();
  });
```

Добавить `act` в импорт из `@testing-library/react` в начале файла, если его там ещё нет
(`import { render, screen, act } from '@testing-library/react';` — свериться с фактическим
текущим импортом файла, там уже есть `render`/`screen`, `act` может отсутствовать).

Прогон: `pnpm -C client exec vitest run src/Board.test.tsx` — весь файл зелёный (включая уже
существовавшие тесты, которые не должны сломаться этой правкой — `currentQuestion` в их
фикстурах не содержит `revealMs`, но поле необязательное в локальном типе, см. Step 3).

- [ ] **Step 7: `Player.tsx` — нет кнопки во время показа**

В `hostAdminPanel()`, в определении `questionActive`, добавить `game.phase ===
'question-reveal' ||` рядом с `game.phase === 'question-media' ||`:

```ts
const questionActive =
  game.phase === 'cat-handoff' ||
  game.phase === 'auction-bidding' ||
  game.phase === 'question-reveal' ||
  game.phase === 'question-media' ||
  game.phase === 'question-open' ||
  game.phase === 'buzzed' ||
  game.phase === 'judging';
```

В основном `switch (game.phase)`, добавить `case` перед существующим `case 'question-media':`:

```tsx
      // Текст ещё показывается по словам — кнопки «Ответ» нет ни у кого, как
      // и во время клипа video-вопроса (design.md,
      // 2026-08-19-gradual-text-reveal-design.md, «Сервер и клиент»).
      case 'question-reveal':
        return (
          <div className="player player--center">
            <p>Читаем вопрос…</p>
          </div>
        );

      case 'question-media':
```

- [ ] **Step 8: `Player.test.tsx` — новый тест**

Рядом с существующим `'offers no buzz button while the clip is still playing — everyone watches
it through first'` добавить:

```ts
  it('offers no buzz button while the question text is still being revealed', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        game: baseGame({
          phase: 'question-reveal',
          timerDeadline: Date.now() + 1600,
        }),
      }),
    );
    render(<Player />);
    expect(
      screen.queryByRole('button', { name: /^ответ$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/читаем вопрос/i)).toBeInTheDocument();
  });
```

Прогон: `pnpm -C client exec vitest run src/Player.test.tsx` — весь файл зелёный.

- [ ] **Step 9: `Admin.tsx` — временная секция**

Деструктурировать из `useAdminConnection()` (рядом с `setLanAddress,`):

```ts
    textRevealWordsPerSecond,
    setTextRevealWordsPerSecond,
```

Добавить локальное состояние поля ввода (рядом с `confirmingWipe`):

```ts
// ВРЕМЕННО — подбор скорости показа текста вопроса вживую, см.
// server/src/protocol.ts, StateMessage.textRevealWordsPerSecond. Убрать
// вместе с полем, как только число зафиксируется в спеке.
const [textRevealRateInput, setTextRevealRateInput] = useState('2.5');
```

Вставить новую секцию между закрывающим `</section>` секции «Сеть» и открывающим `<section
className="admin-section"><h2>Пакет</h2>`:

```tsx
{
  /* ВРЕМЕННО — подбор скорости показа текста вопроса вживую, см.
          server/src/protocol.ts, StateMessage.textRevealWordsPerSecond.
          Убрать секцию целиком, как только число зафиксируется в спеке. */
}
<section className="admin-section">
  <h2>Скорость показа текста (временно)</h2>
  <p>
    Сейчас: {textRevealWordsPerSecond.toFixed(1)} слов/сек. Обычный текстовый
    вопрос показывается на табло по словам с этой скоростью, прежде чем
    открывается кнопка «Ответ».
  </p>
  <input
    type="number"
    min={0.1}
    step={0.1}
    value={textRevealRateInput}
    onChange={(e) => setTextRevealRateInput(e.target.value)}
  />
  <button
    className="button"
    onClick={() => {
      const rate = Number(textRevealRateInput);
      if (Number.isFinite(rate) && rate > 0) {
        setTextRevealWordsPerSecond(rate);
      }
    }}
  >
    Применить
  </button>
</section>;
```

- [ ] **Step 10: `Admin.test.tsx` — фикстура**

Если `Admin.test.tsx` собирает возвращаемое значение `useAdminConnection()` вручную (по образцу
того, как раньше собирался `videoPrerollMs`/`setVideoPrerollMs` — см. `git log -p --all -- 
client/src/Admin.test.tsx` вокруг коммита `9df5dfc` для точного вида, если нужен образец),
добавить в фикстуру `textRevealWordsPerSecond: 2.5, setTextRevealWordsPerSecond: vi.fn(),`. Если
такой ручной фикстуры нет (мок собирается иначе) — оставить как есть, TypeScript ошибку на
отсутствующее поле покажет сам, если оно обязательно; тогда просто добавить требуемые поля туда,
где компилятор укажет.

Прогон: `pnpm -C client exec vitest run src/Admin.test.tsx` — зелёный.

- [ ] **Step 11: Финальная проверка и коммит**

`pnpm -C client typecheck && pnpm -C client lint && pnpm -C client exec vitest run && pnpm -C
client build`.

```bash
git add client/src/useWordReveal.ts client/src/useWordReveal.test.ts \
  client/src/useRoomConnection.ts client/src/useAdminConnection.ts \
  client/src/Board.tsx client/src/Board.test.tsx \
  client/src/Player.tsx client/src/Player.test.tsx \
  client/src/Admin.tsx client/src/Admin.test.tsx
git commit -m "feat: табло показывает вопрос по словам, кнопка на телефоне ждёт конца показа"
```

---

## После всех задач

- `pnpm -C server exec vitest run && pnpm -C client exec vitest run` — оба пакета целиком
  зелёные.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` из корня (или эквивалент по
  package.json — свериться с `svoya-igra-dev/SKILL.md`, «Скрипты»).
- Обновить `docs/ideas.md`: пункт «Постепенный показ текста вопроса» — перевести статус
  из `идея` (или отметить как реализованный по факту), и поправить формулировку — исходная
  идея описывала раннюю кнопку как риск, реализация вместо этого убирает кнопку целиком на
  время показа (см. спеку, «Правило», разошлись по итогам обсуждения).
- Живая партия с настоящим паком — подобрать скорость показа через временную секцию в админке,
  затем отдельной задачей (не часть этого плана) удалить временный механизм целиком, тем же
  способом, каким был удалён `videoPrerollMs` — зафиксировать число, убрать секцию из
  `Admin.tsx`, поля из протокола/`Room`/обоих клиентских хуков, откомментировать «ВРЕМЕННО» -
  markers.
