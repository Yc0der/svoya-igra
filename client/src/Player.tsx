import { useState, type FormEvent } from 'react';
import { useRoomConnection } from './useRoomConnection';

export function Player() {
  const {
    status,
    join,
    game,
    selfId,
    falsestart,
    startGame,
    selectQuestion,
    buzz,
    saidAnswer,
    vote,
  } = useRoomConnection();
  const [name, setName] = useState('');

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
        return <p>Сейчас выбирает другой игрок</p>;
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
      return <p>Соперник отвечает</p>;

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
        </div>
      );

    case 'round-end':
      return <p>Раунд окончен, следующий раунд начинается</p>;

    case 'game-end':
      return (
        <div>
          <h2>Итог</h2>
          <ul>
            {[...game.scores]
              .sort((a, b) => b.score - a.score)
              .map((s) => (
                <li key={s.participantId}>
                  {s.participantId}: {s.score}
                </li>
              ))}
          </ul>
        </div>
      );
  }
}
