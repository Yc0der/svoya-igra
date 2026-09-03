import { useEffect, useRef, useState } from 'react';
import type {
  GameStateView,
  ParticipantView,
  StartGameErrorReason,
} from './useRoomConnection';

// Ловушка «Выбор локального IP на Windows» (svoya-igra-dev) — сервер сам не
// умеет угадать, какой сетевой адаптер настоящий, и печатает всех
// кандидатов, среди которых человек выбирает нужный (server/src/network.ts).
export interface LanCandidate {
  address: string;
  interfaceName: string;
}

export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}

// Типы пакета — зеркало server/src/pack.ts (клиент не импортирует серверные типы)
export interface Question {
  id: string;
  price: number;
  text: string;
  answer: string;
  comment?: string;
  type: 'обычный' | 'кот' | 'аукцион';
}

export interface Theme {
  name: string;
  questions: Question[];
}

export interface Round {
  themes: Theme[];
}

export interface Pack {
  title: string;
  author: string;
  createdAt: string;
  description?: string;
  rounds: Round[];
  final?: unknown;
}

// Админ-панель (design.md, «Админ-панель») — отдельный от useRoomConnection
// хук: сокет админки никогда не шлёт 'join'/'reconnect', не хранит токен в
// localStorage и не занимает место участника. Он получает те же
// широковещательные 'state' от сервера (server.ts шлёт их каждому
// подключённому сокету независимо от того, представился тот или нет), но
// шлёт в ответ только admin-* сообщения.
type ServerMessage =
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      lanUrl: string;
      lanCandidates: LanCandidate[];
      availablePacks: PackSummary[];
      activePackFilename: string | null;
      // ВРЕМЕННО — см. server/src/protocol.ts.
      textRevealWordsPerSecond: number;
      // ВРЕМЕННО — см. server/src/protocol.ts.
      textRevealEnabled: boolean;
      // ВРЕМЕННО — см. server/src/protocol.ts.
      textRevealFadeMs: number;
      historyEnabled: boolean;
      historyRecording: boolean;
      // Список постоянных людей — та же форма, что и state.people у
      // useRoomConnection (задача 2). Задаче 4 нужен здесь только он: два
      // <select> слияния строятся по этому списку, отдельного запроса не
      // заводим (server/src/server.ts, stateMessageFor уже кладёт его в
      // каждую рассылку).
      people: { id: number; name: string; games: number }[];
    }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  | { type: 'select-pack-error'; reason: 'unknown-file' }
  | { type: 'admin-pack'; filename: string; pack: Pack }
  | { type: 'admin-pack-error'; filename: string; reason: string }
  | { type: 'admin-report-ack'; filename: string; questionId: string }
  | {
      type: 'admin-report-error';
      filename: string;
      questionId: string;
      reason: string;
    }
  | {
      type: 'admin-players';
      players: { name: string; date: string }[];
    }
  | { type: 'admin-player'; card: PlayerCardView; extraLines: string[] }
  | { type: 'admin-player-exists'; name: string }
  | { type: 'admin-player-error'; reason: string }
  | {
      type: 'admin-people';
      people: { id: number; name: string; games: number }[];
    }
  | { type: 'admin-people-error'; reason: string };

type ClientMessage =
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в server/src/engine.ts.
  | { type: 'admin-skip-to-final' }
  | { type: 'admin-cancel-question' }
  | { type: 'admin-set-lan-address'; address: string }
  // ВРЕМЕННО — см. server/src/protocol.ts.
  | { type: 'admin-set-text-reveal-rate'; wordsPerSecond: number }
  // ВРЕМЕННО — см. server/src/protocol.ts.
  | { type: 'admin-set-text-reveal-enabled'; enabled: boolean }
  // ВРЕМЕННО — см. server/src/protocol.ts.
  | { type: 'admin-set-text-reveal-fade-ms'; fadeMs: number }
  | { type: 'admin-set-history-enabled'; enabled: boolean }
  | { type: 'admin-refresh-packs' }
  | { type: 'admin-select-pack'; filename: string }
  | { type: 'admin-get-pack'; filename: string }
  | {
      type: 'admin-update-question';
      filename: string;
      questionId: string;
      price: number;
      text: string;
      answer: string;
      comment?: string;
      questionType: Question['type'];
    }
  | { type: 'admin-delete-question'; filename: string; questionId: string }
  | { type: 'admin-delete-pack'; filename: string }
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    }
  | { type: 'admin-get-players' }
  | { type: 'admin-get-player'; name: string }
  | { type: 'admin-delete-player-card'; name: string }
  | {
      type: 'admin-save-player';
      code: string;
      replace: boolean;
      // Есть только у правки через форму: имя до правки. Отсутствие поля и
      // означает «это вставка кода, а не правка».
      originalName?: string;
    }
  | { type: 'admin-merge-people'; fromId: number; intoId: number }
  | { type: 'admin-forget-person'; id: number };

