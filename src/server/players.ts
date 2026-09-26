import type { Color } from "../shared/types.ts";
import { AI_NAME, STOCKFISH_ELO } from "../shared/rules.ts";
import { Chess } from "chess.js";
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

/** Thrown by a player when the game cannot go on for reasons outside chess (e.g. a crashed engine). */
export class PlayerFailure extends Error {}

/** A UCI engine playing with a fixed search time per move, kept under the move clock. */
export class EnginePlayer implements Player {
  constructor(
    readonly name: string,
    protected engine: UciEngine,
    private movetimeMs: number,
  ) {}

  async getMove(req: MoveRequest): Promise<string> {
    // Leave headroom under the clock for process I/O.
    const movetime = Math.max(50, Math.min(this.movetimeMs, req.timeLeftMs - 250));
    let bestMove: string | null;
    try {
      ({ bestMove } = await this.engine.search(req.fen, { movetimeMs: movetime }));
    } catch (err) {
      // An engine that crashed or stopped responding won't recover mid-game: abort rather than forfeit.
      throw new PlayerFailure(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!bestMove) throw new PlayerFailure(`${this.name} returned no move`);
    return bestMove;
  }
}

/** The opponent: Stockfish limited to 1600 Elo, as the brief specifies. */
export class StockfishPlayer extends EnginePlayer {
  static async create(engine: UciEngine, movetimeMs: number): Promise<StockfishPlayer> {
    await engine.configure({ UCI_LimitStrength: true, UCI_Elo: STOCKFISH_ELO });
    await engine.newGame();
    return new StockfishPlayer(`Stockfish (${STOCKFISH_ELO})`, engine, movetimeMs);
  }
}

/** Our AI: Leela Chess Zero at full strength. */
export class Lc0Player extends EnginePlayer {
  static async create(engine: UciEngine, movetimeMs: number): Promise<Lc0Player> {
    await engine.newGame();
    // Lc0 loads its network on the first search (1-2 s). Do that now, so it isn't charged to the first move's clock.
    await engine.search(new Chess().fen(), { nodes: 1 });
    return new Lc0Player(AI_NAME, engine, movetimeMs);
  }
}
