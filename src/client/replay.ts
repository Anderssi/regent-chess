import { Chess } from "chess.js";

export interface ReplayPosition {
  fen: string;
  lastMove: { from: string; to: string } | null;
}

/** All positions of a game: index 0 is the start, index n is after the nth ply. */
export function replayPositions(sanMoves: string[], startFen?: string): ReplayPosition[] {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const positions: ReplayPosition[] = [{ fen: chess.fen(), lastMove: null }];
  for (const san of sanMoves) {
    const move = chess.move(san);
    positions.push({ fen: chess.fen(), lastMove: { from: move.from, to: move.to } });
  }
  return positions;
}
