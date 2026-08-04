import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';

export function Board() {
  const { participants, lanUrl, game } = useRoomConnection();

  function nameOf(participantId: string): string {
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  if (!game) {
    return (
      <div>
        <h1>Своя игра</h1>
        {lanUrl && (
          <>
            <QRCodeSVG value={lanUrl} size={200} title="QR-код для входа" />
            <p>{lanUrl}</p>
          </>
        )}
        <ul>
          {participants.map((p) => (
            <li key={p.id}>
              {p.name} {p.connected ? '' : '(отключён)'}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const scoreboard = (
    <ul>
      {[...game.scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => (
          <li key={s.participantId}>
            {nameOf(s.participantId)}: {s.score}
          </li>
        ))}
    </ul>
  );

  if (game.phase === 'game-end') {
    return (
      <div>
        <h1>Игра окончена</h1>
        {scoreboard}
      </div>
    );
  }

  return (
    <div>
      {game.phase === 'selecting' && (
        <p>Выбирает {nameOf(game.turnParticipantId)}</p>
      )}

      <div>
        {game.grid.map((theme) => (
          <div key={theme.themeName}>
            <h2>{theme.themeName}</h2>
            {theme.questions
              .filter((q) => !q.answered)
              .map((q) => (
                <span key={q.id}>{q.price}</span>
              ))}
          </div>
        ))}
      </div>

      {game.currentQuestion && <p>{game.currentQuestion.text}</p>}

      {game.buzzedParticipantId && (
        <p>{nameOf(game.buzzedParticipantId)} жмёт кнопку</p>
      )}

      {game.correctAnswer && (
        <div>
          <p>{game.correctAnswer.text}</p>
          {game.correctAnswer.comment && <p>{game.correctAnswer.comment}</p>}
        </div>
      )}

      {scoreboard}
    </div>
  );
}
