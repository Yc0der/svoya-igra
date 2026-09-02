import type { Phase } from './engine.js';
import type { LanCandidate } from './network.js';
import type { PackSummary } from './packs.js';
import type { Pack, Question } from './pack.js';
import type { PlayerCard } from './playerCard.js';

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
    // Длительность проявления одной буквы, мс — ВРЕМЕННАЯ настройка
    // (design.md, 2026-08-19-gradual-text-reveal-design.md, «Длительность
    // проявления настраивается в админке»). В отличие от revealMs — не
    // null вне question-reveal: это не секрет и не зависит от текущего
    // вопроса, просто текущее значение Room.textRevealFadeMs, отдаваемое
    // рядом с revealMs, чтобы табло не нуждалось в отдельной проводке.
    fadeMs: number;
  } | null;
  // Оценки вопроса, который только что доиграли (design.md,
  // 2026-08-21-question-tags-design.md). null — окно оценки закрыто: либо
  // вопрос ещё идёт, либо уже выбрали следующий. Счёт анонимный: имён нет
  // намеренно, на табло видно только сколько.
  questionTags: {
    up: number;
    down: number;
    // Оценка самого смотрящего; null — не оценивал.
    mine: 'up' | 'down' | null;
  } | null;
  // Помеченные вниз и ещё не разобранные вопросы САМОГО смотрящего — материал
  // экрана в конце партии (design.md, 2026-08-21-question-tags-design.md).
  // Пустой массив, пока партия не кончилась, а также когда запись истории
  // выключена тумблером: строк в базе нет, значит и разбирать нечего.
  tagReview: {
    questionId: string;
    themeName: string;
    price: number;
    text: string;
    answer: string;
  }[];
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
  // Вход «я — вот этот из списка» (design.md, 2026-08-26-player-identity,
  // «Лобби») — вместо ввода имени руками участник выбирает себя среди уже
  // известных людей (room.ts, Room.joinAsPerson). Имя сервер берёт у самого
  // человека, клиент его не присылает.
  | { type: 'join-as'; personId: number }
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
  // Пальцы вверх/вниз по только что доигранному вопросу (design.md,
  // 2026-08-21-question-tags-design.md). Сервер сам сверяет фазу/окно через
  // Room.tagQuestion — здесь только форма сообщения.
  | { type: 'tag-question'; thumb: 'up' | 'down' }
  // Причина, по которой игрок пометил вопрос пальцем вниз — экран разбора в
  // конце партии (design.md, 2026-08-21-question-tags-design.md).
  // Room.submitTagReason сверяет фазу (game-end) и — через
  // history.recordTagReason (`AND thumb = 0` в WHERE) — что участник
  // действительно ставил палец вниз именно по этому вопросу; при отказе
  // любой из проверок возвращает false. Сервер обязан смотреть на этот
  // возврат: запись в docs/pack-generator-profile.md уходит, только если
  // он true (ревью задачи 4, Important 1) — устаревший/подложный questionId
  // не должен превращаться в выдуманную жалобу на долгоживущем артефакте.
  | {
      type: 'tag-reason';
      questionId: string;
      // Один из TAG_REASONS либо null, если игрок написал только текст.
      reason: string | null;
      // Свободный текст; пустая строка — не писал.
      text: string;
    }
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
  // ВРЕМЕННЫЙ параметр — длительность проявления одной буквы, мс
  // (design.md, 2026-08-19-gradual-text-reveal-design.md, «Длительность
  // проявления настраивается в админке»). Тот же принцип, что
  // admin-set-text-reveal-rate выше: без авторизации, доступно только
  // через /admin, убрать вместе с полем и UI, как только число
  // зафиксируется в спеке.
  | { type: 'admin-set-text-reveal-fade-ms'; fadeMs: number }
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
    }
  // Анкеты интересов игроков (design.md, 2026-08-26). Код приходит от
  // ведущего целиком, как его прислал игрок, — разбирает и проверяет его
  // сервер, а не клиент: клиент не должен знать формат анкеты.
  | { type: 'admin-get-players' }
  | {
      type: 'admin-save-player';
      code: string;
      // false — обычная отправка: если игрок с таким именем уже есть, сервер
      // ответит admin-player-exists и НИЧЕГО не запишет. true — ведущий
      // подтвердил замену. Подтверждение спрашивается один раз и на стороне
      // клиента, чтобы сервер оставался без состояния между сообщениями.
      replace: boolean;
      // Правка через форму в /admin: имя, под которым анкета лежала до
      // правки. Если ведущий сменил имя в форме, это переименование — старый
      // раздел уходит, новый встаёт на его место. Форма шлёт тот же код
      // анкеты, что приходит с телефона, ровно затем, чтобы разбор, проверки
      // и экранирование остались в одном месте на оба источника.
      originalName?: string;
    }
  // Форма правки: отдать анкету так, как она лежит в файле.
  | { type: 'admin-get-player'; name: string }
  // Удаление анкеты — и только анкеты. Человек в истории партий, его участие в
  // играх и его блок в «Показывает в игре» остаются: их убирает
  // admin-forget-person (спека анкет, «Удаление анкеты — это удаление анкеты»).
  // Во время партии разрешено: трогается файл, а не состояние игры.
  | { type: 'admin-delete-player-card'; name: string }
  // Слияние расщепившихся профилей одного человека (design.md,
  // 2026-08-26-player-identity, «Слияние профилей») — направление указывает
  // ведущий: fromId исчезает, intoId остаётся. Сервер сам проверяет, что
  // партия сейчас не идёт (Room.hasActiveGame) — клиент этого не решает.
  | { type: 'admin-merge-people'; fromId: number; intoId: number };

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

