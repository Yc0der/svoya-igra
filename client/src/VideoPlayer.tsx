import { useEffect, useRef, useState } from 'react';
import soundWave from './assets/sound-wave.gif';

interface YouTubePlayerInstance {
  destroy(): void;
}

interface YouTubePlayerOptions {
  host: string;
  width: string;
  height: string;
  videoId: string;
  playerVars: {
    start: number;
    end: number;
    rel: 0;
    modestbranding: 1;
    autoplay: 1;
  };
  events?: {
    onError?: (event: { data: number }) => void;
  };
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        container: HTMLElement,
        options: YouTubePlayerOptions,
      ) => YouTubePlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Один <script> на всё табло за всю сессию — вопросов с видео за партию
// обычно несколько, повторная вставка/загрузка API на каждый была бы лишней
// (design.md, 2026-08-18-video-questions-design.md, «Сервер и клиент»).
let apiLoadingPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiLoadingPromise) {
    apiLoadingPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
    });
  }
  return apiLoadingPromise;
}

export function VideoPlayer({
  video,
}: {
  video: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly: boolean;
  };
}) {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        host: 'https://www.youtube-nocookie.com',
        width: '960',
        height: '540',
        videoId: video.youtubeId,
        playerVars: {
          start: video.startSeconds,
          end: video.startSeconds + video.durationSeconds,
          rel: 0,
          modestbranding: 1,
          autoplay: 1,
        },
        events: {
          onError: () => setFailed(true),
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // Зависимости — конкретные поля video, не сам объект: он пересоздаётся
    // на каждой рассылке состояния (в т.ч. пока этот же вопрос ещё открыт),
    // а зависимость от ссылки на весь объект пересоздавала бы плеер и
    // прерывала воспроизведение на каждой такой рассылке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, video.youtubeId, video.startSeconds, video.durationSeconds]);

  if (failed) {
    return <p className="board-video-error">Видео недоступно</p>;
  }

  if (!started) {
    return (
      <button
        className="button button--primary"
        onClick={() => setStarted(true)}
      >
        ▶ Играть
      </button>
    );
  }

  return (
    <div className={video.audioOnly ? 'board-video-audio-only' : 'board-video'}>
      {video.audioOnly && (
        <img
          src={soundWave}
          className="board-video-audio-placeholder"
          alt="Играет аудио"
        />
      )}
      <div
        ref={containerRef}
        className={video.audioOnly ? 'board-video-hidden' : undefined}
      />
    </div>
  );
}
