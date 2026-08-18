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
  // ВРЕМЕННО — только для prerollMs, см. StateMessage.videoPrerollMs.
  unMute?(): void;
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
    controls: 0;
    // ВРЕМЕННО — см. поле prerollMs у VideoPlayer ниже.
    mute?: 1;
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
  prerollMs = 0,
}: {
  video: {
    youtubeId: string;
    startSeconds: number;
    durationSeconds: number;
    audioOnly: boolean;
  };
  onFinished: () => void;
  // ВРЕМЕННО (2026-08-18) — см. server/src/protocol.ts,
  // StateMessage.videoPrerollMs: сколько миллисекунд играть скрыто и без
  // звука перед официальным показом, чтобы за это время самостоятельно
  // пропала стартовая плашка YouTube с названием/каналом. Плата — зрители
  // теряют ровно эти же первые миллисекунды самого клипа (конец клипа
  // по-прежнему считается от startSeconds, не сдвигается). 0 — текущее
  // поведение без предзапуска.
  prerollMs?: number;
}) {
  const [needsClick, setNeedsClick] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(prerollMs === 0);
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
    // ВРЕМЕННО (2026-08-18) — момент (Date.now()), когда опрос впервые
    // увидел STATE_PLAYING; null, пока видео ещё не заиграло по-настоящему
    // (буферизация не в счёт). Обычная переменная замыкания, а не React
    // state: читается на каждом тике того же интервала, а не по рендерам.
    let playingSince: number | null = null;
    // Обычная переменная замыкания, а не сам React-state revealed: интервал
    // создаётся один раз в onReady и держит его в неизменном (устаревшем)
    // виде, если проверять сам state — нужен актуальный флаг внутри тика.
    let revealedNow = prerollMs === 0;

    function finishOnce() {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishedRef.current();
    }

    // ВРЕМЕННО — общая для обоих путей раскрытия (по истечении prerollMs и
    // по «клип физически закончился раньше») — иначе видео, чей клип короче
    // предзапуска (буферизация съела больше времени, чем сам preroll),
    // осталось бы скрытым навсегда: свой независимый таймер раскрытия успел
    // бы сработать уже после того, как вопрос закрылся по концу клипа.
    function revealNow() {
      if (revealedNow) return;
      revealedNow = true;
      playerRef.current?.unMute?.();
      setRevealed(true);
    }

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      const endsAt = video.startSeconds + video.durationSeconds;
      // ВРЕМЕННО — стартуем на prerollMs раньше задуманной в паке секунды
      // (не раньше нуля), чтобы после раскрытия зритель увидел ровно тот же
      // отрезок, что задуман: иначе первые prerollMs секунд самого клипа
      // просто терялись бы вместе с предзапуском. endsAt намеренно не
      // трогаем — конец клипа остаётся тем, что задуман в паке. Math.floor,
      // не round: YouTube API документирует start как целое число секунд —
      // округление вниз гарантирует, что видимая часть не станет короче
      // задуманной, а не наоборот.
      const actualStart = Math.max(
        0,
        Math.floor(video.startSeconds - prerollMs / 1000),
      );
      playerRef.current = new window.YT.Player(containerRef.current, {
        host: 'https://www.youtube-nocookie.com',
        width: '960',
        height: '540',
        videoId: video.youtubeId,
        playerVars: {
          start: actualStart,
          rel: 0,
          modestbranding: 1,
          autoplay: 1,
          // Живая проверка (2026-08-18): нативная панель управления
          // (таймкод, прогресс-бар, лого YouTube, кнопка полноэкранного
          // режима) оставалась видна внизу кадра даже с pointer-events:none
          // — сама панель не пряталась, только переставала откликаться на
          // клики. controls:0 убирает её целиком, а не пытается закрывать
          // сверху ещё одной полосой.
          controls: 0,
          // ВРЕМЕННО — на время предзапуска (prerollMs) звука быть не
          // должно: зритель ещё не видит кадр вообще.
          ...(prerollMs > 0 ? { mute: 1 as const } : {}),
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            pollHandle = setInterval(() => {
              const player = playerRef.current;
              if (!player) return;
              const state = player.getPlayerState?.();
              // Живая проверка (2026-08-18): ролик с медленным преролом ещё
              // не играл к моменту проверки автозапуска ниже, кнопка
              // появилась, — но затем всё-таки заиграл сам (буферизация
              // просто заняла больше AUTOPLAY_GRACE_MS). Без этой строки
              // кнопка так и висела бы поверх уже идущего клипа: ничего не
              // сбрасывало needsClick обратно после того, как оно однажды
              // стало true.
              if (state === STATE_PLAYING) {
                setNeedsClick(false);
                // ВРЕМЕННО — засекает предзапуск от МОМЕНТА, когда видео
                // реально начало играть, а не от onReady: живая проверка
                // (2026-08-18) поймала, что буферизация/seek сама по себе
                // съедала секунды между onReady и первым STATE_PLAYING.
                if (playingSince === null) playingSince = Date.now();
              }
              if (
                !revealedNow &&
                playingSince !== null &&
                Date.now() - playingSince >= prerollMs
              ) {
                revealNow();
              }
              const at = player.getCurrentTime?.();
              if (typeof at !== 'number' || at < endsAt) return;
              // ВРЕМЕННО — клип физически закончился (буферизация уже съела
              // больше времени, чем сам предзапуск, и видимая часть клипа
              // сжалась до нуля): дальше ждать нечего, а без этого видео
              // осталось бы скрытым навсегда — свой independent таймер
              // раскрытия успел бы сработать только после того, как вопрос
              // уже закрылся по концу клипа.
              revealNow();
              player.pauseVideo?.();
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
    // рассылке. prerollMs — та же логика: меняется только через админку, не
    // на каждой рассылке, но если вдруг изменится посреди уже идущего клипа,
    // пересоздавать плеер ради diagnostic-настройки не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.youtubeId, video.startSeconds, video.durationSeconds]);

  if (failed) {
    return <p className="board-video-error">Видео недоступно</p>;
  }

  // ВРЕМЕННО — !revealed по той же логике, что и audioOnly: пока идёт
  // предзапуск, зритель не должен увидеть кадр вообще, только позже — тем же
  // приёмом (нулевые размеры контейнера), которым уже прячется audioOnly.
  const visuallyHidden = video.audioOnly || !revealed;

  return (
    <div className={video.audioOnly ? 'board-video-audio-only' : 'board-video'}>
      {/* ВРЕМЕННО — та же заглушка, что у audioOnly, но теперь ещё и на
          время предзапуска обычного видео-вопроса: пустой экран несколько
          секунд ощущался как зависание, а не ожидание. */}
      {visuallyHidden && (
        <img
          src={soundWave}
          className="board-video-audio-placeholder"
          alt={video.audioOnly ? 'Играет аудио' : 'Видео скоро начнётся'}
        />
      )}
      {/* Класс — на этой обёртке, не на containerRef напрямую: YouTube
          IFrame API заменяет сам div на <iframe>, копируя className лишь в
          момент создания. React после этого управляет уже отсоединённым от
          DOM исходным div, а не видимым iframe — динамическое снятие класса
          (после prerollMs) до настоящего элемента не долетало бы вовсе.
          Раньше это было незаметно: audioOnly не меняется в рантайме, класс
          никогда не обновлялся динамически после создания плеера. */}
      <div className={visuallyHidden ? 'board-video-hidden' : undefined}>
        <div ref={containerRef} />
      </div>
      {/* Полоса поверх верхней зоны плеера: название ролика там выдаёт ответ,
          а настройками эмбеда оно не убирается (modestbranding устарел).
          Не рендерится, пока сам кадр ещё скрыт предзапуском — иначе на его
          месте висела бы пустая полоса цвета фона без видео под ней. */}
      {!video.audioOnly && !visuallyHidden && (
        <div className="board-video-titleguard" />
      )}
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
