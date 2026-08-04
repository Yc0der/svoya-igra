import { useState, type FormEvent } from 'react';
import { useRoomConnection, type GameStateView } from './useRoomConnection';

export function Player() {
  const {
    status,
    join,
    game,
    selfId,
    participants,
    falsestart,
    startGame,
    selectQuestion,
    buzz,
    saidAnswer,
    vote,
  } = useRoomConnection();
  const [name, setName] = useState('');

  function nameOf(participantId: string | null): string {
    if (!participantId) return '';
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  function scoreboard(scores: GameStateView['scores']) {
    return (
      <ul>
        {[...scores]
          .sort((a, b) => b.score - a.score)
          .map((s) => (
            <li key={s.participantId}>
              {nameOf(s.participantId)}: {s.score}
            </li>
          ))}
      </ul>
    );
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) {
      join(name.trim());
    }
  }

  if (status !== 'joined') {
    return (
      <form onSubmit={handleSubmit}>
        <label htmlFor="name">Имя</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={status === 'joining'}>
          Войти
        </button>
        {status === 'name-taken' && (
          <p role="alert">Это имя уже занято, выбери другое</p>
        )}
      </form>
    );
  }

  if (!game) {
    return (
      <div>
        <p>Ты в игре. Жди начала.</p>
        <button onClick={startGame}>Начать игру</button>
      </div>
    );
  }

  const isMyTurn = game.turnParticipantId === selfId;
  const isBuzzedByMe = game.buzzedParticipantId === selfId;

  switch (game.phase) {
    case 'selecting':
      if (!isMyTurn) {
        return <p>Сейчас выбирает {nameOf(game.turnParticipantId)}</p>;
      }
      return (
        <div>
          {game.grid.map((theme) => (
            <div key={theme.themeName}>
              <h2>{theme.themeName}</h2>
              {theme.questions.map((q) => (
                <button
                  key={q.id}
                  disabled={q.answered}
                  onClick={() => selectQuestion(game.grid.indexOf(theme), q.id)}
                >
                  {q.price}
                </button>
              ))}
            </div>
          ))}
        </div>
      );

    case 'question-open':
      return (
        <button onClick={buzz} disabled={falsestart}>
          Жать!
        </button>
      );

    case 'buzzed':
      if (isBuzzedByMe) {
        return (
          <div>
            <p>Скажи ответ вслух</p>
            <button onClick={saidAnswer}>Я ответил</button>
          </div>
        );
      }
      return <p>{nameOf(game.buzzedParticipantId)} отвечает</p>;

    case 'judging':
      if (isBuzzedByMe) {
        return <p>Ждём решения соперников</p>;
      }
      return (
        <div>
          <button onClick={() => vote(true)}>Зачёт</button>
          <button onClick={() => vote(false)}>Незачёт</button>
        </div>
      );

    case 'reveal':
      return (
        <div>
          <p>{game.correctAnswer?.text}</p>
          {game.correctAnswer?.comment && <p>{game.correctAnswer.comment}</p>}
          {scoreboard(game.scores)}
        </div>
      );

    case 'round-end':
      return (
        <div>
          <p>Раунд окончен, следующий раунд начинается</p>
          {scoreboard(game.scores)}
        </div>
      );

    case 'game-end':
      return (
        <div>
          <h2>Итог</h2>
          {scoreboard(game.scores)}
        </div>
      );
  }
}
