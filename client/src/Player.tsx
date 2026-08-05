import { Fragment, useEffect, useState, type FormEvent } from 'react';
import {
  useRoomConnection,
  type GameStateView,
  type StartGameErrorReason,
} from './useRoomConnection';
import { useCountdown } from './useCountdown';

const START_GAME_ERROR_TEXT: Record<StartGameErrorReason, string> = {
  'not-enough-players': 'Нужно минимум два игрока.',
  'no-pack': 'На сервере нет пакета вопросов.',
  'game-in-progress': 'Партия уже идёт.',
  'host-required':
    'Нужен ведущий, чтобы играть втроём и больше — кто-то должен нажать «Стать ведущим».',
};

export function Player() {
  const {
    status,
    join,
    game,
    selfId,
    participants,
    falsestart,
    hostParticipantId,
    isHost,
    startGameError,
    startGame,
    toggleHost,
    selectQuestion,
    buzz,
    saidAnswer,
    vote,
    adjustScore,
    cancelQuestion,
  } = useRoomConnection();
  const [name, setName] = useState('');
  const [myVote, setMyVote] = useState<boolean | null>(null);
  const remainingSeconds = useCountdown(game?.timerDeadline ?? null);
  // Отдельный от remainingSeconds счётчик: временная блокировка после своей
  // неверной попытки идёт параллельно с уже возобновившимся отсчётом
  // вопроса, а не вместо него — это два разных дедлайна (design.md,
  // «СУДЕЙСТВО», 2026-08-05).
  const graceRemainingSeconds = useCountdown(game?.graceExcludedUntil ?? null);

  useEffect(() => {
    if (game?.phase !== 'judging') setMyVote(null);
  }, [game?.phase]);

  function nameOf(participantId: string | null): string {
    if (!participantId) return '';
    return (
      participants.find((p) => p.id === participantId)?.name ?? participantId
    );
  }

  function scoreboard(scores: GameStateView['scores']) {
    return (
      <ul className="scoreboard">
        {[...scores]
          .sort((a, b) => b.score - a.score)
          .map((s) => (
            <li key={s.participantId}>
              <span className="scoreboard-name">{nameOf(s.participantId)}</span>
              <span className="scoreboard-value">{s.score}</span>
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
      <form className="player player--join" onSubmit={handleSubmit}>
        <h1>Своя игра</h1>
        <label htmlFor="name">Имя</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button
          className="button button--primary"
          type="submit"
          disabled={status === 'joining'}
        >
          Войти
        </button>
        {status === 'name-taken' && (
          <p className="player-alert" role="alert">
            Это имя уже занято, выбери другое
          </p>
        )}
      </form>
    );
  }

  if (!game) {
    const hostName = hostParticipantId ? nameOf(hostParticipantId) : null;
    return (
      <div className="player">
        <p>Ты в игре. Жди начала.</p>
        {hostName && (
          <p>
            Ведущий: {hostName}
            {isHost && ' (ты)'}
          </p>
        )}
        <button className="button" onClick={toggleHost}>
          {isHost ? 'Перестать быть ведущим' : 'Стать ведущим'}
        </button>
        {startGameError && (
          <p className="player-alert" role="alert">
            {START_GAME_ERROR_TEXT[startGameError]}
          </p>
        )}
        <button className="button button--primary" onClick={startGame}>
          Начать игру
        </button>
      </div>
    );
  }

  const isMyTurn = game.turnParticipantId === selfId;
  const isBuzzedByMe = game.buzzedParticipantId === selfId;

  // Панель ведущего — ±очки и отмена вопроса. Постоянная, а не привязанная
  // к одной фазе (например, только к судейству): ошибку в счёте естественно
  // заметить и захотеть поправить в любой момент, не только пока идёт
  // конкретный вопрос.
  function hostAdminPanel() {
    if (!game) return null;
    const questionActive =
      game.phase === 'question-open' ||
      game.phase === 'buzzed' ||
      game.phase === 'judging';
    return (
      <div className="host-admin">
        <h3>Управление</h3>
        <ul className="host-admin-scores">
          {game.scores.map((s) => (
            <li key={s.participantId}>
              <span className="host-admin-name">{nameOf(s.participantId)}</span>
              <span className="host-admin-value">{s.score}</span>
              <button
                className="button host-admin-step"
                onClick={() => adjustScore(s.participantId, -100)}
              >
                −100
              </button>
              <button
                className="button host-admin-step"
                onClick={() => adjustScore(s.participantId, 100)}
              >
                +100
              </button>
            </li>
          ))}
        </ul>
        {questionActive && (
          <button className="button" onClick={cancelQuestion}>
            Отменить вопрос
          </button>
        )}
      </div>
    );
  }

  const phaseContent = (() => {
    switch (game.phase) {
      case 'selecting':
        if (!isMyTurn) {
          return (
            <div className="player">
              <p>Сейчас выбирает {nameOf(game.turnParticipantId)}</p>
            </div>
          );
        }
        return (
          <div className="player">
            <div className="player-grid">
              {game.grid.map((theme) => (
                <Fragment key={theme.themeName}>
                  <h2 className="theme-name">{theme.themeName}</h2>
                  {theme.questions.map((q) => (
                    <button
                      key={q.id}
                      className="price-button"
                      disabled={q.answered}
                      onClick={() =>
                        selectQuestion(game.grid.indexOf(theme), q.id)
                      }
                    >
                      {q.price}
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        );

      case 'question-open': {
        if (isHost) {
          // Ведущий не счётчик — не жмёт кнопку и никогда не будет тем, кому
          // она достанется. Полноценная кнопка тут только сбивала бы с толку:
          // клик по ней ни к чему не приводит (сервер молча игнорирует), но
          // выглядит так, будто ведущий тоже может участвовать.
          return (
            <div className="player player--center">
              <p>Вопрос открыт — ждём, кто нажмёт</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        const iAmExcluded =
          selfId !== null && game.graceExcludedParticipantId === selfId;
        return (
          <div className="player player--center">
            <button
              className="button button--buzz"
              onClick={buzz}
              disabled={falsestart || iAmExcluded}
            >
              Ответ
            </button>
            {/* Общий отсчёт вопроса виден всегда, независимо от того, кто
                временно заблокирован — он идёт параллельно, не вместо. */}
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
            {iAmExcluded && (
              <p className="player-timer">
                Ты уже пробовал(а) — жди
                {graceRemainingSeconds !== null && ` ${graceRemainingSeconds}с`}
              </p>
            )}
          </div>
        );
      }

      case 'buzzed':
        if (isBuzzedByMe) {
          return (
            <div className="player player--center">
              <p>Скажи ответ вслух</p>
              <button className="button button--primary" onClick={saidAnswer}>
                Я ответил
              </button>
            </div>
          );
        }
        return (
          <div className="player player--center">
            <p>{nameOf(game.buzzedParticipantId)} отвечает</p>
          </div>
        );

      case 'judging':
        if (hostParticipantId !== null) {
          if (isHost) {
            return (
              <div className="player player--center">
                <p className="player-answer">{game.correctAnswer?.text}</p>
                {game.correctAnswer?.comment && (
                  <p className="player-comment">{game.correctAnswer.comment}</p>
                )}
                <div className="player-vote">
                  <button
                    className="button button--yes"
                    onClick={() => vote(true)}
                  >
                    Зачёт
                  </button>
                  <button
                    className="button button--no"
                    onClick={() => vote(false)}
                  >
                    Незачёт
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="player player--center">
              <p>Ждём решения ведущего</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        if (isBuzzedByMe) {
          return (
            <div className="player player--center">
              <p>Ждём решения соперников</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        return (
          <div className="player player--center player-vote">
            <button
              className={`button button--yes${myVote === true ? ' is-selected' : ''}`}
              onClick={() => {
                setMyVote(true);
                vote(true);
              }}
            >
              Зачёт{myVote === true && ' ✓'}
            </button>
            <button
              className={`button button--no${myVote === false ? ' is-selected' : ''}`}
              onClick={() => {
                setMyVote(false);
                vote(false);
              }}
            >
              Незачёт{myVote === false && ' ✓'}
            </button>
            {myVote !== null && (
              <p className="player-vote-hint">Голос принят, ждём остальных</p>
            )}
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
          </div>
        );

      case 'reveal':
        return (
          <div className="player">
            <p className="player-answer">{game.correctAnswer?.text}</p>
            {game.correctAnswer?.comment && (
              <p className="player-comment">{game.correctAnswer.comment}</p>
            )}
            {scoreboard(game.scores)}
          </div>
        );

      case 'round-end':
        return (
          <div className="player">
            <p>Раунд окончен, следующий раунд начинается</p>
            {scoreboard(game.scores)}
          </div>
        );

      case 'game-end':
        return (
          <div className="player">
            <h2>Итог</h2>
            {scoreboard(game.scores)}
          </div>
        );
    }
  })();

  return isHost ? (
    <>
      {phaseContent}
      {hostAdminPanel()}
    </>
  ) : (
    phaseContent
  );
}
