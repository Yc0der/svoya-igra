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

// И git, и чтение stdin в норме занимают миллисекунды. Но «в норме» — не гарантия:
// зависший git-процесс или родитель, не закрывший stdin, не должны держать вызов
// инструмента до внешнего timeout из settings.json (10 с) — свой предел на порядок
// меньше, чтобы отказ был дешёвым, а не просто менее дорогим, чем ничего.
const IO_TIMEOUT_MS = 2000;

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

/** null — вход не пришёл вовремя; тогда правильный ответ такой же, как на пустой вход. */
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    (async () => {
      try {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        finish(Buffer.concat(chunks).toString('utf8'));
      } catch {
        finish(null);
      }
    })();
  });
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: IO_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { checks: 'unknown', remindedSha: null, remindedArtifacts: [] };
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
  const raw = await readStdin(IO_TIMEOUT_MS);
  if (raw === null) return emit(null); // вход не подоспел вовремя

  let payload;
  try {
    payload = JSON.parse(raw);
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
    // Решение (в том числе дедуп по пути) принимает checkpointReminder — здесь
    // только факты: какой путь и что уже напоминали в этой сессии. А4 не зависит
    // от git, поэтому дальше обращений к git для неё нет.
    const artifactPath = payload.tool_input?.file_path ?? null;
    const remindedArtifacts = state.remindedArtifacts ?? [];
    const text = checkpointReminder({ event, artifactPath, remindedArtifacts });
    if (text)
      await saveState(stateDir, statePath, {
        ...state,
        remindedArtifacts: [...remindedArtifacts, artifactPath],
      });
    return emit(text);
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
