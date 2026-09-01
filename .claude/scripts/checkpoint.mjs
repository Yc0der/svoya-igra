#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  classifyEvent,
  checksVerdict,
  checkpointReminder,
} from './lib/checkpoint-rules.mjs';
import { createDeadline } from './lib/deadline.mjs';
import { gitFacts } from './lib/git-facts.mjs';
import { loadState, saveState } from './lib/state.mjs';
import {
  latestContextTokens,
  projectSlug,
  readTail,
} from './lib/transcript.mjs';

// И git, и чтение stdin в норме укладываются в низкие сотни миллисекунд — три git-вызова
// подряд на путях commit/merge по замеру дают медиану ~180 мс, а не единицы миллисекунд.
// Но и это не гарантия: зависший git-процесс или родитель, не закрывший stdin, не должны
// держать вызов инструмента до внешнего timeout из settings.json (10 с).
//
// Бюджет один на весь запуск, а не на каждую операцию: покомандный предел ограничивает
// одну команду, а не работу целиком, и пять операций по 2 с складывались ровно в те же
// 10 с — то есть свой предел не давал никакого запаса. Общий бюджет убирает сложение.
const BUDGET_MS = 2000;
const budget = createDeadline(BUDGET_MS);

/** Единственный выход из скрипта. Молчание — тоже допустимый ответ. */
function emit(text) {
  if (!text) return process.exit(0);
  // exit(0) сразу после write может усечь вывод в pipe на Windows — ждём callback
  // записи, а не полагаемся на то, что процесс не завершится раньше неё.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: text,
      },
    }),
    () => process.exit(0),
  );
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

/** Один git-вызов с выданным ему остатком бюджета. null — git не ответил. */
function git(cwd, args, timeoutMs) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });
  } catch {
    return null;
  }
}

async function contextTokens(payload, cwd) {
  if (budget.left() === 0) return null; // за бюджетом честный ответ — «не знаю»
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
  const raw = await readStdin(budget.left());
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

  const facts = gitFacts(
    (args, timeoutMs) => git(cwd, args, timeoutMs),
    budget,
  );

  const text = checkpointReminder({
    event,
    ...facts,
    contextTokens: await contextTokens(payload, cwd),
    checks: state.checks ?? 'unknown',
    remindedSha: state.remindedSha ?? null,
  });

  if (text && facts.commitSha)
    await saveState(stateDir, statePath, {
      ...state,
      remindedSha: facts.commitSha,
    });
  return emit(text);
}

main().catch(() => emit(null));
