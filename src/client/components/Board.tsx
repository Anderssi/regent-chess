import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { canvasTarget } from "../iso/pixels.ts";
import { renderScene, SCENE_H, SCENE_W } from "../iso/render.ts";
import { defaultTheme, type BoardTheme, type PieceCode } from "../theme.ts";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
/** Redraw rate for candle flicker and the moving sky. */
const FRAME_MS = 120;
/** Vertical space kept free below the board for the move navigation when fitting it. */
const BELOW_BOARD = 110;

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  theme?: BoardTheme;
  /** Fill the parent's width and the viewport height below it, extending the sky around the board. */
  fit?: boolean;
}

/**
 * An isometric pixel-art board drawn on a canvas at native resolution and scaled up with
 * nearest-neighbour sampling, so pixels stay sharp. A visually hidden grid mirrors the position for screen readers.
 */
export function Board({ fen, orientation = "white", lastMove, theme = defaultTheme, fit }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useFitSize(boxRef, theme.scale, !!fit);
  const { board, checkSquare } = useMemo(() => {
    const chess = new Chess(fen);
    const king = chess.inCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null : null;
    return { board: chess.board(), checkSquare: king };
  }, [fen]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const target = canvasTarget(ctx);
    const draw = (time: number) =>
      renderScene(target, theme, { board, orientation, lastMove, checkSquare, time, width: size.width, height: size.height });
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
  }, [board, orientation, lastMove?.from, lastMove?.to, checkSquare, theme, size.width, size.height]);

  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? FILES : [...FILES].reverse();

  return (
    <div ref={boxRef} className="board" style={{ width: size.cssWidth, aspectRatio: `${size.width} / ${size.height}` }}>
      <canvas ref={canvasRef} width={size.width} height={size.height} aria-hidden="true" />
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

interface FitSize {
  /** Native canvas pixels. */
  width: number;
  height: number;
  /** Displayed width in CSS pixels. */
  cssWidth: number;
}

/**
 * Canvas size that fills the parent's width and the viewport height below it (leaving room for the
 * navigation). The scale is the largest at which the whole scene fits, never below `minScale`.
 */
function useFitSize(boxRef: React.RefObject<HTMLDivElement | null>, minScale: number, enabled: boolean): FitSize {
  const fixed = { width: SCENE_W, height: SCENE_H, cssWidth: SCENE_W * minScale };
  const [size, setSize] = useState<FitSize>(fixed);
  useEffect(() => {
    const parent = boxRef.current?.parentElement;
    if (!enabled || !parent || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const cssWidth = Math.floor(parent.clientWidth);
      const top = parent.getBoundingClientRect().top + window.scrollY;
      const cssHeight = Math.floor(window.innerHeight - top - BELOW_BOARD);
      const scale = Math.max(minScale, Math.min(cssWidth / SCENE_W, cssHeight / SCENE_H));
      const width = Math.max(SCENE_W, Math.round(cssWidth / scale));
      const height = Math.max(SCENE_H, Math.round(cssHeight / scale));
      setSize((prev) => (prev.width === width && prev.height === height && prev.cssWidth === cssWidth ? prev : { width, height, cssWidth }));
    };
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [boxRef, minScale, enabled]);
  return enabled ? size : fixed;
}