/**
 * Единственная причина с оси «Вкус» (docs/ideas.md, «Две оси, которые нельзя
 * смешивать»). Вынесена из TAG_REASONS отдельным именем, потому что
 * history.ts отбирает по ней сводку тем: литерал, повторённый в двух файлах,
 * разошёлся бы при первой же правке формулировки.
 */
export const REASON_BORING_THEME = 'Неинтересная тема' as const;

/**
 * Готовые варианты причины для разбора в конце партии. Пять, и они не
 * случайны: это ровно те разделы, из которых уже состоит
 * docs/pack-generator-profile.md — «Калибровка сложности», «Брак», «Вкус».
 * Клиент рисует их кнопками, сервер принимает только их.
 */
export const TAG_REASONS = [
  'Слишком сложный',
  'Слишком лёгкий',
  'Непонятная формулировка',
  'Спорный ответ',
  REASON_BORING_THEME,
] as const;

export type ServerMessage =
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  // Отдельные от name-taken отказы join-as (room.ts, Room.joinAsPerson) —
  // причины разные (этим человеком уже кто-то вошёл / человека с таким id
  // нет), и текст, который увидит игрок, тоже должен быть разным.
  | { type: 'person-taken' }
  | { type: 'person-unknown' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      // Список постоянных людей для входа «я — вот этот из списка» (room.ts,
      // Room.getPeople). Пустой массив, когда история выключена — заявленный
      // откат всей вехи: клиент показывает обычное поле ввода имени
      // (design.md, 2026-08-26-player-identity, «Лобби»).
      people: { id: number; name: string; games: number }[];
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
      // ВРЕМЕННЫЙ, как textRevealWordsPerSecond — длительность проявления
      // одной буквы, мс, меняется через admin-set-text-reveal-fade-ms без
      // реконнекта (design.md, 2026-08-19-gradual-text-reveal-design.md).
      textRevealFadeMs: number;
      // Намерение писать историю — для партии, которая начнётся дальше
      // (room.ts, Room.historyEnabled). Не то же самое, что «пишется ли
      // прямо сейчас конкретно идущая партия», см. historyRecording ниже.
      historyEnabled: boolean;
      // Правда для чекбокса в админке (room.ts, Room.isHistoryRecording) —
      // «historyGameId !== null» напрямую, а не намерение. true, только
      // пока идёт партия и она реально пишется; в лобби всегда false, даже
      // при historyEnabled: true (запись начнётся только со стартом
      // партии). Расходится с historyEnabled именно после off→on посреди
      // партии — тумблер снова true, но эта конкретная партия уже
      // выброшена окончательно и заново писаться не начинает (design.md,
      // 2026-08-20-game-history-design.md, «Тумблер»). Admin.tsx для
      // лобби (game === null) показывает чекбокс по historyEnabled, а не
      // по этому полю — иначе он выглядел бы выключенным ещё до старта
      // первой партии.
      historyRecording: boolean;
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
    }
  // Отдаётся и на admin-get-players, и как подтверждение успешной записи —
  // список всегда актуальный, клиенту не нужно догадываться, что изменилось.
  | {
      type: 'admin-players';
      // games — сколько партий этого имени лежит в истории. Нужен диалогу
      // удаления: «анкета и 4 партии» честнее, чем «вы уверены?». Ноль
      // значит и «человек не играл», и «в истории он назвался иначе» — по
      // спеке ведущий обязан видеть это до удаления, а не гадать.
      players: { name: string; date: string; games: number }[];
    }
  // Ответ на admin-get-player: анкета как она лежит в файле. extraLines —
  // строки раздела, которых форма не знает (ручные пометки): форма их
  // показывает как есть и возвращает серверу нетронутыми.
  | {
      type: 'admin-player';
      card: PlayerCard;
      extraLines: string[];
    }
  | { type: 'admin-player-exists'; name: string }
  | { type: 'admin-player-error'; reason: string }
  // Ответ на admin-merge-people: обновлённый список, той же формы, что и
  // state.people (форма зеркалит PersonSummary из history.ts). Тот же приём,
  // что admin-players — список всегда актуальный, клиенту не нужно
  // догадываться, что изменилось.
  | {
      type: 'admin-people';
      people: { id: number; name: string; games: number }[];
    }
  // Отказ admin-merge-people: партия ещё идёт, либо fromId/intoId совпали или
  // fromId не существует (history.mergePeople вернул false).
  | { type: 'admin-people-error'; reason: string };
