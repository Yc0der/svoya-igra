import { render, renderHook, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TEXT_REVEAL_FADE_MS, useTextReveal } from './useTextReveal';

// С переходом на CSS-анимацию (design.md,
// 2026-08-19-gradual-text-reveal-design.md, «Буква проявляется, а не
// возникает») хук больше не крутит requestAnimationFrame и не отдаёт срез
// строки на момент времени X — время ведёт браузер, а не наш код. Поэтому
// тесты больше не двигают часы вперёд и не проверяют «что видно в момент X»:
// вместо этого они проверяют то, что вычисляется нами один раз при рендере —
// разбиение на слова/буквы и animation-delay каждой буквы — плюс отдельно
// то, что весь текст остаётся доступен как текст в DOM независимо от
// визуальной фазы CSS-анимации (иначе табло перестанет быть доступным).
//
// Хук возвращает React-элементы (renderHook их не рендерит в DOM, просто
// отдаёт как значение) — структурные тесты читают их props напрямую, без
// монтирования. Отдельный тест ниже монтирует результат по-настоящему, чтобы
// проверить именно DOM/доступность.
type LetterElement = ReactElement<{
  className: string;
  children: string;
  style: { animationDelay?: string; animationDuration?: string };
}>;
type WordElement = ReactElement<{
  className: string;
  children: LetterElement[];
}>;

