#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateProject,
  carryCostByTool,
  findTranscripts,
  parseTranscript,
  sortByLastRequest,
} from './lib/transcript.mjs';
import { formatReport } from './lib/report.mjs';

const CAP = Number(process.env.TOKENS_CAP ?? 200_000);
const shortId = (id) => (id ?? '—').slice(0, 8);
// Дата последнего запроса, а не первого — сессия могла начаться неделю назад
// и просто возобновиться сегодня; см. sortByLastRequest, который таблицу
// сессий проекта сортирует по этому же значению.
const dateOf = (parsed) =>
  (parsed.requests[parsed.requests.length - 1]?.timestamp ?? '').slice(0, 10) ||
  '——————————';

const files = await findTranscripts(
  join(homedir(), '.claude', 'projects'),
  process.cwd(),
);

const parsedFiles = [];
for (const file of files) {
  let parsed;
  try {
    parsed = parseTranscript(await readFile(file.path, 'utf8'));
  } catch {
    continue;
  }
  if (parsed.requests.length > 0) parsedFiles.push(parsed);
}

if (parsedFiles.length === 0) {
  console.log('Транскрипты проекта не найдены — отчёт строить не из чего.');
  process.exit(0);
}

const burnedOf = (parsed) =>
  parsed.requests.reduce((sum, r) => sum + r.contextTokens, 0);

const [now, ...rest] = parsedFiles;
const nowRequests = now.requests;
// findTranscripts сортирует по mtime — это надёжно только для выбора текущей
// сессии (её файл дописывается прямо сейчас). Для таблицы сессий проекта
// mtime может расходиться с содержимым (файл тронут без новой записи), поэтому
// здесь сортируем по времени последнего запроса — оно же идёт в dateOf.
const sessionsForTable = sortByLastRequest(rest);

const project = aggregateProject(parsedFiles, CAP);

const report = formatReport({
  cap: CAP,
  current: {
    id: shortId(now.sessionId),
    contextNow: nowRequests[nowRequests.length - 1]?.contextTokens ?? 0,
    requests: nowRequests.length,
    burned: burnedOf(now),
    compacts: now.compacts,
    topTools: carryCostByTool(now).slice(0, 3),
  },
  project,
  sessions: sessionsForTable.map((parsed) => ({
    date: dateOf(parsed),
    id: shortId(parsed.sessionId),
    requests: parsed.requests.length,
    avgContext: Math.round(burnedOf(parsed) / parsed.requests.length),
    burned: burnedOf(parsed),
  })),
});

console.log(report.join('\n'));
