import { applyMove } from './game.js';
import { WALL_ANCHOR_MAX, legalPawnMoves, shortestPathLength, wallLegal } from './rules.js';
import type { GameState, Move, PlayerId, Position, Wall } from './types.js';

/** 勝敗が確定した局面の評価値。通常の距離差評価より十分大きくして常に優先させる。 */
const WIN_SCORE = 1_000_000;
/**
 * depth を明示しない既定経路での探索ノード数の予算。
 *
 * 当初は performance.now() ベースの時間予算(deadline)で打ち切る設計にしていたが、
 * Cloudflare Workers は Spectre 系タイミング攻撃対策として、1回の同期実行の間
 * performance.now()/Date.now() の値を凍結する(次の I/O 等まで進まない)ため、
 * 再帰探索の途中で時間切れを検知できず、実質的に無制限に近い時間がかかってしまう
 * ことが実測で判明した。ノード数ベースの予算なら時計に依存しない。
 *
 * さらに当初のノード数予算版は「depth=2 で完了 → depth=3 に新しい予算で再挑戦 →
 * 予算切れなら破棄して depth=2 の結果に戻る」という反復深化だったため、途中で
 * 予算切れになった深さの探索がまるごと無駄になっていた(本番Workersでの実測で、
 * 1手あたり3〜4秒と体感でも無視できない遅延になっていた)。
 *
 * 現在の設計は使い捨てをやめ、1回のパスだけで完結する「段階的縮退(graceful
 * degradation)」方式にした: 探索木の各ノードで budget が尽きたら、その枝はそこで
 * evaluate() を返して打ち切る(例外で全体を巻き戻すのではなく、その場で浅い評価に
 *切り替えるだけ)。手の並び替え(orderedMoves)で有望な手を先に評価するため、
 * budget が潤沢なうちに最有力候補が深く読まれ、budget が減ってから調べる残りの
 * (あまり有望でない)候補は浅い評価で済ませても実害が小さい。消費した budget は
 * 必ず最終的な手の選択に反映されるため、以前のような「予算を使ったのに結果を
 * 丸ごと捨てる」無駄が構造的に起きない。
 */
const DEFAULT_NODE_BUDGET = 10_000;
/** 探索する最大深さ(budget に余裕があっても際限なく深追いしない安全弁)。 */
const MAX_SEARCH_DEPTH = 4;
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
/**
 * ルート(手番プレイヤー自身の手を選ぶ最上位呼び出し)で、壁候補のうち実際に
 * budget を割り振って深く探索する上位候補の数。壁候補は最大で50〜70通りにも
 * なるため、これを全部均等に budget 分割すると1候補あたりの budget が小さすぎて
 * 意味のある読みができない(相手の応手まで見る前に打ち切られ、雑な評価しか
 * 得られない)。着手直後の静的評価(evaluate、1手先読みなし)で軽く足切りしてから
 * 上位だけを本探索にかけることで、少ない budget でも意味のある比較にする。
 */
const ROOT_WALL_CANDIDATE_LIMIT = 6;

export interface AiOptions {
  /**
   * 探索深さを固定したい場合に指定する(主にテスト・決定的な挙動が必要な場面用)。
   * 指定するとノード数無制限(budget なし)の固定深さ探索になる。
   * 省略すると maxNodes によるノード数予算ベースの探索(既定経路)になる。
   */
  depth?: number;
  /** depth 省略時のノード数予算。既定 10,000。 */
  maxNodes?: number;
  /** 同点最善手が複数あるときのタイブレーク用乱数。省略時は決定的(先頭を選ぶ)。 */
  rng?: () => number;
  /**
   * 直近で自分(who)がいたマス(古い→新しい順)。逆戻りによる同じ場所の往復を
   * 抑止する弱いペナルティに使う。省略時はペナルティなし。
   */
  recentOwnSquares?: readonly Position[];
}

/** 探索中に消費したノード数を数える可変カウンタ。remaining<=0 になったら以後は
 *  即座に evaluate() へ縮退する(段階的縮退。例外は使わない)。 */
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
 * 重い処理はここに集中している。budget が尽きたら、その時点までに見つかった候補
 * だけを返して打ち切る(例外は投げない。ここまでの候補で十分に手を選べるため、
 * 打ち切りは単なる縮退であって失敗ではない)。
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
        if (budget.remaining <= 0) return walls;
        budget.remaining--;
        const w: Wall = { r, c, o };
        if (wallLegal(state, w)) walls.push(w);
      }
    }
  }
  return walls;
}

