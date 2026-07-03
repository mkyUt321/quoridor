import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { legalPawnMoves, wallLegal, type GameState, type Move, type PlayerId } from '@quoridor/shared';
import { C, N, P, SIZE, cellXY, wallRect } from '../game/geometry.js';
import { computeHover, type Hover } from '../game/interaction.js';

interface Props {
  state: GameState;
  youAre: PlayerId;
  onMove: (move: Move) => void;
}

export function Board({ state, youAre, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const myTurn = state.turn === youAre && state.winner === null;
  const legalMoves = useMemo(
    () => (state.winner === null ? legalPawnMoves(state, state.turn) : []),
    [state],
  );

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

  function handleMove(e: MouseEvent) {
    if (!myTurn) {
      setHover(null);
      return;
    }
    const bp = boardPoint(e);
    setHover(bp ? computeHover(bp.x, bp.y) : null);
  }

  function handleClick(e: MouseEvent) {
    if (!myTurn) return;
    const bp = boardPoint(e);
    const clicked = bp ? computeHover(bp.x, bp.y) : null;
    if (!clicked) return;
    if (clicked.kind === 'pawn') {
      if (!legalMoves.some((m) => m.r === clicked.r && m.c === clicked.c)) return;
      onMove({ type: 'pawn', to: { r: clicked.r, c: clicked.c } });
    } else {
      if (!wallLegal(state, clicked.wall)) return;
      onMove({ type: 'wall', wall: clicked.wall });
    }
    setHover(null);
  }

  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const { x, y } = cellXY(r, c);
      const cls = r === N - 1 ? 'cell-rect cell-home1' : r === 0 ? 'cell-rect cell-home2' : 'cell-rect';
      cells.push(<rect key={`${r}-${c}`} x={x} y={y} width={C} height={C} rx={7} className={cls} />);
    }
  }

  return (
    <svg
      ref={svgRef}
      className="board"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      onClick={handleClick}
    >
      <g>{cells}</g>
      <g>
        {state.walls.map((w, i) => {
          const rc = wallRect(w);
          return <rect key={i} x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={4} className="wall-placed" />;
        })}
      </g>
      <g>
        {legalMoves.map((m, i) => {
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
          const legal = wallLegal(state, hover.wall);
          return (
            <rect x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={4} className={`ghost ${legal ? 'legal' : 'illegal'}`} />
          );
        })()}
      <g>
        {state.pawns.map((pawn, i) => {
          const { x, y } = cellXY(pawn.r, pawn.c);
          return (
            <g key={i} transform={`translate(${x + C / 2} ${y + C / 2})`}>
              <circle r={18} className={`pawn-body pawn-${i}`} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
