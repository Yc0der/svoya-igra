import { useEffect, useRef, useState } from 'react';
import { useAdminConnection } from './useAdminConnection';
import type { Question } from './useAdminConnection';
import type { GameStateView } from './useRoomConnection';
import { START_GAME_ERROR_TEXT } from './errorText';

// Те же области, что в бланке docs/anketa.html: форма правки обязана
// предлагать их все, даже если в анкете человека часть пустая — иначе
// заполнить пропущенное можно было бы только новым кодом с телефона.
const CARD_AREAS = [
  'Кино и сериалы',
  'Музыка',
  'Спорт',
  'Книги',
  'Игры',
  'Еда и путешествия',
  'Увлечения и работа',
];

// Значения одной области человек вводит через запятую — ровно так же, как
// они лежат в файле после рендера раздела.
function splitValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

// «1 партия», «4 партии», «5 партий» — число идёт в текст подтверждения
// удаления, и «4 партий» там читалось бы как небрежность ровно в том месте,
// где человек решает, стирать ли данные живого человека.
function gamesWord(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return 'партий';
  const ones = count % 10;
  if (ones === 1) return 'партия';
  if (ones >= 2 && ones <= 4) return 'партии';
  return 'партий';
}

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
    textRevealWordsPerSecond,
    setTextRevealWordsPerSecond,
    textRevealEnabled,
    setTextRevealEnabled,
    textRevealFadeMs,
    setTextRevealFadeMs,
    historyEnabled,
    setHistoryEnabled,
    historyRecording,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks,
    selectPack,
    editedPack,
    editedPackFilename,
    editedPackError,
    editedPackVersion,
    clearPackError,
    resetPackEditor,
    getPack,
    updateQuestion,
    deleteQuestion,
    reportError,
    reportAckVersion,
    clearReportError,
    reportQuestion,
    players,
    playerError,
    playerConflictName,
    playerCard,
    clearPlayerFeedback,
    savePlayer,
    getPlayer,
    clearPlayerCard,
    deletePlayerCard,
    people,
    peopleError,
    clearPeopleError,
    mergePeople,
  } = useAdminConnection();
  // «Снести всё» стирает участников, ведущего и партию разом — единственное
  // действие здесь с таким радиусом поражения, поэтому единственное с
  // подтверждением в два клика (design.md, «Админ-панель»). Остальные
  // действия — однокликовые: панель открыта всем на LAN без пароля намеренно
  // (design.md), лишняя защита на каждой кнопке не соответствовала бы этому
  // выбору.
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  // Поле с кодом анкеты — успешное сохранение его намеренно не чистит:
  // ведущий вставляет анкеты подряд и сам видит, что список пополнился
  // (задача 3, sdd/2026-08-26-player-questionnaire).
  const [playerCode, setPlayerCode] = useState('');
  // Правка анкеты: имя, под которым она лежит в файле сейчас (оно же
  // originalName при сохранении), и заполненная форма. Форма отдельным
  // состоянием, а не выводится из playerCard на каждый рендер: иначе
  // очередной ответ сервера затирал бы то, что ведущий уже набрал.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [cardForm, setCardForm] = useState<{
    name: string;
    areas: Record<string, string>;
    boring: string;
  } | null>(null);
  // Удаление необратимо и уносит человека целиком, вместе с историей партий,
  // — отдельный диалог, а не перелейбл кнопки: в тексте обязано быть видно,
  // что именно исчезнет (спека анкет, «Удаление — человек целиком»).
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // Анкета пришла — заполняем форму. Зависимости ровно две: пока ведущий
  // правит, ни имя, ни ответ сервера не меняются, и эффект не перезапустится
  // поверх набранного.
  useEffect(() => {
    if (editingName === null || playerCard === null) return;
    const areas: Record<string, string> = {};
    for (const area of CARD_AREAS) areas[area] = '';
    for (const interest of playerCard.card.interests) {
      areas[interest.area] = interest.examples.join(', ');
    }
    setCardForm({
      name: playerCard.card.name,
      areas,
      boring: playerCard.card.boring.join(', '),
    });
  }, [editingName, playerCard]);

  function closeCardForm(): void {
    setEditingName(null);
    setCardForm(null);
    clearPlayerCard();
  }

  function saveCardForm(): void {
    if (cardForm === null || editingName === null) return;
    const interests = Object.entries(cardForm.areas)
      .map(([area, value]) => ({ area, examples: splitValues(value) }))
      .filter((interest) => interest.examples.length > 0);
    savePlayer(
      JSON.stringify({
        version: 1,
        name: cardForm.name.trim(),
        interests,
        boring: splitValues(cardForm.boring),
      }),
      // Правка своей же анкеты — замена по определению: подтверждать её
      // ведущему нечего, он уже нажал «Редактировать» именно на ней.
      true,
      editingName,
    );
    closeCardForm();
  }

  // Слияние профилей (задача 4, sdd/2026-08-26-player-identity) — id как
  // строка, потому что это значение <select>; '' — ничего не выбрано.
  const [mergeFromId, setMergeFromId] = useState('');
  const [mergeIntoId, setMergeIntoId] = useState('');
  // Операция необратима — тот же принцип, что confirmingWipe/confirmingDelete
  // выше, но с отдельным диалогом (а не перелейблом кнопки): в тексте
  // подтверждения обязано быть видно, какое имя останется, а какое исчезнет
  // (design.md, «Слияние профилей»), а не только «точно?».
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  // ВРЕМЕННО — подбор скорости показа текста вопроса вживую, см.
  // server/src/protocol.ts, StateMessage.textRevealWordsPerSecond. Убрать
  // вместе с полем, как только число зафиксируется в спеке.
  const [textRevealRateInput, setTextRevealRateInput] = useState('2.5');
  // ВРЕМЕННО — подбор длительности проявления буквы вживую, см.
  // server/src/protocol.ts, StateMessage.textRevealFadeMs. Убрать вместе с
  // полем, как только число зафиксируется в спеке.
  const [textRevealFadeInput, setTextRevealFadeInput] = useState('270');
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
  // Вид редактора: 'list' по умолчанию — беглый просмотр запрошен как
  // основной сценарий входа (design.md, 2026-08-15).
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [complainingQuestionId, setComplainingQuestionId] = useState<
    string | null
  >(null);
  const [complaintText, setComplaintText] = useState('');
  // Тот же приём, что pendingSaveVersionRef у формы правки: версия
  // reportAckVersion, зафиксированная в момент клика «Отправить» — эффект
  // ниже закрывает панель жалобы только когда пришёл ack именно на эту
  // жалобу, не на чужую (см. openComplaintPanel/handleSubmitComplaint).
  const pendingReportVersionRef = useRef<number | null>(null);
  // editedPackVersion, зафиксированный в момент клика «Сохранить» — см.
  // эффект ниже, который закрывает форму, когда версия ушла вперёд (сервер
  // прислал новый admin-pack в ответ именно на этот save), но оставляет её
  // открытой при admin-pack-error (версия не меняется). null — нет
  // незавершённого save, чтобы этот эффект не реагировал на чужие обновления
  // пакета (первичная загрузка, фоновое обновление, save другого вопроса).
  const pendingSaveVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingFilename) getPack(editingFilename);
    // Смена файла — закрыть открытую форму вопроса предыдущего пакета.
    setEditingQuestionId(null);
  }, [editingFilename]);

  // Fix 2 (Веха A, финальное ревью): успешный save не даёт иного видимого
  // сигнала, кроме нового admin-pack — закрываем форму, когда видим версию
  // старше зафиксированной в handleSaveQuestion.
  useEffect(() => {
    if (
      pendingSaveVersionRef.current !== null &&
      editedPackVersion > pendingSaveVersionRef.current
    ) {
      pendingSaveVersionRef.current = null;
      setEditingQuestionId(null);
    }
  }, [editedPackVersion]);

  useEffect(() => {
    if (
      pendingReportVersionRef.current !== null &&
      reportAckVersion > pendingReportVersionRef.current
    ) {
      pendingReportVersionRef.current = null;
      setComplainingQuestionId(null);
      setComplaintText('');
    }
  }, [reportAckVersion]);

  function openQuestionForm(question: Question): void {
    setEditingQuestionId(question.id);
    setFormPrice(String(question.price));
    setFormText(question.text);
    setFormAnswer(question.answer);
    setFormComment(question.comment ?? '');
    setFormType(question.type);
    setConfirmingDelete(false);
    // Fix 3 — не тащить ошибку от предыдущего открытого вопроса в форму
    // другого.
    clearPackError();
    // Открытие другого вопроса делает эту ссылку неактуальной — иначе
    // отложенный ответ на save прежнего вопроса мог бы закрыть форму того,
    // который открыли только что.
    pendingSaveVersionRef.current = null;
    // Форма правки и панель жалобы взаимоисключающие — открытие одной
    // закрывает другую (design.md, «Правило»).
    setComplainingQuestionId(null);
  }

  function openComplaintPanel(questionId: string): void {
    setComplainingQuestionId(questionId);
    setComplaintText('');
    clearReportError();
    pendingReportVersionRef.current = null;
    // Симметрично openQuestionForm — открытие панели жалобы закрывает
    // форму правки, если та была открыта.
    setEditingQuestionId(null);
  }

  function handleSubmitComplaint(): void {
    if (!editingFilename || !complainingQuestionId) return;
    pendingReportVersionRef.current = reportAckVersion;
    reportQuestion(editingFilename, complainingQuestionId, complaintText);
  }

  function handleViewModeChange(mode: 'grid' | 'list'): void {
    setViewMode(mode);
    // Переключение вида закрывает любую открытую панель — «Пожаловаться»
    // существует только в списке, а форма правки закрывается для
    // симметрии, чтобы переключение вида было предсказуемым «чистым»
    // действием в обе стороны (design.md, «Правило»).
    setEditingQuestionId(null);
    setComplainingQuestionId(null);
  }

  const isValidComplaint = complaintText.trim() !== '';

  function handleSaveQuestion(): void {
    if (!editingFilename || !editingQuestionId) return;
    pendingSaveVersionRef.current = editedPackVersion;
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

  // Закрывает форму без сохранения — поля формы (formPrice/formText/...)
  // держат несохранённый черновик до клика «Сохранить»; без этой кнопки
  // единственный выход из формы либо сохраняет черновик, либо требует
  // закрыть весь редактор пакета целиком (design.md обратной связи,
  // 2026-08-17).
  function handleCancelEdit(): void {
    setEditingQuestionId(null);
    setConfirmingDelete(false);
    clearPackError();
  }

  // Fix 1 (Веха A, финальное ревью) — форма держится открытой не только по
  // editingQuestionId, а по тому, что вопрос с этим id всё ещё есть в
  // editedPack: после успешного delete сервер шлёт новый пакет без этого
  // вопроса, и форма должна закрыться сама, а не показывать значения уже
  // не существующего вопроса. При admin-pack-error (напр. «нельзя удалить
  // последний вопрос в теме») editedPack не меняется, вопрос никуда не
  // делся, и форма остаётся открытой с ошибкой — как и раньше.
  const questionStillExists =
    editingQuestionId !== null &&
    editedPack !== null &&
    editedPack.rounds.some((round) =>
      round.themes.some((theme) =>
        theme.questions.some((q) => q.id === editingQuestionId),
      ),
    );

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

  const mergeFromPerson = people.find((p) => String(p.id) === mergeFromId);
  const mergeIntoPerson = people.find((p) => String(p.id) === mergeIntoId);

  function handleConfirmMerge(): void {
    if (!mergeFromPerson || !mergeIntoPerson) return;
    mergePeople(mergeFromPerson.id, mergeIntoPerson.id);
    setConfirmingMerge(false);
    setMergeFromId('');
    setMergeIntoId('');
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

      {/* ВРЕМЕННО — подбор скорости показа текста вопроса вживую, см.
        server/src/protocol.ts, StateMessage.textRevealWordsPerSecond.
        Убрать секцию целиком, как только число зафиксируется в спеке. */}
      <section className="admin-section">
        <h2>Скорость показа текста (временно)</h2>
        <p>
          <label>
            <input
              type="checkbox"
              checked={textRevealEnabled}
              onChange={(e) => setTextRevealEnabled(e.target.checked)}
            />{' '}
            Постепенный показ включён
          </label>
        </p>
        <p>
          Сейчас: {textRevealWordsPerSecond.toFixed(1)} слов/сек. Пока включено,
          обычный текстовый вопрос показывается на табло по буквам в темпе этой
          скорости чтения, прежде чем открывается кнопка «Ответ». Выключено —
          вопрос открывается сразу целиком, как раньше.
        </p>
        <input
          type="number"
          aria-label="Скорость показа текста, слов в секунду"
          min={0.1}
          step={0.1}
          value={textRevealRateInput}
          onChange={(e) => setTextRevealRateInput(e.target.value)}
        />
        <button
          className="button"
          onClick={() => {
            const rate = Number(textRevealRateInput);
            if (Number.isFinite(rate) && rate > 0) {
              setTextRevealWordsPerSecond(rate);
            }
          }}
        >
          Применить
        </button>
      </section>

      {/* ВРЕМЕННО — подбор длительности проявления буквы вживую, см.
        server/src/protocol.ts, StateMessage.textRevealFadeMs.
        Убрать секцию целиком, как только число зафиксируется в спеке. */}
      <section className="admin-section">
        <h2>Проявление буквы на табло (временно)</h2>
        <p>
          Каждая буква вопроса на табло не возникает мгновенно, а плавно
          проявляется — это время одного такого проявления, в миллисекундах. Чем
          меньше число, тем резче видна буква; 0 — буква возникает мгновенно,
          без проявления. Судить о значении стоит по настоящему табло, а не по
          этому экрану: с телевизора за несколько метров резкость видна иначе,
          чем на мониторе рядом.
        </p>
        <p>Сейчас: {textRevealFadeMs} мс.</p>
        <input
          type="number"
          aria-label="Длительность проявления буквы, мс"
          min={0}
          max={1000}
          step={10}
          value={textRevealFadeInput}
          onChange={(e) => setTextRevealFadeInput(e.target.value)}
        />
        <button
          className="button"
          onClick={() => {
            const fadeMs = Number(textRevealFadeInput);
            if (Number.isFinite(fadeMs) && fadeMs >= 0) {
              setTextRevealFadeMs(fadeMs);
            }
          }}
        >
          Применить
        </button>
      </section>

      <section className="admin-section">
        <h2>История партий</h2>
        <p>
          <label>
            <input
              type="checkbox"
              // Пока партия не идёт, чекбокс отражает намерение на
              // следующую (historyEnabled). Когда партия уже идёт — честный
              // ответ только один: пишется ли она прямо сейчас
              // (historyRecording), а не то, что стоит в тумблере. Они
              // расходятся именно после «выключил → включил обратно»
              // посреди партии — иначе галочка стояла бы, а в историю не
              // попадало бы ничего (финальное ревью ветки, п. 2).
              checked={game === null ? historyEnabled : historyRecording}
              onChange={(e) => setHistoryEnabled(e.target.checked)}
            />{' '}
            Записывать эту партию в историю
          </label>
        </p>
        <p>
          Сыгранные вопросы попадают в историю, и генератор пакетов перестаёт их
          повторять. Выключить стоит перед тестовым прогоном: выключение не
          просто останавливает запись, а выбрасывает всё, что эта партия уже
          успела записать. Обратно включить в той же партии нельзя — она уже
          выброшена.
        </p>
        {game !== null && historyEnabled && !historyRecording && (
          <p className="player-alert" role="alert">
            Эта партия уже выброшена из истории — тумблер включён, но ничего не
            пишется. Обратно её не вернуть; следующая партия начнёт писаться
            заново.
          </p>
        )}
      </section>

      <section className="admin-section">
        <h2>Анкеты игроков</h2>
        <p className="admin-hint">
          Отправь друзьям <code>docs/anketa.html</code>, а присланный код вставь
          сюда. Заполнять необязательно — пришедший без анкеты играет наравне со
          всеми. Кому неудобно открывать файл на телефоне (обычно это айфон) —
          пришли картинки из <code>docs/anketa-screens/</code>: он ответит
          сообщением, а анкету за него заполнишь здесь ты сам.
        </p>
        <textarea
          className="admin-player-code"
          rows={4}
          value={playerCode}
          onChange={(e) => {
            setPlayerCode(e.target.value);
            clearPlayerFeedback();
          }}
          placeholder="Вставь код анкеты"
        />
        <div className="admin-actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => savePlayer(playerCode, false)}
            disabled={playerCode.trim() === ''}
          >
            Сохранить анкету
          </button>
        </div>
        {playerConflictName && (
          <div className="admin-player-conflict">
            <p>Игрок «{playerConflictName}» уже есть. Заменить его анкету?</p>
            <div className="admin-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => savePlayer(playerCode, true)}
              >
                Заменить
              </button>
              <button
                type="button"
                className="button"
                onClick={clearPlayerFeedback}
              >
                Отмена
              </button>
            </div>
          </div>
        )}
        {playerError && (
          <p className="admin-error" role="alert">
            {playerError}
          </p>
        )}
        {players.length === 0 ? (
          <p className="admin-hint">Анкет пока нет.</p>
        ) : (
          <ul className="admin-players">
            {players.map((player) => (
              <li key={player.name}>
                <span className="admin-player-name">{player.name}</span>
                {player.date && (
                  <span className="admin-player-date">от {player.date}</span>
                )}
                <span className="admin-actions">
                  <button
                    type="button"
                    className="button"
                    aria-label={`Редактировать анкету: ${player.name}`}
                    onClick={() => {
                      setDeletingName(null);
                      setEditingName(player.name);
                      getPlayer(player.name);
                    }}
                  >
                    Редактировать
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Удалить анкету: ${player.name}`}
                    onClick={() => {
                      closeCardForm();
                      setDeletingName(player.name);
                    }}
                  >
                    Удалить
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {editingName !== null && cardForm !== null && (
          <div className="admin-player-form">
            <h3>Правка анкеты</h3>
            {playerCard !== null && playerCard.extraLines.length > 0 && (
              <p className="admin-hint">
                В анкете есть строки не из формы — они сохранятся как есть,
                править их можно только в файле.
              </p>
            )}
            <label htmlFor="card-name">Имя</label>
            <input
              id="card-name"
              type="text"
              value={cardForm.name}
              onChange={(e) =>
                setCardForm({ ...cardForm, name: e.target.value })
              }
            />
            {Object.keys(cardForm.areas).map((area) => (
              <div key={area}>
                <label htmlFor={`card-area-${area}`}>{area}</label>
                <input
                  id={`card-area-${area}`}
                  type="text"
                  value={cardForm.areas[area]}
                  onChange={(e) =>
                    setCardForm({
                      ...cardForm,
                      areas: { ...cardForm.areas, [area]: e.target.value },
                    })
                  }
                />
              </div>
            ))}
            <label htmlFor="card-boring">Скучно</label>
            <input
              id="card-boring"
              type="text"
              value={cardForm.boring}
              onChange={(e) =>
                setCardForm({ ...cardForm, boring: e.target.value })
              }
            />
            <div className="admin-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={saveCardForm}
                disabled={cardForm.name.trim() === ''}
              >
                Сохранить правку
              </button>
              <button type="button" className="button" onClick={closeCardForm}>
                Отменить правку
              </button>
            </div>
          </div>
        )}

        {deletingName !== null && (
          <div className="admin-player-conflict">
            <p>
              Удалить «{deletingName}» полностью?{' '}
              {(players.find((player) => player.name === deletingName)?.games ??
                0) > 0
                ? `Исчезнет анкета и всё, что о нём знает история партий: ${
                    players.find((player) => player.name === deletingName)
                      ?.games ?? 0
                  } ${gamesWord(
                    players.find((player) => player.name === deletingName)
                      ?.games ?? 0,
                  )}.`
                : 'Исчезнет анкета. В истории партий записей под этим именем нет — если человек играл под другим, сначала слей профили ниже.'}{' '}
              Сыгранные вопросы и статистика паков останутся: они обезличены.
            </p>
            <div className="admin-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDeletingName(null)}
              >
                Не удалять
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  deletePlayerCard(deletingName);
                  setDeletingName(null);
                }}
              >
                Удалить навсегда
              </button>
            </div>
          </div>
        )}

        <h3>Один и тот же человек</h3>
        <p className="admin-hint">
          Это про историю, а не про стол: если один и тот же человек в разных
          партиях назвался по-разному, его записи сводятся в одну. Участников
          слияние не трогает — лишнего за столом убирают кнопкой «Кикнуть» в
          разделе «Участники» ниже. Необратимо: направление указываешь ты,
          лишняя запись исчезает совсем. Пока идёт партия, слияние недоступно.
        </p>
        <div className="admin-merge-people">
          <label htmlFor="merge-from-id">Кого слить</label>
          <select
            id="merge-from-id"
            value={mergeFromId}
            onChange={(e) => {
              setMergeFromId(e.target.value);
              setConfirmingMerge(false);
              // Финальное ревью ветки, п. 7: отказ слияния («нельзя сливать
              // игроков, пока идёт партия») не должен пережить смену выбора
              // — иначе он висит красным всю партию, хотя ведущий уже
              // переключился на другую пару.
              clearPeopleError();
            }}
          >
            <option value="">— выбери —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.games})
              </option>
            ))}
          </select>
          <label htmlFor="merge-into-id">В кого</label>
          <select
            id="merge-into-id"
            value={mergeIntoId}
            onChange={(e) => {
              setMergeIntoId(e.target.value);
              setConfirmingMerge(false);
              clearPeopleError();
            }}
          >
            <option value="">— выбери —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.games})
              </option>
            ))}
          </select>
          <div className="admin-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={
                mergeFromId === '' ||
                mergeIntoId === '' ||
                mergeFromId === mergeIntoId
              }
              onClick={() => setConfirmingMerge(true)}
            >
              Слить
            </button>
          </div>
        </div>
        {confirmingMerge && mergeFromPerson && mergeIntoPerson && (
          <div className="admin-player-conflict">
            <p>
              Останется «{mergeIntoPerson.name}» — «{mergeFromPerson.name}»
              исчезнет безвозвратно.
            </p>
            <div className="admin-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={handleConfirmMerge}
              >
                Подтвердить
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirmingMerge(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        )}
        {peopleError && (
          <p className="admin-error" role="alert">
            {peopleError}
          </p>
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
              <button
                className="button"
                onClick={() => setEditingFilename(activePackFilename)}
                disabled={activePackFilename === null}
              >
                Редактировать
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
                onClick={() => {
                  setEditingFilename(null);
                  // Fix 6 — не тащить содержимое этого пакета в следующее
                  // открытие редактора: без сброса до ответа сервера мог бы
                  // мелькнуть старый пакет.
                  resetPackEditor();
                }}
              >
                Готово
              </button>
            </div>
            {editedPackError && (
              <p className="player-alert" role="alert">
                {editedPackError}
              </p>
            )}
            {editedPackFilename === editingFilename && editedPack ? (
              <>
                <div
                  className="pack-editor-view-toggle"
                  role="radiogroup"
                  aria-label="Вид редактора"
                >
                  <label>
                    <input
                      type="radio"
                      name="pack-editor-view"
                      checked={viewMode === 'list'}
                      onChange={() => handleViewModeChange('list')}
                    />
                    Список
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pack-editor-view"
                      checked={viewMode === 'grid'}
                      onChange={() => handleViewModeChange('grid')}
                    />
                    Сетка
                  </label>
                </div>
                {editedPack.rounds.map((round, ri) => (
                  <div key={ri} className="pack-editor-round">
                    <h3>Раунд {ri + 1}</h3>
                    {round.themes.map((theme, ti) => (
                      <div key={ti} className="pack-editor-theme">
                        <span className="pack-editor-theme-name">
                          {theme.name}
                        </span>
                        {viewMode === 'grid' ? (
                          theme.questions.map((q) => (
                            <button
                              key={q.id}
                              className="button"
                              onClick={() => openQuestionForm(q)}
                            >
                              {q.price}
                            </button>
                          ))
                        ) : (
                          <ul className="pack-editor-list">
                            {theme.questions.map((q) => (
                              <li key={q.id} className="pack-editor-list-row">
                                <div className="pack-editor-list-row-main">
                                  <button
                                    className="button pack-editor-list-question"
                                    onClick={() => openQuestionForm(q)}
                                  >
                                    <span className="pack-editor-list-price">
                                      {q.price}
                                    </span>
                                    <span className="pack-editor-list-text">
                                      {q.text}
                                    </span>
                                  </button>
                                  <button
                                    className="button"
                                    onClick={() => openComplaintPanel(q.id)}
                                  >
                                    Пожаловаться
                                  </button>
                                </div>
                                {/* Fix 1/2 (финальное ревью) — панель жалобы
                                    рендерится прямо внутри строки того
                                    вопроса, на который жалуются: на реальном
                                    паке (много вопросов) панель, отрисованная
                                    после всего editedPack.rounds.map(...),
                                    открывалась на тысячи пикселей ниже
                                    видимой области и выглядела как
                                    «ничего не произошло». complainingQuestionId
                                    гарантирует, что открыта не больше одной
                                    панели одновременно — единственный путь
                                    рендера, без дублирования внизу редактора. */}
                                {complainingQuestionId === q.id && (
                                  <div className="pack-editor-complaint">
                                    <p className="pack-editor-complaint-target">
                                      «{q.price} — {q.text}»
                                    </p>
                                    {reportError && (
                                      <p className="player-alert" role="alert">
                                        {reportError}
                                      </p>
                                    )}
                                    <label htmlFor="pack-editor-complaint-text">
                                      Что не понравилось
                                    </label>
                                    <textarea
                                      id="pack-editor-complaint-text"
                                      value={complaintText}
                                      onChange={(e) =>
                                        setComplaintText(e.target.value)
                                      }
                                    />
                                    <div className="admin-actions">
                                      <button
                                        className="button button--primary"
                                        onClick={handleSubmitComplaint}
                                        disabled={!isValidComplaint}
                                      >
                                        Отправить
                                      </button>
                                      <button
                                        className="button"
                                        onClick={() =>
                                          setComplainingQuestionId(null)
                                        }
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {questionStillExists && (
                  <div className="pack-editor-form">
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
                      <button className="button" onClick={handleCancelEdit}>
                        Отменить изменения
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
