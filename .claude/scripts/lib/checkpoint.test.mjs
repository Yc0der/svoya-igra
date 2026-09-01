import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../checkpoint.mjs', import.meta.url));

/** Гоняет checkpoint.mjs как настоящий hook: JSON на stdin, JSON (или пусто) на stdout. */
function runHook(input, cwd) {
  const result = execFileSync('node', [scriptPath], {
    cwd,
    input,
    encoding: 'utf8',
  });
  return result;
}

async function withTempCwd(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'checkpoint-hook-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const gitOpts = (cwd) => ({ cwd, stdio: ['ignore', 'ignore', 'ignore'] });

/** Настоящий git-репозиторий во временном каталоге — не рабочий репозиторий проекта. */
function initGitRepo(dir) {
  // autocrlf=false — иначе git на этой машине пишет в stderr предупреждение
  // про перевод строк при каждом add/commit, и оно засоряет вывод тестов.
  execFileSync('git', ['init', '--quiet'], gitOpts(dir));
  execFileSync('git', ['config', 'core.autocrlf', 'false'], gitOpts(dir));
  execFileSync(
    'git',
    ['config', 'user.email', 'checkpoint-test@example.com'],
    gitOpts(dir),
  );
  execFileSync('git', ['config', 'user.name', 'Checkpoint Test'], gitOpts(dir));
}

/** Создаёт файл и коммитит его — репозиторий остаётся с чистым деревом. */
function commitFile(dir, relPath, content) {
  const fullPath = join(dir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  execFileSync('git', ['add', relPath], gitOpts(dir));
  execFileSync('git', ['commit', '--quiet', '-m', 'test commit'], gitOpts(dir));
}

/** Минимальный транскрипт с одной записью — ровно то, что читает latestContextTokens. */
function writeFakeTranscript(path, contextTokens) {
  const line = JSON.stringify({
    type: 'assistant',
    requestId: 'r1',
    timestamp: '2024-01-01T00:00:00.000Z',
    message: {
      model: 'claude-test',
      usage: { input_tokens: contextTokens, output_tokens: 10 },
    },
  });
  writeFileSync(path, `${line}\n`, 'utf8');
}

test('молчит на нерелевантном событии и не трогает диск', async () => {
  await withTempCwd(async (cwd) => {
    const out = runHook(
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        cwd,
      }),
      cwd,
    );
    assert.equal(out, '');
    // Быстрый выход происходит до mkdir — каталога .claude в cwd быть не должно.
    // (readFile здесь не годится: чтение каталога отвергается всегда, даже
    // если каталога вовсе нет, — такая проверка не отличала бы «есть» от «нет».)
    assert.equal(existsSync(join(cwd, '.claude')), false);
  });
});

test('битый JSON на входе не роняет хук: пустой вывод, код 0', async () => {
  await withTempCwd((cwd) => {
    const out = runHook('{не json', cwd);
    assert.equal(out, '');
  });
});

test('коммит без git-репозитория не роняет хук (грязное дерево не определить — молчим)', async () => {
  await withTempCwd((cwd) => {
    const out = runHook(
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: x"' },
        cwd,
        session_id: 'no-git-session',
      }),
      cwd,
    );
    assert.equal(out, '');
  });
});

test('класс А4: первая запись пака напоминает, повторная в той же сессии — молчит', async () => {
  await withTempCwd(async (cwd) => {
    const event = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'packs/kino.json' },
      cwd,
      session_id: 'artifact-session',
    });

    const first = runHook(event, cwd);
    assert.match(first, /А4/);
    assert.match(first, /additionalContext/);

    const second = runHook(event, cwd);
    assert.equal(second, '');

    const state = JSON.parse(
      await readFile(
        join(cwd, '.claude', 'state', 'checkpoint-artifact-session.json'),
        'utf8',
      ),
    );
    assert.deepEqual(state.remindedArtifacts, ['packs/kino.json']);
  });
});

