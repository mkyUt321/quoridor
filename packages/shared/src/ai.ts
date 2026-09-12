import { applyMove } from './game.js';
import { WALL_ANCHOR_MAX, legalPawnMoves, shortestPathLength, wallLegal } from './rules.js';
import type { GameState, Move, PlayerId, Position, Wall } from './types.js';

/** 勝敗が確定した局面の評価値。通常の距離差評価より十分大きくして常に優先させる。 */
const WIN_SCORE = 1_000_000;
/**
 * depth を明示しない既定経路での探索ノード数の予算。この予算内で完了した最も深い
 * 反復深化(iterative deepening)の結果を使う。
 *
 * 当初は performance.now() ベースの時間予算(deadline)で打ち切る設計にしていたが、
 * Cloudflare Workers は Spectre 系タイミング攻撃対策として、1回の同期実行の間
 * performance.now()/Date.now() の値を凍結する(次の I/O 等まで進まない)ため、
 * 再帰探索の途中で時間切れを検知できず、実質的に無制限に近い時間がかかってしまう
 * ことが実測で判明した(depth3〜4 相当の探索が10秒以上かかるケースがあった)。
 * ノード数ベースの予算なら時計に依存しないため、Node.js でも Cloudflare Workers
 * でも同じ「量」で確実に打ち切れる。しきい値は Node.js 上で既定経路が概ね1秒前後に
 * 収まるよう実測で調整してある(Workers は1ノードあたりの実行がより遅いため、同じ
 * ノード数でも実時間は長くなるが、無制限だった以前と違い有限に収まる)。
 */
const DEFAULT_NODE_BUDGET = 24_000;
/** 反復深化で試す最大深さ(ノード予算に余裕があっても際限なく深追いしない安全弁)。 */
const MAX_ITERATIVE_DEPTH = 4;
/** 相手コマ周辺で壁候補として検討するアンカーのチェビシェフ半径。 */
const OPP_WALL_RADIUS = 2;
/** 自分コマ周辺で壁候補として検討するアンカーのチェビシェフ半径(防御的な壁用)。 */
const SELF_WALL_RADIUS = 1;
/**
 * 直近で自分がいたマスへ戻る手に科す減点の基準値(1マス分の距離短縮による評価差
 * =10点)より大きめに設定し、1手前への逆戻り(recency加重で最大)が距離1マス分の
 * 得より明確に不利になるようにする。迷路状に壁で囲まれ壁を使い切った終盤、浅い
 * 探索では「行く」「戻る」の評価がほぼ同点になり、手番ごとに同じ2〜3マスを往復し
 * 続けるバグが起きていた。直近の自分の足跡を避けさせることで、本当に他に手がない
 * 場合や逆戻りが真に最善(相手の壁で経路が変わった等)な場合を除き、同じ場所を
 * 素通りしにいくことを防ぐ(禁じ手ではなく減点なので、差が大きければ選ばれ得る)。
 */
const REVISIT_PENALTY = 18;

export interface AiOptions {
  /**
   * 探索深さを固定したい場合に指定する(主にテスト・決定的な挙動が必要な場面用)。
   * 省略すると maxNodes によるノード数予算ベースの反復深化(既定経路)になる。
   */
  depth?: number;
  /** depth 省略時のノード数予算。既定 24,000。 */
  maxNodes?: number;
  /** 同点最善手が複数あるときのタイブレーク用乱数。省略時は決定的(先頭を選ぶ)。 */
  rng?: () => number;
  /**
   * 直近で自分(who)がいたマス(古い→新しい順)。逆戻りによる同じ場所の往復を
   * 抑止する弱いペナルティに使う。省略時はペナルティなし。
   */
  recentOwnSquares?: readonly Position[];
}

/** ノード数予算を使い切って探索を打ち切ったことを示す内部シグナル。 */
class SearchAborted extends Error {}

/** 探索中に消費したノード数を数える可変カウンタ。 */
interface NodeBudget {
  remaining: number;
}

const UNLIMITED_BUDGET: NodeBudget = { remaining: Infinity };

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
 *
 * wallLegal 1回につき内部で BFS(hasPath)を2回行っており、探索全体の中で圧倒的に
 * 重い処理はここに集中している(高々数手のミニマックス「ノード数」を数えるだけでは
 * この重さを反映できず、budget が実際の計算量にほとんど比例しなかった)。そのため
 * budget の消費はここ、wallLegal を試すたびに行う。
 */
