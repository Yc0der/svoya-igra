import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeadline } from './deadline.mjs';

/** Управляемые часы: тест не должен зависеть от того, как быстро он выполняется. */
function fakeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('createDeadline отдаёт остаток общего бюджета, а не бюджет заново', () => {
  const clock = fakeClock();
  const budget = createDeadline(2000, clock.now);

  assert.equal(budget.left(), 2000);
  clock.advance(500);
  assert.equal(budget.left(), 1500);
  clock.advance(500);
  assert.equal(budget.left(), 1000);
});

test('createDeadline на исчерпанном бюджете отдаёт 0, а не отрицательное число', () => {
  // Ноль — это «времени нет»: вызывающий обязан отказаться от работы. Отрицательное
  // число тут опаснее всего для execFileSync, где timeout: 0 значит «без предела».
  const clock = fakeClock();
  const budget = createDeadline(2000, clock.now);

  clock.advance(2000);
  assert.equal(budget.left(), 0);
  clock.advance(5000);
  assert.equal(budget.left(), 0);
});

test('createDeadline по умолчанию берёт настоящие часы', () => {
  const budget = createDeadline(2000);
  const left = budget.left();

  assert.ok(left > 0 && left <= 2000, `остаток вне бюджета: ${left}`);
});
