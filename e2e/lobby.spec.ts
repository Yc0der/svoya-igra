import { test, expect } from '@playwright/test';
import { join } from './join';

test('a player joining shows up on the board', async ({ page, context }) => {
  const board = await context.newPage();
  await board.goto('/board');

  await join(page, 'Ваня');
  await expect(board.getByText('Ваня')).toBeVisible();
});
