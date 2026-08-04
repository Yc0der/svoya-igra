import { useEffect, useRef, useState } from 'react';

export interface ParticipantView {
  id: string;
  name: string;
  connected: boolean;
}

type ServerMessage =
  | { type: 'hello'; lanUrl: string }
  | { type: 'joined'; participantId: string; token: string; name: string }
  | { type: 'name-taken' }
  | { type: 'invalid-token' }
  | { type: 'state'; participants: ParticipantView[] };

type ClientMessage =
  { type: 'join'; name: string } | { type: 'reconnect'; token: string };

export type ConnectionStatus =
  'connecting' | 'joining' | 'joined' | 'name-taken' | 'disconnected';

export interface RoomConnection {
  status: ConnectionStatus;
  participants: ParticipantView[];
  selfId: string | null;
  lanUrl: string | null;
  join(name: string): void;
}

const TOKEN_KEY = 'svoya-igra-token';
const RECONNECT_DELAY_MS = 2000;

type WebSocketFactory = (url: string) => WebSocket;

const defaultWsFactory: WebSocketFactory = (url) => new WebSocket(url);

export function useRoomConnection(
  wsFactory: WebSocketFactory = defaultWsFactory,
): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

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

        if (message.type === 'hello') {
          setLanUrl(message.lanUrl);
        }
        if (message.type === 'joined') {
          localStorage.setItem(TOKEN_KEY, message.token);
          setSelfId(message.participantId);
          setStatus('joined');
        }
        if (message.type === 'name-taken') {
          setStatus('name-taken');
        }
        if (message.type === 'invalid-token') {
          localStorage.removeItem(TOKEN_KEY);
          setStatus('connecting');
        }
        if (message.type === 'state') {
          setParticipants(message.participants);
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
      wsRef.current?.close();
    };
  }, [wsFactory]);

  function join(name: string): void {
    pendingNameRef.current = name;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus('joining');
      const message: ClientMessage = { type: 'join', name };
      ws.send(JSON.stringify(message));
    }
  }

  return { status, participants, selfId, lanUrl, join };
}