describe('useTextReveal', () => {
  it('returns the plain text immediately when outside the reveal phase (no deadline/revealMs)', () => {
    const { result } = renderHook(() =>
      useTextReveal(null, null, 'Первое второе третье'),
    );
    expect(result.current).toBe('Первое второе третье');
  });

  it('returns the plain text immediately when revealMs is zero or negative (temporary admin "show disabled" toggle, design.md)', () => {
    const deadline = Date.now() + 1000;
    const { result: zero } = renderHook(() =>
      useTextReveal(deadline, 0, 'Текст вопроса'),
    );
    expect(zero.current).toBe('Текст вопроса');

    const { result: negative } = renderHook(() =>
      useTextReveal(deadline, -10, 'Текст вопроса'),
    );
    expect(negative.current).toBe('Текст вопроса');
  });

  it('groups letters by word (non-breaking span per word) and keeps whitespace as plain text nodes', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const { result } = renderHook(() =>
        useTextReveal(now + 1000, 1000, 'Кто там'),
      );
      const nodes = result.current as unknown as (WordElement | string)[];

      // 'Кто' + пробел + 'там' — три узла, пробел не завёрнут в буквы.
      expect(nodes).toHaveLength(3);
      const [word1, space, word2] = nodes;
      expect(space).toBe(' ');

      expect((word1 as WordElement).props.className).toBe('text-reveal-word');
      expect((word2 as WordElement).props.className).toBe('text-reveal-word');

      const letters1 = (word1 as WordElement).props.children;
      expect(letters1.map((letter) => letter.props.children)).toEqual([
        'К',
        'т',
        'о',
      ]);
      for (const letter of letters1) {
        expect(letter.props.className).toBe('text-reveal-letter');
        expect(letter.props.style.animationDuration).toBe(
          `${TEXT_REVEAL_FADE_MS}ms`,
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('delays each letter proportionally to its position, counted from the real reveal start (timerDeadline - revealMs)', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const revealMs = 4000;
      const text = 'АБВГ'; // 4 буквы без пробелов — один word-узел.
      // Показ уже идёт 2500мс к моменту монтирования — типичное
      // переподключение табло посреди показа: revealStartedAt = deadline -
      // revealMs = now - 2500.
      const deadline = now - 2500 + revealMs; // = now + 1500
      const { result } = renderHook(() =>
        useTextReveal(deadline, revealMs, text),
      );
      const [word] = result.current as unknown as [WordElement];
      const letters = word.props.children;

      // delay(i) = revealStartedAt + i*revealMs/text.length - now
      //          = -2500 + i*1000
      const expectedDelaysMs = [-2500, -1500, -500, 500];
      letters.forEach((letter, i) => {
        expect(letter.props.style.animationDelay).toBe(
          `${expectedDelaysMs[i]}ms`,
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the delay proportion correct for letters after a character outside the BMP (surrogate pair), e.g. an emoji in the question text', () => {
    // Регрессия на баг из код-ревью: перебор букв идёт через [...token]
    // (code point'ы — суррогатная пара это один элемент), а счётчик
    // позиции раньше сдвигался через token.length (code unit'ы —
    // суррогатная пара это два). Пока текст только из кириллицы/латиницы,
    // оба счёта совпадают, но эмодзи (символ вне BMP) их разводит: всё,
    // что после него, получает сдвинутый charIndex и, как следствие,
    // неверную задержку — без видимой ошибки, просто не в такт таймеру.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const revealMs = 500;
      // Code point'ов — 5 ('A', '😀', ' ', 'B', 'C'); code unit'ов — 6
      // (у '😀' их два). Пробел разделяет текст на два слова, чтобы счётчик
      // позиции успел накопить расхождение к моменту, когда до него
      // доходит второе слово.
      const text = 'A😀 BC';
      const deadline = revealMs; // revealStartedAt = deadline - revealMs = 0 = now.
      const { result } = renderHook(() =>
        useTextReveal(deadline, revealMs, text),
      );
      const nodes = result.current as unknown as (WordElement | string)[];
      expect(nodes).toHaveLength(3); // word('A😀'), ' ', word('BC')
      const [word1, space, word2] = nodes;
      expect(space).toBe(' ');

      // delay(i) = i * revealMs / totalCodePoints = i * 500 / 5 = i * 100.
      const lettersBeforeSpace = (word1 as WordElement).props.children;
      expect(lettersBeforeSpace.map((letter) => letter.props.children)).toEqual(
        ['A', '😀'],
      );
      expect(lettersBeforeSpace[0].props.style.animationDelay).toBe('0ms');
      expect(lettersBeforeSpace[1].props.style.animationDelay).toBe('100ms');

      // 'B' и 'C' — третий и четвёртый code point текста (после 'A', '😀',
      // ' '), их charIndex должен быть 3 и 4, а не 4 и 5 (что дала бы
      // ошибочная длина в code unit'ах — на два больше из-за суррогатной
      // пары). Без правки здесь получились бы 333.33мс/416.67мс вместо
      // ровных 300/400.
      const lettersAfterSpace = (word2 as WordElement).props.children;
      expect(lettersAfterSpace.map((letter) => letter.props.children)).toEqual([
        'B',
        'C',
      ]);
      expect(lettersAfterSpace[0].props.style.animationDelay).toBe('300ms');
      expect(lettersAfterSpace[1].props.style.animationDelay).toBe('400ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the whole text available as text content in the DOM regardless of the CSS fade animation state', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      const text = 'Первое второе третье четвёртое';
      function Harness() {
        // Показ только начался — почти все буквы визуально ещё opacity:0,
        // но в DOM как текстовые узлы присутствуют все.
        const node = useTextReveal(now + 4000, 4000, text);
        return createElement('p', { 'data-testid': 'q' }, node);
      }
      render(createElement(Harness));

      // Проверяем именно textContent, а не screen.getByText(text): по
      // умолчанию getByText сверяет только текст, лежащий прямо в узле
      // (getNodeText берёт только непосредственные текстовые дочерние узлы,
      // не рекурсивно) — с разметкой «буква = свой <span>» ни один элемент
      // не содержит текст напрямую. textContent — то же самое, что видит
      // читалка с экрана и что использовали бы существующие проверки на
      // основе экранного текста, поэтому это и есть правильная проверка
      // «текст остаётся доступен как текст» для такой разметки.
      expect(screen.getByTestId('q').textContent).toBe(text);
    } finally {
      vi.useRealTimers();
    }
  });
});
