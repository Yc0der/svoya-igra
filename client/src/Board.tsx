import { Fragment, type CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';
import { useCountdown } from './useCountdown';
import { useTextReveal } from './useTextReveal';
import { VideoPlayer } from './VideoPlayer';

export function Board() {
  const { participants, lanUrl, game, mediaFinished } = useRoomConnection();
  const remainingSeconds = useCountdown(game?.timerDeadline ?? null);
  const revealedQuestionText = useTextReveal(
    game?.phase === 'question-reveal' ? (game.timerDeadline ?? null) : null,
    game?.currentQuestion?.revealMs ?? null,
    game?.currentQuestion?.text ?? '',
  );

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
          <p className="board-timer">{remainingSeconds}с</p>
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
          <p className="board-timer">{remainingSeconds}с</p>
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
    <div className="board">
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
              <p className="board-timer">{remainingSeconds}с</p>
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
            <p className="board-timer">{remainingSeconds}с</p>
          )}
        </>
      )}

      {game.correctAnswer && (
        <div className="board-answer">
          <p>{game.correctAnswer.text}</p>
          {game.correctAnswer.comment && <p>{game.correctAnswer.comment}</p>}
        </div>
      )}

      {scoreboard}
    </div>
  );
}
