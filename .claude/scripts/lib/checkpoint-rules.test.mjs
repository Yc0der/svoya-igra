import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEvent,
  checksVerdict,
  checkpointReminder,
} from './checkpoint-rules.mjs';

const facts = (over = {}) => ({
  event: 'commit',
  commitSha: 'abc1234',
  changedPaths: [],
  worktreeClean: true,
  contextTokens: 250_000,
  checks: 'green',
  remindedSha: null,
  ...over,
});

test('classifyEvent узнаёт коммит, мёрж и прогон проверок', () => {
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(classifyEvent(bash('git commit -m "feat: X"')), 'commit');
  assert.equal(classifyEvent(bash('gh pr merge 42 --squash')), 'merge');
  assert.equal(classifyEvent(bash('pnpm test')), 'checks');
  assert.equal(
    classifyEvent(bash('pnpm --filter server run typecheck')),
    'checks',
  );
  assert.equal(classifyEvent(bash('ls -la')), null);
});

test('classifyEvent не путает упоминание слияния в данных с реальным вызовом', () => {
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  // Реальный вызов — в начале команды или после разделителя.
  assert.equal(classifyEvent(bash('gh pr merge 42 --squash')), 'merge');
  assert.equal(
    classifyEvent(bash('pnpm build && gh pr merge 42 --squash')),
    'merge',
  );
  // Упоминание внутри данных — посередине чужой подкоманды — не событие.
  assert.equal(
    classifyEvent(
      bash(
        'echo \'{"tool_input":{"command":"gh pr merge 1 --squash"}}\' | node hook.mjs',
      ),
    ),
    null,
  );
  assert.equal(
    classifyEvent(bash('echo "не забыть про gh pr merge после ревью"')),
    null,
  );
});

test('classifyEvent считает событием только запись пака', () => {
  const write = (file_path) => ({
    tool_name: 'Write',
    tool_input: { file_path },
  });
  assert.equal(classifyEvent(write('C:\\proj\\packs\\kino.json')), 'artifact');
  assert.equal(classifyEvent(write('packs/kino.json')), 'artifact');
  assert.equal(classifyEvent(write('server/src/room.ts')), null);
  assert.equal(classifyEvent({ tool_name: 'Read', tool_input: {} }), null);
});

test('checksVerdict читает вывод прогона', () => {
  assert.equal(
    checksVerdict({ stdout: 'Test Files  12 passed (12)' }),
    'green',
  );
  assert.equal(
    checksVerdict({ stdout: 'Test Files  1 failed | 11 passed' }),
    'red',
  );
  assert.equal(
    checksVerdict({ stderr: 'src/room.ts(10,3): error TS2345: ...' }),
    'red',
  );
  assert.equal(checksVerdict({ stderr: 'ELIFECYCLE  Command failed' }), 'red');
  assert.equal(checksVerdict({ stdout: 'что-то другое' }), 'unknown');
  assert.equal(checksVerdict(undefined), 'unknown');
});

test('класс А1: закоммиченная спека — чистим без порога по контексту', () => {
  const path = 'docs/superpowers/specs/2026-08-30-token-budget-design.md';
  const text = checkpointReminder(
    facts({
      changedPaths: [path],
      addedPaths: [path],
      contextTokens: 40_000,
    }),
  );
  assert.match(text, /А1/);
  assert.match(text, /\/clear/);
});

test('класс А2: закоммиченный план', () => {
  const path = 'docs/superpowers/plans/2026-08-30-token-budget.md';
  const text = checkpointReminder(
    facts({ changedPaths: [path], addedPaths: [path] }),
  );
  assert.match(text, /А2/);
});

test('класс А2: галочка в уже существующем плане не даёт напоминания (файл изменён, не добавлен)', () => {
  const path = 'docs/superpowers/plans/2026-08-30-token-budget.md';
  // Контекст ниже порога Б и здесь специально: тест проверяет именно то, что
  // А2 не срабатывает на правку — а не что ничего вообще не сработает.
  const text = checkpointReminder(
    facts({ changedPaths: [path], addedPaths: [], contextTokens: 40_000 }),
  );
  assert.equal(text, null);
});

test('класс А1: правка уже существующей спеки не даёт напоминания (файл изменён, не добавлен)', () => {
  const path = 'docs/superpowers/specs/2026-08-30-token-budget-design.md';
  const text = checkpointReminder(
    facts({ changedPaths: [path], addedPaths: [], contextTokens: 40_000 }),
  );
  assert.equal(text, null);
});

