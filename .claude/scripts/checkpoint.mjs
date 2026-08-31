#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  classifyEvent,
  checksVerdict,
  checkpointReminder,
} from './lib/checkpoint-rules.mjs';
import {
  latestContextTokens,
  projectSlug,
  readTail,
} from './lib/transcript.mjs';

/** Единственный выход из скрипта. Молчание — тоже допустимый ответ. */
function emit(text) {
  if (text) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: text,
        },
      }),
    );
  }
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { checks: 'unknown', remindedSha: null, artifactReminded: false };
  }
}

async function saveState(dir, path, state) {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(state), 'utf8');
  } catch {
    // состояние — оптимизация, а не источник истины
  }
}

async function contextTokens(payload, cwd) {
  const direct = payload.transcript_path;
  const fallback =
    payload.session_id &&
    join(
      homedir(),
      '.claude',
      'projects',
      projectSlug(cwd),
      `${payload.session_id}.jsonl`,
    );
  for (const path of [direct, fallback]) {
    if (!path) continue;
    try {
      const tokens = latestContextTokens(await readTail(path));
      if (tokens !== null) return tokens;
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return emit(null);
  }

  const event = classifyEvent(payload);
  if (!event) return emit(null); // быстрый выход: ни git, ни диска

  const cwd = payload.cwd ?? process.cwd();
  const stateDir = join(cwd, '.claude', 'state');
  const statePath = join(
    stateDir,
    `checkpoint-${payload.session_id ?? 'unknown'}.json`,
  );
  const state = await loadState(statePath);

  if (event === 'checks') {
    const verdict = checksVerdict(payload.tool_response);
    if (verdict !== 'unknown')
      await saveState(stateDir, statePath, { ...state, checks: verdict });
    return emit(null); // сам по себе прогон проверок точкой выхода не является
  }

  if (event === 'artifact') {
    // Класс А4 намеренно не проходит дедуп по коммиту в checkpoint-rules.mjs
    // (записанный пак сам делает дерево грязным — требовать чистоты нечестно).
    // Поэтому дедуп — здесь, на уровне сессии: одно напоминание про артефакт
    // за сессию, а не на каждую правку одного и того же пака.
    if (state.artifactReminded) return emit(null);
    await saveState(stateDir, statePath, { ...state, artifactReminded: true });
    return emit(checkpointReminder({ event }));
  }

  const status = git(cwd, ['status', '--porcelain']);
  const worktreeClean = status !== null && status.trim() === '';
  const commitSha = git(cwd, ['rev-parse', 'HEAD'])?.trim() ?? null;
  const changedPaths = (
    git(cwd, ['show', '--name-only', '--format=', 'HEAD']) ?? ''
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const text = checkpointReminder({
    event,
    commitSha,
    changedPaths,
    worktreeClean,
    contextTokens: await contextTokens(payload, cwd),
    checks: state.checks ?? 'unknown',
    remindedSha: state.remindedSha ?? null,
  });

  if (text && commitSha)
    await saveState(stateDir, statePath, { ...state, remindedSha: commitSha });
  return emit(text);
}

main().catch(() => emit(null));
