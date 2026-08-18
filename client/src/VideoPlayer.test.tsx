import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

const VIDEO = {
  youtubeId: 'dQw4w9WgXcQ',
  startSeconds: 30,
  durationSeconds: 15,
  audioOnly: false,
};

// Состояния плеера из IFrame API: 1 — играет, 2 — на паузе, 3 — буферизуется.
const PLAYING = 1;
const PAUSED = 2;
const STATE_BUFFERING = 3;

type Events = {
  onReady?: () => void;
  onError?: (e: { data: number }) => void;
};

/**
 * Подменяет window.YT конструктором-двойником. Обычная `function`, а не
 * стрелка: компонент вызывает `new window.YT.Player(...)`, как и требует
 * настоящий API, а стрелочные функции конструкторами быть не могут.
 */
function mockYouTube(options: { currentTime?: number; state?: number } = {}) {
  const instance = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    getCurrentTime: vi.fn(() => options.currentTime ?? 0),
    getPlayerState: vi.fn(() => options.state ?? PLAYING),
    destroy: vi.fn(),
    unMute: vi.fn(),
  };
  let events: Events = {};
  const Player = vi.fn(function (_container: HTMLElement, opts: unknown) {
    events = (opts as { events?: Events }).events ?? {};
    return instance;
  });
  window.YT = { Player } as unknown as Window['YT'];
  return { instance, Player, events: () => events };
}

