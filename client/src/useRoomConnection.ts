import { useEffect, useRef, useState } from 'react';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameStateView {
  phase:
    | 'selecting'
    | 'cat-handoff'
    | 'auction-bidding'
    | 'question-open'
    | 'buzzed'
    | 'judging'
    | 'reveal'
    | 'round-end'
    | 'final-elim'
    | 'final-wager'
    | 'final-answer'
    | 'final-judging'
    | 'final-reveal'
    | 'game-end';
  // Замороженный на время партии ведущий, НЕ то же самое, что лобби-флаг
  // hostParticipantId — isHost ниже обязан доверять этому полю, пока
  // партия идёт.
  hostId: string | null;
  roundIndex: number;
  grid: {
    themeName: string;
    questions: { id: string; price: number; answered: boolean }[];
  }[];
  turnParticipantId: string;
  // text — null только во время cat-handoff: цена и тема не секрет (видны
  // на сетке ещё до выбора), скрывается только текст, пока получатель не
  // назначен.
  // image — необязательное поле в этом локальном типе (в отличие от
  // сервера, где оно обязательное) намеренно: делает его опциональным
  // для тестовых фикстур в Board.test.tsx/Player.test.tsx, у которых
  // `currentQuestion` собирается вручную — без этого пришлось бы
  // дописывать `image: null` в ~18 уже существующих мест в обоих файлах
  // ради поля, которого эти тесты не касаются. Реальные сообщения с
  // сервера всегда содержат image — на строгость разбора реальных
  // сообщений это не влияет, недостающий у TypeScript-типа необязательный
  // ключ не отбрасывает лишние поля во входящих данных.
  currentQuestion: {
    text: string | null;
    price: number;
    themeName: string;
    image?: string | null;
    // Тот же приём, что и у image выше — необязательное поле в этом
    // локальном типе ради тестовых фикстур, которые собирают
    // currentQuestion вручную (Board.test.tsx). Реальные сообщения с
    // сервера всегда содержат video (Task 2, server/src/protocol.ts).
    video?: {
      youtubeId: string;
      startSeconds: number;
      durationSeconds: number;
      audioOnly: boolean;
    } | null;
  } | null;
  buzzedParticipantId: string | null;
  exclusiveAnswererParticipantId: string | null;
  auctionTurnParticipantId: string | null;
  auctionHighestBid: number | null;
  auctionHighestBidderParticipantId: string | null;
  auctionPassedParticipantIds: string[] | null;
  correctAnswer: { text: string; comment?: string } | null;
  graceExcludedParticipantId: string | null;
  graceExcludedUntil: number | null;
  timerDeadline: number | null;
  scores: { participantId: string; score: number }[];
  finalThemes: { name: string; eliminated: boolean }[] | null;
  finalElimParticipantId: string | null;
  finalQuestion: { text: string } | null;
  finalWagers: { participantId: string; amount: number }[] | null;
  finalAnswers: { participantId: string; text: string }[] | null;
  finalVerdicts: { participantId: string; correct: boolean }[] | null;
  finalCorrectAnswer: { text: string; comment?: string } | null;
}

export type StartGameErrorReason =
  | 'not-enough-players'
  | 'no-pack'
  | 'game-in-progress'
  | 'host-required'
  | 'host-only';

// Единственная причина сейчас — «кота» некому передать (room.ts,
// SelectQuestionResult) — см. select-question-error ниже.
export type SelectQuestionErrorReason = 'no-recipient';

export interface PackSummary {
  filename: string;
  title: string;
  description: string | null;
}

type ServerMessage =
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
      lanUrl: string;
      availablePacks: PackSummary[];
      activePackFilename: string | null;
    }
  | { type: 'falsestart' }
  | { type: 'start-game-error'; reason: StartGameErrorReason }
  | { type: 'select-pack-error'; reason: 'unknown-file' }
  | { type: 'select-question-error'; reason: SelectQuestionErrorReason };

