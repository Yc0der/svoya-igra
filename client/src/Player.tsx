import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useRoomConnection, type GameStateView } from './useRoomConnection';
import { useCountdown } from './useCountdown';
import { START_GAME_ERROR_TEXT } from './errorText';

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
    assignCat,
    buzz,
    saidAnswer,
    vote,
    adjustScore,
    cancelQuestion,
    resetGame,
    eliminateFinalTheme,
    submitWager,
    submitFinalAnswer,
    finalVote,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks,
    selectPack,
  } = useRoomConnection();
  const [name, setName] = useState('');
  const [myVote, setMyVote] = useState<boolean | null>(null);
  // Ведущий в финале судит нескольких счётчиков по очереди в любом порядке —
  // одного myVote (как в base-round judging) не хватает, нужна отметка на
  // каждого отдельно, чтобы было видно, кого уже отметили.
  const [myFinalVerdicts, setMyFinalVerdicts] = useState<
    Record<string, boolean>
  >({});
  const [wagerInput, setWagerInput] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  // Один раз за подключение ведущий решает, продолжать ли партию, найденную
  // на сервере при заходе (например, восстановленную из снапшота после
  // перезапуска), или отбросить её и начать заново — см. блок ниже
  // «Незавершённая партия».
  const [resumeChoiceMade, setResumeChoiceMade] = useState(false);
  // Партия, которую мы видим уже идущей ещё до того, как хоть раз увидели
  // пустое лобби (game === null) — сигнал, что она появилась независимо от
  // нас (например, восстановлена на сервере из снапшота после перезапуска),
  // а не запущена нами самими прямо сейчас в этом же подключении. Именно
  // такую партию и должен спросить выбор «Продолжить»/«Новая игра» ниже —
  // партию, начатую собственной кнопкой «Начать игру», он прерывать не должен.
  const sawEmptyLobbyRef = useRef(false);
  useEffect(() => {
    if (status === 'joined' && game === null) {
      sawEmptyLobbyRef.current = true;
    }
  }, [status, game]);
  const remainingSeconds = useCountdown(game?.timerDeadline ?? null);
  // Отдельный от remainingSeconds счётчик: временная блокировка после своей
  // неверной попытки идёт параллельно с уже возобновившимся отсчётом
  // вопроса, а не вместо него — это два разных дедлайна (design.md,
  // «СУДЕЙСТВО», 2026-08-05).
  const graceRemainingSeconds = useCountdown(game?.graceExcludedUntil ?? null);

  useEffect(() => {
    if (game?.phase !== 'judging') setMyVote(null);
  }, [game?.phase]);

  useEffect(() => {
    if (game?.phase !== 'final-judging') setMyFinalVerdicts({});
  }, [game?.phase]);

  useEffect(() => {
    if (game?.phase !== 'final-wager') setWagerInput('');
    if (game?.phase !== 'final-answer') setAnswerInput('');
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
        {isHost && (
          <div className="player-pack-picker">
            <h3>Пакет</h3>
            {selectPackError && (
              <p className="player-alert" role="alert">
                Не удалось выбрать пакет — файл стал невалиден или исчез.
              </p>
            )}
            <button className="button" onClick={refreshPacks}>
              Обновить
            </button>
            {availablePacks.length === 0 ? (
              <p>
                Пакеты не найдены — положите файлы в packs/ и обновите список.
              </p>
            ) : (
              <ul className="player-packs">
                {availablePacks.map((p) => {
                  const selected = p.filename === activePackFilename;
                  return (
                    <li key={p.filename}>
                      <button
                        className={`button${selected ? ' is-selected' : ''}`}
                        onClick={() => selectPack(p.filename)}
                        disabled={selected}
                      >
                        <span className="admin-pack-title">{p.title}</span>
                        {p.description && (
                          <span className="admin-pack-description">
                            {p.description}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {startGameError && (
          <p className="player-alert" role="alert">
            {START_GAME_ERROR_TEXT[startGameError]}
          </p>
        )}
        {(!hostParticipantId || isHost) && (
          <button className="button button--primary" onClick={startGame}>
            Начать игру
          </button>
        )}
      </div>
    );
  }

  const isMyTurn = game.turnParticipantId === selfId;
  const isBuzzedByMe = game.buzzedParticipantId === selfId;

  // Незавершённая партия, найденная на сервере при заходе (например,
  // восстановленная из снапшота после перезапуска) — ведущий решает один раз
  // за подключение, продолжать её или отбросить и начать заново, вместо того
  // чтобы вручную чистить снапшот и перезапускать сервер. Остальным
  // участникам этот выбор не показывается — сбросить партию не может никто,
  // кроме ведущего.
  if (
    isHost &&
    game.phase !== 'game-end' &&
    !sawEmptyLobbyRef.current &&
    !resumeChoiceMade
  ) {
    return (
      <div className="player">
        <h2>Незавершённая партия</h2>
        <p>Продолжить с того места, где остановились, или начать заново?</p>
        <button
          className="button button--primary"
          onClick={() => setResumeChoiceMade(true)}
        >
          Продолжить
        </button>
        <button
          className="button"
          onClick={() => {
            resetGame();
            setResumeChoiceMade(true);
          }}
        >
          Новая игра
        </button>
      </div>
    );
  }

  // Панель ведущего — ±очки и отмена вопроса. Постоянная, а не привязанная
  // к одной фазе (например, только к судейству): ошибку в счёте естественно
  // заметить и захотеть поправить в любой момент, не только пока идёт
  // конкретный вопрос.
  function hostAdminPanel() {
    if (!game) return null;
    const questionActive =
      game.phase === 'cat-handoff' ||
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
            <div
              className="player-grid"
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

      case 'cat-handoff': {
        if (game.turnParticipantId === selfId) {
          const candidates = participants.filter(
            (p) =>
              p.connected &&
              p.id !== selfId &&
              game.scores.some((s) => s.participantId === p.id),
          );
          return (
            <div className="player">
              <h2>Кот в мешке — выбери, кому отдать</h2>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
              <ul className="final-theme-list">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button className="button" onClick={() => assignCat(p.id)}>
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <div className="player player--center">
            <p>{nameOf(game.turnParticipantId)} выбирает, кому отдать кота</p>
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
          </div>
        );
      }

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
        // Вопрос-«кот»: кнопка «Ответ» существует только для того, кому его
        // передали — остальные, хоть и счётчики, для этого конкретного
        // вопроса не в игре (design.md, «Правило»).
        const isCatRecipient =
          game.catRecipientParticipantId === null ||
          game.catRecipientParticipantId === selfId;
        if (!isCatRecipient) {
          return (
            <div className="player player--center">
              <p>Кот у {nameOf(game.catRecipientParticipantId)} — жди</p>
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

      case 'game-end': {
        // Не game.hostId/isHost — тот заморожен от УЖЕ ЗАКОНЧИВШЕЙСЯ партии и
        // не двигается, даже если тот участник давно отключился. На
        // game-end toggleHost() снова разрешён (room.ts: «'game-end' —
        // исключение»), и именно живой лобби-флаг hostParticipantId — то, что
        // реально проверяет сервер при повторном startGame() (room.ts,
        // startGame(): hostId считается заново из this.hostParticipantId, а
        // не из this.game.hostId). Кнопка обязана смотреть на то же поле,
        // иначе она может быть скрыта от единственного, кто реально способен
        // сейчас перезапустить партию.
        const canRestart = !hostParticipantId || selfId === hostParticipantId;
        return (
          <div className="player">
            <h2>Итог</h2>
            {scoreboard(game.scores)}
            {canRestart && (
              <button className="button button--primary" onClick={startGame}>
                Новая игра
              </button>
            )}
          </div>
        );
      }

      case 'final-elim': {
        const isMyElimTurn = game.finalElimParticipantId === selfId;
        return (
          <div className="player">
            <h2>Финал — выбор темы</h2>
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
            {!isMyElimTurn && (
              <p>Сейчас выбирает {nameOf(game.finalElimParticipantId)}</p>
            )}
            <ul className="final-theme-list">
              {game.finalThemes?.map((theme, i) => (
                <li
                  key={theme.name}
                  className={theme.eliminated ? 'is-eliminated' : ''}
                >
                  <button
                    className="button"
                    disabled={!isMyElimTurn || theme.eliminated}
                    onClick={() => eliminateFinalTheme(i)}
                  >
                    {theme.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      }

      case 'final-wager': {
        // Ведущий не счётчик (не в game.scores) — он не ставит, движок молча
        // проигнорировал бы его submit-wager (handleSubmitWager проверяет
        // event.counterId in state.scores). Показывать ему форму ставки было
        // бы обманом интерфейса: клик выглядел бы рабочим, но ни на что не
        // влиял бы — тот же принцип, что уже применён к кнопке «Ответ» на
        // question-open (design.md, «Клиенты»).
        if (isHost) {
          return (
            <div className="player player--center">
              <h2>Финал — ставка</h2>
              <p>Игроки делают ставки…</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        const myWager = game.finalWagers?.find(
          (w) => w.participantId === selfId,
        );
        if (myWager) {
          return (
            <div className="player player--center">
              <h2>Финал — ставка</h2>
              <p>Ставка принята: {myWager.amount}. Ждём остальных…</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        const myScore =
          game.scores.find((s) => s.participantId === selfId)?.score ?? 0;
        const max = Math.max(0, myScore);
        return (
          <div className="player player--center">
            <h2>Финал — ставка</h2>
            <p>{game.finalThemes?.find((t) => !t.eliminated)?.name}</p>
            <label htmlFor="wager">Ставка</label>
            <input
              id="wager"
              type="number"
              min={0}
              max={max}
              value={wagerInput}
              onChange={(e) => setWagerInput(e.target.value)}
            />
            <button
              className="button button--primary"
              onClick={() =>
                submitWager(Math.min(max, Math.max(0, Number(wagerInput) || 0)))
              }
            >
              Готово
            </button>
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
          </div>
        );
      }

      case 'final-answer': {
        if (isHost) {
          return (
            <div className="player player--center">
              <h2>Финал — ответ</h2>
              <p className="board-question">{game.finalQuestion?.text}</p>
              <p>Игроки пишут ответы…</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        const myAnswer = game.finalAnswers?.find(
          (a) => a.participantId === selfId,
        );
        if (myAnswer) {
          return (
            <div className="player player--center">
              <h2>Финал — ответ</h2>
              <p>Ответ принят. Ждём остальных…</p>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
            </div>
          );
        }
        return (
          <div className="player player--center">
            <h2>Финал — ответ</h2>
            <p className="board-question">{game.finalQuestion?.text}</p>
            <label htmlFor="final-answer">Ответ</label>
            <input
              id="final-answer"
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
            />
            <button
              className="button button--primary"
              onClick={() => submitFinalAnswer(answerInput)}
            >
              Готово
            </button>
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
          </div>
        );
      }

      case 'final-judging':
        if (isHost) {
          return (
            <div className="player">
              <h2>Финал — проверка ответов</h2>
              {remainingSeconds !== null && (
                <p className="player-timer">{remainingSeconds}с</p>
              )}
              <p className="player-answer">{game.finalCorrectAnswer?.text}</p>
              {game.finalCorrectAnswer?.comment && (
                <p className="player-comment">
                  {game.finalCorrectAnswer.comment}
                </p>
              )}
              <ul className="final-judging-list">
                {game.finalAnswers?.map((a) => {
                  const wager = game.finalWagers?.find(
                    (w) => w.participantId === a.participantId,
                  )?.amount;
                  return (
                    <li key={a.participantId}>
                      <span className="final-judging-name">
                        {nameOf(a.participantId)}
                      </span>
                      <span className="final-judging-wager">{wager}</span>
                      <span className="final-judging-answer">{a.text}</span>
                      <button
                        className={`button button--yes${myFinalVerdicts[a.participantId] === true ? ' is-selected' : ''}`}
                        onClick={() => {
                          setMyFinalVerdicts((v) => ({
                            ...v,
                            [a.participantId]: true,
                          }));
                          finalVote(a.participantId, true);
                        }}
                      >
                        Верно
                        {myFinalVerdicts[a.participantId] === true && ' ✓'}
                      </button>
                      <button
                        className={`button button--no${myFinalVerdicts[a.participantId] === false ? ' is-selected' : ''}`}
                        onClick={() => {
                          setMyFinalVerdicts((v) => ({
                            ...v,
                            [a.participantId]: false,
                          }));
                          finalVote(a.participantId, false);
                        }}
                      >
                        Неверно
                        {myFinalVerdicts[a.participantId] === false && ' ✓'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }
        return (
          <div className="player player--center">
            <p>Ведущий проверяет ответы…</p>
            {remainingSeconds !== null && (
              <p className="player-timer">{remainingSeconds}с</p>
            )}
          </div>
        );

      case 'final-reveal':
        return (
          <div className="player">
            <h2>Финал — итог</h2>
            <p className="player-answer">{game.finalCorrectAnswer?.text}</p>
            {game.finalCorrectAnswer?.comment && (
              <p className="player-comment">
                {game.finalCorrectAnswer.comment}
              </p>
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
            {scoreboard(game.scores)}
          </div>
        );
    }
  })();

  const isFinalPhase =
    game?.phase === 'final-elim' ||
    game?.phase === 'final-wager' ||
    game?.phase === 'final-answer' ||
    game?.phase === 'final-judging' ||
    game?.phase === 'final-reveal';

  return isHost && !isFinalPhase ? (
    <>
      {phaseContent}
      {hostAdminPanel()}
    </>
  ) : (
    phaseContent
  );
}
