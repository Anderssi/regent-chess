import type { Color, EngineSetup, MoveSearch } from "../shared/types.ts";
import { AI_NAME, STOCKFISH_ELO } from "../shared/rules.ts";
import { ROOK_CAPTURE_CASTLING, uciToSanLine } from "../shared/notation.ts";
import { Chess } from "chess.js";
import { clampEval } from "./elo.ts";
import { scoreToCp, type SearchResult, type UciEngine } from "./engine/uci.ts";

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

/** A move, and from engine players the engine's own account of the search behind it. */
export interface PlayedMove {
  move: string;
  search?: MoveSearch;
}

export interface Player {
  readonly name: string;
  /** How the player is set up, recorded with the game. */
  readonly setup?: EngineSetup;
  /** Return a move in SAN or UCI (e.g. "Nf3" or "g1f3"), on its own or with search data. */
  getMove(req: MoveRequest): Promise<string | PlayedMove>;
}

/** Thrown by a player when the game cannot go on for reasons outside chess (e.g. a crashed engine). */
export class PlayerFailure extends Error {}

/** A UCI engine playing with a fixed search time per move, kept under the move clock. */
export class EnginePlayer implements Player {
  constructor(
    readonly name: string,
    protected engine: UciEngine,
    protected movetimeMs: number,
  ) {}

  async getMove(req: MoveRequest): Promise<PlayedMove> {
    // Leave headroom under the clock for process I/O.
    const movetime = Math.max(50, Math.min(this.movetimeMs, req.timeLeftMs - 250));
    const started = performance.now();
    let result: SearchResult;
    try {
      result = await this.engine.search(req.fen, { movetimeMs: movetime });
    } catch (err) {
      // An engine that crashed or stopped responding won't recover mid-game: abort rather than forfeit.
      throw new PlayerFailure(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!result.bestMove) throw new PlayerFailure(`${this.name} returned no move`);
    return { move: result.bestMove, search: describeSearch(req.fen, result, movetime, performance.now() - started) };
  }
}

/** A search as recorded with the game: moves in SAN, evaluations from White's point of view. */
export function describeSearch(fen: string, result: SearchResult, movetimeMs: number, timeMs: number): MoveSearch {
  const whiteToMove = fen.split(" ")[1] === "w";
  const info = result.info;
  const legal = new Map(new Chess(fen).moves({ verbose: true }).map((m) => [m.from + m.to + (m.promotion ?? ""), m.san]));
  const toSan = (uci: string) => legal.get(uci) ?? legal.get(ROOK_CAPTURE_CASTLING[uci] ?? "");
  const pvStart = info?.pv[0] ? toSan(info.pv[0]) : undefined;
  const pv = info && pvStart && pvStart === toSan(result.bestMove ?? "") ? info.pv : result.bestMove ? [result.bestMove] : [];
  return {
    movetimeMs,
    timeMs: Math.round(timeMs),
    depth: result.depth,
    seldepth: info?.seldepth ?? null,
    nodes: info?.nodes ?? null,
    nps: info?.nps ?? null,
    eval: info ? (whiteToMove ? 1 : -1) * clampEval(scoreToCp(info.score)) : null,
    wdl: info?.wdl ? (whiteToMove ? info.wdl : [info.wdl[2], info.wdl[1], info.wdl[0]]) : null,
    pv: uciToSanLine(fen, pv),
    candidates: result.moveStats.flatMap((s) => {
      const san = toSan(s.move);
      return san ? [{ san, visits: s.visits, policy: s.policy, q: s.q }] : [];
    }),
  };
}

/** The opponent: Stockfish limited to an Elo (1600 by default, as the brief specifies). */
export class StockfishPlayer extends EnginePlayer {
  static async create(engine: UciEngine, movetimeMs: number, elo = STOCKFISH_ELO): Promise<StockfishPlayer> {
    await engine.configure({ UCI_LimitStrength: true, UCI_Elo: elo });
    await engine.newGame();
    return new StockfishPlayer(`Stockfish (${elo})`, engine, movetimeMs);
  }
}

/** Lc0 options on top of its defaults: search statistics for the game record. They don't slow the search down. */
export const LC0_OPTIONS = { UCI_ShowWDL: true, VerboseMoveStats: true };

/** Our AI: Leela Chess Zero at full strength. */
export class Lc0Player extends EnginePlayer {
  static async create(engine: UciEngine, movetimeMs: number, command: string[] = []): Promise<Lc0Player> {
    await engine.configure(LC0_OPTIONS);
    await engine.newGame();
    // Lc0 loads its network on the first search (1-2 s). Do that now, so it isn't charged to the first move's clock.
    await engine.search(new Chess().fen(), { nodes: 1 });
    return new Lc0Player(AI_NAME, engine, movetimeMs, command);
  }

  private constructor(
    name: string,
    engine: UciEngine,
    movetimeMs: number,
    private command: string[],
  ) {
    super(name, engine, movetimeMs);
  }

  get setup(): EngineSetup {
    const log = this.engine.startupLog;
    return {
      name: this.engine.name ?? this.name,
      command: this.command,
      movetimeMs: this.movetimeMs,
      options: { ...LC0_OPTIONS },
      network: /Loading weights file from: (.+)/.exec(log)?.[1]?.trim() ?? null,
      backend: /Initialized (.+ backend.*)/.exec(log)?.[1]?.trim() ?? null,
    };
  }
}