type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'reconnect'; token: string }
  | { type: 'start-game' }
  | { type: 'toggle-host' }
  | { type: 'select-question'; themeIndex: number; questionId: string }
  | { type: 'place-bid'; amount: number }
  | { type: 'pass-bid' }
  | { type: 'assign-cat'; recipientParticipantId: string }
  | { type: 'buzz' }
  | { type: 'said-answer' }
  | { type: 'vote'; correct: boolean }
  | { type: 'adjust-score'; participantId: string; delta: number }
  | { type: 'cancel-question' }
  | { type: 'reset-game' }
  | { type: 'eliminate-final-theme'; themeIndex: number }
  | { type: 'submit-wager'; amount: number }
  | { type: 'submit-final-answer'; text: string }
  | { type: 'final-vote'; participantId: string; correct: boolean }
  | { type: 'refresh-packs' }
  | { type: 'select-pack'; filename: string };

export type ConnectionStatus =
  'connecting' | 'joining' | 'joined' | 'name-taken' | 'disconnected';

export interface RoomConnection {
  status: ConnectionStatus;
  participants: ParticipantView[];
  selfId: string | null;
  lanUrl: string | null;
  game: GameStateView | null;
  falsestart: boolean;
  // Самоочищающийся сигнал (как falsestart) — сервер молча отклонил
  // select-question (сейчас единственная причина — «кота» некому передать),
  // и без этого поля пикер не видел бы вообще никакой реакции на клик
  // (обратная связь, живая партия 2026-08-17).
  selectQuestionBlocked: boolean;
  hostParticipantId: string | null;
  isHost: boolean;
  startGameError: StartGameErrorReason | null;
  join(name: string): void;
  startGame(): void;
  toggleHost(): void;
  selectQuestion(themeIndex: number, questionId: string): void;
  placeBid(amount: number): void;
  passBid(): void;
  assignCat(recipientParticipantId: string): void;
  buzz(): void;
  saidAnswer(): void;
  vote(correct: boolean): void;
  adjustScore(participantId: string, delta: number): void;
  cancelQuestion(): void;
  resetGame(): void;
  eliminateFinalTheme(themeIndex: number): void;
  submitWager(amount: number): void;
  submitFinalAnswer(text: string): void;
  finalVote(participantId: string, correct: boolean): void;
  availablePacks: PackSummary[];
  activePackFilename: string | null;
  selectPackError: 'unknown-file' | null;
  refreshPacks(): void;
  selectPack(filename: string): void;
}

const TOKEN_KEY = 'svoya-igra-token';
const RECONNECT_DELAY_MS = 2000;
const FALSESTART_LOCK_MS = 2000;
// Дольше, чем FALSESTART_LOCK_MS — здесь целое предложение, а не мгновенная
// блокировка кнопки, читать его нужно больше 2 секунд.
const SELECT_QUESTION_BLOCKED_MS = 5000;

type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

