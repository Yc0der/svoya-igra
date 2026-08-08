import { useState } from 'react';
import { useAdminConnection } from './useAdminConnection';
import { START_GAME_ERROR_TEXT } from './errorText';

export function Admin() {
  const {
    connected,
    lanUrl,
    participants,
    hostParticipantId,
    game,
    startGameError,
    startGame,
    resetGame,
    resetRoom,
    kick,
    setHost,
  } = useAdminConnection();
  // «Снести всё» стирает участников, ведущего и партию разом — единственное
  // действие здесь с таким радиусом поражения, поэтому единственное с
  // подтверждением в два клика (design.md, «Админ-панель»). Остальные
  // действия — однокликовые: панель открыта всем на LAN без пароля намеренно
  // (design.md), лишняя защита на каждой кнопке не соответствовала бы этому
  // выбору.
  const [confirmingWipe, setConfirmingWipe] = useState(false);

  function roleOf(participantId: string): string {
    if (game) {
      if (game.hostId === participantId) return 'Ведущий';
      if (game.scores.some((s) => s.participantId === participantId)) {
        return 'Играет';
      }
      return 'Не в партии';
    }
    return hostParticipantId === participantId ? 'Ведущий (лобби)' : '—';
  }

  function scoreOf(participantId: string): number | null {
    return (
      game?.scores.find((s) => s.participantId === participantId)?.score ?? null
    );
  }

  function handleWipe(): void {
    if (!confirmingWipe) {
      setConfirmingWipe(true);
      return;
    }
    resetRoom();
    setConfirmingWipe(false);
  }

  return (
    <div className="admin">
      <h1>Админ-панель</h1>
      <p className="admin-status">
        {connected ? 'Подключено' : 'Переподключение…'}
        {lanUrl && ` · ${lanUrl}`}
      </p>

      <section className="admin-section">
        <h2>Партия</h2>
        <p>
          Фаза: <strong>{game ? game.phase : 'нет партии (лобби)'}</strong>
        </p>
        {startGameError && (
          <p className="player-alert" role="alert">
            {START_GAME_ERROR_TEXT[startGameError]}
          </p>
        )}
        <div className="admin-actions">
          <button className="button button--primary" onClick={startGame}>
            {game && game.phase !== 'game-end'
              ? 'Начать заново'
              : 'Начать игру'}
          </button>
          <button className="button" onClick={resetGame} disabled={!game}>
            Завершить партию (в лобби)
          </button>
          <button
            className={`button button--no${confirmingWipe ? ' is-selected' : ''}`}
            onClick={handleWipe}
            onBlur={() => setConfirmingWipe(false)}
          >
            {confirmingWipe ? 'Точно? Ещё раз, чтобы снести всё' : 'Снести всё'}
          </button>
        </div>
      </section>

      <section className="admin-section">
        <h2>Участники</h2>
        {participants.length === 0 ? (
          <p>Пока никто не подключился.</p>
        ) : (
          <ul className="admin-participants">
            {participants.map((p) => {
              const score = scoreOf(p.id);
              const isLobbyHost = hostParticipantId === p.id;
              return (
                <li key={p.id} className={p.connected ? '' : 'is-disconnected'}>
                  <span className="admin-participant-name">{p.name}</span>
                  <span className="admin-participant-status">
                    {p.connected ? 'онлайн' : 'офлайн'}
                  </span>
                  <span className="admin-participant-role">
                    {roleOf(p.id)}
                    {score !== null && ` (${score})`}
                  </span>
                  <button
                    className="button host-admin-step"
                    onClick={() => setHost(isLobbyHost ? null : p.id)}
                  >
                    {isLobbyHost ? 'Снять ведущего' : 'Сделать ведущим'}
                  </button>
                  <button
                    className="button button--no host-admin-step"
                    onClick={() => kick(p.id)}
                  >
                    Кикнуть
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
