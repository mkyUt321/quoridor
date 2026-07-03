interface Props {
  legal: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WallConfirmBar({ legal, onConfirm, onCancel }: Props) {
  return (
    <div className="wall-confirm-bar">
      <button type="button" className="btn" onClick={onCancel}>
        ✕ 取消
      </button>
      <button type="button" className="btn primary" onClick={onConfirm} disabled={!legal}>
        ✓ ここに壁を置く
      </button>
    </div>
  );
}
