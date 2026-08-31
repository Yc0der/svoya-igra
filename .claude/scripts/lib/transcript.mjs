import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Имя каталога транскриптов для рабочего каталога. */
export function projectSlug(dir) {
  return dir.replace(/[^A-Za-z0-9]/g, '-');
}

/** Тот же слаг, но без суффикса воркtree — чтобы собрать сессии всего проекта. */
export function projectRootSlug(dir) {
  return projectSlug(dir).replace(/--claude-worktrees-.*$/, '');
}

/** Все транскрипты проекта, включая воркtree, свежие первыми. */
export async function findTranscripts(projectsDir, cwd) {
  const root = projectRootSlug(cwd);
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter(
      (e) =>
        e.isDirectory() && (e.name === root || e.name.startsWith(`${root}--`)),
    )
    .map((e) => join(projectsDir, e.name));

  const files = [];
  for (const dir of dirs) {
    let names;
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      try {
        files.push({ path, mtimeMs: (await stat(path)).mtimeMs });
      } catch {
        // файл исчез между readdir и stat — не беда
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resultBytes(content) {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (typeof part?.text === 'string')
      total += Buffer.byteLength(part.text, 'utf8');
  }
  return total;
}

export function parseTranscript(text) {
  const requests = [];
  const seen = new Set();
  const toolNames = new Map();
  const toolResults = [];
  let compacts = 0;
  let userMessages = 0;
  let sessionId = null;

  for (const raw of text.split('\n')) {
    if (!raw) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue; // хвост файла бывает дописан наполовину
    }
    if (!sessionId && typeof entry.sessionId === 'string')
      sessionId = entry.sessionId;

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      compacts += 1;
      continue;
    }

    if (entry.type === 'assistant' && entry.message) {
      const usage = entry.message.usage;
      const id = entry.requestId;
      if (
        id &&
        usage &&
        entry.message.model !== '<synthetic>' &&
        !seen.has(id)
      ) {
        seen.add(id);
        requests.push({
          requestId: id,
          timestamp: entry.timestamp ?? null,
          model: entry.message.model ?? null,
          contextTokens:
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
        });
      }
      for (const block of entry.message.content ?? []) {
        if (block?.type === 'tool_use' && block.id)
          toolNames.set(block.id, block.name);
      }
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (typeof content === 'string') {
        if (!entry.isMeta) userMessages += 1;
        continue;
      }
      if (!Array.isArray(content)) continue;
      let hasText = false;
      for (const block of content) {
        if (block?.type === 'text') hasText = true;
        if (block?.type !== 'tool_result') continue;
        toolResults.push({
          tool: toolNames.get(block.tool_use_id) ?? 'unknown',
          bytes: resultBytes(block.content),
          at: requests.length,
        });
      }
      if (hasText && !entry.isMeta) userMessages += 1;
    }
  }

  return { sessionId, requests, toolResults, compacts, userMessages };
}

/**
 * Во что обошёлся результат инструмента: он лежит в контексте до конца сессии и
 * перечитывается на каждом следующем запросе. Это и есть настоящая цена, а не размер ответа.
 */
export function carryCostByTool(parsed) {
  const total = parsed.requests.length;
  const byTool = new Map();
  for (const result of parsed.toolResults) {
    const tokens = Math.ceil(result.bytes / 4) * Math.max(0, total - result.at);
    byTool.set(result.tool, (byTool.get(result.tool) ?? 0) + tokens);
  }
  return [...byTool]
    .map(([tool, tokens]) => ({ tool, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Агрегаты по всем сессиям проекта для отчёта `/tokens`: сколько сожжено, сколько
 * было бы при потолке `cap`, средний контекст запроса и доля сожжённого, которая
 * пришлась на запросы за 300k/500k токенов. Граница строгая — запрос ровно на
 * 300k (или 500k) в превышение не попадает, только те, что больше.
 */
export function aggregateProject(parsedFiles, cap) {
  let requests = 0;
  let burned = 0;
  let capped = 0;
  let over300 = 0;
  let over500 = 0;

  for (const parsed of parsedFiles) {
    for (const request of parsed.requests) {
      requests += 1;
      burned += request.contextTokens;
      capped += Math.min(request.contextTokens, cap);
      if (request.contextTokens > 300_000) over300 += request.contextTokens;
      if (request.contextTokens > 500_000) over500 += request.contextTokens;
    }
  }

  const avgContext = requests === 0 ? 0 : Math.round(burned / requests);
  const share = (part) =>
    burned === 0 ? 0 : Math.round((part / burned) * 100);

  return {
    sessions: parsedFiles.length,
    requests,
    burned,
    capped,
    avgContext,
    over300: share(over300),
    over500: share(over500),
  };
}

/** Хвост файла — чтобы хук не платил чтением 30 МБ на каждом вызове инструмента. */
export async function readTail(path, maxBytes = 256 * 1024) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return '';
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

/** Размер контекста последнего запроса — «сколько сейчас». */
export function latestContextTokens(text) {
  const { requests } = parseTranscript(text);
  return requests.length === 0
    ? null
    : requests[requests.length - 1].contextTokens;
}