test('класс А4: разные сессии напоминают независимо', async () => {
  await withTempCwd((cwd) => {
    const eventFor = (sessionId) =>
      JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'packs/sport.json' },
        cwd,
        session_id: sessionId,
      });

    const first = runHook(eventFor('session-a'), cwd);
    const second = runHook(eventFor('session-b'), cwd);
    assert.match(first, /А4/);
    assert.match(second, /А4/);
  });
});

// Основной git-путь (commit/merge) до сих пор был проверен только на отсутствии
// git-репозитория вовсе. Ниже — сценарии на настоящем временном репозитории:
// git status/rev-parse/show реально исполняются, состояние реально читается и
// пишется на диск. Все репозитории живут в os.tmpdir() и убираются в finally
// внутри withTempCwd — рабочий репозиторий проекта не трогаем.

test('главный git-путь: коммит со спекой напоминает один раз — повтор на том же HEAD молчит', async () => {
  await withTempCwd((cwd) => {
    initGitRepo(cwd);
    commitFile(
      cwd,
      'docs/superpowers/specs/x-design.md',
      '# спека для теста\n',
    );

    const event = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: x"' },
      cwd,
      session_id: 'git-path-spec-session',
    });

    const first = runHook(event, cwd);
    assert.match(first, /А1/);
    assert.match(first, /additionalContext/);

    // Тот же HEAD, тот же вызов — remindedSha в состоянии сессии гасит повтор.
    const second = runHook(event, cwd);
    assert.equal(second, '');
  });
});

test('главный git-путь: грязное рабочее дерево глушит commit-путь', async () => {
  await withTempCwd((cwd) => {
    initGitRepo(cwd);
    commitFile(
      cwd,
      'docs/superpowers/specs/x-design.md',
      '# спека для теста\n',
    );
    // Незакоммиченный файл — дерево грязное, хотя HEAD уже указывает на спеку.
    writeFileSync(join(cwd, 'scratch.txt'), 'мусор', 'utf8');

    const event = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: x"' },
      cwd,
      session_id: 'git-path-dirty-session',
    });

    const out = runHook(event, cwd);
    assert.equal(out, '');
  });
});

test('главный git-путь: красный прогон проверок глушит класс Б в следующем commit-событии', async () => {
  await withTempCwd(async (cwd) => {
    initGitRepo(cwd);
    // Обычный файл — не спека, не план, не пак, чтобы дойти именно до класса Б.
    commitFile(cwd, 'server/src/example.ts', 'export const x = 1;\n');

    const sessionId = 'git-path-checks-red-session';

    const checksEvent = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      tool_response: { stdout: 'Test Files  1 failed | 11 passed' },
      cwd,
      session_id: sessionId,
    });
    const checksOut = runHook(checksEvent, cwd);
    assert.equal(checksOut, ''); // прогон проверок сам по себе не точка выхода

    const state = JSON.parse(
      await readFile(
        join(cwd, '.claude', 'state', `checkpoint-${sessionId}.json`),
        'utf8',
      ),
    );
    assert.equal(state.checks, 'red'); // вердикт действительно лёг в состояние

    // Контекст заведомо выше порога — без красных проверок класс Б бы сработал.
    const transcriptPath = join(cwd, 'transcript.jsonl');
    writeFakeTranscript(transcriptPath, 250_000);

    const commitEvent = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: x"' },
      cwd,
      session_id: sessionId,
      transcript_path: transcriptPath,
    });
    const commitOut = runHook(commitEvent, cwd);
    assert.equal(commitOut, '');
  });
});

test('главный git-путь: отсутствующий транскрипт не даёт классу Б сработать', async () => {
  await withTempCwd((cwd) => {
    initGitRepo(cwd);
    commitFile(cwd, 'server/src/example.ts', 'export const x = 1;\n');

    const event = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: x"' },
      cwd,
      session_id: 'git-path-no-transcript-session',
      transcript_path: join(cwd, 'nonexistent-transcript.jsonl'),
    });

    const out = runHook(event, cwd);
    assert.equal(out, '');
  });
});
