import { useEffect, useState } from 'react';

// Общий для табло и игрока индикатор «сколько ещё ждать» — конкретно ради
// паузы в судействе, где до этого не было вообще никакого признака того, что
// система жива (см. свежий фидбэк с живой проверки), но пригоден для любого
// timerDeadline из GameStateView.
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
