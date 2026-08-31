import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTokens, formatReport } from './report.mjs';

const sample = {
  cap: 200_000,
  current: {
    id: '75b186',
    contextNow: 412_000,
    requests: 118,
    burned: 38_200_000,
    compacts: 0,
    topTools: [
      { tool: 'Read', tokens: 9_100_000 },
      { tool: 'Bash', tokens: 6_400_000 },
      { tool: 'Grep', tokens: 2_200_000 },
    ],
  },
  project: {
    sessions: 21,
    requests: 25_852,
    burned: 11_500_000_000,
    capped: 3_100_000_000,
    avgContext: 447_000,
    over300: 87,
    over500: 61,
  },
  sessions: Array.from({ length: 12 }, (_, i) => ({
    date: '2026-08-30',
    id: `sess${i}`,
    requests: 100 + i,
    avgContext: 300_000,
    burned: 30_000_000,
  })),
};

test('fmtTokens сокращает крупные числа', () => {
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(447_000), '447k');
  assert.equal(fmtTokens(38_200_000), '38.2M');
  assert.equal(fmtTokens(11_500_000_000), '11.5G');
});

test('formatReport укладывается в 30 строк', () => {
  assert.ok(
    formatReport(sample).length <= 30,
    'отчёт должен быть не длиннее 30 строк',
  );
});

test('formatReport показывает текущую сессию, проект и оценку экономии', () => {
  const text = formatReport(sample).join('\n');
  assert.match(text, /75b186/);
  assert.match(text, /412k/);
  assert.match(text, /Read 9\.1M/);
  assert.match(text, /11\.5G/);
  assert.match(text, /−73%/);
});

test('formatReport переживает пустой проект', () => {
  const empty = {
    cap: 200_000,
    current: {
      id: '—',
      contextNow: 0,
      requests: 0,
      burned: 0,
      compacts: 0,
      topTools: [],
    },
    project: {
      sessions: 0,
      requests: 0,
      burned: 0,
      capped: 0,
      avgContext: 0,
      over300: 0,
      over500: 0,
    },
    sessions: [],
  };
  const lines = formatReport(empty);
  assert.ok(lines.length <= 30);
  assert.match(lines.join('\n'), /—/);
});
