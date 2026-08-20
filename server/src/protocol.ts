import type { Phase } from './engine.js';
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
import type { Pack, Question } from './pack.js';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase: Phase;
  // Замороженный на время партии ведущий, НЕ то же самое, что лобби-флаг
  // StateMessage.hostParticipantId (см. Room.toGameStateView).
  hostId: string | null;
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  // text — null только во время cat-handoff (см. Room.toGameStateView): цена
  // и тема не секрет (видны на сетке ещё до выбора вопроса), скрывается
  // только текст, пока получатель не назначен.
  currentQuestion: {
    // Стабильный id вопроса из пакета (инвариант 3). Табло возвращает его в
    // media-finished — так опоздавший сигнал по прошлому вопросу не оборвёт
    // клип следующего.
    id: string;
    text: string | null;
    price: number;
    themeName: string;
    // Готовый относительный URL картинки (`/media/<пак>/<файл>`) или null,
    // если у вопроса нет картинки. Та же видимость, что у text — null во
    // время cat-handoff/торгов, пока получатель/победитель ещё не
    // определён (design.md, 2026-08-16, «Сервер и клиент»).
    image: string | null;
    // Тот же принцип видимости, что у image/text — null во время
    // cat-handoff/торгов аукциона, иначе объект с youtubeId/таймкодом или
    // null, если у вопроса нет video (design.md,
    // 2026-08-18-video-questions-design.md, «Сервер и клиент»). audioOnly
    // здесь уже разрешён (false, если в паке отсутствовал) — клиенту не
    // нужно самому обрабатывать undefined.
    video: {
      youtubeId: string;
      startSeconds: number;
      durationSeconds: number;
      audioOnly: boolean;
    } | null;
    // Сколько всего мс займёт постепенный показ текущего вопроса — не null
    // только в фазе question-reveal (design.md,
    // 2026-08-19-gradual-text-reveal-design.md, «Сервер и клиент»). Табло
    // считает по нему и timerDeadline, сколько слов уже показывать, без
    // своего независимого отсчёта.
    revealMs: number | null;
  } | null;
  buzzedParticipantId: string | null;
  // Не null только пока фаза — question-open/buzzed/judging для вопроса,
  // требующего эксклюзивного права ответа («кот» или «аукцион») —
  // единственный, кому в этом состоянии можно жать «Ответ» (design.md обеих
  // вех: 2026-08-12-cat-in-bag-design.md, 2026-08-13-auction-design.md,
  // «Рефакторинг вехи 4»).
  exclusiveAnswererParticipantId: string | null;
  // Чей сейчас ход в торгах по вопросу-аукциону; null вне auction-bidding.
  auctionTurnParticipantId: string | null;
  // Текущая наивысшая ставка — null, пока торги не идут (auctionOrder на
  // движке ещё/уже пуст), не 0: 0 — валидная ставка внутри самих торгов.
  auctionHighestBid: number | null;
  auctionHighestBidderParticipantId: string | null;
  // Кто уже спасовал в текущем раунде торгов — null вне auction-bidding, по
  // тому же принципу, что auctionHighestBid выше.
  auctionPassedParticipantIds: string[] | null;
  // На judging непустой только для одного получателя за раз: при
  // hostParticipantId === null — для всех (двое, открытое судейство), иначе
  // — только для сокета с этим participantId (см. Room.toGameStateView).
  correctAnswer: { text: string; comment?: string } | null;
  // Не секрет ни от кого (в отличие от correctAnswer), одинаковы для всех
  // получателей. Не поле движка — Room-состояние (design.md, «СУДЕЙСТВО»,
  // 2026-08-05: временное исключение после неверного ответа — транспортное
  // ограничение, как фальстарт, не игровое правило). graceExcludedUntil —
  // ОТДЕЛЬНЫЙ от timerDeadline дедлайн: исключение идёт параллельно с уже
  // возобновившимся отсчётом вопроса, а не вместо него, поэтому у них разные
  // числа и client должен показывать оба независимо.
  graceExcludedParticipantId: string | null;
  graceExcludedUntil: number | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  // Персональные поля, как correctAnswer: обычному игроку — только его
  // собственная запись (или пустой массив, пока не отправил); ведущему на
  // final-judging и всем на final-reveal — все (см. Room.toGameStateView).
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
  // Тот же принцип видимости, что и у showAllFinal (см. finalWagers выше):
  // ведущему на final-judging, всем на final-reveal, иначе null.
  finalCorrectAnswer: { text: string; comment?: string } | null;
}

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'toggle-host' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'place-bid'; amount: number }
  | { type: 'pass-bid' }
  | { type: 'assign-cat'; recipientParticipantId: string }
  | { type: 'buzz' }
  // Шлёт табло, доигравшее клип видео-вопроса. Как и admin-*, не привязано к
  // личности отправителя: табло не участник и никогда не шлёт 'join'.
  // questionId — защита от опоздавшего сигнала по предыдущему вопросу
  // (design.md, 2026-08-18-video-questions-design.md, «Фаза проигрывания
  // медиа»).
  | { type: 'media-finished'; questionId: string }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean }
  // Панель ведущего — сервер сам проверяет, что отправитель и есть hostId,
  // клиентскому participantId в поле не доверяет.
  | { type: 'adjust-score'; participantId: string; delta: number }
  | { type: 'cancel-question' }
  // Сбрасывает текущую партию в пустое лобби — см. Room.resetGame().
  | { type: 'reset-game' }
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean }
  // Админ-панель (design.md, «Админ-панель») — отдельный тип сообщений, не
  // привязанный к участнику: сокет админки не присоединяется к комнате
  // (никогда не шлёт 'join'), поэтому эти сообщения сервер обрабатывает без
  // поиска в connections/participants, в отличие от всего выше.
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в engine.ts.
  | { type: 'admin-skip-to-final' }
  // Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — человек
  // выбирает из реально найденных кандидатов вместо угадывания сервером.
  | { type: 'admin-set-lan-address'; address: string }
  // ВРЕМЕННЫЙ параметр — скорость показа текста вопроса, слов/сек (design.md,
  // 2026-08-19-gradual-text-reveal-design.md, «Временная скорость показа»).
  // Без авторизации, тот же паттерн, что и admin-set-lan-address — доступно
  // только через /admin. Убрать вместе с полем и UI в админке, как только
  // число зафиксируется в спеке.
  | { type: 'admin-set-text-reveal-rate'; wordsPerSecond: number }
  // ВРЕМЕННЫЙ переключатель — вкл/выкл постепенного показа текста целиком,
  // тот же принцип, что admin-set-text-reveal-rate выше. false — вопрос
  // открывается сразу целиком, без ожидания (Room.computeTextRevealMs).
  | { type: 'admin-set-text-reveal-enabled'; enabled: boolean }
  // Тумблер записи текущей партии в историю (room.ts, Room.historyEnabled) —
  // тот же паттерн, что и admin-set-text-reveal-enabled выше, но постоянная
  // функция, не временная.
  | { type: 'admin-set-history-enabled'; enabled: boolean }
  // Выбор пакета — от участника (сервер сверяет отправителя с
  // hostParticipantId) и с админ-панели (без проверки личности), тем же
  // способом, каким уже разделены skip-to-final/admin-skip-to-final.
  | { type: 'refresh-packs' }
  | { type: 'select-pack'; filename: string }
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string }
  // Ручной редактор пакетов, веха A (design.md, 2026-08-15) — просмотр,
  // правка и удаление существующего вопроса. id не редактируется, только
  // используется для поиска вопроса внутри пакета.
  | { type: 'admin-get-pack'; filename: string }
  | {
      type: 'admin-update-question';
      filename: string;
      questionId: string;
      price: number;
      text: string;
      answer: string;
      comment?: string;
      // Не «type» — не путать с полем-дискриминантом самого сообщения.
      questionType: Question['type'];
    }
  | { type: 'admin-delete-question'; filename: string; questionId: string }
  // Жалоба на вопрос — список для беглого просмотра (design.md, 2026-08-15).
  // Контекст вопроса (текст/ответ/тема/цена) сервер достаёт сам по
  // filename+questionId, от клиента нужен только текст жалобы.
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    };

