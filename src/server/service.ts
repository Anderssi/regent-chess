import type { AgentRun, Color, GameAnalysis, GameRecord } from "../shared/types.ts";
import {
  INITIAL_RATING,
  isStockfishElo,
  MOVE_TIME_LIMIT_MS,
  RATING_K_FACTOR,
  STOCKFISH_ELO,
  STOCKFISH_ELO_MAX,
  STOCKFISH_ELO_MIN,
} from "../shared/rules.ts";
import { parsePastedGame } from "../shared/notation.ts";
import type { AgentRunner } from "./agents/runner.ts";
import { analyseGame } from "./analysis.ts";
import type { GameSort, GameStore, SortOrder } from "./db.ts";
import type { UciEngine } from "./engine/uci.ts";
import { updateRating } from "./elo.ts";
import { playGame } from "./game-loop.ts";
import type { Player } from "./players.ts";

export interface GameServiceDeps {
  store: GameStore;
  createAiPlayer: () => Promise<Player>;
  createStockfishPlayer: (elo: number) => Promise<Player>;
  /** A full-strength engine used only for analysis. */
  getAnalysisEngine: () => Promise<UciEngine>;
  analysisDepth?: number;
  moveTimeLimitMs?: number;
  /** Runs the Claude Code analysis agents on each game once Stockfish has analysed it. Without it, `agentsOff` says why. */
  agents?: AgentRunner;
  agentsOff?: string;
}

export class GameInProgressError extends Error {}

/** A start request with settings outside what the app supports. */
export class InvalidGameSettingsError extends Error {}

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "not_ready" | "unavailable",
  ) {
    super(message);
  }
}

export class GameService {
  private active: Promise<void> | null = null;

  constructor(private deps: GameServiceDeps) {}

  /** Our AI alternates colours from game to game, starting with White. */
  nextAiColor(): Color {
    return this.deps.store.lastAiColor() === "white" ? "black" : "white";
  }

  currentRating(): number {
    return this.deps.store.latestRating() ?? INITIAL_RATING;
  }

  isPlaying(): boolean {
    return this.active !== null;
  }

  /** Start a game in the background, against Stockfish at `stockfishElo`. Only one game runs at a time. */
  async startGame(settings: { stockfishElo?: number } = {}): Promise<GameRecord> {
    if (this.active) throw new GameInProgressError("A game is already in progress");
    const stockfishElo = settings.stockfishElo ?? STOCKFISH_ELO;
    if (!isStockfishElo(stockfishElo)) {
      throw new InvalidGameSettingsError(`Stockfish's Elo must be a whole number from ${STOCKFISH_ELO_MIN} to ${STOCKFISH_ELO_MAX}`);
    }
    const ai = await this.deps.createAiPlayer();
    const stockfish = await this.deps.createStockfishPlayer(stockfishElo);
    const aiColor = this.nextAiColor();
    const [white, black] = aiColor === "white" ? [ai, stockfish] : [stockfish, ai];
    const game = this.deps.store.create({ aiColor, white: white.name, black: black.name, stockfishElo });

    this.active = this.runGame(game.id, aiColor, white, black, stockfishElo).finally(() => {
      this.active = null;
    });
    return game;
  }

  /** Resolves when the current game (if any) has finished and been analysed. */
  async waitForActiveGame(): Promise<void> {
    await this.active;
  }

  private async runGame(id: number, aiColor: Color, white: Player, black: Player, stockfishElo: number): Promise<void> {
    const { store } = this.deps;
    const outcome = await playGame({
      white,
      black,
      moveTimeLimitMs: this.deps.moveTimeLimitMs ?? MOVE_TIME_LIMIT_MS,
      headers: { Event: "SchackMars", Site: "SchackMars", Date: new Date().toISOString().slice(0, 10).replaceAll("-", ".") },
      onMove: (_san, sanMoves) => store.updateMoves(id, sanMoves, ""),
    });

    let ratingBefore: number | null = null;
    let ratingAfter: number | null = null;
    if (outcome.status === "finished" && outcome.result) {
      ratingBefore = this.currentRating();
      const score = outcome.result === "1/2-1/2" ? 0.5 : (outcome.result === "1-0") === (aiColor === "white") ? 1 : 0;
      ratingAfter = updateRating(ratingBefore, stockfishElo, score, RATING_K_FACTOR);
    }
    const aiSetup = (aiColor === "white" ? white : black).setup ?? null;
    store.finish(id, { ...outcome, ratingBefore, ratingAfter, aiSetup });

    if (outcome.status === "finished" && outcome.sanMoves.length > 0) {
      try {
        const analysis = await this.analyse(outcome.sanMoves);
        store.saveAnalysis(id, analysis, analysis[aiColor].estimatedElo);
        this.deps.agents?.enqueue(id);
      } catch (err) {
        console.error(`Analysis of game ${id} failed:`, err);
      }
    }
  }

  agentStatus(): { enabled: boolean; reason?: string } {
    return this.deps.agents ? { enabled: true } : { enabled: false, reason: this.deps.agentsOff ?? "agent analysis is not set up" };
  }

  /** Queue the agent analysis of a finished, analysed game, or run it again. */
  requestAgentAnalysis(id: number): AgentRun {
    const { agents, store } = this.deps;
    if (!agents) throw new AgentRequestError(`Agent analysis is off: ${this.agentStatus().reason}`, "unavailable");
    const game = store.get(id);
    if (!game) throw new AgentRequestError("Game not found", "not_found");
    if (game.status !== "finished" || !game.analysis) {
      throw new AgentRequestError("Only finished games that Stockfish has analysed can go to the agents", "not_ready");
    }
    return agents.enqueue(id);
  }

  async analyse(sanMoves: string[], startFen?: string): Promise<GameAnalysis> {
    const engine = await this.deps.getAnalysisEngine();
    return analyseGame(engine, sanMoves, { depth: this.deps.analysisDepth, startFen });
  }

  async analysePasted(text: string) {
    const parsed = parsePastedGame(text);
    const analysis = await this.analyse(parsed.sanMoves, parsed.headers.FEN);
    return { ...parsed, analysis };
  }

  listGames(sort?: GameSort, order?: SortOrder): GameRecord[] {
    return this.deps.store.list(sort, order).map((game) => this.withAgentRun(game));
  }

  getGame(id: number): GameRecord | null {
    const game = this.deps.store.get(id);
    return game && this.withAgentRun(game);
  }

  private withAgentRun(game: GameRecord): GameRecord {
    return { ...game, agentRun: this.deps.agents?.run(game.id) ?? null };
  }
}
