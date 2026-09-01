export const CONTEXT_THRESHOLD = 200_000;

const PACK_PATH = /(^|\/)packs\/[^/]+\.json$/;
const SPEC_PATH = /^docs\/superpowers\/specs\/.+\.md$/;
const PLAN_PATH = /^docs\/superpowers\/plans\/.+\.md$/;

const slashes = (path) => (path ?? '').replace(/\\/g, '/');

// Разбивает команду на подкоманды по shell-разделителям, чтобы упоминание
// «gh pr merge» как данных (в кавычках, в heredoc, в чужом аргументе)
// не засчиталось за реальный вызов — реальный вызов стоит в начале своей
// подкоманды, а не где-то посередине текста.
const commandSegments = (command) =>
  command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

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
  if (commandSegments(command).some((s) => /^gh\s+pr\s+merge\b/.test(s)))
    return 'merge';
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

// Короткие тексты: напоминание оплачивается контекстом до конца сессии, ориентир ~15–20
// токенов на фразу. Подробности («почему», условия класса В) уже есть в CLAUDE.md —
// повторять их на каждом срабатывании незачем.
const TEXTS = {
  А1: 'Точка выхода А1: спека закоммичена, можно /clear.',
  А2: 'Точка выхода А2: план закоммичен, можно /clear.',
  А3: 'Точка выхода А3: PR смёржен, можно /clear.',
  А4: 'Точка выхода А4: артефакт записан, можно /clear.',
};

const classB = (checks) =>
  `Точка выхода Б: коммит, ${
    checks === 'unknown' ? 'проверки не прогонялись' : 'контекст >200k'
  }. /handoff, потом /clear.`;

/** Факты → текст напоминания или null. Класс В остаётся на усмотрение модели. */
export function checkpointReminder(facts) {
  if (facts?.event === 'artifact') {
    // Записанный пак сам и делает дерево грязным — требовать чистоты тут нечестно,
    // поэтому класс А4 не проходит дедуп по коммиту, как прочие классы. Дедуп у
    // него свой: по пути конкретного артефакта в рамках сессии — повтор по тому
    // же файлу не напоминаем второй раз, а другой файл в той же сессии остаётся
    // законным поводом напомнить.
    const path = slashes(facts.artifactPath);
    const alreadyReminded = (facts.remindedArtifacts ?? [])
      .map(slashes)
      .includes(path);
    return alreadyReminded ? null : TEXTS.А4;
  }

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
