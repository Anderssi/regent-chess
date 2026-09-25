import type { ReactNode } from "react";

/** Piece codes: colour (w/b) + piece letter (p n b r q k). */
export type PieceCode = `${"w" | "b"}${"p" | "n" | "b" | "r" | "q" | "k"}`;

/**
 * Everything that controls how the board looks. Swap in a new theme (e.g. SVG or image pieces)
 * without touching the board logic.
 */
export interface BoardTheme {
  name: string;
  lightSquare: string;
  darkSquare: string;
  lastMoveHighlight: string;
  coordinateColor: { onLight: string; onDark: string };
  renderPiece: (piece: PieceCode) => ReactNode;
}

const GLYPHS: Record<PieceCode, string> = {
  wk: "♚", wq: "♛", wr: "♜", wb: "♝", wn: "♞", wp: "♟",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

export const classicTheme: BoardTheme = {
  name: "Classic",
  lightSquare: "#ecdab9",
  darkSquare: "#ae8a68",
  lastMoveHighlight: "rgba(255, 213, 0, 0.45)",
  coordinateColor: { onLight: "#ae8a68", onDark: "#ecdab9" },
  renderPiece: (piece) => GLYPHS[piece],
};
