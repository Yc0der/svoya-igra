import { useEffect, useRef, useState } from 'react';
import type {
  GameStateView,
  ParticipantView,
  StartGameErrorReason,
} from './useRoomConnection';

// Админ-панель (design.md, «Админ-панель») — отдельный от useRoomConnection
// хук: сокет админки никогда не шлёт 'join'/'reconnect', не хранит токен в
// localStorage и не занимает место участника. Он получает те же
// широковещательные 'state' от сервера (server.ts шлёт их каждому
// подключённому сокету независимо от того, представился тот или нет), но
// шлёт в ответ только admin-* сообщения.
type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | {
      type: 'state';
      participants: ParticipantView[];
      hostParticipantId: string | null;
      game: GameStateView | null;
    }
  | { type: 'start-game-error'; reason: StartGameErrorReason };

type ClientMessage =
  | { type: 'admin-start-game' }
  | { type: 'admin-reset-game' }
  | { type: 'admin-reset-room' }
  | { type: 'admin-kick'; participantId: string }
  | { type: 'admin-set-host'; participantId: string | null };

export interface AdminConnection {
  // Открыт ли прямо сейчас собственный сокет админки — не то же самое, что
  // "жива ли комната": пока идёт переподключение, последнее известное
  // состояние ниже остаётся на экране, не сбрасываясь в пустоту.
  connected: boolean;
  lanUrl: string | null;
  participants: ParticipantView[];
  hostParticipantId: string | null;
  game: GameStateView | null;
  startGameError: StartGameErrorReason | null;
  startGame(): void;
  resetGame(): void;
  resetRoom(): void;
  kick(participantId: string): void;
  setHost(participantId: string | null): void;
}

const RECONNECT_DELAY_MS = 2000;

type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

export function useAdminConnection(
  wsFactory: WebSocketFactory = defaultWsFactory,
): AdminConnection {
  const [connected, setConnected] = useState(false);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [hostParticipantId, setHostParticipantId] = useState<string | null>(
    null,
  );
  const [game, setGame] = useState<GameStateView | null>(null);
  const [startGameError, setStartGameError] =
    useState<StartGameErrorReason | null>(null);
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

        if (message.type === 'hello') {
          setLanUrl(message.lanUrl);
        }
        if (message.type === 'state') {
          setParticipants(message.participants);
          setHostParticipantId(message.hostParticipantId);
          setGame(message.game);
          setStartGameError(null);
        }
        if (message.type === 'start-game-error') {
          setStartGameError(message.reason);
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
    participants,
    hostParticipantId,
    game,
    startGameError,
    startGame: () => send({ type: 'admin-start-game' }),
    resetGame: () => send({ type: 'admin-reset-game' }),
    resetRoom: () => send({ type: 'admin-reset-room' }),
    kick: (participantId) => send({ type: 'admin-kick', participantId }),
    setHost: (participantId) => send({ type: 'admin-set-host', participantId }),
  };
}
