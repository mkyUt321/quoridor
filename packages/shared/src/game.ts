import { legalPawnMoves, wallLegal } from './rules.js';
import type { GameState, Move, PlayerId, Position, Result } from './types.js';

export function createInitialState(): GameState {
  return {
    pawns: [
      { r: 8, c: 4 },
      { r: 0, c: 4 },
    ],
    goal: [0, 8],
    walls: [],
    wallsLeft: [10, 10],
    turn: 0,
    last: null,
    winner: null,
  };
}

export function checkWinner(state: GameState): PlayerId | null {
  for (let p = 0; p < 2; p++) {
    const player = p as PlayerId;
    if (state.pawns[player].r === state.goal[player]) return player;
  }
  return null;
}

/** サーバ権威の単一入口。手番一致→種別ごとに合法性検証→新 state を返す。 */
export function applyMove(state: GameState, move: Move, who: PlayerId): Result<GameState> {
  if (state.winner !== null) return { ok: false, error: 'game_over' };
  if (state.turn !== who) return { ok: false, error: 'not_your_turn' };

  if (move.type === 'pawn') {
    const legal = legalPawnMoves(state, who);
    if (!legal.some((p) => p.r === move.to.r && p.c === move.to.c)) {
      return { ok: false, error: 'illegal_pawn_move' };
    }
    const from: Position = state.pawns[who];
    const pawns: [Position, Position] = [...state.pawns];
    pawns[who] = move.to;

    const next: GameState = {
      ...state,
      pawns,
      last: { type: 'pawn', from, to: move.to },
      winner: null,
    };
    const winner = checkWinner(next);
    next.winner = winner;
    next.turn = winner === null ? (who === 0 ? 1 : 0) : state.turn;
    return { ok: true, value: next };
  }

  if (!wallLegal(state, move.wall)) {
    return { ok: false, error: 'illegal_wall' };
  }
  const wallsLeft: [number, number] = [...state.wallsLeft];
  wallsLeft[who] -= 1;

  const next: GameState = {
    ...state,
    walls: [...state.walls, move.wall],
    wallsLeft,
    turn: who === 0 ? 1 : 0,
    last: { type: 'wall', wall: move.wall },
    winner: null,
  };
  return { ok: true, value: next };
}
