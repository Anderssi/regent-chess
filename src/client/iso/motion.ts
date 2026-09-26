/**
 * Working out which pieces moved between two positions, so a single move (or castling) can be
 * animated as a lift, glide and set-down.
 */
import type { PieceType } from "../theme.ts";

export interface Piece {
  type: PieceType;
  color: "w" | "b";
}

/** Board contents, rank 8 first, like chess.js `board()`. */
export type BoardGrid = (Piece | null)[][];

export interface PieceMotion {
  from: string;
  to: string;
  piece: Piece;
}

export interface MoveAnimation {
  /** Pieces that travel from one square to another (one, or two when castling). */
  motions: PieceMotion[];
  /** Captured pieces, shown on their square until the mover lands. */
  ghosts: { square: string; piece: Piece }[];
}

const FILES = "abcdefgh";

function squares(board: BoardGrid): Map<string, Piece> {
  const map = new Map<string, Piece>();
  board.forEach((rank, r) =>
    rank.forEach((piece, f) => {
      // Keep just type and colour (chess.js pieces also carry their square).
      if (piece) map.set(`${FILES[f]}${8 - r}`, { type: piece.type, color: piece.color });
    }),
  );
  return map;
}

const same = (a: Piece | undefined, b: Piece | undefined) => !!a && !!b && a.type === b.type && a.color === b.color;

/**
 * The animation from `prev` to `next`, or null when they aren't one move apart (e.g. jumping to the
 * start of the game). Works backwards too: an un-captured piece simply reappears.
 */
export function diffBoards(prev: BoardGrid, next: BoardGrid): MoveAnimation | null {
  const before = squares(prev);
  const after = squares(next);
  const gone = [...before].filter(([sq, p]) => !same(after.get(sq), p));
  const came = [...after].filter(([sq, p]) => !same(before.get(sq), p));
  const motions: PieceMotion[] = [];
  const matched = new Set<string>();
  for (const [to, piece] of came) {
    // Prefer the same piece; fall back to the same colour for a promotion (pawn in, queen out).
    const source =
      gone.find(([sq, p]) => !matched.has(sq) && same(p, piece)) ??
      gone.find(([sq, p]) => !matched.has(sq) && p.color === piece.color && p.type === "p");
    if (!source) continue;
    matched.add(source[0]);
    motions.push({ from: source[0], to, piece });
  }
  const ghosts = gone.filter(([sq]) => !matched.has(sq)).map(([square, piece]) => ({ square, piece }));
  if (motions.length === 0 || motions.length > 2 || ghosts.length > 1) return null;
  return { motions, ghosts };
}

/** Lift for the first quarter, glide for the middle half, set down for the last quarter. */
export function motionPath(progress: number): { travel: number; lift: number } {
  const ease = (x: number) => x * x * (3 - 2 * x);
  const p = Math.max(0, Math.min(1, progress));
  const lift = p < 0.25 ? ease(p / 0.25) : p > 0.75 ? ease((1 - p) / 0.25) : 1;
  const travel = p < 0.25 ? 0 : p > 0.75 ? 1 : ease((p - 0.25) / 0.5);
  return { travel, lift };
}
