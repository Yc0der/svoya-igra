import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTextReveal } from './useTextReveal';

describe('useTextReveal', () => {
  it('returns the full text immediately when deadline/revealMs are null', () => {
    const { result } = renderHook(() =>
      useTextReveal(null, null, 'Первое второе третье'),
    );
    expect(result.current).toBe('Первое второе третье');
  });

  it('reveals a growing prefix of characters as time passes toward the deadline', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const deadline = now + 4000;
      const text = 'Первое второе третье четвёртое'; // length 30
      const { result, rerender } = renderHook(
        ({ d, r }: { d: number; r: number }) => useTextReveal(d, r, text),
        { initialProps: { d: deadline, r: 4000 } },
      );
      // count = floor(30 * 0 / 4000) + 1 = 1 — первая буква видна сразу.
      expect(result.current).toBe('П');

      act(() => {
        // advanceTimersByTime двигает подложные часы вместе с таймером —
        // реальный elapsed на момент срабатывания интервала 2000+250=2250мс,
        // не 2000.
        vi.setSystemTime(now + 2000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      // count = floor(30 * 2250 / 4000) + 1 = 16 + 1 = 17.
      expect(result.current).toBe('Первое второе тре');

      act(() => {
        vi.setSystemTime(now + 4000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      expect(result.current).toBe(text);
    } finally {
      vi.useRealTimers();
    }
  });
});
