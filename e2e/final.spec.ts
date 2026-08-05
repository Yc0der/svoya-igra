import { test, expect, type Page } from '@playwright/test';

async function join(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
}

test('board, two players and a host play through the final round', async ({
  browser,
}) => {
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto('/board');

  const aContext = await browser.newContext();
  const a = await aContext.newPage();
  await join(a, 'Аня');

  const bContext = await browser.newContext();
  const b = await bContext.newPage();
  await join(b, 'Боря');

  const cContext = await browser.newContext();
  const c = await cContext.newPage();
  await join(c, 'Вика');

  await c.getByRole('button', { name: 'Стать ведущим' }).click();
  await expect(c.getByText('Стать ведущим')).not.toBeVisible();

  await a.getByRole('button', { name: 'Начать игру' }).click();

  // Единственный вопрос пакета — кто из a/b видит сетку, тот и picker.
  let picker!: Page;
  let pickerName!: string;
  let other!: Page;
  let otherName!: string;
  await expect(async () => {
    if (
      await a
        .getByRole('button', { name: /^\d+$/ })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      picker = a;
      pickerName = 'Аня';
      other = b;
      otherName = 'Боря';
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
      pickerName = 'Боря';
      other = a;
      otherName = 'Аня';
      return;
    }
    throw new Error('grid not visible on either page yet');
  }).toPass();

  await picker.getByRole('button', { name: /^\d+$/ }).first().click();
  await picker.getByRole('button', { name: 'Ответ', exact: true }).click();
  await picker.getByRole('button', { name: 'Я ответил' }).click();

  // Судейство с ведущим (c) — решает сразу, без ожидания таймера голосования.
  await expect(c.getByText('Ответ')).toBeVisible();
  await c.getByRole('button', { name: 'Зачёт', exact: true }).click();

  // other пришёл бы к финалу с 0 очков — движок зажимает ставку до
  // max(0, score) (engine.ts, handleSubmitWager), так что ставка больше 0
  // ниже была бы молча обнулена, а тест перестал бы содержательно проверять
  // проигрыш ставки. Панель ведущего ещё видна: сейчас идёт reveal обычного
  // раунда, не финальная фаза (Player.tsx, hostAdminPanel скрыта только в
  // final-*). Пользуемся тем же путём (±очки), что уже проверен в базовом
  // раунде, чтобы дать other очки, на которые реально можно поставить.
  await expect(
    c.getByRole('listitem').filter({ hasText: otherName }),
  ).toBeVisible();
  await c
    .getByRole('listitem')
    .filter({ hasText: otherName })
    .getByRole('button', { name: '+100', exact: true })
    .click();

  // Единственный вопрос единственного раунда исчерпан — после раскрытия
  // (REVEAL_TIMER_MS) партия сразу переходит в финал, минуя round-end.
  await expect(board.getByText('Финал — выбор темы')).toBeVisible({
    timeout: 20_000,
  });

  // Изначально other пришёл бы к финалу с 0 < picker'а 100 и ходил бы первым
  // по правилу «по возрастанию счёта» (design.md, финал-спека). Но панель
  // ведущего выше выдала other фиксированные +100 (кнопка Player.tsx не
  // параметризуется), а единственный вопрос пакета тоже стоит 100 — счета
  // сравниваются 100 на 100. При равенстве engine.ts (ascendingByScore)
  // разрешает порядок по тому, в каком порядке сформирован список счётчиков
  // (тот же принцип, что и в design.md) — то есть по порядку входа в
  // комнату, который не совпадает ни с picker, ни с other предсказуемо: кто
  // из них войдёт первым, зависит от того, кого случайный стартовый
  // turnCounterId (engine.ts, createInitialState) назначил picker'ом в
  // начале теста. Поэтому здесь не фиксируем, что первый ход — за other, а
  // опрашиваем, у кого из двух реально включена кнопка темы, тем же паттерном
  // toPass(), что и при определении picker'а выше.
  await expect(async () => {
    if (
      await picker
        .getByRole('button', { name: 'Финал A', exact: true })
        .isEnabled()
        .catch(() => false)
    ) {
      await picker
        .getByRole('button', { name: 'Финал A', exact: true })
        .click();
      return;
    }
    if (
      await other
        .getByRole('button', { name: 'Финал A', exact: true })
        .isEnabled()
        .catch(() => false)
    ) {
      await other.getByRole('button', { name: 'Финал A', exact: true }).click();
      return;
    }
    throw new Error('final elim turn not resolved on either page yet');
  }).toPass();

  await expect(picker.getByLabel('Ставка')).toBeVisible();
  await picker.getByLabel('Ставка').fill('50');
  await picker.getByRole('button', { name: 'Готово' }).click();
  await other.getByLabel('Ставка').fill('30');
  await other.getByRole('button', { name: 'Готово' }).click();

  await expect(picker.getByLabel('Ответ')).toBeVisible();
  await picker.getByLabel('Ответ').fill('ответ пикера');
  await picker.getByRole('button', { name: 'Готово' }).click();
  await other.getByLabel('Ответ').fill('ответ второго');
  await other.getByRole('button', { name: 'Готово' }).click();

  await expect(
    c.getByRole('listitem').filter({ hasText: pickerName }),
  ).toBeVisible();
  await c
    .getByRole('listitem')
    .filter({ hasText: pickerName })
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await c
    .getByRole('listitem')
    .filter({ hasText: otherName })
    .getByRole('button', { name: 'Неверно', exact: true })
    .click();

  // picker: 100 (базовый раунд) + 50 (верная ставка) = 150.
  // other: 0 (базовый раунд) + 100 (панель ведущего) − 30 (неверная ставка) = 70.
  await expect(board.getByText('Финал — итог')).toBeVisible();
  await expect(board.getByText('150')).toBeVisible();
  await expect(board.getByText('70')).toBeVisible();
  await expect(picker.getByText('150')).toBeVisible();
  await expect(other.getByText('70')).toBeVisible();

  await boardContext.close();
  await aContext.close();
  await bContext.close();
  await cContext.close();
});