test('класс А2: смешанный коммит (новый план + код) — не конец writing-plans, класс Б решает дальше', () => {
  const planPath = 'docs/superpowers/plans/2026-08-30-token-budget.md';
  const codePath = 'server/src/example.ts';
  const text = checkpointReminder(
    facts({
      changedPaths: [planPath, codePath],
      addedPaths: [planPath, codePath],
    }),
  );
  // Не А2: план не единственное, что принёс этот коммит. Контекст в facts() по
  // умолчанию выше порога и проверки зелёные — коммит падает в класс Б, как обычный.
  assert.doesNotMatch(text ?? '', /А2/);
  assert.match(text, /Б/);
});

test('класс А1: смешанный коммит (новая спека + код) — не конец writing-plans', () => {
  const specPath = 'docs/superpowers/specs/x-design.md';
  const codePath = 'server/src/example.ts';
  const text = checkpointReminder(
    facts({
      changedPaths: [specPath, codePath],
      addedPaths: [specPath, codePath],
    }),
  );
  assert.doesNotMatch(text ?? '', /А1/);
  assert.match(text, /Б/);
});

test('класс А3: смёрженный PR', () => {
  const text = checkpointReminder(facts({ event: 'merge', changedPaths: [] }));
  assert.match(text, /А3/);
  assert.match(text, /\/clear/);
});

test('класс А4: записанный пак — даже при грязном дереве', () => {
  // Запись пака сама и делает дерево грязным, поэтому чистота тут не условие.
  const text = checkpointReminder(
    facts({
      event: 'artifact',
      commitSha: null,
      worktreeClean: false,
      changedPaths: [],
    }),
  );
  assert.match(text, /А4/);
});

test('класс А4: повтор по тому же пути артефакта глушится', () => {
  const text = checkpointReminder(
    facts({
      event: 'artifact',
      commitSha: null,
      worktreeClean: false,
      changedPaths: [],
      artifactPath: 'packs/kino.json',
      remindedArtifacts: ['packs/kino.json'],
    }),
  );
  assert.equal(text, null);
});

test('класс А4: другой путь артефакта в той же сессии — законный повод напомнить', () => {
  const text = checkpointReminder(
    facts({
      event: 'artifact',
      commitSha: null,
      worktreeClean: false,
      changedPaths: [],
      artifactPath: 'packs/sport.json',
      remindedArtifacts: ['packs/kino.json'],
    }),
  );
  assert.match(text, /А4/);
});

test('класс А4: сравнение пути нечувствительно к виду слэшей', () => {
  const text = checkpointReminder(
    facts({
      event: 'artifact',
      worktreeClean: false,
      artifactPath: 'packs\\kino.json',
      remindedArtifacts: ['packs/kino.json'],
    }),
  );
  assert.equal(text, null);
});

test('класс Б: коммит без спеки и плана — только выше порога', () => {
  assert.equal(checkpointReminder(facts({ contextTokens: 150_000 })), null);
  const text = checkpointReminder(facts({ contextTokens: 250_000 }));
  assert.match(text, /Б/);
  assert.match(text, /\/handoff/);
});

test('класс Б молчит, когда проверки красные или не прогонялись', () => {
  assert.equal(checkpointReminder(facts({ checks: 'red' })), null);
  const unknown = checkpointReminder(facts({ checks: 'unknown' }));
  assert.match(unknown, /не прогонялись/);
});

test('грязное рабочее дерево глушит все классы, кроме А4', () => {
  assert.equal(
    checkpointReminder(
      facts({
        worktreeClean: false,
        changedPaths: ['docs/superpowers/plans/x.md'],
      }),
    ),
    null,
  );
  assert.equal(checkpointReminder(facts({ worktreeClean: false })), null);
});

test('неизвестный размер контекста глушит класс Б, но не класс А', () => {
  assert.equal(checkpointReminder(facts({ contextTokens: null })), null);
  const path = 'docs/superpowers/specs/x-design.md';
  assert.match(
    checkpointReminder(
      facts({ contextTokens: null, changedPaths: [path], addedPaths: [path] }),
    ),
    /А1/,
  );
});

test('по одному и тому же коммиту напоминаем один раз', () => {
  assert.equal(checkpointReminder(facts({ remindedSha: 'abc1234' })), null);
});

test('любое напоминание короче 90 символов — бюджет не абзац, а фраза', () => {
  const cases = [
    facts({
      changedPaths: ['docs/superpowers/specs/x-design.md'],
      addedPaths: ['docs/superpowers/specs/x-design.md'],
    }),
    facts({
      changedPaths: ['docs/superpowers/plans/x.md'],
      addedPaths: ['docs/superpowers/plans/x.md'],
    }),
    facts({ event: 'merge' }),
    facts({ event: 'artifact', changedPaths: ['packs/x.json'] }),
    facts({}),
    facts({ checks: 'unknown' }),
  ];
  for (const c of cases) {
    const text = checkpointReminder(c);
    assert.ok(text, 'ожидалось напоминание');
    assert.ok(text.length <= 90, `слишком длинно: ${text.length}`);
  }
});
