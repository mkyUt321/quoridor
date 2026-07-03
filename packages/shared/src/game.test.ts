import { describe, expect, it } from 'vitest';
import { applyMove, checkWinner, createInitialState } from './game.js';
import type { GameState } from './types.js';

describe('createInitialState', () => {
  it('9x9盤・対辺中央スタート・壁10枚ずつ・P1先手', () => {
    const state = createInitialState();
    expect(state.pawns).toEqual([
      { r: 8, c: 4 },
      { r: 0, c: 4 },
    ]);
    expect(state.goal).toEqual([0, 8]);
    expect(state.wallsLeft).toEqual([10, 10]);
    expect(state.turn).toBe(0);
    expect(state.winner).toBeNull();
  });
});

describe('applyMove: 手番', () => {
  it('手番でないプレイヤーの手は拒否される', () => {
    const state = createInitialState();
    const result = applyMove(state, { type: 'pawn', to: { r: 1, c: 4 } }, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not_your_turn');
  });

  it('決着後の手は拒否される', () => {
    const state: GameState = { ...createInitialState(), winner: 0 };
    const result = applyMove(state, { type: 'pawn', to: { r: 6, c: 4 } }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('game_over');
  });
});

describe('applyMove: pawn', () => {
  it('合法な移動で turn が交代し last が記録される', () => {
    const state = createInitialState();
    const result = applyMove(state, { type: 'pawn', to: { r: 7, c: 4 } }, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pawns[0]).toEqual({ r: 7, c: 4 });
      expect(result.value.turn).toBe(1);
      expect(result.value.last).toEqual({ type: 'pawn', from: { r: 8, c: 4 }, to: { r: 7, c: 4 } });
    }
  });

  it('不正な移動先は拒否され盤面は変わらない', () => {
    const state = createInitialState();
    const result = applyMove(state, { type: 'pawn', to: { r: 5, c: 4 } }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('illegal_pawn_move');
  });

  it('ゴール到達で winner が設定され turn は交代しない', () => {
    const state: GameState = { ...createInitialState(), pawns: [{ r: 1, c: 4 }, { r: 0, c: 0 }] };
    const result = applyMove(state, { type: 'pawn', to: { r: 0, c: 4 } }, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.winner).toBe(0);
      expect(result.value.turn).toBe(0);
    }
  });
});

describe('applyMove: wall', () => {
  it('合法な壁設置で wallsLeft が減り turn が交代する', () => {
    const state = createInitialState();
    const result = applyMove(state, { type: 'wall', wall: { r: 3, c: 3, o: 'H' } }, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.wallsLeft).toEqual([9, 10]);
      expect(result.value.walls).toEqual([{ r: 3, c: 3, o: 'H' }]);
      expect(result.value.turn).toBe(1);
    }
  });

  it('残り壁0での壁設置は拒否される', () => {
    const state: GameState = { ...createInitialState(), wallsLeft: [0, 10] };
    const result = applyMove(state, { type: 'wall', wall: { r: 3, c: 3, o: 'H' } }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('illegal_wall');
  });

  it('相手を完全封鎖する壁設置は拒否される', () => {
    let state: GameState = {
      ...createInitialState(),
      pawns: [{ r: 8, c: 4 }, { r: 1, c: 4 }],
      walls: [
        { r: 0, c: 0, o: 'H' },
        { r: 0, c: 2, o: 'H' },
        { r: 0, c: 4, o: 'H' },
        { r: 0, c: 6, o: 'H' },
      ],
    };
    const result = applyMove(state, { type: 'wall', wall: { r: 0, c: 7, o: 'H' } }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('illegal_wall');
  });
});

describe('checkWinner', () => {
  it('どちらもゴール未到達なら null', () => {
    expect(checkWinner(createInitialState())).toBeNull();
  });

  it('P2 がゴール行(8)に到達したら 1', () => {
    const state: GameState = { ...createInitialState(), pawns: [{ r: 8, c: 4 }, { r: 8, c: 0 }] };
    expect(checkWinner(state)).toBe(1);
  });
});
