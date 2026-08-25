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
    };

type ClientMessage =
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null }
  // ВРЕМЕННО — см. комментарий у EngineEvent.skip-to-final в server/src/engine.ts.
  | { type: 'admin-skip-to-final' }
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
  | {
      type: 'admin-report-question';
      filename: string;
      questionId: string;
      complaint: string;
    };

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
  reportError: string | null;
  reportAckVersion: number;
  clearReportError(): void;
  reportQuestion(filename: string, questionId: string, complaint: string): void;
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
  const [textRevealFadeMs, setTextRevealFadeMsState] = useState(200);
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
    reportError,
    reportAckVersion,
    clearReportError: () => setReportError(null),
    reportQuestion: (filename, questionId, complaint) =>
      send({ type: 'admin-report-question', filename, questionId, complaint }),
  };
}
