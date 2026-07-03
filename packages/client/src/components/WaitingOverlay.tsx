import type { Notice } from '../net/useGameSocket.js';

interface Props {
  notice: Notice | null;
  opponent: string;
}

export function WaitingOverlay({ notice, opponent }: Props) {
  if (!notice) return null;

  return (
    <div className="toast">
      {notice.kind === 'opponentLeft' && (
        <span>
          {opponent} が切断しました。再接続を待っています(残り{notice.grace}秒)
        </span>
      )}
      {notice.kind === 'opponentBack' && <span>{opponent} が再接続しました</span>}
      {notice.kind === 'rematchOffered' && <span>{opponent} がもう一局を希望しています</span>}
    </div>
  );
}
