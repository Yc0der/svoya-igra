import { Fragment } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';
import { useCountdown } from './useCountdown';

export function Board() {
  const { participants, lanUrl, game } = useRoomConnection();
  const remainingSeconds = useCountdown(game?.timerDeadline ?? null);

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

  return (
    <div className="board">
      {game.phase === 'selecting' && (
        <p className="board-status">
          Выбирает <strong>{nameOf(game.turnParticipantId)}</strong>
        </p>
      )}

      <div className="board-grid">
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
          <p className="board-question">{game.currentQuestion.text}</p>
          {game.phase === 'question-open' && remainingSeconds !== null && (
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
