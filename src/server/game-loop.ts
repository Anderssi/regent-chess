import { Chess, type Move } from "chess.js";
import type { Color, GameResult, MoveSearch, Termination } from "../shared/types.ts";
import { MOVE_TIME_LIMIT_MS } from "../shared/rules.ts";
import { PlayerFailure, type MoveRequest, type PlayedMove, type Player } from "./players.ts";

export interface GameOutcome {
  status: "finished" | "aborted";
  result: GameResult | null;
  termination: Termination | null;
  sanMoves: string[];
  pgn: string;
  error: string | null;
  /** Each engine's own search for each ply; null for plies whose player reported none. */
  searchLog: (MoveSearch | null)[];
}

export interface PlayGameOptions {
  white: Player;
  black: Player;
  moveTimeLimitMs?: number;
  headers?: Record<string, string>;
  onMove?: (san: string, sanMoves: string[], fen: string) => void | Promise<void>;
  now?: () => number;
}

class MoveTimeout extends Error {}

const RETRY_BACKOFF_MS = 250;

/** Try to apply a SAN or UCI move. Returns null if it is illegal or unreadable. */
export function tryMove(chess: Chess, input: string): Move | null {
  const text = input.trim();
  if (!text) return null;
  try {
    return chess.move(text);
  } catch {}
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text);
  if (uci) {
    try {
      return chess.move({ from: uci[1]!.toLowerCase(), to: uci[2]!.toLowerCase(), promotion: uci[3]?.toLowerCase() });
    } catch {}
  }
  return null;
}

/**
 * FIDE 6.9: a side whose time runs out loses, unless the opponent cannot checkmate by any
 * series of legal moves, in which case the game is drawn. We detect the material cases:
 * the opponent has a lone king, or king + one minor piece against a lone king.
 */
export function opponentCanCheckmate(chess: Chess, flagged: Color): boolean {
  const pieces = (color: Color) =>
    chess
      .board()
      .flat()
      .filter((sq) => sq && sq.color === (color === "white" ? "w" : "b") && sq.type !== "k");
  const opponent = pieces(flagged === "white" ? "black" : "white");
  if (opponent.length === 0) return false;
  const loneMinor = opponent.length === 1 && (opponent[0]!.type === "n" || opponent[0]!.type === "b");
  if (loneMinor && pieces(flagged).length === 0) return false;
  return true;
}

function detectGameOver(chess: Chess): { result: GameResult; termination: Termination } | null {
  if (chess.isCheckmate()) {
    return { result: chess.turn() === "w" ? "0-1" : "1-0", termination: "checkmate" };
  }
  if (chess.isStalemate()) return { result: "1/2-1/2", termination: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "1/2-1/2", termination: "insufficient_material" };
  if (chess.isThreefoldRepetition()) return { result: "1/2-1/2", termination: "threefold_repetition" };
  if (chess.isDrawByFiftyMoves()) return { result: "1/2-1/2", termination: "fifty_move_rule" };
  return null;
}

export async function playGame(opts: PlayGameOptions): Promise<GameOutcome> {
  const limit = opts.moveTimeLimitMs ?? MOVE_TIME_LIMIT_MS;
  const now = opts.now ?? Date.now;
  const chess = new Chess();
  for (const [k, v] of Object.entries(opts.headers ?? {})) chess.setHeader(k, v);
  chess.setHeader("White", opts.white.name);
  chess.setHeader("Black", opts.black.name);
  const searchLog: (MoveSearch | null)[] = [];

  const finish = (status: GameOutcome["status"], result: GameResult | null, termination: Termination | null, error: string | null = null): GameOutcome => {
    chess.setHeader("Result", result ?? "*");
    if (termination) chess.setHeader("Termination", termination);
    return { status, result, termination, sanMoves: chess.history(), pgn: chess.pgn(), error, searchLog };
  };

  while (true) {
    const over = detectGameOver(chess);
    if (over) return finish("finished", over.result, over.termination);

    const color: Color = chess.turn() === "w" ? "white" : "black";
    const player = color === "white" ? opts.white : opts.black;
    try {
      const { move, search } = await requestLegalMove(chess, player, color, limit, now);
      searchLog.push(search);
      await opts.onMove?.(move.san, chess.history(), chess.fen());
    } catch (err) {
      if (err instanceof MoveTimeout) {
        if (!opponentCanCheckmate(chess, color)) {
          return finish("finished", "1/2-1/2", "timeout_vs_insufficient_material");
        }
        return finish("finished", color === "white" ? "0-1" : "1-0", "timeout");
      }
      const message = err instanceof Error ? err.message : String(err);
      return finish("aborted", null, null, `${player.name}: ${message}`);
    }
  }
}

/**
 * Ask a player for a move until it gives a legal one or its time runs out.
 * Illegal moves are reported back to the player and it may try again within the same time budget.
 */
async function requestLegalMove(
  chess: Chess,
  player: Player,
  color: Color,
  limitMs: number,
  now: () => number,
): Promise<{ move: Move; search: MoveSearch | null }> {
  const deadline = now() + limitMs;
  const controller = new AbortController();
  const rejectedAttempts: MoveRequest["rejectedAttempts"] = [];
  const legalMoves = chess.moves();
  const history = chess.history();
  const fen = chess.fen();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MoveTimeout());
    }, limitMs);
  });
  timeout.catch(() => undefined); // observed via Promise.race; avoid unhandled-rejection noise

  try {
    while (true) {
      const timeLeftMs = deadline - now();
      if (timeLeftMs <= 0) throw new MoveTimeout();
      let answer: string | PlayedMove;
      try {
        answer = await Promise.race([
          player.getMove({ fen, color, sanHistory: history, legalMoves, rejectedAttempts: [...rejectedAttempts], timeLeftMs, signal: controller.signal }),
          timeout,
        ]);
      } catch (err) {
        if (err instanceof MoveTimeout || err instanceof PlayerFailure) throw err;
        if (controller.signal.aborted) throw new MoveTimeout();
        // Transient failures (network etc.) use up clock time but may be retried.
        rejectedAttempts.push({ move: "", reason: `error: ${err instanceof Error ? err.message : String(err)}` });
        await Promise.race([Bun.sleep(RETRY_BACKOFF_MS), timeout]);
        continue;
      }
      if (now() > deadline) throw new MoveTimeout();
      const { move: text, search } = typeof answer === "string" ? { move: answer, search: undefined } : answer;
      const move = tryMove(chess, text);
      if (move) return { move, search: search ?? null };
      rejectedAttempts.push({ move: text, reason: "illegal or unreadable move" });
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
