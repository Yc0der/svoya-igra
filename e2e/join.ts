import { expect, type Page } from '@playwright/test';

// Вход игрока с экрана лобби. С вехи player-identity экран бывает двух видов:
// при непустой истории — список знакомых людей и «Меня тут нет», при пустой —
// сразу поле имени. Какой из двух, становится известно только с первым
// `state` по ws, а до него React уже отрисовал поле имени. Поиск поля
// «наугад» ловит его ровно тогда, когда лобби переключается на список, и
// падает с «element was detached from the DOM» — так падал вход второго
// игрока: первый уже записан в историю, и второй телефон видит список.
// Поэтому решение принимается по `people` из самого кадра, а не по разметке.
export async function join(page: Page, name: string): Promise<void> {
  const firstState = new Promise<unknown[]>((resolve) => {
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;
        const message = JSON.parse(payload) as {
          type?: string;
          people?: unknown[];
        };
        if (message.type === 'state' && message.people) {
          resolve(message.people);
        }
      });
    });
  });

  await page.goto('/');
  const people = await firstState;
  if (people.length > 0) {
    await page.getByRole('button', { name: 'Меня тут нет' }).click();
  }
  await page.getByLabel('Имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Ты в игре. Жди начала.')).toBeVisible();
}
