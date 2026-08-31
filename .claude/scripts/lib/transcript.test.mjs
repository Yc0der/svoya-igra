import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectSlug,
  projectRootSlug,
  parseTranscript,
  carryCostByTool,
  aggregateProject,
} from './transcript.mjs';

const line = (obj) => JSON.stringify(obj);

const assistant = (requestId, ctx, extra = {}) =>
  line({
    type: 'assistant',
    requestId,
    timestamp: '2026-08-30T10:00:00.000Z',
    message: {
      model: 'claude-opus-5',
      content: extra.content ?? [{ type: 'text', text: 'ок' }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: ctx,
        cache_creation_input_tokens: 0,
        output_tokens: 10,
      },
    },
  });

test('projectSlug превращает путь в имя каталога транскриптов', () => {
  assert.equal(
    projectSlug('C:\\Users\\ib1te\\Desktop\\svoya_igra'),
    'C--Users-ib1te-Desktop-svoya-igra',
  );
});

test('projectRootSlug отбрасывает суффикс воркtree', () => {
  assert.equal(
    projectRootSlug(
      'C:\\Users\\ib1te\\Desktop\\svoya_igra\\.claude\\worktrees\\feature-x',
    ),
    'C--Users-ib1te-Desktop-svoya-igra',
  );
});

test('parseTranscript дедуплицирует записи одного запроса по requestId', () => {
  const text = [
    assistant('req-1', 1000),
    assistant('req-1', 1000),
    assistant('req-2', 2000),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.equal(parsed.requests.length, 2);
  assert.deepEqual(
    parsed.requests.map((r) => r.contextTokens),
    [1002, 2002],
  );
});

test('parseTranscript пропускает synthetic-записи и битые строки', () => {
  const synthetic = line({
    type: 'assistant',
    requestId: 'req-s',
    message: { model: '<synthetic>', content: [], usage: { input_tokens: 5 } },
  });
  const parsed = parseTranscript(
    [assistant('req-1', 1000), synthetic, '{не json'].join('\n'),
  );
  assert.equal(parsed.requests.length, 1);
});

test('parseTranscript считает автокомпакты и сообщения пользователя', () => {
  const text = [
    line({ type: 'user', message: { role: 'user', content: 'сделай Х' } }),
    assistant('req-1', 1000),
    line({
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto' },
    }),
    line({
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: 'служебное' },
    }),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.equal(parsed.compacts, 1);
  assert.equal(parsed.userMessages, 1);
});

test('parseTranscript связывает результат инструмента с именем инструмента', () => {
  const text = [
    assistant('req-1', 1000, {
      content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }],
    }),
    line({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'x'.repeat(400),
          },
        ],
      },
    }),
    assistant('req-2', 2000),
  ].join('\n');
  const parsed = parseTranscript(text);
  assert.deepEqual(parsed.toolResults, [{ tool: 'Read', bytes: 400, at: 1 }]);
});

test('carryCostByTool считает, сколько раз результат ещё перечитается', () => {
  const parsed = {
    requests: [{}, {}, {}, {}],
    toolResults: [
      { tool: 'Read', bytes: 400, at: 1 },
      { tool: 'Bash', bytes: 40, at: 3 },
    ],
  };
  // Read: 100 токенов × 3 оставшихся запроса = 300; Bash: 10 × 1 = 10.
  assert.deepEqual(carryCostByTool(parsed), [
    { tool: 'Read', tokens: 300 },
    { tool: 'Bash', tokens: 10 },
  ]);
});

test('aggregateProject возвращает нули для пустого списка сессий', () => {
  assert.deepEqual(aggregateProject([], 200_000), {
    sessions: 0,
    requests: 0,
    burned: 0,
    capped: 0,
    avgContext: 0,
    over300: 0,
    over500: 0,
  });
});

test('aggregateProject считает сожжённое, потолок и средний контекст по всем сессиям', () => {
  const parsedFiles = [
    { requests: [{ contextTokens: 100 }, { contextTokens: 900 }] },
    { requests: [{ contextTokens: 1000 }] },
  ];
  const result = aggregateProject(parsedFiles, 500);
  assert.equal(result.sessions, 2);
  assert.equal(result.requests, 3);
  assert.equal(result.burned, 2000);
  // Потолок 500: min(100,500)+min(900,500)+min(1000,500) = 100+500+500 = 1100.
  assert.equal(result.capped, 1100);
  assert.equal(result.avgContext, Math.round(2000 / 3));
});

test('aggregateProject не считает контекст ровно на границе 300k/500k превышением', () => {
  const at300k = aggregateProject(
    [{ requests: [{ contextTokens: 300_000 }] }],
    200_000,
  );
  assert.equal(at300k.over300, 0);
  assert.equal(at300k.over500, 0);

  const at500k = aggregateProject(
    [{ requests: [{ contextTokens: 500_000 }] }],
    200_000,
  );
  // 500 000 больше 300 000, но не больше 500 000 — граница строгая (>).
  assert.equal(at500k.over300, 100);
  assert.equal(at500k.over500, 0);
});

test('aggregateProject считает контекст сразу за границей 300k/500k превышением', () => {
  const justOver300 = aggregateProject(
    [{ requests: [{ contextTokens: 300_001 }] }],
    200_000,
  );
  assert.equal(justOver300.over300, 100);
  assert.equal(justOver300.over500, 0);

  const justOver500 = aggregateProject(
    [{ requests: [{ contextTokens: 500_001 }] }],
    200_000,
  );
  assert.equal(justOver500.over300, 100);
  assert.equal(justOver500.over500, 100);
});
