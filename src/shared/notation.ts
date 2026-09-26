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

/**
 * Lc0 writes castling as the king taking its own rook (e1h1) in some output, where standard UCI moves the king
 * two squares (e1g1). Use these only when the move as written isn't legal: e1h1 can also be a rook move.
 */
export const ROOK_CAPTURE_CASTLING: Readonly<Record<string, string>> = { e1h1: "e1g1", e1a1: "e1c1", e8h8: "e8g8", e8a8: "e8c8" };

/** Convert moves in UCI notation (an engine's principal variation, say) to SAN, stopping at the first illegal one. */
export function uciToSanLine(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const play = (uci: string) => {
    const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
    try {
      return m ? chess.move({ from: m[1]!, to: m[2]!, promotion: m[3] }).san : null;
    } catch {
      return null;
    }
  };
  const san: string[] = [];
  for (const uci of uciMoves) {
    const move = play(uci) ?? (ROOK_CAPTURE_CASTLING[uci] ? play(ROOK_CAPTURE_CASTLING[uci]) : null);
    if (!move) break;
    san.push(move);
  }
  return san;
}

/** A ply of a game that starts with White to move, as a numbered move: ply 3 "Nf3" is "2. Nf3", ply 4 "Nc6" is "2... Nc6". */
export function moveLabel(ply: number, san: string): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}. ${san}` : `${number}... ${san}`;
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
