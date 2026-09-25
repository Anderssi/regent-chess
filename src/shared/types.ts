export type Color = "white" | "black";
export type GameResult = "1-0" | "0-1" | "1/2-1/2";
export type GameStatus = "in_progress" | "finished" | "aborted";

export type Termination =
  | "checkmate"
  | "stalemate"
  | "threefold_repetition"
  | "fifty_move_rule"
  | "insufficient_material"
  | "timeout"
  | "timeout_vs_insufficient_material";

export interface PlyAnalysis {
  ply: number;
  color: Color;
  san: string;
  fenBefore: string;
  fenAfter: string;
  /** Evaluation before the move, in centipawns from White's point of view (mates clamped). */
  evalBefore: number;
  /** Evaluation after the move, in centipawns from White's point of view (mates clamped). */
  evalAfter: number;
  /** Engine's preferred move in the position before, in SAN. */
  bestMove: string | null;
  /** Centipawns lost by the mover relative to the engine's best line (>= 0). */
  cpLoss: number;
  /** 0-100 accuracy for this move. */
  accuracy: number;
}

export interface SideSummary {
  moves: number;
  acpl: number;
  accuracy: number;
  estimatedElo: number;
}

export interface GameAnalysis {
  plies: PlyAnalysis[];
  white: SideSummary;
  black: SideSummary;
  depth: number;
}

export interface GameRecord {
  id: number;
  createdAt: string;
  finishedAt: string | null;
  status: GameStatus;
  aiColor: Color;
  white: string;
  black: string;
  result: GameResult | null;
  termination: Termination | null;
  sanMoves: string[];
  pgn: string;
  /** Per-game Elo estimate for our AI from Stockfish analysis. */
  aiEloEstimate: number | null;
  /** Running rating from results, before and after this game. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  error: string | null;
  analysis: GameAnalysis | null;
}
