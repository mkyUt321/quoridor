import { useCallback, useEffect, useRef, useState } from 'react';
import { isServerMsg, type ClientMsg, type GameState, type PlayerId } from '@quoridor/shared';

const SESSION_KEY = 'quoridor_session';

interface PersistedSession {
  room: string;
  name: string;
  token: string;
  cpu: boolean;
}

function savePersistedSession(session: PersistedSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadPersistedSession(): PersistedSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

function clearPersistedSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export type Phase = 'home' | 'waiting' | 'playing';
export type GameOverReason = 'goal' | 'resign';

export type Notice =
  | { kind: 'opponentLeft'; grace: number }
  | { kind: 'opponentBack' }
  | { kind: 'rematchOffered' };

/** 持ち時間。syncedAt はこの remainingMs を受け取った時刻(クライアントの Date.now())で、
 *  手番側の残り時間は Date.now() - syncedAt を差し引いて表示する。 */
export interface Clock {
  remainingMs: [number, number];
  turn: PlayerId;
  syncedAt: number;
}

export interface GameSocketState {
  phase: Phase;
  state: GameState | null;
  youAre: PlayerId | null;
  /** 自分のニックネーム。リロード後の自動 rejoin でも sessionStorage から復元される。 */
  you: string;
  opponent: string | null;
  error: string | null;
  gameOverReason: GameOverReason | null;
  notice: Notice | null;
  /** 自分がまだ rematch を要求していないか。true の間は自分のボタンを「応答待ち」で無効化する。 */
  rematchRequestedByMe: boolean;
  clock: Clock | null;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

const initialState: GameSocketState = {
  phase: 'home',
  state: null,
  youAre: null,
  you: '',
  opponent: null,
  error: null,
  gameOverReason: null,
  notice: null,
  rematchRequestedByMe: false,
  clock: null,
};

export function useGameSocket() {
  const [state, setState] = useState<GameSocketState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const nameRef = useRef<string>('');
  const tokenRef = useRef<string | null>(null);
  const cpuRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const backoffRef = useRef(MIN_BACKOFF_MS);

  const openSocket = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const cpuParam = cpuRef.current ? '&cpu=1' : '';
    const ws = new WebSocket(
      wsUrl(`/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(nameRef.current)}${cpuParam}`),
    );
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      backoffRef.current = MIN_BACKOFF_MS;
      if (tokenRef.current) ws.send(JSON.stringify({ t: 'rejoin', token: tokenRef.current }));
    });

    ws.addEventListener('message', (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (!isServerMsg(parsed)) return;

      switch (parsed.t) {
        case 'waiting':
          setState((s) => ({ ...s, phase: 'waiting' }));
          break;
        case 'matched':
          tokenRef.current = parsed.token;
          if (roomRef.current) {
            savePersistedSession({
              room: roomRef.current,
              name: nameRef.current,
              token: parsed.token,
              cpu: cpuRef.current,
            });
          }
          setState((s) => ({
            ...s,
            phase: 'playing',
            youAre: parsed.you,
            opponent: parsed.opponent,
            state: parsed.state,
            gameOverReason: null,
            notice: null,
            rematchRequestedByMe: false,
          }));
          break;
        case 'state':
          setState((s) => ({ ...s, state: parsed.state }));
          break;
        case 'gameOver':
          setState((s) => ({ ...s, gameOverReason: parsed.reason }));
          break;
        case 'opponentLeft':
          setState((s) => ({ ...s, notice: { kind: 'opponentLeft', grace: parsed.grace } }));
          break;
        case 'opponentBack':
          setState((s) => ({ ...s, notice: { kind: 'opponentBack' } }));
          break;
        case 'rematchOffered':
          // 相手が既に rematch を要求した(自分はまだ)。自分のボタンは有効なまま、押せば即成立する。
          setState((s) => ({ ...s, notice: { kind: 'rematchOffered' } }));
          break;
        case 'rematchAgreed':
          setState((s) => ({ ...s, notice: null, gameOverReason: null, rematchRequestedByMe: false }));
          break;
        case 'clock':
          setState((s) => ({
            ...s,
            clock: { remainingMs: parsed.remainingMs, turn: parsed.turn, syncedAt: Date.now() },
          }));
          break;
        case 'error':
          setState((s) => ({ ...s, error: parsed.message }));
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (intentionalCloseRef.current) return;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      setTimeout(() => {
        if (!intentionalCloseRef.current) openSocket();
      }, delay);
    });
  }, []);

  const connectRoom = useCallback(
    (room: string, name: string, cpu = false) => {
      // 対局終了後に再びクイックマッチへ入る等、既存の接続がある状態で呼ばれることもある。
      // ここで明示的に閉じておかないと古い接続が残り続ける(close イベントは古い ws 自身の
      // 参照と wsRef.current を比較して判定するため、先に wsRef.current を差し替えても
      // 古い接続の再接続ロジックは正しく無効化される)。
      wsRef.current?.close();
      roomRef.current = room;
      nameRef.current = name;
      tokenRef.current = null;
      cpuRef.current = cpu;
      intentionalCloseRef.current = false;
      backoffRef.current = MIN_BACKOFF_MS;
      setState({ ...initialState, phase: 'waiting', you: name });
      openSocket();
    },
    [openSocket],
  );

  // ページ再読み込み後、進行中のセッションが sessionStorage にあれば自動で rejoin する。
  // StrictMode の開発時二重マウント(mount→cleanup→mount)でも WS が1本だけ残るよう、
  // cleanup で必ずこのマウントが開いた接続を閉じる。
  useEffect(() => {
    const saved = loadPersistedSession();
    if (!saved) return;
    roomRef.current = saved.room;
    nameRef.current = saved.name;
    tokenRef.current = saved.token;
    cpuRef.current = saved.cpu === true;
    intentionalCloseRef.current = false;
    backoffRef.current = MIN_BACKOFF_MS;
    setState({ ...initialState, phase: 'waiting', you: saved.name });
    openSocket();
    return () => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const joinPass = useCallback(
    (pass: string, name: string) => connectRoom(`p:${pass.trim()}`, name),
    [connectRoom],
  );

  const joinQuick = useCallback(
    async (name: string) => {
      setState({ ...initialState, phase: 'waiting', you: name });
      const res = await fetch('/quick', { method: 'POST' });
      const { roomKey } = (await res.json()) as { roomKey: string };
      connectRoom(roomKey, name);
    },
    [connectRoom],
  );

  const joinCpu = useCallback(
    (name: string) => connectRoom(`cpu:${crypto.randomUUID()}`, name, true),
    [connectRoom],
  );

  const send = useCallback((msg: ClientMsg) => {
    if (msg.t === 'rematch') {
      setState((s) => ({ ...s, rematchRequestedByMe: true }));
    }
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const leave = useCallback(() => {
    intentionalCloseRef.current = true;
    roomRef.current = null;
    tokenRef.current = null;
    clearPersistedSession();
    wsRef.current?.close();
    wsRef.current = null;
    setState(initialState);
  }, []);

  return { ...state, joinPass, joinQuick, joinCpu, send, leave };
}
