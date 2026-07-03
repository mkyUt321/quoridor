import { useEffect, useRef } from 'react';
import type { ClientMsg, GameState, PlayerId } from '@quoridor/shared';
import type { Clock, GameOverReason, Notice } from '../net/useGameSocket.js';
import { Board } from './Board.js';
import { Hud } from './Hud.js';
import { WaitingOverlay } from './WaitingOverlay.js';

const REASON_LABEL: Record<GameOverReason, string> = {
  goal: 'ゴール到達',
  resign: '投了',
  disconnect: '相手の切断',
  timeout: '時間切れ',
};

interface Props {
  state: GameState;
  youAre: PlayerId;
  you: string;
  opponent: string;
  gameOverReason: GameOverReason | null;
  notice: Notice | null;
  clock: Clock | null;
  rematchRequestedByMe: boolean;
  send: (msg: ClientMsg) => void;
  onRematch: () => void;
  onBackToHome: () => void;
}

export function Game({
  state,
  youAre,
  you,
  opponent,
  gameOverReason,
  notice,
  clock,
  rematchRequestedByMe,
  send,
  onRematch,
  onBackToHome,
}: Props) {
  const youWon = state.winner === youAre;
  const claimedRef = useRef(false);

  // 自分の手元の時計表示が手番側の残り時間切れを検知したら、サーバへ申告する。
  // サーバは自前のタイムスタンプで再計算して検証するため、誤申告があっても無視されるだけで安全。
  useEffect(() => {
    claimedRef.current = false;
  }, [clock?.turn, state.winner]);

  useEffect(() => {
    if (!clock || state.winner !== null) return;
    const check = () => {
      if (claimedRef.current) return;
      const elapsed = Date.now() - clock.syncedAt;
      const remaining = clock.remainingMs[clock.turn] - elapsed;
      if (remaining <= 0) {
        claimedRef.current = true;
        send({ t: 'claimTimeout' });
      }
    };
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [clock, state.winner, send]);

  return (
    <div className="game">
      <Hud
        state={state}
        youAre={youAre}
        you={you}
        opponent={opponent}
        clock={clock}
        onResign={() => send({ t: 'resign' })}
        onRematch={onRematch}
        onBackToHome={onBackToHome}
        rematchRequestedByMe={rematchRequestedByMe}
      />
      <div className="board-wrap">
        <Board state={state} youAre={youAre} onMove={(move) => send({ t: 'move', move })} />
        {state.winner !== null && (
          <div className="overlay show">
            <div className="wincard">
              <div className={`big${youWon ? ' win' : ' lose'}`}>{youWon ? 'あなたの勝ち!' : 'あなたの負け...'}</div>
              {gameOverReason && <div className="reason">{REASON_LABEL[gameOverReason]}</div>}
              <div className="wincard-actions">
                <button type="button" className="btn primary" onClick={onRematch} disabled={rematchRequestedByMe}>
                  {rematchRequestedByMe ? 'もう一局(相手の応答待ち)' : 'もう一局'}
                </button>
                <button type="button" className="btn" onClick={onBackToHome}>
                  ホームに戻る
                </button>
              </div>
            </div>
          </div>
        )}
        <WaitingOverlay notice={notice} opponent={opponent} />
      </div>
    </div>
  );
}
