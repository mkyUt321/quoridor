import { useCallback, useRef, useState } from 'react';
import { isServerMsg, type ClientMsg, type GameState, type PlayerId } from '@quoridor/shared';

export type Phase = 'home' | 'waiting' | 'playing' | 'over';

export interface GameSocketState {
  phase: Phase;
  state: GameState | null;
  youAre: PlayerId | null;
  opponent: string | null;
  error: string | null;
}

function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

export function useGameSocket() {
  const [state, setState] = useState<GameSocketState>({
    phase: 'home',
    state: null,
    youAre: null,
    opponent: null,
    error: null,
  });
  const wsRef = useRef<WebSocket | null>(null);

  const joinPass = useCallback((pass: string, name: string) => {
    const room = `p:${pass.trim()}`;
    const ws = new WebSocket(wsUrl(`/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`));
    wsRef.current = ws;
    setState((s) => ({ ...s, phase: 'waiting', error: null }));

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
          }));
          break;
        case 'state':
          setState((s) => ({ ...s, state: parsed.state }));
          break;
        case 'gameOver':
          setState((s) => ({ ...s, phase: 'over' }));
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
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { ...state, joinPass, send };
}
