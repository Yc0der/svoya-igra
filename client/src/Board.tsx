import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';
import type { RoomConnection } from './useRoomConnection';
import { useCountdown } from './useCountdown';
import { useTextReveal } from './useTextReveal';
import { useBoardAudio } from './useBoardAudio';
import { VideoPlayer } from './VideoPlayer';
import { VolumeSlider } from './VolumeSlider';
import type { AudioSettings } from './audio';

export function Board() {
  const connection = useRoomConnection();
  const { blocked, unlock } = useBoardAudio(connection);
  return (
    <>
      <BoardScreen connection={connection} />
      <BoardAudioControls
        settings={connection.audio}
        onChange={connection.setAudioSettings}
        blocked={blocked}
        onUnlock={unlock}
      />
    </>
  );
}

function BoardScreen({ connection }: { connection: RoomConnection }) {
  const { participants, lanUrl, game, mediaFinished } = connection;
  const remainingSeconds = useCountdown(game?.timerDeadline ?? null);
  const revealedQuestionText = useTextReveal(
    game?.phase === 'question-reveal' ? (game.timerDeadline ?? null) : null,
    game?.currentQuestion?.revealMs ?? null,
    game?.currentQuestion?.text ?? '',
    game?.currentQuestion?.fadeMs,
  );

  // Последние пять секунд таймер перекрашивается в «сейчас» — на телевизоре
  // это видно боковым зрением, в отличие от смены цифры.
  const timerClass = `board-timer${
    remainingSeconds !== null && remainingSeconds <= 5
      ? ' board-timer--urgent'
      : ''
  }`;

  function nameOf(participantId: string): string {
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  if (!game) {
    return (
      <div className="board board--lobby">
        <h1>Своя игра</h1>
        {lanUrl && (
          <div className="board-qr">
            {/* Первое, что видит гость, — код без единого слова. Строка
                говорит, что с ним делать: пустой экран должен приглашать к
                действию, а не молчать. */}
            <p className="board-qr-hint">Наведи камеру телефона на код</p>
            <QRCodeSVG value={lanUrl} size={220} title="QR-код для входа" />
            <p className="board-qr-url">{lanUrl}</p>
          </div>
        )}
        <ul className="board-participants">
          {participants.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'is-disconnected'}>
              {p.name} {p.connected ? '' : '(отключён)'}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const scoreboard = (
    <ul className="scoreboard">
      {[...game.scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => (
          <li key={s.participantId}>
            <span className="scoreboard-name">{nameOf(s.participantId)}</span>
            <span className="scoreboard-value">{s.score}</span>
          </li>
        ))}
    </ul>
  );

  if (game.phase === 'game-end') {
    return (
      <div className="board">
        <h1>Игра окончена</h1>
        {scoreboard}
      </div>
    );
  }

  if (game.phase === 'final-elim') {
    return (
      <div className="board">
        <h1>Финал — выбор темы</h1>
        <p className="board-status">
          Сейчас выбирает{' '}
          <strong>{nameOf(game.finalElimParticipantId ?? '')}</strong>
        </p>
        {remainingSeconds !== null && (
          <p className={timerClass}>{remainingSeconds}с</p>
        )}
        <ul className="final-theme-list">
          {game.finalThemes?.map((theme) => (
            <li
              key={theme.name}
              className={theme.eliminated ? 'is-eliminated' : ''}
            >
              {theme.name}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (
    game.phase === 'final-wager' ||
    game.phase === 'final-answer' ||
    game.phase === 'final-judging'
  ) {
    return (
      <div className="board">
        <h1>Финал</h1>
        <p className="board-status">
          {game.finalThemes?.find((t) => !t.eliminated)?.name}
        </p>
        {game.finalQuestion && (
          <p className="board-question">{game.finalQuestion.text}</p>
        )}
        {game.phase === 'final-judging' && (
          <p className="board-status">Ведущий проверяет ответы…</p>
        )}
        {remainingSeconds !== null && (
          <p className={timerClass}>{remainingSeconds}с</p>
        )}
      </div>
    );
  }

  if (game.phase === 'final-reveal') {
    return (
      <div className="board">
        <h1>Финал — итог</h1>
        {game.finalCorrectAnswer && (
          <div className="board-answer">
            <p>{game.finalCorrectAnswer.text}</p>
            {game.finalCorrectAnswer.comment && (
              <p>{game.finalCorrectAnswer.comment}</p>
            )}
          </div>
        )}
        <ul className="final-judging-list">
          {game.finalAnswers?.map((a) => {
            const wager = game.finalWagers?.find(
              (w) => w.participantId === a.participantId,
            )?.amount;
            const correct = game.finalVerdicts?.find(
              (v) => v.participantId === a.participantId,
            )?.correct;
            return (
              <li key={a.participantId}>
                <span className="final-judging-name">
                  {nameOf(a.participantId)}
                </span>
                <span className="final-judging-wager">{wager}</span>
                <span className="final-judging-answer">{a.text}</span>
                <span>{correct ? '✓' : '✗'}</span>
              </li>
            );
          })}
        </ul>
        {scoreboard}
      </div>
    );
  }

  return (
    // Класс фазы нужен только оформлению: пока вопрос на экране, сетка тем
    // с телевизора уходит (index.css) — на трёх метрах она спорит с самим
    // вопросом за внимание. Разметка при этом не меняется, потому что
    // возвращать её обратно в 'selecting' надо мгновенно.
    <div className={`board board--${game.phase}`}>
      {game.phase === 'selecting' && (
        <p className="board-status">
          Выбирает <strong>{nameOf(game.turnParticipantId)}</strong>
        </p>
      )}

      <div
        className="board-grid"
        style={
          {
            '--price-columns': game.grid[0]?.questions.length ?? 4,
          } as CSSProperties
        }
      >
        {game.grid.map((theme) => (
          <Fragment key={theme.themeName}>
            <h2 className="theme-name">{theme.themeName}</h2>
            {theme.questions.map((q) => (
              <span
                key={q.id}
                className={`price-cell${q.answered ? ' price-cell--answered' : ''}`}
              >
                {q.answered ? '' : q.price}
              </span>
            ))}
          </Fragment>
        ))}
      </div>

      {game.currentQuestion && (
        <>
          {/* text — null во время cat-handoff (текст ещё скрыт, см.
              Room.toGameStateView) — показываем тему и цену, не пустой
              абзац. */}
          {/* Тема и цена над вопросом. Раньше их роль играла сетка, но пока
              вопрос на экране, сетка убрана (см. board--<фаза> в index.css) —
              без этой строки телевизор перестал бы показывать, что именно
              разыгрывается и на сколько. Одной строкой, а не двумя узлами:
              тесты ищут «Тема» точным совпадением по сетке. */}
          {game.currentQuestion.text !== null && (
            <p className="board-eyebrow">
              {game.currentQuestion.themeName} · {game.currentQuestion.price}
            </p>
          )}
          {game.currentQuestion.text !== null ? (
            <p className="board-question">
              {game.phase === 'question-reveal'
                ? revealedQuestionText
                : game.currentQuestion.text}
            </p>
          ) : (
            <p className="board-question">
              {game.currentQuestion.themeName} за {game.currentQuestion.price}
            </p>
          )}
          {game.currentQuestion.image && !game.currentQuestion.video && (
            <img
              className="board-question-image"
              src={game.currentQuestion.image}
              alt="Картинка к вопросу"
            />
          )}
          {game.currentQuestion.video && (
            <VideoPlayer
              // Ключ по вопросу, а не по фазе: переход question-media →
              // question-open не должен пересоздавать плеер и запускать
              // клип по второму разу.
              key={game.currentQuestion.id}
              video={game.currentQuestion.video}
              onFinished={() => {
                if (game.currentQuestion?.id) {
                  mediaFinished(game.currentQuestion.id);
                }
              }}
            />
          )}
          {(game.phase === 'question-open' || game.phase === 'cat-handoff') &&
            remainingSeconds !== null && (
              <p className={timerClass}>{remainingSeconds}с</p>
            )}
        </>
      )}

      {game.buzzedParticipantId && (
        <p className="board-status board-status--buzzed">
          {nameOf(game.buzzedParticipantId)} жмёт кнопку
        </p>
      )}

      {game.phase === 'judging' && (
        <>
          {/* Пусто, если судит ведущий: ответ ему виден только на его
              собственном экране (design.md, «СУДЕЙСТВО») — показывать его
              здесь означало бы вернуть ту самую утечку, ради которой ведущий
              вообще появился. */}
          {!game.correctAnswer && (
            <p className="board-status">Ведущий судит…</p>
          )}
          {remainingSeconds !== null && (
            <p className={timerClass}>{remainingSeconds}с</p>
          )}
        </>
      )}

      {game.correctAnswer && (
        <div className="board-answer">
          <p>{game.correctAnswer.text}</p>
          {game.correctAnswer.comment && <p>{game.correctAnswer.comment}</p>}
          {game.questionTags &&
            game.questionTags.up + game.questionTags.down > 0 && (
              <p className="board-tags">
                👍 {game.questionTags.up} 👎 {game.questionTags.down}
              </p>
            )}
        </div>
      )}

      {scoreboard}
    </div>
  );
}

function BoardAudioControls({
  settings,
  onChange,
  blocked,
  onUnlock,
}: {
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  blocked: boolean;
  onUnlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Клик вне панели закрывает её: на телевизоре мышью не пользуются, панель
  // открывают редко и с чужого устройства — оставлять её раскрытой поверх
  // игры хуже, чем открыть лишний раз.
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [open]);

  return (
    <div className="board-audio" ref={rootRef}>
      {/* Браузер не играет ничего до жеста на странице, а табло — экран, на
          котором никто не кликает. Тот же приём, что у кнопки «▶ Играть» в
          VideoPlayer.tsx (design.md, «Разблокировка звука»). */}
      {blocked && (
        <button className="button button--primary" onClick={onUnlock}>
          🔊 Включить звук
        </button>
      )}
      <button
        className="button board-audio-toggle"
        aria-label="Звук"
        onClick={() => setOpen((value) => !value)}
      >
        🔊
      </button>
      {open && (
        <div className="board-audio-panel">
          <label>
            <input
              type="checkbox"
              checked={settings.effectsEnabled}
              onChange={(e) => onChange({ effectsEnabled: e.target.checked })}
            />{' '}
            Звуки событий
          </label>
          <VolumeSlider
            label="Громкость звуков"
            value={settings.effectsVolume}
            onChange={(volume) => onChange({ effectsVolume: volume })}
          />
          <label>
            <input
              type="checkbox"
              checked={settings.musicEnabled}
              onChange={(e) => onChange({ musicEnabled: e.target.checked })}
            />{' '}
            Музыка
          </label>
          <VolumeSlider
            label="Громкость музыки"
            value={settings.musicVolume}
            onChange={(volume) => onChange({ musicVolume: volume })}
          />
        </div>
      )}
    </div>
  );
}
