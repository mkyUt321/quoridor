import { applyMove } from './game.js';
import { WALL_ANCHOR_MAX, legalPawnMoves, shortestPathLength, wallLegal } from './rules.js';
import type { GameState, Move, PlayerId, Position, Wall } from './types.js';

/** 勝敗が確定した局面の評価値。通常の距離差評価より十分大きくして常に優先させる。 */
const WIN_SCORE = 1_000_000;
/** 既定の探索深さ。2 = 自分の手 → 相手の最善応手 まで読む。 */
const DEFAULT_DEPTH = 2;
/** 相手コマ周辺で壁候補として検討するアンカーのチェビシェフ半径。 */
const OPP_WALL_RADIUS = 2;
/** 自分コマ周辺で壁候補として検討するアンカーのチェビシェフ半径(防御的な壁用)。 */
const SELF_WALL_RADIUS = 1;

export interface AiOptions {
  /** 探索深さ(既定 2)。 */
  depth?: number;
  /** 同点最善手が複数あるときのタイブレーク用乱数。省略時は決定的(先頭を選ぶ)。 */
  rng?: () => number;
}

function opponentOf(who: PlayerId): PlayerId {
  return who === 0 ? 1 : 0;
}

function chebyshev(r1: number, c1: number, r2: number, c2: number): number {
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

/**
 * who 視点での盤面評価。大きいほど who に有利。
 * 主指標: 相手のゴールまでの距離 − 自分のゴールまでの距離(自分が近いほど良い)。
 * 副指標: 残り壁数の差(将来の妨害余地を少しだけ評価に織り込む)。
 */
export function evaluate(state: GameState, who: PlayerId): number {
  const opp = opponentOf(who);
  if (state.winner === who) return WIN_SCORE;
  if (state.winner === opp) return -WIN_SCORE;

  const myDist = shortestPathLength(state.walls, state.pawns[who], state.goal[who]);
  const oppDist = shortestPathLength(state.walls, state.pawns[opp], state.goal[opp]);
  return (oppDist - myDist) * 10 + (state.wallsLeft[who] - state.wallsLeft[opp]);
}

/**
 * mover が検討に値する壁候補を絞り込む。全 128 通りを毎ノードで検証すると探索が
 * 重すぎるため、相手コマ周辺(妨害)と自分コマ周辺(防御)のアンカーだけに限定し、
 * wallLegal を通ったものだけを返す。
 */
function candidateWalls(state: GameState, mover: PlayerId): Wall[] {
  if (state.wallsLeft[mover] <= 0) return [];
  const opp = state.pawns[opponentOf(mover)];
  const me = state.pawns[mover];

  const walls: Wall[] = [];
  const orientations: Array<'H' | 'V'> = ['H', 'V'];
  for (let r = 0; r <= WALL_ANCHOR_MAX; r++) {
    for (let c = 0; c <= WALL_ANCHOR_MAX; c++) {
      const near =
        chebyshev(r, c, opp.r, opp.c) <= OPP_WALL_RADIUS ||
        chebyshev(r, c, me.r, me.c) <= SELF_WALL_RADIUS;
      if (!near) continue;
      for (const o of orientations) {
        const w: Wall = { r, c, o };
        if (wallLegal(state, w)) walls.push(w);
      }
    }
  }
  return walls;
}

/**
 * mover の合法手一覧。ゴールに近づくコマ移動を先頭に寄せて並べ、alpha-beta 枝刈りの
 * 効率を上げる(良さそうな手を先に調べるほど枝刈りが効く)。壁手はその後に続ける。
 */
function orderedMoves(state: GameState, mover: PlayerId): Move[] {
  const goalRow = state.goal[mover];
  const pawnMoves = legalPawnMoves(state, mover)
    .map((to) => ({ to, d: shortestPathLength(state.walls, to, goalRow) }))
    .sort((a, b) => a.d - b.d)
    .map(({ to }): Move => ({ type: 'pawn', to }));

  const wallMoves = candidateWalls(state, mover).map((wall): Move => ({ type: 'wall', wall }));
  return [...pawnMoves, ...wallMoves];
}

/**
 * root 視点の評価を最大化するミニマックス(alpha-beta 枝刈り付き)。
 * mover はこのノードで手を指すプレイヤー、root は評価を最大化したい AI 自身。
 */
function search(
  state: GameState,
  mover: PlayerId,
  depth: number,
  alpha: number,
  beta: number,
  root: PlayerId,
): number {
  if (state.winner !== null || depth === 0) return evaluate(state, root);

  const maximizing = mover === root;
  let value = maximizing ? -Infinity : Infinity;

  for (const move of orderedMoves(state, mover)) {
    const res = applyMove(state, move, mover);
    if (!res.ok) continue;
    const score = search(res.value, opponentOf(mover), depth - 1, alpha, beta, root);
    if (maximizing) {
      if (score > value) value = score;
      if (value > alpha) alpha = value;
    } else {
      if (score < value) value = score;
      if (value < beta) beta = value;
    }
    if (beta <= alpha) break;
  }
  return value;
}

/**
 * who の手番で AI が指す手を選ぶ純関数。ミニマックスで最善手を求め、同点最善手が
 * 複数あって rng が渡されていれば、その中からランダムに選んで対局に変化を持たせる。
 * rng を省略すると決定的(常に同じ手)になり、テストしやすい。
 */
export function chooseAiMove(state: GameState, who: PlayerId, options: AiOptions = {}): Move {
  const depth = options.depth ?? DEFAULT_DEPTH;
  const rng = options.rng;

  let bestScore = -Infinity;
  const best: Move[] = [];
  for (const move of orderedMoves(state, who)) {
    const res = applyMove(state, move, who);
    if (!res.ok) continue;
    // 各ルート手は評価の正確さを保つため全幅ウィンドウで探索する(タイブレーク集合が
    // 枝刈りの境界値で汚染されないようにするため)。
    const score = search(res.value, opponentOf(who), depth - 1, -Infinity, Infinity, who);
    if (score > bestScore) {
      bestScore = score;
      best.length = 0;
      best.push(move);
    } else if (score === bestScore) {
      best.push(move);
    }
  }

  if (best.length === 0) {
    // 通常ここには来ない(hasPath が保たれる限り合法手は必ず存在する)。保険として
    // 最短経路方向のコマ移動を返す。
    const fallback: Position = legalPawnMoves(state, who)[0]!;
    return { type: 'pawn', to: fallback };
  }
  if (rng && best.length > 1) {
    return best[Math.floor(rng() * best.length) % best.length]!;
  }
  return best[0]!;
}
