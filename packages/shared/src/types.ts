export type PlayerId = 0 | 1;

export interface Position {
  r: number;
  c: number;
}

/** 壁。r,c は交点アンカー(0..7)。o='H' は横壁(行の溝)、'V' は縦壁(列の溝)。 */
export interface Wall {
  r: number;
  c: number;
  o: 'H' | 'V';
}

export type Move = { type: 'pawn'; to: Position } | { type: 'wall'; wall: Wall };

export interface GameState {
  pawns: [Position, Position];
  goal: [number, number];
  walls: Wall[];
  wallsLeft: [number, number];
  turn: PlayerId;
  last:
    | { type: 'pawn'; from: Position; to: Position }
    | { type: 'wall'; wall: Wall }
    | null;
  winner: PlayerId | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
