import { describe, expect, it } from 'vitest';
import { createInitialState } from './game.js';
import { bestMoveTowardGoal, canStep, hasPath, legalPawnMoves, wallConflict, wallLegal } from './rules.js';
import type { GameState, Position, Wall } from './types.js';

function withState(overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState(), ...overrides };
}

describe('canStep', () => {
  it('直進は壁がなければ許可される', () => {
    expect(canStep([], 4, 4, 3, 4)).toBe(true);
    expect(canStep([], 4, 4, 5, 4)).toBe(true);
    expect(canStep([], 4, 4, 4, 3)).toBe(true);
    expect(canStep([], 4, 4, 4, 5)).toBe(true);
  });

  it('盤外への移動は禁止', () => {
    expect(canStep([], 0, 0, -1, 0)).toBe(false);
    expect(canStep([], 8, 8, 8, 9)).toBe(false);
  });

  it('横壁(H)は縦方向の移動を塞ぐ', () => {
    const walls: Wall[] = [{ r: 4, c: 4, o: 'H' }];
    expect(canStep(walls, 4, 4, 5, 4)).toBe(false);
    expect(canStep(walls, 4, 5, 5, 5)).toBe(false);
    // 横方向は塞がれない
    expect(canStep(walls, 4, 4, 4, 5)).toBe(true);
  });

  it('縦壁(V)は横方向の移動を塞ぐ', () => {
    const walls: Wall[] = [{ r: 4, c: 4, o: 'V' }];
    expect(canStep(walls, 4, 4, 4, 5)).toBe(false);
    expect(canStep(walls, 5, 4, 5, 5)).toBe(false);
    // 縦方向は塞がれない
    expect(canStep(walls, 4, 4, 5, 4)).toBe(true);
  });
});

describe('legalPawnMoves', () => {
  it('初期状態では4隣接のうち盤内3方向が合法(スタート行は盤端)', () => {
    const state = createInitialState();
    const moves = legalPawnMoves(state, 0); // pawn at (8,4)
    expect(moves).toHaveLength(3);
    expect(moves).toEqual(
      expect.arrayContaining([
        { r: 7, c: 4 },
        { r: 8, c: 3 },
        { r: 8, c: 5 },
      ]),
    );
  });

  it('隣接する相手を直進ジャンプできる', () => {
    const state = withState({
      pawns: [
        { r: 4, c: 4 },
        { r: 3, c: 4 },
      ],
    });
    const moves = legalPawnMoves(state, 0);
    expect(moves).toEqual(expect.arrayContaining([{ r: 2, c: 4 }]));
  });

  it('直進ジャンプが壁で塞がれている場合は斜めジャンプが合法になる', () => {
    const state = withState({
      pawns: [
        { r: 4, c: 4 },
        { r: 3, c: 4 },
      ],
      walls: [{ r: 2, c: 3, o: 'H' }, { r: 2, c: 4, o: 'H' }],
    });
    const moves = legalPawnMoves(state, 0);
    expect(moves).not.toEqual(expect.arrayContaining([{ r: 2, c: 4 }]));
    expect(moves).toEqual(expect.arrayContaining([{ r: 3, c: 3 }, { r: 3, c: 5 }]));
  });

  it('直進ジャンプが盤外の場合も斜めジャンプが合法になる', () => {
    const state = withState({
      pawns: [
        { r: 1, c: 4 },
        { r: 0, c: 4 },
      ],
    });
    const moves = legalPawnMoves(state, 0);
    expect(moves).not.toEqual(expect.arrayContaining([{ r: -1, c: 4 }]));
    expect(moves).toEqual(expect.arrayContaining([{ r: 0, c: 3 }, { r: 0, c: 5 }]));
  });

  it('相手がいないマスへは通常移動のみ', () => {
    const state = createInitialState();
    const moves = legalPawnMoves(state, 1); // pawn at (0,4)
    expect(moves).toEqual(
      expect.arrayContaining([
        { r: 1, c: 4 },
        { r: 0, c: 3 },
        { r: 0, c: 5 },
      ]),
    );
  });
});

