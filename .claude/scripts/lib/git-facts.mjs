const lines = (output) =>
  (output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Факты о репозитории для правил точек выхода. Решений тут нет — только «что видно
 * в git»; что из этого следует, знает `checkpointReminder`.
 *
 * Все четыре вызова делит один бюджет: покомандный предел ограничивает одну команду,
 * а не работу целиком, и четыре предела по 2 с складываются в 8 с — больше, чем внешний
 * timeout хука. Каждому вызову выдаётся остаток, а на нуле спрашивать уже нечего:
 * `timeout: 0` для `execFileSync` означает «без предела», то есть ровно то, от чего
 * бюджет и защищает.
 *
 * `run(args, timeoutMs)` возвращает вывод git или null, если тот не ответил. null —
 * это «не знаю»: дерево тогда считается грязным, и хук молчит.
 */
export function gitFacts(run, budget) {
  const call = (args) => {
    const timeoutMs = budget.left();
    return timeoutMs === 0 ? null : run(args, timeoutMs);
  };

  const status = call(['status', '--porcelain']);
  const head = call(['rev-parse', 'HEAD']);
  const changed = call(['show', '--name-only', '--format=', 'HEAD']);
  // Отдельно от changed: только пути, добавленные именно этим коммитом. Правила
  // А1/А2 требуют «добавлен, а не изменён» — отличить одно от другого может только git.
  const added = call([
    'show',
    '--diff-filter=A',
    '--name-only',
    '--format=',
    'HEAD',
  ]);

  return {
    worktreeClean: status !== null && status.trim() === '',
    commitSha: head?.trim() ?? null,
    changedPaths: lines(changed),
    addedPaths: lines(added),
  };
}
