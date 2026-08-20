import { test, expect, type Page } from '@playwright/test';

async function join(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
}

test('board and two players play two questions end to end', async ({
  browser,
}) => {
  // Дефолтный таймаут теста (30с, не переопределён в playwright.config.ts)
  // тесен для двух реальных циклов голосования: VOTE_TIMER_MS (10с) +
  // REVEAL_TIMER_MS (4с) на каждый из двух вопросов — уже ~28с одних только
  // таймеров движка, без учёта сетапа и сетевых задержек. Раздвинуто здесь,
  // локально для файла, а не в глобальном конфиге.
  test.setTimeout(90_000);

  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto('/board');

  // Имена намеренно не 'Ваня' — эта же строка уже занята в
  // e2e/lobby.spec.ts. Комната на сервере одна на весь процесс `pnpm run
  // test:e2e` (единственный webServer, reuseExistingServer: false), а
  // `Room.join()` (server/src/room.ts) резервирует имя навсегда: `disconnect`
  // только переключает `connected: false`, но не убирает участника из
  // массива, так что имя не освобождается даже после закрытия контекста.
  // Playwright по умолчанию раскидывает разные spec-файлы по разным
  // воркерам и гоняет их параллельно против одного и того же процесса —
  // так что при совпадении имён тот файл, чей join('Ваня', ...) прилетит
  // вторым, детерминированно получит {error: 'name-taken'} независимо от
  // порядка. Это не гонка, которая иногда проходит — это гарантированная
  // коллизия при каждом прогоне всего набора, потому что комната одна на
  // весь процесс сервера, а не на тест.
  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  await join(a, 'Пётр');

  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await join(b, 'Катя');

  await a.getByRole('button', { name: 'Начать игру' }).click();

  // Кто-то из двоих увидит сетку — определить, чей ход, и довести раунд
  // одним и тем же игроком, чтобы не гадать заранее, кому выпадет первый ход.
  // `.isVisible()` не ждёт появления элемента (в отличие от locator-действий
  // и `expect(...).toBeVisible()`) — сразу после клика по «Начать игру»
  // сетка на обеих страницах ещё может быть не отрисована (WS ещё не
  // домчался), и голый `.isVisible()` без ожидания даст ложный результат.
  // `expect(...).toPass()` опрашивает обе страницы, пока сетка не появится
  // хоть у одной.
  let picker!: Page;
  let other!: Page;
  await expect(async () => {
    if (
      await a
        .getByRole('button', { name: /^\d+$/ })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      picker = a;
      other = b;
      return;
    }
    if (
      await b
        .getByRole('button', { name: /^\d+$/ })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      picker = b;
      other = a;
      return;
    }
    throw new Error('grid not visible on either page yet');
  }).toPass();

  await expect(board.getByText(/\d/).first()).toBeVisible();

  for (let i = 0; i < 2; i++) {
    // :enabled, не просто getByRole('button', { name: /^\d+$/ }).first() —
    // `Player.tsx` намеренно не убирает уже отвеченный вопрос из разметки:
    // кнопка остаётся в DOM с тем же числовым текстом (ценой), но получает
    // `disabled`, чтобы сетка не «прыгала». Со второй итерации цикла на
    // странице уже есть такая disabled-кнопка первой в DOM-порядке (первая
    // тема, первая по возрастанию цена), и голый `.first()` по имени находит
    // именно её — клик по disabled-элементу никогда не срабатывает, и
    // `.click()` виснет до таймаута теста. `:enabled` отфильтровывает уже
    // разыгранные вопросы и оставляет только реально кликабельные.
    await picker
      .locator('button:enabled', { hasText: /^\d+$/ })
      .first()
      .click();
    // getByText, не board.locator('p') без уточнения — на табло несколько
    // <p> одновременно (адрес лобби, «Выбирает …», текст вопроса), и
    // toContainText на множественном локаторе либо кидает strict-mode
    // ошибку, либо требует массив ожиданий на каждый элемент. Вопросы в
    // packs/current.json оканчиваются на «?» и это единственный такой текст
    // на экране на этом шаге, так что совпадение однозначно.
    // Таймаут увеличен: «?» — последнее слово вопроса, и теперь оно
    // появляется только по окончании постепенного показа по словам
    // (question-reveal), чья длительность масштабируется с временной
    // админ-настройкой textRevealWordsPerSecond — при её понижении на живой
    // калибровке дефолтный 5000ms expect-таймаут может не хватить.
    await expect(board.getByText(/\?/)).toBeVisible({ timeout: 15000 });

    // Оба видят кнопку «Ответ», но нажимает picker, чтобы сценарий был
    // детерминированным (не зависел от того, кто физически быстрее).
    // exact: true — иначе «Ответ» матчится как подстрока внутри «Я
    // ответил» (тот же класс проблемы, что и с «Зачёт»/«Незачёт» ниже).
    await picker.getByRole('button', { name: 'Ответ', exact: true }).click();
    await picker.getByRole('button', { name: 'Я ответил' }).click();

    // exact: true — иначе getByRole матчит по подстроке без учёта регистра,
    // а «Незачёт» содержит «Зачёт» как подстроку, что даёт strict-mode
    // violation (найдены обе кнопки сразу).
    await other.getByRole('button', { name: 'Зачёт', exact: true }).click();

    // Голос не резолвится сразу по клику — `handleVote` (server/src/engine.ts)
    // только записывает голос в state.votes; переход дальше происходит
    // исключительно по истечении таймера 'vote' (VOTE_TIMER_MS = 10с,
    // engine.ts) через resolveVote(), даже если проголосовали уже все
    // имеющие право голоса — это осознанное, юнит-протестированное поведение
    // (engine.test.ts: «records a vote from an eligible counter without
    // resolving yet»), не гонка и не повод дёргать голосование раньше.
    // Дальше — раскрытие (REVEAL_TIMER_MS = 4с) и, если раунд ещё не
    // разобран, снова 'selecting'. Итого минимум ~14с реального времени
    // между кликом «Зачёт» и повторным появлением сетки; таймеры настоящие,
    // е2е намеренно не мокает время. Дожидаемся, что у picker'а (правильно
    // ответившего — значит, снова его ход) заново появилась кликабельная
    // сетка: это единственный надёжный сигнал, что цикл
    // buzzed → judging → reveal → selecting долистал до конца, не
    // завязанный на конкретный текст конкретного вопроса. Таймаут с запасом
    // сверх 14с под сборку/сеть.
    await expect(
      picker.getByRole('button', { name: /^\d+$/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
  }

  await boardContext.close();
  await aContext.close();
  await bContext.close();
});
