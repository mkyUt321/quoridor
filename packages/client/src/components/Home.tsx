import { useState } from 'react';
import { loadNickname, saveNickname } from '../nickname.js';
import { RulesToggle } from './RulesToggle.js';

interface Props {
  onJoinPass: (pass: string, name: string) => void;
  onJoinQuick: (name: string) => void;
  error: string | null;
}

export function Home({ onJoinPass, onJoinQuick, error }: Props) {
  const [nick, setNick] = useState(loadNickname());
  const [pass, setPass] = useState('');

  function commitNick(): string {
    const name = nick.trim() || '名無し';
    saveNickname(name);
    return name;
  }

  return (
    <div className="home-card">
      <h1>Quoridor</h1>
      <p className="sub">合言葉を決めて、相手と同じ言葉を入力すると出会います。合言葉なしでランダム対戦も選べます。</p>
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
      <div className="home-actions">
        <button type="button" disabled={pass.trim() === ''} onClick={() => onJoinPass(pass, commitNick())}>
          対戦する
        </button>
        <button type="button" className="secondary" onClick={() => onJoinQuick(commitNick())}>
          ランダム対戦
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <RulesToggle />
    </div>
  );
}
