import { Chess } from "chess.js";
import { useEffect, useMemo, useRef } from "react";
import { canvasTarget } from "../iso/pixels.ts";
import { renderScene, SCENE_H, SCENE_W } from "../iso/render.ts";
import { defaultTheme, type BoardTheme, type PieceCode } from "../theme.ts";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
/** Redraw rate for candle flicker and twinkling stars. */
const FRAME_MS = 120;

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  theme?: BoardTheme;
}

/**
 * An isometric pixel-art board drawn on a canvas at native resolution and scaled up by a whole
 * number, so pixels stay crisp. A visually hidden grid mirrors the position for screen readers.
 */
export function Board({ fen, orientation = "white", lastMove, theme = defaultTheme }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { board, checkSquare } = useMemo(() => {
    const chess = new Chess(fen);
    const king = chess.inCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null : null;
    return { board: chess.board(), checkSquare: king };
  }, [fen]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const target = canvasTarget(ctx);
    const draw = (time: number) => renderScene(target, theme, { board, orientation, lastMove, checkSquare, time });
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      draw(0);
      return;
    }
    let frame = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now || 1);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    draw(performance.now() || 1);
    return () => cancelAnimationFrame(frame);
  }, [board, orientation, lastMove?.from, lastMove?.to, checkSquare, theme]);

  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? FILES : [...FILES].reverse();

  return (
    <div className="board" style={{ width: SCENE_W * theme.scale, aspectRatio: `${SCENE_W} / ${SCENE_H}` }}>
      <canvas ref={canvasRef} width={SCENE_W} height={SCENE_H} aria-hidden="true" />
      <div className="sr-only" role="grid" aria-label="Chess board">
        {ranks.map((rank) => (
          <div role="row" key={rank}>
            {files.map((file) => {
              const square = `${file}${rank}`;
              const piece = board[8 - rank]![FILES.indexOf(file)];
              const code = piece ? (`${piece.color}${piece.type}` as PieceCode) : undefined;
              const label = piece ? `${square}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}` : `${square}, empty`;
              return <div role="gridcell" key={square} data-square={square} data-piece={code} aria-label={label} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
