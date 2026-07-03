import type { GameState, Move, PlayerId } from './types.js';

export type ClientMsg =
  | { t: 'move'; move: Move }
  | { t: 'resign' }
  | { t: 'rematch' }
  | { t: 'rejoin'; token: string };

export type ServerMsg =
  | { t: 'waiting' }
  | { t: 'matched'; you: PlayerId; token: string; opponent: string; state: GameState }
  | { t: 'state'; state: GameState }
  | { t: 'gameOver'; winner: PlayerId; reason: 'goal' | 'resign' | 'disconnect' }
  | { t: 'opponentLeft'; grace: number }
  | { t: 'opponentBack' }
  | { t: 'rematchOffered' }
  | { t: 'rematchAgreed' }
  | { t: 'error'; code: string; message: string };

export interface QuickMatchResponse {
  roomKey: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isClientMsg(v: unknown): v is ClientMsg {
  if (!isRecord(v) || typeof v.t !== 'string') return false;
  switch (v.t) {
    case 'move':
      return isRecord(v.move);
    case 'resign':
    case 'rematch':
      return true;
    case 'rejoin':
      return typeof v.token === 'string';
    default:
      return false;
  }
}

export function isServerMsg(v: unknown): v is ServerMsg {
  if (!isRecord(v) || typeof v.t !== 'string') return false;
  switch (v.t) {
    case 'waiting':
    case 'opponentBack':
    case 'rematchOffered':
    case 'rematchAgreed':
      return true;
    case 'matched':
      return typeof v.you === 'number' && typeof v.token === 'string' && typeof v.opponent === 'string' && isRecord(v.state);
    case 'state':
      return isRecord(v.state);
    case 'gameOver':
      return typeof v.winner === 'number' && typeof v.reason === 'string';
    case 'opponentLeft':
      return typeof v.grace === 'number';
    case 'error':
      return typeof v.code === 'string' && typeof v.message === 'string';
    default:
      return false;
  }
}
