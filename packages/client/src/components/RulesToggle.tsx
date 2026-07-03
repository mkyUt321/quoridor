import type { GameState } from '@quoridor/shared';
import { Board } from './Board.js';

/** ルール説明用の図解サンプル局面。移動・ジャンプ・壁が一目で分かるように配置している。 */
const SAMPLE_STATE: GameState = {
  pawns: [
    { r: 5, c: 4 },
    { r: 4, c: 4 },
  ],
  goal: [0, 8],
  walls: [{ r: 2, c: 5, o: 'V' }],
  wallsLeft: [7, 8],
  turn: 0,
  last: null,
  winner: null,
};

/** 待機画面下部に常設するトグル(details)形式のルール説明。ポップアップにすると
 *  見つけにくいという指摘を受けて、ページ内に折り畳み表示するだけの構成にした。 */
export function RulesToggle() {
  return (
    <details className="rules-toggle">
      <summary>Quoridorの遊び方</summary>
      <div className="modal-board">
        <Board state={SAMPLE_STATE} youAre={0} onMove={() => {}} readOnly />
      </div>
      <div className="rules-sections">
        <section>
          <h3>目的</h3>
          <p>自分の駒(手前・緑)を、盤の反対側の辺(奥の行)のどこかへ先に到達させれば勝ちです。</p>
        </section>
        <section>
          <h3>移動</h3>
          <p>自分の番には、駒を上下左右に1マス動かします。図の緑の点が今動ける先です。</p>
        </section>
        <section>
          <h3>壁</h3>
          <p>
            移動の代わりに、マスとマスの間の溝に壁を1枚置くこともできます(お互い初期10枚)。相手の進路を
            妨害できますが、相手が絶対にゴールへ到達できなくなるような置き方は禁止されています(必ず道が
            1本は残ります)。図の濃い帯が置かれた壁です。
          </p>
        </section>
        <section>
          <h3>ジャンプ</h3>
          <p>
            相手の駒が正面に隣接しているときは、まっすぐ飛び越えて進めます。奥が壁や盤の端で飛び越えられ
            ない場合は、斜めへ進めます。
          </p>
        </section>
      </div>
    </details>
  );
}