describe('wallConflict', () => {
  it('同一アンカー・同一向きは重なりとして衝突する', () => {
    const walls: Wall[] = [{ r: 3, c: 3, o: 'H' }];
    expect(wallConflict(walls, { r: 3, c: 3, o: 'H' })).toBe(true);
  });

  it('同一向きで隣接セグメントは重なりとして衝突する', () => {
    const walls: Wall[] = [{ r: 3, c: 3, o: 'H' }];
    expect(wallConflict(walls, { r: 3, c: 4, o: 'H' })).toBe(true);
    expect(wallConflict(walls, { r: 3, c: 2, o: 'H' })).toBe(true);
  });

  it('同一向きで2マス以上離れていれば衝突しない', () => {
    const walls: Wall[] = [{ r: 3, c: 3, o: 'H' }];
    expect(wallConflict(walls, { r: 3, c: 5, o: 'H' })).toBe(false);
  });

  it('同一交点での異なる向きは交差として衝突する', () => {
    const walls: Wall[] = [{ r: 3, c: 3, o: 'H' }];
    expect(wallConflict(walls, { r: 3, c: 3, o: 'V' })).toBe(true);
  });

  it('異なる交点での異なる向きは衝突しない', () => {
    const walls: Wall[] = [{ r: 3, c: 3, o: 'H' }];
    expect(wallConflict(walls, { r: 4, c: 4, o: 'V' })).toBe(false);
  });
});

describe('hasPath (BFS)', () => {
  it('壁がなければゴールへ到達可能', () => {
    const start: Position = { r: 8, c: 4 };
    expect(hasPath([], start, 0)).toBe(true);
  });

  it('ゴール行全体を塞ぐと到達不可能', () => {
    const walls: Wall[] = [];
    for (let c = 0; c < 8; c++) walls.push({ r: 0, c, o: 'H' });
    expect(hasPath(walls, { r: 8, c: 4 }, 0)).toBe(false);
  });
});

describe('wallLegal', () => {
  it('残り壁が0のプレイヤーは設置できない', () => {
    const state = withState({ wallsLeft: [0, 10] });
    expect(wallLegal(state, { r: 3, c: 3, o: 'H' })).toBe(false);
  });

  it('範囲外のアンカーは不正', () => {
    const state = createInitialState();
    expect(wallLegal(state, { r: 8, c: 0, o: 'H' })).toBe(false);
    expect(wallLegal(state, { r: -1, c: 0, o: 'H' })).toBe(false);
  });

  it('相手を完全封鎖する壁は拒否される(BFS 封鎖禁止)', () => {
    const state = withState({
      pawns: [
        { r: 8, c: 4 },
        { r: 1, c: 4 },
      ],
      walls: [
        { r: 0, c: 0, o: 'H' },
        { r: 0, c: 2, o: 'H' },
        { r: 0, c: 4, o: 'H' },
        { r: 0, c: 6, o: 'H' },
      ],
    });
    // 残り1マス分(c=8側の隙間)を塞ぐと相手(P2, goal row 8)は封鎖されないが
    // P1のゴール到達路(row 0)を完全に塞ぐケースを検証する
    expect(wallLegal(state, { r: 0, c: 7, o: 'H' })).toBe(false);
  });

  it('経路を1本残す壁の設置は許可される', () => {
    const state = withState({
      walls: [
        { r: 0, c: 0, o: 'H' },
        { r: 0, c: 2, o: 'H' },
        { r: 0, c: 4, o: 'H' },
      ],
    });
    expect(wallLegal(state, { r: 0, c: 6, o: 'H' })).toBe(true);
  });
});

describe('bestMoveTowardGoal', () => {
  it('壁がなければ直進でゴールへ最短距離が縮むマスを選ぶ', () => {
    const state = createInitialState(); // P1: (8,4) -> goal row 0
    const move = bestMoveTowardGoal(state, 0);
    expect(move).toEqual({ r: 7, c: 4 });
  });

  it('直進が壁で塞がれていれば別の合法手(かつ塞がれた直進先ではない)を選ぶ', () => {
    const state = withState({
      pawns: [
        { r: 4, c: 4 },
        { r: 0, c: 4 },
      ],
      walls: [{ r: 3, c: 3, o: 'H' }, { r: 3, c: 4, o: 'H' }],
    });
    const move = bestMoveTowardGoal(state, 0);
    expect(move).not.toEqual({ r: 3, c: 4 });
    expect(legalPawnMoves(state, 0)).toEqual(expect.arrayContaining([move]));
  });

  it('隣接する相手をジャンプすればゴールへより縮むならジャンプを選ぶ', () => {
    const state = withState({
      pawns: [
        { r: 4, c: 4 },
        { r: 3, c: 4 },
      ],
    });
    const move = bestMoveTowardGoal(state, 0);
    expect(move).toEqual({ r: 2, c: 4 });
  });

  it('既にゴール行に到達していれば距離0のまま合法手の中から選ぶ', () => {
    const state = withState({
      pawns: [
        { r: 0, c: 4 },
        { r: 8, c: 4 },
      ],
    });
    const move = bestMoveTowardGoal(state, 0);
    // ゴール行(0)からの移動なので、どこへ動いても距離は1以上に増える。
    // 単に合法手のいずれかが返ることだけを確認する(既にゴール済みなら通常呼ばれない状況)。
    expect(legalPawnMoves(state, 0)).toEqual(expect.arrayContaining([move]));
  });
});
