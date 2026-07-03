import { useEffect, useState } from 'react';
import type { GameState, PlayerId } from '@quoridor/shared';
import type { Clock } from '../net/useGameSocket.js';

interface Props {
  state: GameState;
  youAre: PlayerId;
  you: string;
  opponent: string;
  clock: Clock | null;
  onResign: () => void;
  onRematch: () => void;
  rematchRequestedByMe: boolean;
}

function Pips({ wallsLeft, color }: { wallsLeft: number; color: 'p1' | 'p2' }) {
  return (
    <div className={`pips pips-${color}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`pip pip-${color}${i >= wallsLeft ? ' used' : ''}`} />
      ))}
    </div>
  );
}

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Countdown({ clock, seat }: { clock: Clock | null; seat: PlayerId }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  if (!clock) return null;
  const elapsed = clock.turn === seat ? Date.now() - clock.syncedAt : 0;
  const remaining = clock.remainingMs[seat] - elapsed;
  return <span className={`clock${remaining <= 30_000 ? ' low' : ''}`}>{formatClock(remaining)}</span>;
}

export function Hud({ state, youAre, you, opponent, clock, onResign, onRematch, rematchRequestedByMe }: Props) {
  const gameOver = state.winner !== null;
  const myTurn = state.turn === youAre && !gameOver;

  const p1Name = youAre === 0 ? you : opponent;
  const p2Name = youAre === 0 ? opponent : you;

  return (
    <div className="hud">
      <div className="statusbar">
        <div className={`pcard p1${state.turn === 0 && !gameOver ? ' active' : ''}`}>
          <span className="dot" />
          <div className="who">
            <span className="name">{p1Name}</span>
            <Pips wallsLeft={state.wallsLeft[0]} color="p1" />
          </div>
          <Countdown clock={clock} seat={0} />
        </div>
        <div className="turnwrap">
          <div className={`turn${myTurn ? ' mine' : ''}`}>
            {gameOver ? '対局終了' : myTurn ? 'あなたの番' : `${opponent}の番`}
          </div>
        </div>
        <div className={`pcard p2${state.turn === 1 && !gameOver ? ' active' : ''}`}>
          <span className="dot" />
          <div className="who">
            <span className="name">{p2Name}</span>
            <Pips wallsLeft={state.wallsLeft[1]} color="p2" />
          </div>
          <Countdown clock={clock} seat={1} />
        </div>
      </div>
      <div className="toolbar">
        {!gameOver && (
          <button type="button" className="btn" onClick={onResign}>
            投了
          </button>
        )}
        {gameOver && (
          <button type="button" className="btn primary" onClick={onRematch} disabled={rematchRequestedByMe}>
            {rematchRequestedByMe ? 'もう一局(相手の応答待ち)' : 'もう一局'}
          </button>
        )}
      </div>
    </div>
  );
}
