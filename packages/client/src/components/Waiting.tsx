interface Props {
  pass: string;
  onCancel: () => void;
}

export function Waiting({ pass, onCancel }: Props) {
  return (
    <div className="wait-card">
      <div className="spinner" />
      <p className="msg">
        あいことば「<b>{pass}</b>」で待機中
      </p>
      <p className="hint">相手が同じあいことばを入力すると対局が始まります</p>
      <button type="button" className="btn" onClick={onCancel}>
        キャンセル
      </button>
    </div>
  );
}
