import type { Wall } from '@quoridor/shared';
import { C, G, N, STEP, WSPAN } from './geometry.js';

export type Hover = { kind: 'pawn'; r: number; c: number } | { kind: 'wall'; wall: Wall };

function nearestAnchor(cands: number[], coord: number): number {
  const first = cands[0];
  if (first === undefined) throw new Error('nearestAnchor: no candidates');
  if (cands.length === 1) return first;
  const centerOf = (a: number) => a * STEP + WSPAN / 2;
  let best = first;
  let bestDist = Infinity;
  for (const a of cands) {
    const d = Math.abs(coord - centerOf(a));
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

/** x,y は盤面の外枠内側(P だけオフセット済み)を原点とする座標。マス上かどうか、壁の場合は最寄りスロットへスナップして判定する。 */
export function computeHover(x: number, y: number): Hover | null {
  const span = N * C + (N - 1) * G;
  if (x < -6 || y < -6 || x > span + 6 || y > span + 6) return null;

  const col = Math.max(0, Math.min(N - 1, Math.floor(x / STEP)));
  const row = Math.max(0, Math.min(N - 1, Math.floor(y / STEP)));
  const xin = x - col * STEP;
  const yin = y - row * STEP;
  const inColBand = xin <= C;
  const inRowBand = yin <= C;

  if (inColBand && inRowBand) return { kind: 'pawn', r: row, c: col };

  let o: 'H' | 'V';
  if (!inColBand && inRowBand) o = 'V';
  else if (inColBand && !inRowBand) o = 'H';
  else o = xin - C > yin - C ? 'V' : 'H';

  if (o === 'H') {
    const rr = Math.min(N - 2, row);
    const cand = [col - 1, col].filter((a) => a >= 0 && a <= N - 2);
    return { kind: 'wall', wall: { o: 'H', r: rr, c: nearestAnchor(cand, x) } };
  }
  const cc = Math.min(N - 2, col);
  const cand = [row - 1, row].filter((a) => a >= 0 && a <= N - 2);
  return { kind: 'wall', wall: { o: 'V', r: nearestAnchor(cand, y), c: cc } };
}
