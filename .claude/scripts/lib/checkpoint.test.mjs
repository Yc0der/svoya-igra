import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    // быстрый выход происходит до mkdir — каталога состояния быть не должно
    await assert.rejects(readFile(join(cwd, '.claude', 'state')));
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
    assert.equal(state.artifactReminded, true);
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