/**
 * mover の合法手一覧。ゴールに近づくコマ移動を先頭に寄せて並べ、alpha-beta 枝刈りの
 * 効率を上げる(良さそうな手を先に調べるほど枝刈りが効く)と同時に、budget が
 * 潤沢なうちに最有力候補(前進コマ移動)が優先的に深く読まれるようにする。
 * 壁手はその後に続ける。
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
 *
 * budget.remaining が尽きたら、そのノード以降は evaluate() による静的評価に
 * 即座に縮退する(例外で巻き戻さない)。手の並び替えにより有望な手ほど budget が
 * 潤沢なうちに深く評価されるため、budget が尽きた後に浅く評価される手は元々
 * 選ばれにくい手であることが多く、実害は小さい。
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
  if (state.winner !== null || depth === 0 || budget.remaining <= 0) return evaluate(state, root);

  const maximizing = mover === root;
  let value = maximizing ? -Infinity : Infinity;

  for (const move of orderedMoves(state, mover, budget)) {
    if (budget.remaining <= 0) break;
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
  // ここまで1手も展開できなかった(budget切れ・盤面のせいで全滅)場合は、
  // 静的評価にフォールバックして必ず何らかの値を返す。
  return value === -Infinity || value === Infinity ? evaluate(state, root) : value;
}

/**
 * who の手番で最善手を1つ選ぶ(ミニマックス+逆戻り抑止ペナルティ)。
 *
 * ルート候補(コマ移動・上位の壁候補)へ budget を「均等に」割り振ってから各々を
 * 探索する。単純に1つの budget を候補間で使い回すと、orderedMoves がコマ移動を
 * 先に並べるため、budget が潤沢なコマ移動だけが深く読まれ、後回しの壁候補は
 * budget が尽きた後にしか調べられず常に浅い評価(=段階的縮退で即 evaluate())しか
 * 受けられない。深い探索は浅い探索より高めのスコアが出やすいため、この順序
 * バイアスにより壁がほとんど選ばれなくなる回帰が実際に起きた(自己対局で壁が
 * 一切使われなかった)。
 *
 * ただし壁候補は最大50〜70通りにもなるため、全部を均等分配すると1候補あたりの
 * budget が小さすぎて逆に意味のある読みができなくなる(相手の応手を1つも見ずに
 * 打ち切られる)。そこで壁候補は着手直後の静的評価で ROOT_WALL_CANDIDATE_LIMIT
 * 件に事前に絞り込み、その上位候補とコマ移動全体とで budget を均等分配する。
 */
function selectBestMove(
  state: GameState,
  who: PlayerId,
  depth: number,
  recent: readonly Position[],
  rng: (() => number) | undefined,
  totalBudget: NodeBudget,
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

  // 候補一覧の生成自体は軽い(ルート1回だけの壁legalチェック)ので無制限で行う。
  const allMoves = orderedMoves(state, who, { remaining: Infinity });
  const pawnMoves = allMoves.filter((m) => m.type === 'pawn');
  const wallMoves = allMoves.filter((m) => m.type === 'wall');

  // 壁候補は着手直後の静的評価(1手先読みなし)で上位 ROOT_WALL_CANDIDATE_LIMIT
  // 件に絞ってから本探索にかける(理由は定数の説明を参照)。
  const topWallMoves = wallMoves
    .map((move) => {
      const res = applyMove(state, move, who);
      return { move, score: res.ok ? evaluate(res.value, who) : -Infinity };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, ROOT_WALL_CANDIDATE_LIMIT)
    .map(({ move }) => move);

  const moves = [...pawnMoves, ...topWallMoves];
  const perMoveBudget = moves.length > 0 ? totalBudget.remaining / moves.length : totalBudget.remaining;

  let bestScore = -Infinity;
  const best: Move[] = [];
  for (const move of moves) {
    const res = applyMove(state, move, who);
    if (!res.ok) continue;
    // 各ルート手は評価の正確さを保つため全幅ウィンドウで探索する(タイブレーク集合が
    // 枝刈りの境界値で汚染されないようにするため)。
    const budget: NodeBudget = { remaining: perMoveBudget };
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
 * - options.depth を指定すると、その深さ・ノード数無制限で固定のミニマックス探索を
 *   行う(テストや決定的な挙動が必要な場面向け)。
 * - 省略すると、maxNodes(既定10,000)のノード数予算内で段階的縮退(graceful
 *   degradation)しながら1回のパスで探索する(既定経路)。時計に依存しないため
 *   実行環境の速度に関わらず必ず有限の計算量で終わり、かつ予算切れで捨てられる
 *   計算が発生しない(カジュアル対戦では強さより低遅延を優先するための設計)。
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
  return selectBestMove(state, who, MAX_SEARCH_DEPTH, recent, rng, { remaining: maxNodes });
}
