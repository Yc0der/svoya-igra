import test from 'node:test';
import assert from 'node:assert/strict';
import { gitFacts } from './git-facts.mjs';

/** Бюджет с управляемыми часами: тест не должен зависеть от скорости выполнения. */
function fakeBudget(budgetMs) {
  let spent = 0;
  return {
    left: () => Math.max(0, budgetMs - spent),
    spend: (ms) => {
      spent += ms;
    },
  };
}

/** Подставной git: отдаёт заготовленный вывод и записывает, что и с чем спросили. */
function fakeGit(outputs) {
  const calls = [];
  const run = (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    return outputs[args[0]] ?? null;
  };
  return { run, calls };
}

test('gitFacts собирает факты из вывода git', () => {
  const { run } = fakeGit({
    status: '',
    'rev-parse': 'abc123\n',
    show: 'docs/plan.md\nserver/src/x.ts\n',
  });

  const facts = gitFacts(run, fakeBudget(2000));

  assert.equal(facts.worktreeClean, true);
  assert.equal(facts.commitSha, 'abc123');
  assert.deepEqual(facts.changedPaths, ['docs/plan.md', 'server/src/x.ts']);
  assert.deepEqual(facts.addedPaths, ['docs/plan.md', 'server/src/x.ts']);
});

test('gitFacts считает дерево грязным, когда git не ответил', () => {
  const { run } = fakeGit({});

  const facts = gitFacts(run, fakeBudget(2000));

  // null от git — это «не знаю», а не «чисто»: молчание безопаснее ложной точки выхода.
  assert.equal(facts.worktreeClean, false);
  assert.equal(facts.commitSha, null);
  assert.deepEqual(facts.changedPaths, []);
});

test('gitFacts отдаёт каждому вызову остаток общего бюджета, а не бюджет заново', () => {
  const budget = fakeBudget(2000);
  const { run, calls } = fakeGit({
    status: '',
    'rev-parse': 'abc\n',
    show: '',
  });
  const spending = (args, timeoutMs) => {
    budget.spend(600); // каждый git думает 600 мс
    return run(args, timeoutMs);
  };

  gitFacts(spending, budget);

  assert.deepEqual(
    calls.map((c) => c.timeoutMs),
    [2000, 1400, 800, 200],
  );
});

test('gitFacts перестаёт звать git, когда общий бюджет исчерпан', () => {
  const budget = fakeBudget(2000);
  const calls = [];
  // Зависший git выбирает выданный ему предел целиком и не отвечает ничем.
  const hanging = (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    budget.spend(timeoutMs);
    return null;
  };

  const facts = gitFacts(hanging, budget);

  // Первый вызов съел весь бюджет — остальные три даже не начинаются.
  assert.equal(calls.length, 1);
  assert.equal(facts.worktreeClean, false);
  assert.equal(facts.commitSha, null);
});
