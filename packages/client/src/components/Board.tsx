import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { legalPawnMoves, wallLegal, type GameState, type Move, type PlayerId, type Wall } from '@quoridor/shared';
import { C, N, P, SIZE, cellXY, flipPosition, flipWall, wallRect } from '../game/geometry.js';
import { computeHover, TOUCH_SLOP, type Hover } from '../game/interaction.js';
import { usePointerKind } from '../usePointerKind.js';
import { WallConfirmBar } from './WallConfirmBar.js';

interface Props {
  state: GameState;
  youAre: PlayerId;
  onMove: (move: Move) => void;
  /** true の場合、操作を一切受け付けない表示専用モード(ルール説明の図解などに使う)。 */
  readOnly?: boolean;
}

/** hover は表示座標(視点正規化後)。合法性判定・送信前に state 座標へ戻す。 */
function hoverToState(h: Hover, flip: boolean): Hover {
  if (h.kind === 'pawn') {
    const pos = flipPosition({ r: h.r, c: h.c }, flip);
    return { kind: 'pawn', r: pos.r, c: pos.c };
  }
  return { kind: 'wall', wall: flipWall(h.wall, flip) };
}

export function Board({ state, youAre, onMove, readOnly = false }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pendingWall, setPendingWall] = useState<Wall | null>(null);
  const pointerKind = usePointerKind();
  const flip = youAre === 1;

  const myTurn = state.turn === youAre && state.winner === null;
  const legalMoves = useMemo(
    () => (state.winner === null ? legalPawnMoves(state, state.turn) : []),
    [state],
  );
  const displayLegalMoves = useMemo(
    () => legalMoves.map((m) => flipPosition(m, flip)),
    [legalMoves, flip],
  );

  // 手番が自分でなくなったら(再接続直後の再同期・相手の手・対局終了など)、
  // 保留中の壁確認バーを残さず必ずクリアする。放置すると確認ボタンが
  // 押しても静かに無反応になり「壊れた」ように見えるため。
  useEffect(() => {
    if (!myTurn) {
      setPendingWall(null);
      setHover(null);
    }
  }, [myTurn]);

  function boardPoint(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x - P, y: p.y - P };
  }

  function tryMove(displayHover: Hover) {
    const stateHover = hoverToState(displayHover, flip);
    if (stateHover.kind === 'pawn') {
      if (!legalMoves.some((m) => m.r === stateHover.r && m.c === stateHover.c)) return;
      onMove({ type: 'pawn', to: { r: stateHover.r, c: stateHover.c } });
    } else {
      if (!wallLegal(state, stateHover.wall)) return;
      onMove({ type: 'wall', wall: stateHover.wall });
    }
    setHover(null);
  }

  // ===== マウス(fine) =====
  function handleMouseMove(e: MouseEvent) {
    if (readOnly || pointerKind === 'coarse' || !myTurn) return;
    const bp = boardPoint(e);
    setHover(bp ? computeHover(bp.x, bp.y) : null);
  }

  function handleClick(e: MouseEvent) {
    if (readOnly || pointerKind === 'coarse' || !myTurn) return;
    const bp = boardPoint(e);
    const displayHover = bp ? computeHover(bp.x, bp.y) : null;
    if (displayHover) tryMove(displayHover);
  }

  // ===== タッチ(coarse): マスタップ=即移動 / 溝タップ=2段階確定 =====
  function handlePointerDown(e: PointerEvent) {
    if (readOnly || pointerKind !== 'coarse' || !myTurn) return;
    const bp = boardPoint(e);
    const displayHover = bp ? computeHover(bp.x, bp.y, TOUCH_SLOP) : null;
    setHover(displayHover);
    if (!displayHover) {
      setPendingWall(null);
      return;
    }
    if (displayHover.kind === 'pawn') {
      tryMove(displayHover);
      setPendingWall(null);
    } else {
      setPendingWall(flipWall(displayHover.wall, flip));
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (readOnly || pointerKind !== 'coarse' || !myTurn || pendingWall === null) return;
    const bp = boardPoint(e);
    const displayHover = bp ? computeHover(bp.x, bp.y, TOUCH_SLOP) : null;
    if (displayHover?.kind === 'wall') {
      setHover(displayHover);
      setPendingWall(flipWall(displayHover.wall, flip));
    }
  }

  function confirmPendingWall() {
    if (!pendingWall || !myTurn || !wallLegal(state, pendingWall)) return;
    onMove({ type: 'wall', wall: pendingWall });
    setPendingWall(null);
    setHover(null);
  }

  function cancelPendingWall() {
    setPendingWall(null);
    setHover(null);
  }

  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const home = flipPosition({ r, c }, flip);
      const { x, y } = cellXY(r, c);
      const cls = home.r === N - 1 ? 'cell-rect cell-home1' : home.r === 0 ? 'cell-rect cell-home2' : 'cell-rect';
      cells.push(<rect key={`${r}-${c}`} x={x} y={y} width={C} height={C} rx={7} className={cls} />);
    }
  }

  const lastMoveRect = useMemo(() => {
    if (!state.last) return null;
    if (state.last.type === 'pawn') {
      const from = flipPosition(state.last.from, flip);
      const { x, y } = cellXY(from.r, from.c);
      return { x: x + 3, y: y + 3, w: C - 6, h: C - 6, rx: 6 };
    }
    const w = flipWall(state.last.wall, flip);
    const rc = wallRect(w);
    return { x: rc.x - 2, y: rc.y - 2, w: rc.w + 4, h: rc.h + 4, rx: 5 };
  }, [state.last, flip]);

  const hoverLegal = hover?.kind === 'wall' ? wallLegal(state, flipWall(hover.wall, flip)) : null;

  return (
    <div className="board-frame">
      <svg
        ref={svgRef}
        className={`board${readOnly ? ' readonly' : ''}`}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          if (pointerKind === 'fine') setHover(null);
        }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <g>{cells}</g>
        {lastMoveRect && (
          <rect
            x={lastMoveRect.x}
            y={lastMoveRect.y}
            width={lastMoveRect.w}
            height={lastMoveRect.h}
            rx={lastMoveRect.rx}
            className="lastmove"
          />
        )}
        <g>
          {state.walls.map((w, i) => {
            const rc = wallRect(flipWall(w, flip));
            return <rect key={i} x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={4} className="wall-placed" />;
          })}
        </g>
        <g>
          {displayLegalMoves.map((m, i) => {
            const { x, y } = cellXY(m.r, m.c);
            const isHover = hover?.kind === 'pawn' && hover.r === m.r && hover.c === m.c;
            return (
              <circle
                key={i}
                cx={x + C / 2}
                cy={y + C / 2}
                r={isHover ? 12 : 8}
                className={`legal-dot${isHover ? ' legal-hi' : ''}`}
              />
            );
          })}
        </g>
        {hover?.kind === 'wall' &&
          myTurn &&
          (() => {
            const rc = wallRect(hover.wall);
            return (
              <rect x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={4} className={`ghost ${hoverLegal ? 'legal' : 'illegal'}`} />
            );
          })()}
        <g>
          {state.pawns.map((pawn, i) => {
            const disp = flipPosition(pawn, flip);
            const { x, y } = cellXY(disp.r, disp.c);
            return (
              <g key={i} className="pawn" transform={`translate(${x + C / 2} ${y + C / 2})`}>
                <circle r={18} className={`pawn-body pawn-${i}`} />
              </g>
            );
          })}
        </g>
      </svg>
      {!readOnly && pointerKind === 'coarse' && pendingWall !== null && (
        <WallConfirmBar legal={wallLegal(state, pendingWall)} onConfirm={confirmPendingWall} onCancel={cancelPendingWall} />
      )}
    </div>
  );
}