export function useRoomConnection(
  wsFactory: WebSocketFactory = defaultWsFactory,
): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [availablePacks, setAvailablePacks] = useState<PackSummary[]>([]);
  const [activePackFilename, setActivePackFilename] = useState<string | null>(
    null,
  );
  const [selectPackError, setSelectPackError] = useState<'unknown-file' | null>(
    null,
  );
  const [game, setGame] = useState<GameStateView | null>(null);
  const [falsestart, setFalsestart] = useState(false);
  const [selectQuestionBlocked, setSelectQuestionBlocked] = useState(false);
  const [hostParticipantId, setHostParticipantId] = useState<string | null>(
    null,
  );
  const [startGameError, setStartGameError] =
    useState<StartGameErrorReason | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let falsestartTimer: ReturnType<typeof setTimeout> | undefined;
    let selectQuestionBlockedTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = wsFactory(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          setStatus('joining');
          const message: ClientMessage = { type: 'reconnect', token };
          ws.send(JSON.stringify(message));
        } else if (pendingNameRef.current) {
          setStatus('joining');
          const message: ClientMessage = {
            type: 'join',
            name: pendingNameRef.current,
          };
          ws.send(JSON.stringify(message));
        }
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as ServerMessage;

        if (message.type === 'joined') {
          localStorage.setItem(TOKEN_KEY, message.token);
          setSelfId(message.participantId);
          setStatus('joined');
        }
        if (message.type === 'name-taken') {
          // Гонка двух подряд join() (например, двойной тап): второй запрос
          // мог уйти до того, как пришёл ответ на первый, и получить
          // 'name-taken' уже ПОСЛЕ того, как первый успешно завершился
          // 'joined'. Это устаревший ответ не на тот запрос, что определяет
          // текущий статус — применять его, затирая уже случившийся успех,
          // нельзя.
          setStatus((current) =>
            current === 'joined' ? current : 'name-taken',
          );
        }
        if (message.type === 'invalid-token') {
          localStorage.removeItem(TOKEN_KEY);
          setStatus('connecting');
        }
        if (message.type === 'state') {
          setParticipants(message.participants);
          setHostParticipantId(message.hostParticipantId);
          setGame(message.game);
          setLanUrl(message.lanUrl);
          setAvailablePacks(message.availablePacks);
          setActivePackFilename(message.activePackFilename);
          setSelectPackError(null);
          // Любое изменение в комнате (кто-то присоединился, кто-то стал
          // ведущим, партия реально началась) делает старую ошибку запуска
          // неактуальной — пользователь либо чинит проблему прямо сейчас,
          // либо она уже больше не про то, что показано на экране.
          setStartGameError(null);
        }
        if (message.type === 'start-game-error') {
          setStartGameError(message.reason);
        }
        if (message.type === 'select-pack-error') {
          setSelectPackError(message.reason);
        }
        if (message.type === 'falsestart') {
          setFalsestart(true);
          clearTimeout(falsestartTimer);
          falsestartTimer = setTimeout(
            () => setFalsestart(false),
            FALSESTART_LOCK_MS,
          );
        }
        if (message.type === 'select-question-error') {
          setSelectQuestionBlocked(true);
          clearTimeout(selectQuestionBlockedTimer);
          selectQuestionBlockedTimer = setTimeout(
            () => setSelectQuestionBlocked(false),
            SELECT_QUESTION_BLOCKED_MS,
          );
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        setStatus('disconnected');
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      clearTimeout(falsestartTimer);
      clearTimeout(selectQuestionBlockedTimer);
      wsRef.current?.close();
    };
  }, [wsFactory]);

  function send(message: ClientMessage): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function join(name: string): void {
    pendingNameRef.current = name;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus('joining');
      send({ type: 'join', name });
    }
  }

  return {
    status,
    participants,
    selfId,
    lanUrl,
    game,
    falsestart,
    selectQuestionBlocked,
    hostParticipantId,
    isHost:
      selfId !== null && selfId === (game ? game.hostId : hostParticipantId),
    startGameError,
    join,
    startGame: () => send({ type: 'start-game' }),
    toggleHost: () => send({ type: 'toggle-host' }),
    selectQuestion: (themeIndex, questionId) =>
      send({ type: 'select-question', themeIndex, questionId }),
    placeBid: (amount) => send({ type: 'place-bid', amount }),
    passBid: () => send({ type: 'pass-bid' }),
    assignCat: (recipientParticipantId) =>
      send({ type: 'assign-cat', recipientParticipantId }),
    buzz: () => send({ type: 'buzz' }),
    saidAnswer: () => send({ type: 'said-answer' }),
    vote: (correct) => send({ type: 'vote', correct }),
    adjustScore: (participantId, delta) =>
      send({ type: 'adjust-score', participantId, delta }),
    cancelQuestion: () => send({ type: 'cancel-question' }),
    resetGame: () => send({ type: 'reset-game' }),
    eliminateFinalTheme: (themeIndex) =>
      send({ type: 'eliminate-final-theme', themeIndex }),
    submitWager: (amount) => send({ type: 'submit-wager', amount }),
    submitFinalAnswer: (text) => send({ type: 'submit-final-answer', text }),
    finalVote: (participantId, correct) =>
      send({ type: 'final-vote', participantId, correct }),
    availablePacks,
    activePackFilename,
    selectPackError,
    refreshPacks: () => send({ type: 'refresh-packs' }),
    selectPack: (filename) => send({ type: 'select-pack', filename }),
  };
}
