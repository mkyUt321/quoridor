import type { GameState, PlayerId } from '@quoridor/shared';

interface Props {
  state: GameState;
  youAre: PlayerId;
  you: string;
  opponent: string;
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

export function Hud({ state, youAre, you, opponent, onResign, onRematch, rematchRequestedByMe }: Props) {
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
