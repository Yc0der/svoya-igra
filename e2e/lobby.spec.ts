import { test, expect } from '@playwright/test';

test('a player joining shows up on the board', async ({ page, context }) => {
  const board = await context.newPage();
  await board.goto('/board');

  await page.goto('/');
  await page.getByLabel('Имя').fill('Ваня');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
  await expect(board.getByText('Ваня')).toBeVisible();
});