export type StartGameErrorReason =
  | 'not-enough-players'
  | 'no-pack'
  | 'game-in-progress'
  | 'host-required'
  | 'host-only';

// Единственная причина сейчас — «кота» некому передать (room.ts,
// SelectQuestionResult). Отдельный тип, а не переиспользование
// StartGameErrorReason — по смыслу это разные отказы, и раздельные типы не
// дадут по ошибке присвоить одно на месте другого.
export type SelectQuestionErrorReason = 'no-recipient';

export type ServerMessage =
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      // Живой, не разовый: пересчитывается на каждой рассылке (server.ts,
      // stateMessageFor) из room.getLanInfo(), а не отправляется один раз
      // при подключении — иначе уже подключённые табло/админка не увидели
      // бы смену адреса, выбранную через admin-set-lan-address.
      lanUrl: string;
      lanCandidates: LanCandidate[];
      // Живые, как lanUrl/lanCandidates — пересчитываются на каждой
      // рассылке из room.getPackInfo(), видны всем подключённым, но
      // действовать (refresh-packs/select-pack) могут только ведущий и
      // админка.
      availablePacks: PackSummary[];
      activePackFilename: string | null;
      // ВРЕМЕННЫЙ, как lanUrl — текущая скорость показа текста вопроса,
      // слов/сек, меняется через admin-set-text-reveal-rate без реконнекта
      // (design.md, 2026-08-19-gradual-text-reveal-design.md).
      textRevealWordsPerSecond: number;
      // ВРЕМЕННЫЙ, как textRevealWordsPerSecond — вкл/выкл постепенного
      // показа целиком, меняется через admin-set-text-reveal-enabled.
      textRevealEnabled: boolean;
      // Пишется ли текущая партия в историю (room.ts, Room.historyEnabled).
      historyEnabled: boolean;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  // Адресован только тому, кто пытался выбрать вопрос (server.ts шлёт его
  // отправителю, а не рассылает всем) — остальным участникам ничего не
  // видно, чтобы не выдать раньше времени, что это был именно «кот»
  // (design.md, «Правило» вехи 2026-08-12-cat-in-bag).
  | { type: 'select-question-error'; reason: SelectQuestionErrorReason }
  // Попытка select-pack/admin-select-pack на файл, ставший невалидным или
  // исчезнувший между обновлением списка и выбором.
  | { type: 'select-pack-error'; reason: 'unknown-file' }
  // Ответ на все три admin-get-pack/admin-update-question/
  // admin-delete-question сразу — один тип на три запроса, чтобы клиенту
  // не нужно было по-разному обрабатывать три разных формы успеха.
  | { type: 'admin-pack'; filename: string; pack: Pack }
  | { type: 'admin-pack-error'; filename: string; reason: string }
  // Отдельные от admin-pack/admin-pack-error — жалоба не редактирует пакет,
  // её ошибка не должна путаться с ошибкой правки вопроса.
  | { type: 'admin-report-ack'; filename: string; questionId: string }
  | {
      type: 'admin-report-error';
      filename: string;
      questionId: string;
      reason: string;
    };
