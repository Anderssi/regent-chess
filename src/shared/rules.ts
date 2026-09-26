/** Rules from the brief, on top of the standard laws of chess. */
export const MOVE_TIME_LIMIT_MS = 5_000;
/** The brief's opponent: Stockfish at 1600 Elo. It can be turned up per game. */
export const STOCKFISH_ELO = 1600;
/** Stockfish's UCI_Elo range. */
export const STOCKFISH_ELO_MIN = 1320;
export const STOCKFISH_ELO_MAX = 3190;
/** The strengths offered in the app. */
export const STOCKFISH_LEVELS = [STOCKFISH_ELO_MIN, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000, STOCKFISH_ELO_MAX];

export function isStockfishElo(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= STOCKFISH_ELO_MIN && (value as number) <= STOCKFISH_ELO_MAX;
}

/** The name our AI (Leela Chess Zero under the hood) plays and is shown under. */
export const AI_NAME = "Pluto";

/** Rating bookkeeping for the running rating (standard Elo formula). */
export const INITIAL_RATING = 1500;
export const RATING_K_FACTOR = 32;
