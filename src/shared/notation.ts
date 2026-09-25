import { Chess } from "chess.js";

export interface ParsedGame {
  sanMoves: string[];
  headers: Record<string, string>;
  startFen: string;
}

/**
 * Parse a game pasted as PGN or bare algebraic movetext ("1. e4 e5 2. Nf3" or "e4 e5 Nf3").
 * Every move is validated by replaying it; throws with the offending move on failure.
 */
export function parsePastedGame(text: string): ParsedGame {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("No moves found");

  const chess = new Chess();
  try {
    chess.loadPgn(trimmed);
  } catch (err) {
    // Fall back to token-by-token replay for a clearer error message.
    replayTokens(trimmed);
    throw err;
  }
  const sanMoves = chess.history();
  if (sanMoves.length === 0) throw new Error("No moves found");
  const headers = Object.fromEntries(
    Object.entries(chess.getHeaders()).filter(([, v]) => v != null && v !== ""),
  ) as Record<string, string>;
  return { sanMoves, headers, startFen: headers.FEN ?? new Chess().fen() };
}

function replayTokens(text: string): void {
  const body = text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ");
  const tokens = body
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ""))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) && !/^\$\d+$/.test(t));
  const chess = new Chess();
  tokens.forEach((token, i) => {
    try {
      chess.move(token);
    } catch {
      throw new Error(`Illegal or unreadable move "${token}" at ply ${i + 1}`);
    }
  });
}

/** Render SAN moves as numbered movetext: "1. e4 e5 2. Nf3". */
export function formatMovetext(sanMoves: string[]): string {
  const parts: string[] = [];
  sanMoves.forEach((san, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(san);
  });
  return parts.join(" ");
}
