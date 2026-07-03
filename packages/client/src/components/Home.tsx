import { useState } from 'react';
import { loadNickname, saveNickname } from '../nickname.js';

interface Props {
  onJoin: (pass: string, name: string) => void;
  error: string | null;
}

export function Home({ onJoin, error }: Props) {
  const [nick, setNick] = useState(loadNickname());
  const [pass, setPass] = useState('');

  return (
    <div className="home-card">
      <h1>Quoridor</h1>
      <p className="sub">合言葉を決めて、相手と同じ言葉を入力すると出会います。</p>
      <label>
        ニックネーム
        <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={16} autoComplete="off" />
      </label>
      <label>
        あいことば
        <input
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          maxLength={20}
          placeholder="例: さくら"
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        disabled={pass.trim() === ''}
        onClick={() => {
          const name = nick.trim() || '名無し';
          saveNickname(name);
          onJoin(pass, name);
        }}
      >
        対戦する
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
