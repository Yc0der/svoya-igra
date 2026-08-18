import { useEffect, useRef, useState } from 'react';
import soundWave from './assets/sound-wave.gif';

interface YouTubePlayerInstance {
  // Всё опционально: тестовые двойники реализуют не каждый метод, а вызывать
  // их через `?.` всё равно приходится — настоящий плеер до готовности тоже
  // отдаёт не весь набор.
  destroy?(): void;
  playVideo?(): void;
  pauseVideo?(): void;
  getCurrentTime?(): number;
  getPlayerState?(): number;
}

interface YouTubePlayerOptions {
  host: string;
  width: string;
  height: string;
  videoId: string;
  playerVars: {
    start: number;
    rel: 0;
    modestbranding: 1;
    autoplay: 1;
  };
  events?: {
    onReady?: () => void;
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
// обычно несколько, повторная вставка/загрузка API на каждый была бы лишней.
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

// Как часто спрашиваем плеер, докуда он доиграл. playerVars.end на живой
// проверке ролик не остановил, поэтому конец клипа отслеживаем сами
// (design.md, 2026-08-18-video-questions-design.md, «Сервер и клиент»).
const PROGRESS_POLL_MS = 250;
// Сколько ждём, прежде чем решить, что автозапуск заблокирован браузером и
// без человеческого клика звук не пойдёт.
const AUTOPLAY_GRACE_MS = 1500;
const STATE_PLAYING = 1;
const STATE_BUFFERING = 3;

export function VideoPlayer({
  video,
  onFinished,
}: {
  video: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly: boolean;
  };
  onFinished: () => void;
}) {
  const [needsClick, setNeedsClick] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  // Ровно один сигнал за жизнь плеера: и опрос времени, и onError ведут сюда,
  // а сервер по этому сигналу запускает таймер вопроса — второй был бы уже
  // про следующий вопрос.
  const finishedRef = useRef(false);
  // onFinished не в зависимостях эффекта: пересоздавать плеер из-за новой
  // ссылки на колбэк значило бы обрывать воспроизведение на каждой рассылке
  // состояния.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let autoplayHandle: ReturnType<typeof setTimeout> | null = null;

    function finishOnce() {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedRef.current();
    }

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      const endsAt = video.startSeconds + video.durationSeconds;
      playerRef.current = new window.YT.Player(containerRef.current, {
        host: 'https://www.youtube-nocookie.com',
        width: '960',
        height: '540',
        videoId: video.youtubeId,
        playerVars: {
          start: video.startSeconds,
          rel: 0,
          modestbranding: 1,
          autoplay: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            pollHandle = setInterval(() => {
              const at = playerRef.current?.getCurrentTime?.();
              if (typeof at !== 'number' || at < endsAt) return;
              playerRef.current?.pauseVideo?.();
              if (pollHandle) clearInterval(pollHandle);
              pollHandle = null;
              finishOnce();
            }, PROGRESS_POLL_MS);
            autoplayHandle = setTimeout(() => {
              const state = playerRef.current?.getPlayerState?.();
              if (state !== STATE_PLAYING && state !== STATE_BUFFERING) {
                setNeedsClick(true);
              }
            }, AUTOPLAY_GRACE_MS);
          },
          onError: () => {
            if (cancelled) return;
            setFailed(true);
            // Ролика не будет вообще — партии незачем досиживать
            // страховочный таймер сервера, вопрос сразу становится обычным.
            finishOnce();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
      if (autoplayHandle) clearTimeout(autoplayHandle);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // Зависимости — конкретные поля video, не сам объект: он пересоздаётся
    // на каждой рассылке состояния, а зависимость от ссылки на весь объект
    // пересоздавала бы плеер и прерывала воспроизведение на каждой такой
    // рассылке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.youtubeId, video.startSeconds, video.durationSeconds]);

  if (failed) {
    return <p className="board-video-error">Видео недоступно</p>;
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
      {/* Полоса поверх верхней зоны плеера: название ролика там выдаёт ответ,
          а настройками эмбеда оно не убирается (modestbranding устарел). */}
      {!video.audioOnly && <div className="board-video-titleguard" />}
      {needsClick && (
        <button
          className="button button--primary"
          onClick={() => {
            playerRef.current?.playVideo?.();
            setNeedsClick(false);
          }}
        >
          ▶ Играть
        </button>
      )}
    </div>
  );
}
