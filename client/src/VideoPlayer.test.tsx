import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './VideoPlayer';

const VIDEO = {
  youtubeId: 'dQw4w9WgXcQ',
  startSeconds: 30,
  durationSeconds: 15,
  audioOnly: false,
};

describe('VideoPlayer', () => {
  afterEach(() => {
    delete (window as { YT?: unknown }).YT;
    delete (window as { onYouTubeIframeAPIReady?: unknown })
      .onYouTubeIframeAPIReady;
  });

  it('shows a "Играть" button before the video is started', () => {
    render(<VideoPlayer video={VIDEO} />);
    expect(screen.getByRole('button', { name: /играть/i })).toBeInTheDocument();
  });

  it('creates a YT.Player with the right video/timing when the API is already loaded, and hides the button', async () => {
    const playerConstructor = vi.fn();
    window.YT = { Player: playerConstructor } as unknown as Window['YT'];

    render(<VideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    await vi.waitFor(() => expect(playerConstructor).toHaveBeenCalled());
    expect(playerConstructor.mock.calls[0][1]).toMatchObject({
      host: 'https://www.youtube-nocookie.com',
      videoId: 'dQw4w9WgXcQ',
      playerVars: {
        start: 30,
        end: 45,
        rel: 0,
        modestbranding: 1,
        autoplay: 1,
      },
    });
    expect(
      screen.queryByRole('button', { name: /играть/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the sound-wave placeholder instead of the visible player when audioOnly is true', async () => {
    window.YT = { Player: vi.fn() } as unknown as Window['YT'];

    render(<VideoPlayer video={{ ...VIDEO, audioOnly: true }} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    expect(await screen.findByAltText(/играет аудио/i)).toBeInTheDocument();
    expect(document.querySelector('.board-video-hidden')).toBeInTheDocument();
  });

  it('shows an error message when the player reports onError', async () => {
    let capturedEvents: { onError?: (e: { data: number }) => void } = {};
    window.YT = {
      // Regular `function`, not an arrow function: this mock is invoked via
      // `new` (VideoPlayer.tsx does `new window.YT.Player(...)`, matching
      // the real YouTube IFrame API), and arrow functions cannot be used as
      // constructors in JS.
      Player: vi.fn(function (_container: HTMLElement, options: unknown) {
        capturedEvents =
          (options as { events?: typeof capturedEvents }).events ?? {};
        return { destroy: vi.fn() };
      }),
    } as unknown as Window['YT'];

    render(<VideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));
    await vi.waitFor(() =>
      expect(capturedEvents.onError).toBeTypeOf('function'),
    );
    capturedEvents.onError!({ data: 100 });

    expect(await screen.findByText(/видео недоступно/i)).toBeInTheDocument();
  });

  it('injects the IFrame API script when YT is not yet loaded, then creates the player once ready', async () => {
    vi.resetModules();
    const { VideoPlayer: FreshVideoPlayer } = await import('./VideoPlayer');
    render(<FreshVideoPlayer video={VIDEO} />);
    fireEvent.click(screen.getByRole('button', { name: /играть/i }));

    await vi.waitFor(() =>
      expect(
        document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]',
        ),
      ).toBeInTheDocument(),
    );

    const playerConstructor = vi.fn();
    window.YT = { Player: playerConstructor } as unknown as Window['YT'];
    window.onYouTubeIframeAPIReady?.();

    await vi.waitFor(() => expect(playerConstructor).toHaveBeenCalled());
  });
});
