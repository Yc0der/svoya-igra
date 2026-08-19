import { useEffect, useState } from 'react';

// Табло показывает вопрос по словам, пока идёт постепенный показ (design.md,
// 2026-08-19-gradual-text-reveal-design.md) — темп синхронизирован с
// серверным таймером (deadline/revealMs из GameStateView), а не своим
// независимым отсчётом: иначе табло и правило «кнопка появляется по концу
// показа» (движок) разъедутся. deadline/revealMs — null вне фазы
// question-reveal, тогда возвращается text целиком без подсчёта.
export function useWordReveal(
  deadline: number | null,
  revealMs: number | null,
  text: string,
): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null || revealMs === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline, revealMs]);

  if (deadline === null || revealMs === null || revealMs <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const elapsed = revealMs - (deadline - now);
  const count = Math.max(
    0,
    Math.min(words.length, Math.floor((words.length * elapsed) / revealMs)),
  );
  return words.slice(0, count).join(' ');
}
