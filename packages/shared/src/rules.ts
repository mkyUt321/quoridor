import type { GameState, PlayerId, Position, Wall } from './types.js';

export const BOARD_SIZE = 9;
export const WALL_ANCHOR_MAX = 7;

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/** 縦壁(V)が row r, 列 c/c+1 間の横移動エッジを塞いでいるか */
function blockedV(walls: readonly Wall[], r: number, c: number): boolean {
  return walls.some((w) => w.o === 'V' && w.c === c && (w.r === r || w.r === r - 1));
}

/** 横壁(H)が row r/r+1, 列 c の縦移動エッジを塞いでいるか */
function blockedH(walls: readonly Wall[], r: number, c: number): boolean {
  return walls.some((w) => w.o === 'H' && w.r === r && (w.c === c || w.c === c - 1));
}

/** (r,c) から隣接1マス (r2,c2) へ壁に妨げられず移動できるか */
export function canStep(walls: readonly Wall[], r: number, c: number, r2: number, c2: number): boolean {
  const dr = r2 - r;
  const dc = c2 - c;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
  if (!inBounds(r2, c2)) return false;
  if (dc === 1) return !blockedV(walls, r, c);
  if (dc === -1) return !blockedV(walls, r, c - 1);
  if (dr === 1) return !blockedH(walls, r, c);
  return !blockedH(walls, r - 1, c);
}

/** 手番プレイヤーの合法な移動先(直進/ジャンプ/斜め)一覧 */
export function legalPawnMoves(state: GameState, who: PlayerId): Position[] {
  const pos = state.pawns[who];
  const opp = state.pawns[who === 0 ? 1 : 0];
  const moves: Position[] = [];

  for (const [dr, dc] of DIRS) {
    const mr = pos.r + dr;
    const mc = pos.c + dc;
    if (!inBounds(mr, mc)) continue;
    if (!canStep(state.walls, pos.r, pos.c, mr, mc)) continue;

    if (mr === opp.r && mc === opp.c) {
      const jr = mr + dr;
      const jc = mc + dc;
      const straightOk = inBounds(jr, jc) && canStep(state.walls, mr, mc, jr, jc);
      if (straightOk) {
        moves.push({ r: jr, c: jc });
      } else {
        const perp: ReadonlyArray<readonly [number, number]> = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const [pr, pc] of perp) {
          const dr2 = mr + pr;
          const dc2 = mc + pc;
          if (!inBounds(dr2, dc2)) continue;
          if (canStep(state.walls, mr, mc, dr2, dc2)) {
            moves.push({ r: dr2, c: dc2 });
          }
        }
      }
    } else {
      moves.push({ r: mr, c: mc });
    }
  }

  return moves;
}

/** BFS: start から goalRow のいずれかのマスへ到達可能か */
export function hasPath(walls: readonly Wall[], start: Position, goalRow: number): boolean {
  const visited = new Set<string>();
  const queue: Position[] = [start];
  visited.add(`${start.r},${start.c}`);

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.r === goalRow) return true;
    for (const [dr, dc] of DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBounds(nr, nc)) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (!canStep(walls, cur.r, cur.c, nr, nc)) continue;
      visited.add(key);
      queue.push({ r: nr, c: nc });
    }
  }
  return false;
}

/** 新しい壁 w が既存 walls と重なる(同一/隣接セグメント)か交差する(同一交点)か */
export function wallConflict(walls: readonly Wall[], w: Wall): boolean {
  return walls.some((e) => {
    if (e.o === w.o) {
      if (w.o === 'H') return e.r === w.r && Math.abs(e.c - w.c) <= 1;
      return e.c === w.c && Math.abs(e.r - w.r) <= 1;
    }
    return e.r === w.r && e.c === w.c;
  });
}

/** 壁 w を state.turn のプレイヤーが設置可能か(範囲・残枚数・conflict・両者 hasPath) */
export function wallLegal(state: GameState, w: Wall): boolean {
  if (w.r < 0 || w.r > WALL_ANCHOR_MAX || w.c < 0 || w.c > WALL_ANCHOR_MAX) return false;
  if (state.wallsLeft[state.turn] <= 0) return false;
  if (wallConflict(state.walls, w)) return false;

  const newWalls = [...state.walls, w];
  for (let p = 0; p < 2; p++) {
    const player = p as PlayerId;
    if (!hasPath(newWalls, state.pawns[player], state.goal[player])) return false;
  }
  return true;
}

/** 壁配置を考慮した、各マスからゴール行までの最短手数(BFS)。goalRow から逆向きに広げる。 */
export function distanceToGoalRow(walls: readonly Wall[], goalRow: number): number[][] {
  const dist: number[][] = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(Infinity));
  const queue: Position[] = [];
  for (let c = 0; c < BOARD_SIZE; c++) {
    dist[goalRow]![c] = 0;
    queue.push({ r: goalRow, c });
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const [dr, dc] of DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBounds(nr, nc)) continue;
      if (!canStep(walls, cur.r, cur.c, nr, nc)) continue;
      if (dist[nr]![nc]! > dist[cur.r]![cur.c]! + 1) {
        dist[nr]![nc] = dist[cur.r]![cur.c]! + 1;
        queue.push({ r: nr, c: nc });
      }
    }
  }
  return dist;
}

/**
 * 壁配置を考慮した、あるマス from からゴール行 goalRow までの最短手数。
 * 到達不能なら Infinity。AI の盤面評価(ゴールまでの距離差)で使う。
 */
export function shortestPathLength(walls: readonly Wall[], from: Position, goalRow: number): number {
  const dist = distanceToGoalRow(walls, goalRow);
  return dist[from.r]![from.c]!;
}

/**
 * 手番プレイヤーの合法な移動先の中から、ゴール行までの最短距離が最も縮むマスを選ぶ。
 * 持ち時間切れ時の自動移動に使う。hasPath が保たれている限り legalPawnMoves は必ず
 * 1つ以上あるため、常に有効な移動先を返す。
 */
export function bestMoveTowardGoal(state: GameState, who: PlayerId): Position {
  const legal = legalPawnMoves(state, who);
  const first = legal[0];
  if (!first) throw new Error('bestMoveTowardGoal: no legal moves available');

  const dist = distanceToGoalRow(state.walls, state.goal[who]);
  let best = first;
  let bestDist = dist[first.r]![first.c]!;
  for (const m of legal) {
    const d = dist[m.r]![m.c]!;
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}
