import type { Wall } from '@quoridor/shared';

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
