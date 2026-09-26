/** Rules from the brief, on top of the standard laws of chess. */
export const MOVE_TIME_LIMIT_MS = 5_000;
export const STOCKFISH_ELO = 1600;

/** The name our AI (Leela Chess Zero under the hood) plays and is shown under. */
export const AI_NAME = "Pluto";

/** Rating bookkeeping for the running rating (standard Elo formula). */
export const INITIAL_RATING = 1500;
export const RATING_K_FACTOR = 32;
