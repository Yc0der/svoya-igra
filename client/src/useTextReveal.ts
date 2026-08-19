import { useEffect, useState } from 'react';

// Табло показывает вопрос по буквам, пока идёт постепенный показ (design.md,
// 2026-08-19-gradual-text-reveal-design.md) — темп синхронизирован с
// серверным таймером (deadline/revealMs из GameStateView), а не своим
// независимым отсчётом: иначе табло и правило «кнопка появляется по концу
// показа» (движок) разъедутся. deadline/revealMs — null вне фазы
// question-reveal, тогда возвращается text целиком без подсчёта.
//
// По буквам, не по словам — живая проверка 2026-08-19 показала, что показ
// целыми словами выглядит неестественно (слово либо есть целиком, либо его
// нет, без ощущения печати/чтения). Длительность (revealMs) при этом
// по-прежнему считается Комнатой по числу СЛОВ (слова/сек — та единица, в
// которой разумно думать о темпе чтения) — меняется только то, чем именно
// заполняется это время на табло.
export function useTextReveal(
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
  const elapsed = revealMs - (deadline - now);
  // +1: первый символ должен быть виден сразу (elapsed=0 → count=1), иначе
  // короткий вопрос стоит пустым весь TEXT_REVEAL_MIN_MS — та же «вспышка»,
  // от которой минимальная длительность должна была защищать (найдено
  // финальным ревью ветки, тогда ещё для показа по словам). Обратная
  // сторона: полный текст открывается на один символ раньше дедлайна —
  // приемлемый компромисс («дочитал — можно жать»).
  const count = Math.max(
    0,
    Math.min(text.length, Math.floor((text.length * elapsed) / revealMs) + 1),
  );
  return text.slice(0, count);
}
