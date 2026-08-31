#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  carryCostByTool,
  findTranscripts,
  parseTranscript,
} from './lib/transcript.mjs';
import { formatReport } from './lib/report.mjs';

const CAP = Number(process.env.TOKENS_CAP ?? 200_000);
const shortId = (id) => (id ?? '—').slice(0, 8);
const dateOf = (parsed) =>
  (parsed.requests[0]?.timestamp ?? '').slice(0, 10) || '——————————';

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
const cappedOf = (parsed) =>
  parsed.requests.reduce((sum, r) => sum + Math.min(r.contextTokens, CAP), 0);

const [now, ...rest] = parsedFiles;
const nowRequests = now.requests;

const project = {
  sessions: parsedFiles.length,
  requests: parsedFiles.reduce((sum, p) => sum + p.requests.length, 0),
  burned: parsedFiles.reduce((sum, p) => sum + burnedOf(p), 0),
  capped: parsedFiles.reduce((sum, p) => sum + cappedOf(p), 0),
  avgContext: 0,
  over300: 0,
  over500: 0,
};
project.avgContext =
  project.requests === 0 ? 0 : Math.round(project.burned / project.requests);

let over300 = 0;
let over500 = 0;
for (const parsed of parsedFiles) {
  for (const request of parsed.requests) {
    if (request.contextTokens > 300_000) over300 += request.contextTokens;
    if (request.contextTokens > 500_000) over500 += request.contextTokens;
  }
}
const share = (part) =>
  project.burned === 0 ? 0 : Math.round((part / project.burned) * 100);
project.over300 = share(over300);
project.over500 = share(over500);

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
  sessions: rest.map((parsed) => ({
    date: dateOf(parsed),
    id: shortId(parsed.sessionId),
    requests: parsed.requests.length,
    avgContext: Math.round(burnedOf(parsed) / parsed.requests.length),
    burned: burnedOf(parsed),
  })),
});

console.log(report.join('\n'));
