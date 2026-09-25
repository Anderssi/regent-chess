/**
 * Rating math.
 *
 * Accuracy follows the widely used Lichess model (win% from centipawns, accuracy from win% drop).
 * The per-game Elo estimate is a heuristic mapping from average centipawn loss (ACPL):
 *   Elo ≈ 3100 · e^(−0.01 · ACPL)
 * It is an estimate only: Stockfish itself does not produce Elo ratings.
 */

export const EVAL_CLAMP_CP = 1000;

export function clampEval(cp: number): number {
  return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
}

/** Winning chance (0-100) for the side whose point of view `cp` is given in. */
export function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clampEval(cp))) - 1);
}

/** Accuracy (0-100) of a move given the mover's win% before and after it. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter);
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

export function eloFromAcpl(acpl: number): number {
  return Math.round(Math.max(100, Math.min(3100, 3100 * Math.exp(-0.01 * Math.max(0, acpl)))));
}

/** Standard Elo expected score. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** Standard Elo update. `score` is 1 for a win, 0.5 for a draw, 0 for a loss. */
export function updateRating(rating: number, opponent: number, score: number, k: number): number {
  return Math.round(rating + k * (score - expectedScore(rating, opponent)));
}
