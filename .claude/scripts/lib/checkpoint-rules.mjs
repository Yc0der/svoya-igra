export const CONTEXT_THRESHOLD = 200_000;

const PACK_PATH = /(^|\/)packs\/[^/]+\.json$/;
const SPEC_PATH = /^docs\/superpowers\/specs\/.+\.md$/;
const PLAN_PATH = /^docs\/superpowers\/plans\/.+\.md$/;

const slashes = (path) => (path ?? '').replace(/\\/g, '/');

/** Что за событие только что произошло. null — повод ничего не делать и выйти. */
export function classifyEvent(payload) {
  const tool = payload?.tool_name;

  if (tool === 'Write' || tool === 'Edit') {
    return PACK_PATH.test(slashes(payload.tool_input?.file_path))
      ? 'artifact'
      : null;
  }

  if (tool !== 'Bash') return null;
  const command = payload.tool_input?.command ?? '';
  if (/\bgh\s+pr\s+merge\b/.test(command)) return 'merge';
  if (/\bgit\s+commit\b/.test(command)) return 'commit';
  if (/\bpnpm\b[^|;&]*\b(test|typecheck)\b/.test(command)) return 'checks';
  return null;
}

/**
 * Хук не может запускать проверки сам — это десятки секунд на каждом вызове инструмента.
 * Поэтому он читает вывод чужого прогона. Когда маркеров нет, честный ответ — 'unknown'.
 */
export function checksVerdict(toolResponse) {
  const text = `${toolResponse?.stdout ?? ''}\n${toolResponse?.stderr ?? ''}`;
  if (/\b\d+ failed\b|\berror TS\d+\b|ELIFECYCLE/i.test(text)) return 'red';
  if (/Test Files\s+\d+ passed|\bno errors\b/i.test(text)) return 'green';
  return 'unknown';
}

const TEXTS = {
  А1:
    'Точка выхода, класс А1: спека закоммичена, рабочее дерево чистое. Дальше writing-plans ' +
    'стартует с файла — контекст можно чистить (/clear). Если в разговоре остались устные ' +
    'решения, которых нет в спеке, сначала допиши их туда.',
  А2:
    'Точка выхода, класс А2: план закоммичен, рабочее дерево чистое. Дальше executing-plans ' +
    'стартует с файла — контекст можно чистить (/clear).',
  А3:
    'Точка выхода, класс А3: PR смёржен. Перед /clear занеси в CLAUDE.md устные правила, ' +
    'которые прозвучали в ревью, — иначе они останутся только в этом контексте.',
  А4:
    'Точка выхода, класс А4: артефакт записан на диск. Файл сам является передачей ' +
    'состояния — контекст можно чистить (/clear), не забыв закоммитить сам файл.',
};

const classB = (checks) =>
  'Точка выхода, класс Б: коммит есть, дерево чистое, контекст выше 200k. ' +
  (checks === 'unknown'
    ? 'Проверки в этой сессии не прогонялись — подтверди их сам. '
    : '') +
  'Если это не середина многофайловой правки и нет незакрытых вопросов — /handoff, потом /clear.';

/** Факты → текст напоминания или null. Класс В остаётся на усмотрение модели. */
export function checkpointReminder(facts) {
  // Записанный пак сам и делает дерево грязным — требовать чистоты тут нечестно.
  if (facts?.event === 'artifact') return TEXTS.А4;

  if (!facts?.worktreeClean) return null;
  if (facts.commitSha && facts.commitSha === facts.remindedSha) return null;

  const paths = (facts.changedPaths ?? []).map(slashes);

  if (facts.event === 'merge') return TEXTS.А3;
  if (paths.some((p) => PLAN_PATH.test(p))) return TEXTS.А2;
  if (paths.some((p) => SPEC_PATH.test(p))) return TEXTS.А1;
  if (paths.some((p) => PACK_PATH.test(p))) return TEXTS.А4;

  if (facts.event !== 'commit') return null;
  if (facts.checks === 'red') return null;
  if (facts.contextTokens === null || facts.contextTokens < CONTEXT_THRESHOLD)
    return null;
  return classB(facts.checks);
}
