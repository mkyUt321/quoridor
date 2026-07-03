import { useState } from 'react';
import { Board } from './components/Board.js';
import { useGameSocket } from './net/useGameSocket.js';
import { loadNickname, saveNickname } from './nickname.js';

export function App() {
  const { phase, state, youAre, opponent, error, joinPass, send } = useGameSocket();
  const [nick, setNick] = useState(loadNickname());
  const [pass, setPass] = useState('');

  if (phase === 'home') {
    return (
      <div className="home-card">
        <h1>Quoridor</h1>
        <label>
          ニックネーム
          <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={16} />
        </label>
        <label>
          あいことば
          <input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            maxLength={20}
            placeholder="例: さくら"
          />
        </label>
        <button
          disabled={pass.trim() === ''}
          onClick={() => {
            const name = nick.trim() || '名無し';
            saveNickname(name);
            joinPass(pass, name);
          }}
        >
          対戦する
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (state === null || youAre === null) {
    return (
      <div className="wait-card">
        <p>あいことば「{pass}」で待機中…</p>
      </div>
    );
  }

  const turnLabel =
    state.winner !== null
      ? state.winner === youAre
        ? 'あなたの勝ち'
        : `${opponent ?? 'あいて'}の勝ち`
      : state.turn === youAre
        ? 'あなたの番'
        : `${opponent ?? 'あいて'}の番`;

  return (
    <div className="game">
      <p className="status">
        {nick} vs {opponent} — {turnLabel}
      </p>
      <Board state={state} youAre={youAre} onMove={(move) => send({ t: 'move', move })} />
    </div>
  );
}
