import { useEffect, useState } from 'react';
import { useAdminConnection } from './useAdminConnection';
import type { Question } from './useAdminConnection';
import type { GameStateView } from './useRoomConnection';
import { START_GAME_ERROR_TEXT } from './errorText';

// ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в
// server/src/engine.ts. Те же фазы, при которых сам движок игнорирует
// skip-to-final как no-op — дублируется здесь только чтобы не включать
// кнопку без надобности, финальную проверку всё равно делает сервер.
const FINAL_PHASES = new Set<GameStateView['phase']>([
  'final-elim',
  'final-wager',
  'final-answer',
  'final-judging',
  'final-reveal',
  'game-end',
]);

export function Admin() {
  const {
    connected,
    lanUrl,
    lanCandidates,
    participants,
    hostParticipantId,
    game,
    startGameError,
    startGame,
    resetGame,
    resetRoom,
    kick,
    setHost,
    skipToFinal,
    setLanAddress,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks,
    selectPack,
    editedPack,
    editedPackFilename,
    editedPackError,
    getPack,
    updateQuestion,
    deleteQuestion,
  } = useAdminConnection();
  // «Снести всё» стирает участников, ведущего и партию разом — единственное
  // действие здесь с таким радиусом поражения, поэтому единственное с
  // подтверждением в два клика (design.md, «Админ-панель»). Остальные
  // действия — однокликовые: панель открыта всем на LAN без пароля намеренно
  // (design.md), лишняя защита на каждой кнопке не соответствовала бы этому
  // выбору.
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  // Режим редактора: какой файл сейчас открыт (null — обычный список
  // пакетов), какой вопрос открыт формой, и текущие значения формы —
  // отдельные строковые поля, а не готовые number/enum: значение в инпуте
  // цены должно оставаться редактируемым текстом (в том числе временно
  // невалидным, «0» или пустым), пока не нажали «Сохранить».
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  );
  const [formPrice, setFormPrice] = useState('');
  const [formText, setFormText] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formComment, setFormComment] = useState('');
  const [formType, setFormType] = useState<Question['type']>('обычный');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (editingFilename) getPack(editingFilename);
    // Смена файла — закрыть открытую форму вопроса предыдущего пакета.
    setEditingQuestionId(null);
  }, [editingFilename]);

  function openQuestionForm(question: Question): void {
    setEditingQuestionId(question.id);
    setFormPrice(String(question.price));
    setFormText(question.text);
    setFormAnswer(question.answer);
    setFormComment(question.comment ?? '');
    setFormType(question.type);
    setConfirmingDelete(false);
  }

  function handleSaveQuestion(): void {
    if (!editingFilename || !editingQuestionId) return;
    updateQuestion(editingFilename, editingQuestionId, {
      price: Number(formPrice),
      text: formText,
      answer: formAnswer,
      comment: formComment.trim() === '' ? undefined : formComment,
      questionType: formType,
    });
  }

  function handleDeleteQuestion(): void {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    if (editingFilename && editingQuestionId) {
      deleteQuestion(editingFilename, editingQuestionId);
    }
    setConfirmingDelete(false);
  }

  // Те же границы, что проверяет сервер (packs.ts, validatePack/
  // validateQuestion): цена — положительное число, текст и ответ — не
  // пустые строки. Без этой проверки кнопка «Сохранить» всегда кликабельна,
  // а недопустимое значение молча улетает в admin-pack-error — тот же
  // принцип, что уже применён к форме ставки в аукционе (Player.tsx).
  const parsedFormPrice = Number(formPrice);
  const isValidForm =
    Number.isFinite(parsedFormPrice) &&
    Number.isInteger(parsedFormPrice) &&
    parsedFormPrice > 0 &&
    formText.trim() !== '' &&
    formAnswer.trim() !== '';

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

  // Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — сервер сам
  // не знает, какой адаптер настоящий, и угадывает первый попавшийся; тут
  // человек видит все найденные и выбирает сам. Сравнение по hostname, а не
  // по вхождению строки — «192.168.1.1» не должен считаться выбранным из-за
  // «192.168.1.10».
  function isSelectedAddress(address: string): boolean {
    return lanUrl !== null && new URL(lanUrl).hostname === address;
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
        <h2>Сеть</h2>
        {lanCandidates.length === 0 ? (
          <p>
            Сетевые адреса не найдены — игра доступна только с этого устройства.
          </p>
        ) : (
          <ul className="admin-lan-candidates">
            {lanCandidates.map((c) => {
              const selected = isSelectedAddress(c.address);
              return (
                <li key={c.address}>
                  <button
                    className={`button${selected ? ' is-selected' : ''}`}
                    onClick={() => setLanAddress(c.address)}
                    disabled={selected}
                  >
                    {c.address} ({c.interfaceName})
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="admin-section">
        <h2>Пакет</h2>
        {selectPackError && (
          <p className="player-alert" role="alert">
            Не удалось выбрать пакет — файл стал невалиден или исчез.
          </p>
        )}
        {editingFilename === null ? (
          <>
            <div className="admin-actions">
              <button className="button" onClick={refreshPacks}>
                Обновить
              </button>
            </div>
            {availablePacks.length === 0 ? (
              <p>
                Пакеты не найдены — положите файлы в packs/ и нажмите
                «Обновить».
              </p>
            ) : (
              <ul className="admin-packs">
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
                      <button
                        className="button"
                        onClick={() => setEditingFilename(p.filename)}
                      >
                        Редактировать
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <div className="pack-editor">
            <div className="admin-actions">
              <button
                className="button"
                onClick={() => setEditingFilename(null)}
              >
                Готово
              </button>
            </div>
            {editedPackFilename === editingFilename && editedPack ? (
              <>
                {editedPack.rounds.map((round, ri) => (
                  <div key={ri} className="pack-editor-round">
                    <h3>Раунд {ri + 1}</h3>
                    {round.themes.map((theme, ti) => (
                      <div key={ti} className="pack-editor-theme">
                        <span className="pack-editor-theme-name">
                          {theme.name}
                        </span>
                        {theme.questions.map((q) => (
                          <button
                            key={q.id}
                            className="button"
                            onClick={() => openQuestionForm(q)}
                          >
                            {q.price}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                {editingQuestionId && (
                  <div className="pack-editor-form">
                    {editedPackError && (
                      <p className="player-alert" role="alert">
                        {editedPackError}
                      </p>
                    )}
                    <label htmlFor="pack-editor-price">Цена</label>
                    <input
                      id="pack-editor-price"
                      type="number"
                      value={formPrice}
                      onChange={(e) => setFormPrice(e.target.value)}
                    />
                    <label htmlFor="pack-editor-text">Текст</label>
                    <textarea
                      id="pack-editor-text"
                      value={formText}
                      onChange={(e) => setFormText(e.target.value)}
                    />
                    <label htmlFor="pack-editor-answer">Ответ</label>
                    <textarea
                      id="pack-editor-answer"
                      value={formAnswer}
                      onChange={(e) => setFormAnswer(e.target.value)}
                    />
                    <label htmlFor="pack-editor-comment">
                      Комментарий (необязательно)
                    </label>
                    <textarea
                      id="pack-editor-comment"
                      value={formComment}
                      onChange={(e) => setFormComment(e.target.value)}
                    />
                    <label htmlFor="pack-editor-type">Тип</label>
                    <select
                      id="pack-editor-type"
                      value={formType}
                      onChange={(e) =>
                        setFormType(e.target.value as Question['type'])
                      }
                    >
                      <option value="обычный">обычный</option>
                      <option value="кот">кот</option>
                      <option value="аукцион">аукцион</option>
                    </select>
                    <div className="admin-actions">
                      <button
                        className="button button--primary"
                        onClick={handleSaveQuestion}
                        disabled={!isValidForm}
                      >
                        Сохранить
                      </button>
                      <button
                        className={`button button--no${confirmingDelete ? ' is-selected' : ''}`}
                        onClick={handleDeleteQuestion}
                        onBlur={() => setConfirmingDelete(false)}
                      >
                        {confirmingDelete ? 'Точно?' : 'Удалить'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p>Загрузка…</p>
            )}
          </div>
        )}
      </section>

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
          {/* ВРЕМЕННО, для ручного тестирования финала — см. комментарий у
              EngineEvent.skip-to-final в server/src/engine.ts. Убрать вместе
              с остальными skip-to-final местами после живой проверки финала. */}
          <button
            className="button"
            onClick={skipToFinal}
            disabled={!game || FINAL_PHASES.has(game.phase)}
          >
            Перейти к финалу (тест)
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
