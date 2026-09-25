import type { Color, GameAnalysis, GameRecord } from "../shared/types.ts";
import { INITIAL_RATING, MOVE_TIME_LIMIT_MS, RATING_K_FACTOR, STOCKFISH_ELO } from "../shared/rules.ts";
import { parsePastedGame } from "../shared/notation.ts";
import { analyseGame } from "./analysis.ts";
import type { GameSort, GameStore, SortOrder } from "./db.ts";
import type { UciEngine } from "./engine/uci.ts";
import { updateRating } from "./elo.ts";
import { playGame } from "./game-loop.ts";
import type { Player } from "./players.ts";

export interface GameServiceDeps {
  store: GameStore;
  createClaudePlayer: () => Player;
  createStockfishPlayer: () => Promise<Player>;
  /** A full-strength engine used only for analysis. */
  getAnalysisEngine: () => Promise<UciEngine>;
  analysisDepth?: number;
  moveTimeLimitMs?: number;
}

export class GameInProgressError extends Error {}

export class GameService {
  private active: Promise<void> | null = null;

  constructor(private deps: GameServiceDeps) {}

  /** Claude alternates colours from game to game, starting with White. */
  nextClaudeColor(): Color {
    return this.deps.store.lastClaudeColor() === "white" ? "black" : "white";
  }

  currentRating(): number {
    return this.deps.store.latestRating() ?? INITIAL_RATING;
  }

  isPlaying(): boolean {
    return this.active !== null;
  }

  /** Start a game in the background. Only one game runs at a time. */
  async startGame(): Promise<GameRecord> {
    if (this.active) throw new GameInProgressError("A game is already in progress");
    const claude = this.deps.createClaudePlayer();
    const stockfish = await this.deps.createStockfishPlayer();
    const claudeColor = this.nextClaudeColor();
    const [white, black] = claudeColor === "white" ? [claude, stockfish] : [stockfish, claude];
    const game = this.deps.store.create({ claudeColor, white: white.name, black: black.name });

    this.active = this.runGame(game.id, claudeColor, white, black).finally(() => {
      this.active = null;
    });
    return game;
  }

  /** Resolves when the current game (if any) has finished and been analysed. */
  async waitForActiveGame(): Promise<void> {
    await this.active;
  }

  private async runGame(id: number, claudeColor: Color, white: Player, black: Player): Promise<void> {
    const { store } = this.deps;
    const outcome = await playGame({
      white,
      black,
      moveTimeLimitMs: this.deps.moveTimeLimitMs ?? MOVE_TIME_LIMIT_MS,
      headers: { Event: "Regent Chess", Site: "Regent Chess", Date: new Date().toISOString().slice(0, 10).replaceAll("-", ".") },
      onMove: (_san, sanMoves) => store.updateMoves(id, sanMoves, ""),
    });

    let ratingBefore: number | null = null;
    let ratingAfter: number | null = null;
    if (outcome.status === "finished" && outcome.result) {
      ratingBefore = this.currentRating();
      const score = outcome.result === "1/2-1/2" ? 0.5 : (outcome.result === "1-0") === (claudeColor === "white") ? 1 : 0;
      ratingAfter = updateRating(ratingBefore, STOCKFISH_ELO, score, RATING_K_FACTOR);
    }
    store.finish(id, { ...outcome, ratingBefore, ratingAfter });

    if (outcome.status === "finished" && outcome.sanMoves.length > 0) {
      try {
        const analysis = await this.analyse(outcome.sanMoves);
        store.saveAnalysis(id, analysis, analysis[claudeColor].estimatedElo);
      } catch (err) {
        console.error(`Analysis of game ${id} failed:`, err);
      }
    }
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
    return this.deps.store.list(sort, order);
  }

  getGame(id: number): GameRecord | null {
    return this.deps.store.get(id);
  }
}