// Даёт отработать микрозадачам loadYouTubeApi().then(...) — плеер создаётся
// именно там, а не синхронно в рендере.
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('VideoPlayer', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as { YT?: unknown }).YT;
    delete (window as { onYouTubeIframeAPIReady?: unknown })
      .onYouTubeIframeAPIReady;
  });

  it('creates the player as soon as it mounts, without waiting for a click', async () => {
    vi.useFakeTimers();
    const { Player } = mockYouTube();

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();

    expect(Player).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('asks the player to start at the right second and does not rely on playerVars.end', async () => {
    vi.useFakeTimers();
    const { Player } = mockYouTube();

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();

    const options = Player.mock.calls[0][1] as {
      playerVars: Record<string, unknown>;
    };
    expect(options).toMatchObject({
      host: 'https://www.youtube-nocookie.com',
      videoId: 'dQw4w9WgXcQ',
      playerVars: {
        start: 30,
        rel: 0,
        modestbranding: 1,
        autoplay: 1,
        controls: 0,
      },
    });
    expect(options.playerVars).not.toHaveProperty('end');
  });

  it('stops the clip itself at the end and reports it finished exactly once', async () => {
    vi.useFakeTimers();
    const onFinished = vi.fn();
    // Уже за пределами клипа: 30 + 15 = 45.
    const { instance, events } = mockYouTube({ currentTime: 46 });

    render(<VideoPlayer video={VIDEO} onFinished={onFinished} />);
    await flush();
    events().onReady!();
    await vi.advanceTimersByTimeAsync(300);

    expect(instance.pauseVideo).toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);

    // Опрос не должен продолжать дёргать onFinished после остановки.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('keeps playing while the clip has not reached its end yet', async () => {
    vi.useFakeTimers();
    const onFinished = vi.fn();
    const { instance, events } = mockYouTube({ currentTime: 35 });

    render(<VideoPlayer video={VIDEO} onFinished={onFinished} />);
    await flush();
    events().onReady!();
    await vi.advanceTimersByTimeAsync(1000);

    expect(instance.pauseVideo).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('offers a play button when the browser blocked autoplay, and starts the clip on click', async () => {
    vi.useFakeTimers();
    const { instance, events } = mockYouTube({ state: PAUSED });

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();
    events().onReady!();
    await vi.advanceTimersByTimeAsync(2000);

    const button = screen.getByRole('button', { name: /играть/i });
    fireEvent.click(button);

    expect(instance.playVideo).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the play button again once playback starts on its own, even after the grace period already showed it', async () => {
    // Живая проверка (2026-08-18): ролик с преролом/медленной буферизацией
    // (HBO Max-трейлер) ещё не играл к моменту проверки на 1500мс — кнопка
    // появилась, — но затем всё-таки заиграл сам. Кнопка осталась висеть
    // поверх уже идущего клипа, потому что ничего не сбрасывало needsClick
    // обратно после того, как оно однажды стало true.
    vi.useFakeTimers();
    let currentState = PAUSED;
    let capturedEvents: Events = {};
    const instance = {
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getPlayerState: vi.fn(() => currentState),
      destroy: vi.fn(),
    };
    window.YT = {
      Player: vi.fn(function (_container: HTMLElement, opts: unknown) {
        capturedEvents = (opts as { events?: Events }).events ?? {};
        return instance;
      }),
    } as unknown as Window['YT'];

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();
    capturedEvents.onReady!();
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByRole('button', { name: /играть/i })).toBeInTheDocument();

    // Буферизация закончилась, ролик заиграл сам — без клика по кнопке.
    // act() нужен по той же причине, что и в тесте на onError: тик опроса
    // приходит снаружи React, без обёртки состояние не успеет отрисоваться
    // к проверке ниже.
    currentState = PLAYING;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('shows no button at all when autoplay worked', async () => {
    vi.useFakeTimers();
    const { events } = mockYouTube({ state: PLAYING });

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();
    events().onReady!();
    await vi.advanceTimersByTimeAsync(2000);

    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('reports finished immediately when the video errors, so the game does not wait for the safety timer', async () => {
    vi.useFakeTimers();
    const onFinished = vi.fn();
    const { events } = mockYouTube();

    render(<VideoPlayer video={VIDEO} onFinished={onFinished} />);
    await flush();
    // onError приходит из плеера, снаружи React — без act() перерисовка с
    // сообщением об ошибке не успеет произойти к проверке ниже.
    await act(async () => {
      events().onError!({ data: 150 });
    });

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/видео недоступно/i)).toBeInTheDocument();
  });

  it('shows the sound-wave placeholder instead of the visible player when audioOnly is true', async () => {
    vi.useFakeTimers();
    mockYouTube();

    render(
      <VideoPlayer
        video={{ ...VIDEO, audioOnly: true }}
        onFinished={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByAltText(/играет аудио/i)).toBeInTheDocument();
    expect(document.querySelector('.board-video-hidden')).toBeInTheDocument();
  });

  it('injects the IFrame API script on mount when YT is not loaded yet', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { VideoPlayer: FreshVideoPlayer } = await import('./VideoPlayer');

    render(<FreshVideoPlayer video={VIDEO} onFinished={vi.fn()} />);

    expect(
      document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      ),
    ).toBeInTheDocument();

    const { Player } = mockYouTube();
    window.onYouTubeIframeAPIReady?.();
    await flush();

    expect(Player).toHaveBeenCalled();
  });

  // ВРЕМЕННО (2026-08-18) — см. server/src/protocol.ts,
  // StateMessage.videoPrerollMs.
  describe('prerollMs (временно)', () => {
    it('starts muted and hidden, then unmutes and reveals once prerollMs elapses', async () => {
      vi.useFakeTimers();
      const { instance, Player, events } = mockYouTube();

      render(
        <VideoPlayer video={VIDEO} onFinished={vi.fn()} prerollMs={3000} />,
      );
      await flush();

      const options = Player.mock.calls[0][1] as {
        playerVars: Record<string, unknown>;
      };
      expect(options.playerVars.mute).toBe(1);
      expect(document.querySelector('.board-video-hidden')).toBeInTheDocument();
      expect(screen.getByAltText(/видео скоро начнётся/i)).toBeInTheDocument();

      events().onReady!();
      // prerollMs отсчитывается не от onReady, а от первого тика опроса,
      // где getPlayerState() реально вернул «играет» — плюс сам этот тик
      // (PROGRESS_POLL_MS), иначе таймер ещё не успеет сработать.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 + 300);
      });

      expect(instance.unMute).toHaveBeenCalled();
      expect(
        document.querySelector('.board-video-hidden'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByAltText(/видео скоро начнётся/i),
      ).not.toBeInTheDocument();
    });

    it('does not start the preroll clock while the player is still buffering, only once it actually starts playing', async () => {
      // Живая проверка (2026-08-18): предзапуск, отсчитанный от onReady, а
      // не от факта STATE_PLAYING, засчитывал буферизацию как часть своих
      // секунд — клип успевал раскрыться игрокам уже почти доигранным или
      // ещё не начавшим идти вовсе.
      let currentState = STATE_BUFFERING;
      const instance = {
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn(() => 0),
        getPlayerState: vi.fn(() => currentState),
        destroy: vi.fn(),
        unMute: vi.fn(),
      };
      let capturedEvents: Events = {};
      window.YT = {
        Player: vi.fn(function (_container: HTMLElement, opts: unknown) {
          capturedEvents = (opts as { events?: Events }).events ?? {};
          return instance;
        }),
      } as unknown as Window['YT'];

      vi.useFakeTimers();
      render(
        <VideoPlayer video={VIDEO} onFinished={vi.fn()} prerollMs={3000} />,
      );
      await flush();
      capturedEvents.onReady!();

      // Буферизуется 4 секунды — дольше самого предзапуска. Часы
      // предзапуска не должны за это время успеть истечь.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(instance.unMute).not.toHaveBeenCalled();
      expect(document.querySelector('.board-video-hidden')).toBeInTheDocument();

      // Только теперь видео реально заиграло — отсюда и должен пойти отсчёт.
      currentState = PLAYING;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 + 300);
      });
      expect(instance.unMute).toHaveBeenCalled();
      expect(
        document.querySelector('.board-video-hidden'),
      ).not.toBeInTheDocument();
    });

    it('reveals the clip anyway if it physically ends before the preroll clock runs out, instead of staying hidden forever', async () => {
      // Живая проверка (2026-08-18): клип на 8 секунд, предзапуск 2 секунды
      // — но реальная буферизация до STATE_PLAYING сама по себе съела
      // время, и к моменту, когда видео технически заиграло, оставшейся
      // длины клипа уже не хватило на полные 2 секунды предзапуска. Видео
      // так и осталось скрытым весь вопрос: свой отдельный таймер раскрытия
      // должен был сработать позже, чем клип уже закончился и вопрос
      // закрылся.
      vi.useFakeTimers();
      const onFinished = vi.fn();
      // currentTime сразу за endsAt (30+15=45) — клип «закончился» с самого
      // первого тика после начала воспроизведения.
      const { instance, events } = mockYouTube({
        state: PLAYING,
        currentTime: 46,
      });

      render(
        <VideoPlayer video={VIDEO} onFinished={onFinished} prerollMs={2000} />,
      );
      await flush();
      events().onReady!();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(instance.unMute).toHaveBeenCalled();
      expect(
        document.querySelector('.board-video-hidden'),
      ).not.toBeInTheDocument();
    });

    it('starts the player prerollMs earlier than startSeconds, so the visible part matches what the pack intended', async () => {
      vi.useFakeTimers();
      const { Player } = mockYouTube();

      render(
        <VideoPlayer video={VIDEO} onFinished={vi.fn()} prerollMs={4000} />,
      );
      await flush();

      const options = Player.mock.calls[0][1] as {
        playerVars: Record<string, unknown>;
      };
      // VIDEO.startSeconds === 30, 4 секунды предзапуска → старт с 26-й.
      expect(options.playerVars.start).toBe(26);
    });

    it('never starts before second 0, even when prerollMs exceeds startSeconds', async () => {
      vi.useFakeTimers();
      const { Player } = mockYouTube();

      render(
        <VideoPlayer
          video={{ ...VIDEO, startSeconds: 2 }}
          onFinished={vi.fn()}
          prerollMs={4000}
        />,
      );
      await flush();

      const options = Player.mock.calls[0][1] as {
        playerVars: Record<string, unknown>;
      };
      expect(options.playerVars.start).toBe(0);
    });

    it('shows the sound-wave placeholder instead of a blank screen while an ordinary (non-audioOnly) clip is still in preroll', async () => {
      vi.useFakeTimers();
      mockYouTube();

      render(
        <VideoPlayer video={VIDEO} onFinished={vi.fn()} prerollMs={3000} />,
      );
      await flush();

      expect(screen.getByAltText(/видео скоро начнётся/i)).toBeInTheDocument();
    });

    it('does not mute or hide anything when prerollMs is 0 (default)', async () => {
      vi.useFakeTimers();
      const { Player } = mockYouTube();

      render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
      await flush();

      const options = Player.mock.calls[0][1] as {
        playerVars: Record<string, unknown>;
      };
      expect(options.playerVars.mute).toBeUndefined();
      expect(
        document.querySelector('.board-video-hidden'),
      ).not.toBeInTheDocument();
    });

    it('still ends the clip at the same startSeconds + durationSeconds, regardless of preroll', async () => {
      vi.useFakeTimers();
      const onFinished = vi.fn();
      const { events } = mockYouTube({ currentTime: 46 });

      render(
        <VideoPlayer video={VIDEO} onFinished={onFinished} prerollMs={3000} />,
      );
      await flush();
      events().onReady!();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(onFinished).toHaveBeenCalledTimes(1);
    });
  });
});
