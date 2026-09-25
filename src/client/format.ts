import type { GameRecord } from "../shared/types.ts";

const TERMINATIONS: Record<string, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  threefold_repetition: "threefold repetition",
  fifty_move_rule: "fifty-move rule",
  insufficient_material: "insufficient material",
  timeout: "time forfeit",
  timeout_vs_insufficient_material: "time ran out, but opponent could not mate",
};

export function claudeScore(game: GameRecord): "win" | "draw" | "loss" | null {
  if (!game.result) return null;
  if (game.result === "1/2-1/2") return "draw";
  return (game.result === "1-0") === (game.claudeColor === "white") ? "win" : "loss";
}

export function describeOutcome(game: GameRecord): string {
  if (game.status === "in_progress") return `In progress: ${game.sanMoves.length} plies played`;
  if (game.status === "aborted") return `Aborted${game.error ? `: ${game.error}` : ""}`;
  const parts = [`${game.result} by ${TERMINATIONS[game.termination ?? ""] ?? game.termination}`];
  const score = claudeScore(game);
  if (score) parts.push(`Claude ${score === "win" ? "won" : score === "loss" ? "lost" : "drew"}`);
  if (game.ratingBefore != null && game.ratingAfter != null) {
    const diff = game.ratingAfter - game.ratingBefore;
    parts.push(`rating ${game.ratingBefore} → ${game.ratingAfter} (${diff >= 0 ? "+" : ""}${diff})`);
  }
  if (game.claudeEloEstimate != null) parts.push(`est. Elo this game: ${game.claudeEloEstimate}`);
  else if (game.status === "finished") parts.push("analysing…");
  return parts.join(" · ");
}
