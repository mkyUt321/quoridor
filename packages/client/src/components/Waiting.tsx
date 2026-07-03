interface Props {
  label: string;
  onCancel: () => void;
}

export function Waiting({ label, onCancel }: Props) {
  return (
    <div className="wait-card">
      <div className="spinner" />
      <p className="msg">{label}</p>
      <p className="hint">相手が見つかると対局が始まります</p>
      <button type="button" className="btn" onClick={onCancel}>
        キャンセル
      </button>
    </div>
  );
}
