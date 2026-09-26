import { AI_NAME } from "../shared/rules.ts";
import type { GameRecord } from "../shared/types.ts";

/** A player's display name. Games recorded before the rename stored our AI as "Lc0". */
export function playerName(name: string): string {
  return name === "Lc0" ? AI_NAME : name;
}

const TERMINATIONS: Record<string, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  threefold_repetition: "threefold repetition",
  fifty_move_rule: "fifty-move rule",
  insufficient_material: "insufficient material",
  timeout: "time forfeit",
  timeout_vs_insufficient_material: "time ran out, but opponent could not mate",
};

export function aiScore(game: GameRecord): "win" | "draw" | "loss" | null {
  if (!game.result) return null;
  if (game.result === "1/2-1/2") return "draw";
  return (game.result === "1-0") === (game.aiColor === "white") ? "win" : "loss";
}

/** A short note on a game's agent analysis for the game list, or "" if there's nothing to say. */
export function agentNote(game: GameRecord): string {
  if (game.agentRun?.status === "failed") return "agent run failed";
  if (game.agentRun) return "agents analysing…";
  const n = game.agentReports.length;
  return n ? `${n} agent report${n > 1 ? "s" : ""}` : "";
}

export function describeOutcome(game: GameRecord): string {
  if (game.status === "in_progress") return `In progress: ${game.sanMoves.length} plies played`;
  if (game.status === "aborted") return `Aborted${game.error ? `: ${game.error}` : ""}`;
  const parts = [`${game.result} by ${TERMINATIONS[game.termination ?? ""] ?? game.termination}`];
  const score = aiScore(game);
  if (score) parts.push(`${AI_NAME} ${score === "win" ? "won" : score === "loss" ? "lost" : "drew"}`);
  if (game.ratingBefore != null && game.ratingAfter != null) {
    const diff = game.ratingAfter - game.ratingBefore;
    parts.push(`rating ${game.ratingBefore} → ${game.ratingAfter} (${diff >= 0 ? "+" : ""}${diff})`);
  }
  if (game.aiEloEstimate != null) parts.push(`est. Elo this game: ${game.aiEloEstimate}`);
  else if (game.status === "finished") parts.push("analysing…");
  return parts.join(" · ");
}
