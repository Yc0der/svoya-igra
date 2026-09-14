import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  MUSIC_FADE_MS,
  type SoundHandle,
} from './audio';
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

describe('useBoardAudio: StrictMode', () => {
  // Реальный <audio>-элемент недоступен в jsdom и не нужен: проверяется
  // решение движка (что вызвано последним — play или pause, и какая
  // громкость), а не проигрывание.
  class TrackingSound implements SoundHandle {
    static created: TrackingSound[] = [];
    volume = 1;
    currentTime = 0;
    lastAction: 'play' | 'pause' | null = null;
    readonly url: string;

    // Раскрытая parameter property: erasableSyntaxOnly в tsconfig.app.json
    // запрещает сокращённую форму `constructor(readonly url: string)`.
    constructor(url: string) {
      this.url = url;
      TrackingSound.created.push(this);
    }

    play(): Promise<void> {
      this.lastAction = 'play';
      return Promise.resolve();
    }

    pause(): void {
      this.lastAction = 'pause';
    }

    addEventListener(): void {
      // Тесту не нужен 'ended' — трек не доигрывает за MUSIC_FADE_MS.
    }
  }

  function connectionWithMusic(): RoomConnection {
    return {
      audio: DEFAULT_AUDIO_SETTINGS,
      audioAssets: { cues: [], music: ['/audio/music/a.mp3'] },
      game: null,
      subscribeCue: () => () => {},
    } as unknown as RoomConnection;
  }

  beforeEach(() => {
    TrackingSound.created = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // StrictMode в деве прогоняет монтирование → очистку → повторное
  // монтирование эффектов на одном и том же рендере. Между очисткой
  // (engine.dispose()) и повторной установкой компонент не перерисовывается,
  // так что вызовы setAssets/setSettings/setMusicWanted из тела рендера не
  // повторяются сами по себе — движок должен пересинхронизироваться сам по
  // себе на повторной установке эффектов.
  it('после двойного прогона эффектов StrictMode музыка в лобби всё равно играет', async () => {
    const conn = connectionWithMusic();

    await act(async () => {
      renderHook(
        () =>
          useBoardAudio(conn, {
            createSound: (url) => new TrackingSound(url),
            shuffle: (items) => [...items],
          }),
        { wrapper: StrictMode },
      );
      await Promise.resolve();
    });

    const track = TrackingSound.created.at(-1);
    expect(track).toBeDefined();
    expect(track!.lastAction).toBe('play');

    act(() => {
      vi.advanceTimersByTime(MUSIC_FADE_MS);
    });
    expect(track!.volume).toBeCloseTo(DEFAULT_AUDIO_SETTINGS.musicVolume, 5);
  });
});

// F1 (финальная волна): audioAssets приезжает новым объектом в каждом
// сообщении state (design.md), а AudioEngine.setAssets сравнивал перемешанный
// playlist с исходным списком — под identity-шафлом (как в остальных тестах
// этого файла) они случайно совпадают и баг не виден. Реальный шафл почти
// никогда не даёт совпадения, и музыка перезапускалась на каждый рендер
// табло.
describe('useBoardAudio: плейлист не перезапускается при неидентичном перемешивании', () => {
  class TrackingSound implements SoundHandle {
    static created: TrackingSound[] = [];
    volume = 1;
    currentTime = 0;
    pauseCalls = 0;
    readonly url: string;

    constructor(url: string) {
      this.url = url;
      TrackingSound.created.push(this);
    }

    play(): Promise<void> {
      return Promise.resolve();
    }

    pause(): void {
      this.pauseCalls += 1;
    }

    addEventListener(): void {
      // Трек не доигрывает за время теста — 'ended' не нужен.
    }
  }

  beforeEach(() => {
    TrackingSound.created = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rerender с равным по значению, но новым по ссылке audioAssets не создаёт новый звук', async () => {
    const music = ['/audio/music/a.mp3', '/audio/music/b.mp3'];
    function connection(): RoomConnection {
      return {
        audio: DEFAULT_AUDIO_SETTINGS,
        // Новый объект на каждый вызов — как из useRoomConnection на каждый state.
        audioAssets: { cues: [], music: [...music] },
        game: null,
        subscribeCue: () => () => {},
      } as unknown as RoomConnection;
    }

    const { rerender } = renderHook(
      (conn: RoomConnection) =>
        useBoardAudio(conn, {
          createSound: (url) => new TrackingSound(url),
          shuffle: (items) => [...items].reverse(),
        }),
      { initialProps: connection() },
    );

    await act(async () => {
      await Promise.resolve();
    });
    const before = TrackingSound.created.length;
    expect(before).toBeGreaterThan(0);

    rerender(connection());

    expect(TrackingSound.created.length).toBe(before);
  });
});