function candidateWalls(state: GameState, mover: PlayerId, budget: NodeBudget): Wall[] {
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
        if (--budget.remaining <= 0) throw new SearchAborted();
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
function orderedMoves(state: GameState, mover: PlayerId, budget: NodeBudget): Move[] {
  const goalRow = state.goal[mover];
  const pawnMoves = legalPawnMoves(state, mover)
    .map((to) => ({ to, d: shortestPathLength(state.walls, to, goalRow) }))
    .sort((a, b) => a.d - b.d)
    .map(({ to }): Move => ({ type: 'pawn', to }));

  const wallMoves = candidateWalls(state, mover, budget).map((wall): Move => ({ type: 'wall', wall }));
  return [...pawnMoves, ...wallMoves];
}

/**
 * root 視点の評価を最大化するミニマックス(alpha-beta 枝刈り付き)。
 * mover はこのノードで手を指すプレイヤー、root は評価を最大化したい AI 自身。
 * budget.remaining を使い切ったら SearchAborted を投げて即座に巻き戻る
 * (budget.remaining=Infinity なら打ち切りは起きない。固定深さ経路用)。
 */
function search(
  state: GameState,
  mover: PlayerId,
  depth: number,
  alpha: number,
  beta: number,
  root: PlayerId,
  budget: NodeBudget,
): number {
  if (--budget.remaining <= 0) throw new SearchAborted();
  if (state.winner !== null || depth === 0) return evaluate(state, root);

  const maximizing = mover === root;
  let value = maximizing ? -Infinity : Infinity;

  for (const move of orderedMoves(state, mover, budget)) {
    const res = applyMove(state, move, mover);
    if (!res.ok) continue;
    const score = search(res.value, opponentOf(mover), depth - 1, alpha, beta, root, budget);
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
 * who の手番で指定深さの最善手を1つ選ぶ(ミニマックス+逆戻り抑止ペナルティ)。
 * budget を使い切ったら SearchAborted を投げる(呼び出し側が前の深さの結果へ
 * フォールバックできるようにするため、ここでは途中結果を返さず必ず例外で知らせる)。
 */
function selectBestMove(
  state: GameState,
  who: PlayerId,
  depth: number,
  recent: readonly Position[],
  rng: (() => number) | undefined,
  budget: NodeBudget,
): Move {
  /** move の着地マスが recent の何番目に古いかを返す(0=最古)。該当なければ -1。 */
  function revisitPenalty(move: Move): number {
    if (move.type !== 'pawn') return 0;
    const idx = recent.findIndex((p) => p.r === move.to.r && p.c === move.to.c);
    if (idx === -1) return 0;
    // 直近(配列末尾、idx が大きいほど新しい)ほど大きな減点にする。1手前への
    // 逆戻りが最も往復に見えるため最重、数手前は軽めにする。
    return REVISIT_PENALTY * (idx + 1);
  }

  let bestScore = -Infinity;
  const best: Move[] = [];
  for (const move of orderedMoves(state, who, budget)) {
    if (--budget.remaining <= 0) throw new SearchAborted();
    const res = applyMove(state, move, who);
    if (!res.ok) continue;
    // 各ルート手は評価の正確さを保つため全幅ウィンドウで探索する(タイブレーク集合が
    // 枝刈りの境界値で汚染されないようにするため)。
    const score = search(res.value, opponentOf(who), depth - 1, -Infinity, Infinity, who, budget) - revisitPenalty(move);
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

/**
 * who の手番で AI が指す手を選ぶ純関数。
 *
 * - options.depth を指定すると、その深さで固定のミニマックス探索を行う(ノード数
 *   制限なし。テストや決定的な挙動が必要な場面向け)。
 * - 省略すると、depth=1 から順に深さを増やす反復深化(iterative deepening)を
 *   maxNodes(既定24,000ノード)まで繰り返し、予算切れになった深さの結果は捨てて
 *   直前に完了した深さの結果を使う。ノード数ベースなので実行環境の速度に関わらず
 *   常に有限の計算量で打ち切れる(カジュアル対戦では強さより低遅延を優先するための
 *   設計。壁時計ベースの時間予算は Cloudflare Workers のタイマー凍結により機能
 *   しないため、あえてノード数を使っている)。
 *
 * 同点最善手が複数あって rng が渡されていれば、その中からランダムに選んで対局に
 * 変化を持たせる。rng を省略すると決定的(常に同じ手)になり、テストしやすい。
 */
export function chooseAiMove(state: GameState, who: PlayerId, options: AiOptions = {}): Move {
  const rng = options.rng;
  const recent = options.recentOwnSquares ?? [];

  if (options.depth !== undefined) {
    return selectBestMove(state, who, options.depth, recent, rng, { ...UNLIMITED_BUDGET });
  }

  const maxNodes = options.maxNodes ?? DEFAULT_NODE_BUDGET;

  // depth=1 は常にごく少ないノード数で終わるので予算なしで確実な土台を作り、
  // 以降は予算が残っている限り深さを増やして上書きする。
  let best = selectBestMove(state, who, 1, recent, rng, { ...UNLIMITED_BUDGET });
  for (let depth = 2; depth <= MAX_ITERATIVE_DEPTH; depth++) {
    try {
      best = selectBestMove(state, who, depth, recent, rng, { remaining: maxNodes });
    } catch (e) {
      if (e instanceof SearchAborted) break;
      throw e;
    }
  }
  return best;
}
