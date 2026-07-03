import {
  applyMove,
  createInitialState,
  type GameState,
  type Move,
  type PlayerId,
  type Result,
} from '@quoridor/shared';

export type RematchVote = 'offered' | 'agreed';

/** ランタイム非依存の対局セッション中核。RoomDO から呼ばれる純ロジック。 */
export class Session {
  state: GameState = createInitialState();
  private rematchVotes = new Set<PlayerId>();

  move(move: Move, who: PlayerId): Result<GameState> {
    const result = applyMove(this.state, move, who);
    if (result.ok) this.state = result.value;
    return result;
  }

  resign(who: PlayerId): GameState {
    const winner: PlayerId = who === 0 ? 1 : 0;
    this.state = { ...this.state, winner };
    return this.state;
  }

  requestRematch(who: PlayerId): RematchVote {
    this.rematchVotes.add(who);
    if (this.rematchVotes.size < 2) return 'offered';
    this.rematchVotes.clear();
    this.state = createInitialState();
    return 'agreed';
  }
}
