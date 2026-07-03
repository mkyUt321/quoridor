import { describe, expect, it } from 'vitest';
import { Session } from './session.js';

describe('Session', () => {
  it('手番でないプレイヤーの手を拒否する', () => {
    const session = new Session();
    const result = session.move({ type: 'pawn', to: { r: 1, c: 4 } }, 1);
    expect(result.ok).toBe(false);
    expect(session.state.turn).toBe(0);
  });

  it('合法手で state を更新し手番を交代する', () => {
    const session = new Session();
    const result = session.move({ type: 'pawn', to: { r: 7, c: 4 } }, 0);
    expect(result.ok).toBe(true);
    expect(session.state.pawns[0]).toEqual({ r: 7, c: 4 });
    expect(session.state.turn).toBe(1);
  });

  it('不正手は state を変えずエラーを返す', () => {
    const session = new Session();
    const before = session.state;
    const result = session.move({ type: 'pawn', to: { r: 5, c: 4 } }, 0);
    expect(result.ok).toBe(false);
    expect(session.state).toBe(before);
  });

  it('ゴール到達で勝敗が決まり以後の手を拒否する', () => {
    const session = new Session();
    session.state = { ...session.state, pawns: [{ r: 1, c: 4 }, { r: 0, c: 3 }], turn: 0 };
    const result = session.move({ type: 'pawn', to: { r: 0, c: 4 } }, 0);
    expect(result.ok).toBe(true);
    expect(session.state.winner).toBe(0);

    const after = session.move({ type: 'pawn', to: { r: 0, c: 2 } }, 1);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toBe('game_over');
  });

  it('resign すると相手が勝者になる', () => {
    const session = new Session();
    const state = session.resign(0);
    expect(state.winner).toBe(1);
  });

  it('rematch は両者の要求が揃うまで合意しない', () => {
    const session = new Session();
    session.move({ type: 'pawn', to: { r: 7, c: 4 } }, 0);

    expect(session.requestRematch(0)).toBe('offered');
    expect(session.state.pawns[0]).toEqual({ r: 7, c: 4 });

    expect(session.requestRematch(1)).toBe('agreed');
    expect(session.state.pawns[0]).toEqual({ r: 8, c: 4 });
    expect(session.state.turn).toBe(0);
    expect(session.state.winner).toBeNull();
  });
});
