import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { canvasTarget } from "../iso/pixels.ts";
import { renderScene, SCENE_H, SCENE_W } from "../iso/render.ts";
import { defaultTheme, type BoardTheme, type PieceCode } from "../theme.ts";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
/** Redraw rate for candle flicker and the moving sky. */
const FRAME_MS = 100;

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  theme?: BoardTheme;
  /**
   * Draw the scene as a fixed backdrop covering the whole window, with the board scaled to fit and
   * centred in the parent element (the open "stage" between the page's panels).
   */
  fullscreen?: boolean;
}

/**
 * An isometric pixel-art board drawn on a canvas at native resolution and scaled up with
 * nearest-neighbour sampling, so pixels stay sharp. A visually hidden grid mirrors the position for screen readers.
 */
export function Board({ fen, orientation = "white", lastMove, theme = defaultTheme, fullscreen }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useSceneSize(boxRef, theme.scale, !!fullscreen);
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
      renderScene(target, theme, { board, orientation, lastMove, checkSquare, time, ...size.scene });
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
  }, [board, orientation, lastMove?.from, lastMove?.to, checkSquare, theme, size.key]);

  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? FILES : [...FILES].reverse();

  return (
    <div ref={boxRef} className={fullscreen ? "board fullscreen" : "board"} style={size.boxStyle}>
      <canvas ref={canvasRef} width={size.scene.width} height={size.scene.height} style={size.canvasStyle} aria-hidden="true" />
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

interface SceneSize {
  scene: { width: number; height: number; boardX?: number; boardY?: number };
  boxStyle?: React.CSSProperties;
  canvasStyle?: React.CSSProperties;
  /** Changes whenever the drawing needs redoing. */
  key: string;
}

/**
 * Inline mode: the bare scene at `minScale`. Fullscreen: a canvas covering the window at the largest
 * scale where the board fits the stage (the box's parent), with the board centred on the stage.
 */
function useSceneSize(boxRef: React.RefObject<HTMLDivElement | null>, minScale: number, fullscreen: boolean): SceneSize {
  const inline: SceneSize = {
    scene: { width: SCENE_W, height: SCENE_H },
    boxStyle: { width: SCENE_W * minScale, aspectRatio: `${SCENE_W} / ${SCENE_H}` },
    key: "inline",
  };
  const [size, setSize] = useState<SceneSize>(inline);
  useEffect(() => {
    const stage = boxRef.current?.parentElement;
    if (!fullscreen || !stage || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const r = stage.getBoundingClientRect();
      // Fractional scales keep the board filling the stage; below 0.5× (tiny phone stages) it would blur.
      const scale = Math.max(0.5, Math.min(r.width / SCENE_W, r.height / SCENE_H));
      const width = Math.ceil(window.innerWidth / scale);
      const height = Math.ceil(window.innerHeight / scale);
      const boardX = Math.round((r.left + r.width / 2) / scale - SCENE_W / 2);
      const boardY = Math.round((r.top + r.height / 2) / scale - SCENE_H / 2);
      const key = [width, height, boardX, boardY, scale.toFixed(4)].join(",");
      setSize((prev) =>
        prev.key === key
          ? prev
          : { scene: { width, height, boardX, boardY }, canvasStyle: { width: width * scale, height: height * scale }, key },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    // Panels above the stage can grow (text loading in) and push it down without resizing it.
    observer.observe(document.body);
    window.addEventListener("resize", update);
    // The stage moves when the page scrolls (narrow screens), so keep the board on it.
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [boxRef, minScale, fullscreen]);
  return fullscreen ? size : inline;
}
