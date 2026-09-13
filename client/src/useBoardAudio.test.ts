import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS } from './audio';
import { musicWantedFor, useBoardAudio } from './useBoardAudio';
import type { GameStateView, RoomConnection } from './useRoomConnection';

// Каркас: из всего состояния правилу важны только phase и currentQuestion.
function game(
  phase: GameStateView['phase'],
  currentQuestion: GameStateView['currentQuestion'] = null,
): GameStateView {
  return { phase, currentQuestion } as GameStateView;
}

const someQuestion = {
  id: 'q1',
  text: 'Вопрос',
  price: 100,
  themeName: 'Тема',
  image: null,
  video: null,
  revealMs: null,
  fadeMs: 270,
};

describe('musicWantedFor', () => {
  it('в лобби музыка играет', () => {
    expect(musicWantedFor(null)).toBe(true);
  });

  it('играет там, где никто не отвечает на вопрос', () => {
    expect(musicWantedFor(game('selecting'))).toBe(true);
    expect(musicWantedFor(game('round-end'))).toBe(true);
    expect(musicWantedFor(game('final-elim'))).toBe(true);
    expect(musicWantedFor(game('game-end'))).toBe(true);
  });

  it('молчит с момента выбора вопроса — включая «кота» и торги', () => {
    expect(musicWantedFor(game('cat-handoff', someQuestion))).toBe(false);
    expect(musicWantedFor(game('auction-bidding', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-media', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-reveal', someQuestion))).toBe(false);
    expect(musicWantedFor(game('question-open', someQuestion))).toBe(false);
    expect(musicWantedFor(game('buzzed', someQuestion))).toBe(false);
    expect(musicWantedFor(game('judging', someQuestion))).toBe(false);
  });

  it('молчит на экране правильного ответа — там идёт разговор', () => {
    expect(musicWantedFor(game('reveal', someQuestion))).toBe(false);
  });

  it('молчит весь финал, кроме вычёркивания тем', () => {
    expect(musicWantedFor(game('final-wager'))).toBe(false);
    expect(musicWantedFor(game('final-answer'))).toBe(false);
    expect(musicWantedFor(game('final-judging'))).toBe(false);
    expect(musicWantedFor(game('final-reveal'))).toBe(false);
  });
});

describe('useBoardAudio: блокировка', () => {
  function connection(): RoomConnection {
    return {
      audio: DEFAULT_AUDIO_SETTINGS,
      audioAssets: { cues: [], music: ['/audio/music/a.mp3'] },
      game: null,
      subscribeCue: () => () => {},
    } as unknown as RoomConnection;
  }

  it('поднимает blocked, когда браузер отказал в воспроизведении', async () => {
    const { result } = renderHook(() =>
      useBoardAudio(connection(), {
        createSound: () => ({
          volume: 1,
          currentTime: 0,
          play: () => Promise.reject(new Error('NotAllowedError')),
          pause: () => {},
          addEventListener: () => {},
        }),
        shuffle: (items) => [...items],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.blocked).toBe(true);

    act(() => result.current.unlock());
    expect(result.current.blocked).toBe(false);
  });
});
