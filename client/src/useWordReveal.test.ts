import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWordReveal } from './useWordReveal';

describe('useWordReveal', () => {
  it('returns the full text immediately when deadline/revealMs are null', () => {
    const { result } = renderHook(() =>
      useWordReveal(null, null, 'Первое второе третье'),
    );
    expect(result.current).toBe('Первое второе третье');
  });

  it('reveals a growing prefix of words as time passes toward the deadline', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const deadline = now + 4000;
      const { result, rerender } = renderHook(
        ({ d, r }: { d: number; r: number }) =>
          useWordReveal(d, r, 'Первое второе третье четвёртое'),
        { initialProps: { d: deadline, r: 4000 } },
      );
      expect(result.current).toBe('');

      act(() => {
        vi.setSystemTime(now + 2000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      expect(result.current).toBe('Первое второе');

      act(() => {
        vi.setSystemTime(now + 4000);
        vi.advanceTimersByTime(250);
      });
      rerender({ d: deadline, r: 4000 });
      expect(result.current).toBe('Первое второе третье четвёртое');
    } finally {
      vi.useRealTimers();
    }
  });
});
