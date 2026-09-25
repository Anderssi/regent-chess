import type { Color } from "../shared/types.ts";
import { STOCKFISH_ELO } from "../shared/rules.ts";
import type { UciEngine } from "./engine/uci.ts";

export interface MoveRequest {
  fen: string;
  color: Color;
  sanHistory: string[];
  legalMoves: string[];
  /** Earlier attempts this turn that were illegal or unreadable. */
  rejectedAttempts: { move: string; reason: string }[];
  /** Milliseconds left on this move's clock when the request is made. */
  timeLeftMs: number;
  /** Aborted when the move's time runs out. */
  signal: AbortSignal;
}

export interface Player {
  readonly name: string;
  /** Return a move in SAN or UCI (e.g. "Nf3" or "g1f3"). */
  getMove(req: MoveRequest): Promise<string>;
}

/** Thrown by a player when the game cannot go on for reasons outside chess (bad API key, crashed engine). */
export class PlayerFailure extends Error {}

export class StockfishPlayer implements Player {
  readonly name = `Stockfish (${STOCKFISH_ELO})`;
  constructor(
    private engine: UciEngine,
    private movetimeMs: number,
  ) {}

  /** Apply the brief's strength limit. */
  static async create(engine: UciEngine, movetimeMs: number): Promise<StockfishPlayer> {
    await engine.configure({ UCI_LimitStrength: true, UCI_Elo: STOCKFISH_ELO });
    await engine.newGame();
    return new StockfishPlayer(engine, movetimeMs);
  }

  async getMove(req: MoveRequest): Promise<string> {
    // Leave headroom under the clock for process I/O.
    const movetime = Math.max(50, Math.min(this.movetimeMs, req.timeLeftMs - 250));
    const { bestMove } = await this.engine.search(req.fen, { movetimeMs: movetime });
    if (!bestMove) throw new PlayerFailure("Stockfish returned no move");
    return bestMove;
  }
}
