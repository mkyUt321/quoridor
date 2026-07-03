import { useState } from 'react';
import { RulesModal } from './RulesModal.js';

interface Props {
  label: string;
  onCancel: () => void;
}

export function Waiting({ label, onCancel }: Props) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="wait-card">
      <div className="spinner" />
      <p className="msg">{label}</p>
      <p className="hint">相手が見つかると対局が始まります</p>
      <div className="wait-actions">
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="btn" onClick={() => setShowRules(true)}>
          遊び方を見る
        </button>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
