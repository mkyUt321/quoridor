import { useCallback, useRef, useState } from 'react';
import { isServerMsg, type ClientMsg, type GameState, type PlayerId } from '@quoridor/shared';

export type Phase = 'home' | 'waiting' | 'playing';
export type GameOverReason = 'goal' | 'resign' | 'disconnect';

export type Notice =
  | { kind: 'opponentLeft'; grace: number }
  | { kind: 'opponentBack' }
  | { kind: 'rematchOffered' };

export interface GameSocketState {
  phase: Phase;
  state: GameState | null;
  youAre: PlayerId | null;
  opponent: string | null;
  error: string | null;
  gameOverReason: GameOverReason | null;
  notice: Notice | null;
  /** 自分がまだ rematch を要求していないか。true の間は自分のボタンを「応答待ち」で無効化する。 */
  rematchRequestedByMe: boolean;
}

function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

const initialState: GameSocketState = {
  phase: 'home',
  state: null,
  youAre: null,
  opponent: null,
  error: null,
  gameOverReason: null,
  notice: null,
  rematchRequestedByMe: false,
};

export function useGameSocket() {
  const [state, setState] = useState<GameSocketState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);

  const joinPass = useCallback((pass: string, name: string) => {
    const room = `p:${pass.trim()}`;
    const ws = new WebSocket(wsUrl(`/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`));
    wsRef.current = ws;
    setState({ ...initialState, phase: 'waiting' });

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
        case 'error':
          setState((s) => ({ ...s, error: parsed.message }));
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      if (wsRef.current === ws) wsRef.current = null;
    });
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    if (msg.t === 'rematch') {
      setState((s) => ({ ...s, rematchRequestedByMe: true }));
    }
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const leave = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState(initialState);
  }, []);

  return { ...state, joinPass, send, leave };
}
