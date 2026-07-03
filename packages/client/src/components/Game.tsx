import type { ClientMsg, GameState, PlayerId } from '@quoridor/shared';
import type { Notice } from '../net/useGameSocket.js';
import { Board } from './Board.js';
import { Hud } from './Hud.js';
import { WaitingOverlay } from './WaitingOverlay.js';

const REASON_LABEL: Record<'goal' | 'resign' | 'disconnect', string> = {
  goal: 'ゴール到達',
  resign: '投了',
  disconnect: '相手の切断',
};

interface Props {
  state: GameState;
  youAre: PlayerId;
  you: string;
  opponent: string;
  gameOverReason: 'goal' | 'resign' | 'disconnect' | null;
  notice: Notice | null;
  rematchRequestedByMe: boolean;
  send: (msg: ClientMsg) => void;
}

export function Game({ state, youAre, you, opponent, gameOverReason, notice, rematchRequestedByMe, send }: Props) {
  const winnerName = state.winner === youAre ? you : opponent;
  const requestRematch = () => send({ t: 'rematch' });

  return (
    <div className="game">
      <Hud
        state={state}
        youAre={youAre}
        you={you}
        opponent={opponent}
        onResign={() => send({ t: 'resign' })}
        onRematch={requestRematch}
        rematchRequestedByMe={rematchRequestedByMe}
      />
      <div className="board-wrap">
        <Board state={state} youAre={youAre} onMove={(move) => send({ t: 'move', move })} />
        {state.winner !== null && (
          <div className="overlay show">
            <div className="wincard">
              <div className="big">
                <span>{winnerName}</span> の勝ち
              </div>
              {gameOverReason && <div className="reason">{REASON_LABEL[gameOverReason]}</div>}
              <button type="button" className="btn primary" onClick={requestRematch} disabled={rematchRequestedByMe}>
                {rematchRequestedByMe ? 'もう一局(相手の応答待ち)' : 'もう一局'}
              </button>
            </div>
          </div>
        )}
        <WaitingOverlay notice={notice} opponent={opponent} />
      </div>
    </div>
  );
}
