import { describe, expect, it } from 'vitest';
import { chooseAiMove, evaluate } from './ai.js';
import { applyMove, createInitialState } from './game.js';
import { legalPawnMoves } from './rules.js';
import type { GameState, Move } from './types.js';

function withState(overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState(), ...overrides };
}

/** 決定的な擬似乱数(seed 固定)。rng を渡す経路のテスト用。 */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('evaluate', () => {
  it('自分が勝った局面は大きな正の値', () => {
    const state = withState({ winner: 0 });
    expect(evaluate(state, 0)).toBeGreaterThan(1000);
    expect(evaluate(state, 1)).toBeLessThan(-1000);
  });

  it('自分の方がゴールに近い局面は正の評価', () => {
    // P0 は残り1手でゴール(row 0)、P1 は初期位置から遠い
    const state = withState({
      pawns: [
        { r: 1, c: 4 },
        { r: 0, c: 0 },
      ],
    });
    expect(evaluate(state, 0)).toBeGreaterThan(0);
  });
});

describe('chooseAiMove', () => {
  it('初期局面で合法な手を返す', () => {
    const state = createInitialState();
    const move = chooseAiMove(state, 0);
    const res = applyMove(state, move, 0);
    expect(res.ok).toBe(true);
  });

  it('ゴール直前ならゴールへ進む勝ち手を選ぶ', () => {
    // P0 は (1,4)。row 0 がゴールなので (0,4) へ進めば勝ち。
    const state = withState({
      pawns: [
        { r: 1, c: 4 },
        { r: 8, c: 4 },
      ],
    });
    const move = chooseAiMove(state, 0);
    expect(move).toEqual({ type: 'pawn', to: { r: 0, c: 4 } });
    const res = applyMove(state, move, 0);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.winner).toBe(0);
  });

  it('壁がなければゴール方向へ距離を縮める手を選ぶ', () => {
    const state = createInitialState(); // P0 (8,4) -> row 0
    const move = chooseAiMove(state, 0);
    // 壁を置くよりゴールへ前進する方が距離差評価で有利なので、前進コマ移動を選ぶはず。
    expect(move.type).toBe('pawn');
    if (move.type === 'pawn') expect(move.to).toEqual({ r: 7, c: 4 });
  });

  it('rng を渡さなければ決定的(同じ入力で同じ手)', () => {
    // depth を明示して高速化する(既定経路のノード数予算ベース反復深化も決定的だが、
    // 1回あたり最大1秒近くかかるためテストが遅くなる)。
    const state = createInitialState();
    const a = chooseAiMove(state, 0, { depth: 2 });
    const b = chooseAiMove(state, 0, { depth: 2 });
    expect(a).toEqual(b);
  });

  it('rng 経路でも常に合法手を返す', () => {
    // depth は既定値(3)だと1手ごとに1秒前後かかりテストが遅くなるため、この性質は
    // 探索深さに依存しないので明示的に depth:2 に固定して高速化する。
    const rng = seededRng(12345);
    const state = createInitialState();
    for (let i = 0; i < 10; i++) {
      const move = chooseAiMove(state, 0, { rng, depth: 2 });
      const res = applyMove(state, move, 0);
      expect(res.ok).toBe(true);
    }
  });

  it('AI 同士を対局させても常に合法手で必ず決着する', () => {
    // depth:2 に固定(理由は上のテストと同じ)。最大400手までの終局性は深さに
    // 依存しない一般的な性質なので、速い深さで検証すれば十分。
    let state = createInitialState();
    const rng = seededRng(777);
    let turns = 0;
    while (state.winner === null && turns < 400) {
      const move: Move = chooseAiMove(state, state.turn, { rng, depth: 2 });
      const res = applyMove(state, move, state.turn);
      expect(res.ok).toBe(true);
      if (!res.ok) break;
      state = res.value;
      turns += 1;
    }
    expect(state.winner).not.toBeNull();
  });

  it('返す手は必ず legalPawnMoves もしくは合法な壁手のいずれか', () => {
    const state = createInitialState();
    const move = chooseAiMove(state, 1, { depth: 2 });
    if (move.type === 'pawn') {
      expect(legalPawnMoves(state, 1)).toEqual(expect.arrayContaining([move.to]));
    } else {
      const res = applyMove(state, move, 1);
      expect(res.ok).toBe(true);
    }
  });

  it('既定経路(depth省略時のノード数予算ベース反復深化)でも合法手を返し、概ね1秒程度に収まる', () => {
    // ノード数予算(既定24,000)は Node.js 上で概ね1秒前後に収まるよう実測で調整した
    // 値。performance.now() ベースの時間予算は Cloudflare Workers がタイマーを凍結
    // するため機能せず、ノード数ベースに変更した経緯がある(ai.ts のコメント参照)。
    const state = createInitialState();
    const t0 = performance.now();
    const move = chooseAiMove(state, 0);
    const elapsed = performance.now() - t0;
    const res = applyMove(state, move, 0);
    expect(res.ok).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('chooseAiMove の同じマス往復の抑止(recentOwnSquares)', () => {
  it('直近にいたマスへ戻る手は、他に同等以上の選択肢があれば避ける', () => {
    // 初期局面: 前進(7,4)が距離-1で最良(既存テスト同様)。ここで(7,4)を「2手前に
    // 自分がいたマス」として渡すと、前進の優位(distance差1=評価10点相当)より
    // 逆戻りペナルティの方が大きいため、前進ではなく横移動が選ばれるはず。
    const state = createInitialState();
    const move = chooseAiMove(state, 0, { depth: 1, recentOwnSquares: [{ r: 7, c: 4 }] });
    expect(move).not.toEqual({ type: 'pawn', to: { r: 7, c: 4 } });
    if (move.type === 'pawn') expect(move.to.r).toBe(8); // 前進せず同じ行に留まる
  });

  it('逆戻りが唯一の勝ち手なら、ペナルティより優先してそれを選ぶ', () => {
    // ゴール直前(1,4)から(0,4)へ進めば勝利。(0,4)を recentOwnSquares に含めても
    // WIN_SCORE がペナルティを圧倒的に上回るため、勝ち手が選ばれ続ける。
    const state = withState({
      pawns: [
        { r: 1, c: 4 },
        { r: 8, c: 4 },
      ],
    });
    const move = chooseAiMove(state, 0, { depth: 1, recentOwnSquares: [{ r: 0, c: 4 }] });
    expect(move).toEqual({ type: 'pawn', to: { r: 0, c: 4 } });
  });

  it('recentOwnSquares を渡さなければ従来どおり前進を選ぶ', () => {
    const state = createInitialState();
    const move = chooseAiMove(state, 0, { depth: 1 });
    expect(move).toEqual({ type: 'pawn', to: { r: 7, c: 4 } });
  });
});
