import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

const VIDEO = {
  youtubeId: 'dQw4w9WgXcQ',
  startSeconds: 30,
  durationSeconds: 15,
  audioOnly: false,
};

// Состояния плеера из IFrame API: 1 — играет, 2 — на паузе.
const PLAYING = 1;
const PAUSED = 2;

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
      playerVars: { start: 30, rel: 0, modestbranding: 1, autoplay: 1 },
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

  it('covers the YouTube title area so it cannot spoil the answer', async () => {
    vi.useFakeTimers();
    mockYouTube();

    render(<VideoPlayer video={VIDEO} onFinished={vi.fn()} />);
    await flush();

    expect(
      document.querySelector('.board-video-titleguard'),
    ).toBeInTheDocument();
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
});