// Анкета в том виде, в каком её отдаёт сервер, — форма правки заполняется
// ею и из неё же собирает код обратно.
export interface PlayerCardView {
  name: string;
  interests: { area: string; examples: string[] }[];
  boring: string[];
}

export interface AdminConnection {
  // Открыт ли прямо сейчас собственный сокет админки — не то же самое, что
  // "жива ли комната": пока идёт переподключение, последнее известное
  // состояние ниже остаётся на экране, не сбрасываясь в пустоту.
  connected: boolean;
  lanUrl: string | null;
  lanCandidates: LanCandidate[];
  participants: ParticipantView[];
  hostParticipantId: string | null;
  game: GameStateView | null;
  startGameError: StartGameErrorReason | null;
  startGame(): void;
  resetGame(): void;
  resetRoom(): void;
  kick(participantId: string): void;
  setHost(participantId: string | null): void;
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в server/src/engine.ts.
  skipToFinal(): void;
  // Закрывает активный вопрос без начисления очков — то же, что кнопка на
  // телефоне ведущего, но с пульта и не требуя назначенного ведущего.
  cancelQuestion(): void;
  setLanAddress(address: string): void;
  // ВРЕМЕННО — см. server/src/protocol.ts.
  textRevealWordsPerSecond: number;
  setTextRevealWordsPerSecond(wordsPerSecond: number): void;
  // ВРЕМЕННО — см. server/src/protocol.ts.
  textRevealEnabled: boolean;
  setTextRevealEnabled(enabled: boolean): void;
  // ВРЕМЕННО — см. server/src/protocol.ts.
  textRevealFadeMs: number;
  setTextRevealFadeMs(fadeMs: number): void;
  historyEnabled: boolean;
  setHistoryEnabled(enabled: boolean): void;
  // Правда для чекбокса (server/src/protocol.ts, StateMessage.historyRecording)
  // — см. комментарий там. Admin.tsx использует его вместо historyEnabled,
  // когда партия уже идёт.
  historyRecording: boolean;
  availablePacks: PackSummary[];
  activePackFilename: string | null;
  selectPackError: 'unknown-file' | null;
  refreshPacks(): void;
  selectPack(filename: string): void;
  editedPack: Pack | null;
  editedPackFilename: string | null;
  editedPackError: string | null;
  // Увеличивается на каждое входящее 'admin-pack' — способ для Admin.tsx
  // отличить «пришёл новый пакет после моего save/delete» от «пакет тот же,
  // просто пришла ошибка» без сравнения содержимого пакета (design.md,
  // «При успехе — форма закрывается»).
  editedPackVersion: number;
  // Локально сбрасывает editedPackError, не дожидаясь следующего 'admin-pack'
  // с сервера — нужно при переключении формы на другой вопрос, чтобы старая
  // ошибка не «протекала» в форму, к которой не имеет отношения.
  clearPackError(): void;
  // Полный сброс editedPack/editedPackFilename/editedPackError к начальным
  // значениям — вызывается при выходе из редактора («Готово»), чтобы при
  // повторном входе не мелькнул старый пакет до ответа сервера.
  resetPackEditor(): void;
  getPack(filename: string): void;
  updateQuestion(
    filename: string,
    questionId: string,
    fields: {
      price: number;
      text: string;
      answer: string;
      comment?: string;
      questionType: Question['type'];
    },
  ): void;
  deleteQuestion(filename: string, questionId: string): void;
  // Сносит пакет вместе с его папкой картинок. Ответа при успехе нет —
  // пакет просто исчезает из availablePacks.
  deletePack(filename: string): void;
  reportError: string | null;
  reportAckVersion: number;
  clearReportError(): void;
  reportQuestion(filename: string, questionId: string, complaint: string): void;
  // Анкеты игроков (задача 3, sdd/2026-08-26-player-questionnaire) — список
  // уже заведённых игроков и обратная связь по последней попытке вставить
  // код. Отдельного «ок» на успешную запись сервер не шлёт — успех виден по
  // приходу нового admin-players (см. players ниже).
  players: { name: string; date: string }[];
  // Анкета, запрошенная для правки. null — форма закрыта или ответ ещё не
  // пришёл: заполнять её пустышкой нельзя, иначе «Сохранить» сотрёт то, что
  // не успело приехать.
  playerCard: { card: PlayerCardView; extraLines: string[] } | null;
  playerError: string | null;
  // Имя игрока, чья анкета уже есть — сервер ничего не записал и ждёт
  // повторной отправки того же кода с replace: true.
  playerConflictName: string | null;
  clearPlayerFeedback(): void;
  savePlayer(code: string, replace: boolean, originalName?: string): void;
  getPlayer(name: string): void;
  clearPlayerCard(): void;
  // Убирает только анкету. Человека из истории партий убирает forgetPerson
  // (задача 3 слайса) — это разные действия и разные кнопки.
  deletePlayerCard(name: string): void;
  // Слияние расщепившихся профилей (задача 4, sdd/2026-08-26-player-identity)
  // — тот же список людей, что и в лобби (задача 2/3), для двух <select> в
  // подразделе «Один и тот же человек». Обновляется и обычным 'state', и
  // прицельным admin-people после успешного слияния.
  people: { id: number; name: string; games: number }[];
  peopleError: string | null;
  // Гасит отказ слияния (финальное ревью ветки, п. 7, Minor) — иначе
  // «нельзя сливать игроков, пока идёт партия» висит красным всю партию и
  // переживает смену выбора в обоих выпадающих списках. Вызывается из
  // Admin.tsx при смене выбора в любом из двух — тот же класс дефекта, что
  // уже чинили в лобби (задача 3), только там гасило прибытие 'state', а тут
  // ошибка не про сервер, а про текущий выбор в форме.
  clearPeopleError(): void;
  mergePeople(fromId: number, intoId: number): void;
  // Забывает человека и его участие в партиях. Анкету не трогает — её убирает
  // deletePlayerCard.
  forgetPerson(id: number): void;
}

