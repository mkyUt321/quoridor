import type { Position, Wall } from '@quoridor/shared';

export const N = 9;
export const C = 56;
export const G = 14;
export const P = 8;
export const STEP = C + G;
export const WSPAN = 2 * C + G;
export const SIZE = N * C + (N - 1) * G + 2 * P;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function cellXY(r: number, c: number): Point {
  return { x: P + c * STEP, y: P + r * STEP };
}

export function wallRect(w: Wall): Rect {
  const { x, y } = cellXY(w.r, w.c);
  return w.o === 'H' ? { x, y: y + C, w: WSPAN, h: G } : { x: x + C, y, w: G, h: WSPAN };
}

/**
 * 視点正規化: 180°回転の座標変換(自分の駒を常に手前/下に描画するため)。
 * 自己逆変換なので state→表示・表示→state のどちらにも同じ関数を使える。
 */
export function flipPosition(p: Position, flip: boolean): Position {
  return flip ? { r: 8 - p.r, c: 8 - p.c } : p;
}

export function flipWall(w: Wall, flip: boolean): Wall {
  return flip ? { r: 7 - w.r, c: 7 - w.c, o: w.o } : w;
}