const RECONNECT_DELAY_MS = 2000;

type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

export function useAdminConnection(
  wsFactory: WebSocketFactory = defaultWsFactory,
): AdminConnection {
  const [connected, setConnected] = useState(false);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [lanCandidates, setLanCandidates] = useState<LanCandidate[]>([]);
  const [availablePacks, setAvailablePacks] = useState<PackSummary[]>([]);
  const [activePackFilename, setActivePackFilename] = useState<string | null>(
    null,
  );
  // ВРЕМЕННО — см. server/src/protocol.ts.
  const [textRevealWordsPerSecond, setTextRevealWordsPerSecondState] =
    useState(2.5);
  // ВРЕМЕННО — см. server/src/protocol.ts.
  const [textRevealEnabled, setTextRevealEnabledState] = useState(true);
  // ВРЕМЕННО — см. server/src/protocol.ts.
  const [textRevealFadeMs, setTextRevealFadeMsState] = useState(270);
  const [historyEnabled, setHistoryEnabledState] = useState(true);
  const [historyRecording, setHistoryRecordingState] = useState(true);
  const [selectPackError, setSelectPackError] = useState<'unknown-file' | null>(
    null,
  );
  const [editedPack, setEditedPack] = useState<Pack | null>(null);
  const [editedPackFilename, setEditedPackFilename] = useState<string | null>(
    null,
  );
  const [editedPackError, setEditedPackError] = useState<string | null>(null);
  const [editedPackVersion, setEditedPackVersion] = useState(0);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [hostParticipantId, setHostParticipantId] = useState<string | null>(
    null,
  );
  const [game, setGame] = useState<GameStateView | null>(null);
  const [startGameError, setStartGameError] =
    useState<StartGameErrorReason | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportAckVersion, setReportAckVersion] = useState(0);
  const [players, setPlayers] = useState<{ name: string; date: string }[]>([]);
  const [playerCard, setPlayerCard] = useState<{
    card: PlayerCardView;
    extraLines: string[];
  } | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerConflictName, setPlayerConflictName] = useState<string | null>(
    null,
  );
  const [people, setPeople] = useState<
    { id: number; name: string; games: number }[]
  >([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = wsFactory(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setConnected(true);
        // Анкеты не приходят с широковещательным 'state' — список нужно
        // запросить явно, как только сокет открылся.
        send({ type: 'admin-get-players' });
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ServerMessage;

        if (message.type === 'state') {
          setParticipants(message.participants);
          setHostParticipantId(message.hostParticipantId);
          setGame(message.game);
          setLanUrl(message.lanUrl);
          setLanCandidates(message.lanCandidates);
          setAvailablePacks(message.availablePacks);
          setActivePackFilename(message.activePackFilename);
          setTextRevealWordsPerSecondState(message.textRevealWordsPerSecond);
          setTextRevealEnabledState(message.textRevealEnabled);
          setTextRevealFadeMsState(message.textRevealFadeMs);
          setHistoryEnabledState(message.historyEnabled);
          setHistoryRecordingState(message.historyRecording);
          setPeople(message.people);
          setSelectPackError(null);
          setStartGameError(null);
        }
        if (message.type === 'start-game-error') {
          setStartGameError(message.reason);
        }
        if (message.type === 'select-pack-error') {
          setSelectPackError(message.reason);
        }
        if (message.type === 'admin-pack') {
          setEditedPack(message.pack);
          setEditedPackFilename(message.filename);
          setEditedPackError(null);
          setEditedPackVersion((v) => v + 1);
        }
        if (message.type === 'admin-pack-error') {
          setEditedPackFilename(message.filename);
          setEditedPackError(message.reason);
        }
        if (message.type === 'admin-report-ack') {
          setReportError(null);
          setReportAckVersion((v) => v + 1);
        }
        if (message.type === 'admin-report-error') {
          setReportError(message.reason);
        }
        if (message.type === 'admin-players') {
          setPlayers(message.players);
          // Успешная запись гасит и ошибку, и вопрос про замену: список
          // пришёл — значит всё сохранилось.
          setPlayerError(null);
          setPlayerConflictName(null);
        }
        if (message.type === 'admin-player') {
          setPlayerCard({ card: message.card, extraLines: message.extraLines });
          setPlayerError(null);
        }
        if (message.type === 'admin-player-exists') {
          setPlayerConflictName(message.name);
          setPlayerError(null);
        }
        if (message.type === 'admin-player-error') {
          setPlayerError(message.reason);
          setPlayerConflictName(null);
        }
        if (message.type === 'admin-people') {
          setPeople(message.people);
          setPeopleError(null);
        }
        if (message.type === 'admin-people-error') {
          setPeopleError(message.reason);
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsFactory]);

  function send(message: ClientMessage): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  return {
    connected,
    lanUrl,
    lanCandidates,
    participants,
    hostParticipantId,
    game,
    startGameError,
    startGame: () => send({ type: 'admin-start-game' }),
    resetGame: () => send({ type: 'admin-reset-game' }),
    resetRoom: () => send({ type: 'admin-reset-room' }),
    kick: (participantId) => send({ type: 'admin-kick', participantId }),
    setHost: (participantId) => send({ type: 'admin-set-host', participantId }),
    skipToFinal: () => send({ type: 'admin-skip-to-final' }),
    cancelQuestion: () => send({ type: 'admin-cancel-question' }),
    setLanAddress: (address) =>
      send({ type: 'admin-set-lan-address', address }),
    textRevealWordsPerSecond,
    setTextRevealWordsPerSecond: (wordsPerSecond) =>
      send({ type: 'admin-set-text-reveal-rate', wordsPerSecond }),
    textRevealEnabled,
    setTextRevealEnabled: (enabled) =>
      send({ type: 'admin-set-text-reveal-enabled', enabled }),
    textRevealFadeMs,
    setTextRevealFadeMs: (fadeMs) =>
      send({ type: 'admin-set-text-reveal-fade-ms', fadeMs }),
    historyEnabled,
    setHistoryEnabled: (enabled) =>
      send({ type: 'admin-set-history-enabled', enabled }),
    historyRecording,
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks: () => send({ type: 'admin-refresh-packs' }),
    selectPack: (filename) => send({ type: 'admin-select-pack', filename }),
    editedPack,
    editedPackFilename,
    editedPackError,
    editedPackVersion,
    clearPackError: () => setEditedPackError(null),
    resetPackEditor: () => {
      setEditedPack(null);
      setEditedPackFilename(null);
      setEditedPackError(null);
    },
    getPack: (filename) => send({ type: 'admin-get-pack', filename }),
    updateQuestion: (filename, questionId, fields) =>
      send({
        type: 'admin-update-question',
        filename,
        questionId,
        ...fields,
      }),
    deleteQuestion: (filename, questionId) =>
      send({ type: 'admin-delete-question', filename, questionId }),
    deletePack: (filename) => send({ type: 'admin-delete-pack', filename }),
    reportError,
    reportAckVersion,
    clearReportError: () => setReportError(null),
    reportQuestion: (filename, questionId, complaint) =>
      send({ type: 'admin-report-question', filename, questionId, complaint }),
    players,
    playerError,
    playerConflictName,
    clearPlayerFeedback: () => {
      setPlayerError(null);
      setPlayerConflictName(null);
    },
    playerCard,
    savePlayer: (code, replace, originalName) =>
      send(
        originalName === undefined
          ? { type: 'admin-save-player', code, replace }
          : { type: 'admin-save-player', code, replace, originalName },
      ),
    getPlayer: (name) => send({ type: 'admin-get-player', name }),
    clearPlayerCard: () => setPlayerCard(null),
    deletePlayerCard: (name) =>
      send({ type: 'admin-delete-player-card', name }),
    people,
    peopleError,
    clearPeopleError: () => setPeopleError(null),
    mergePeople: (fromId, intoId) =>
      send({ type: 'admin-merge-people', fromId, intoId }),
    forgetPerson: (id) => send({ type: 'admin-forget-person', id }),
  };
}
