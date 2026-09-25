import homepage from "../client/index.html";
import { ClaudePlayer } from "./claude-player.ts";
import { GameStore } from "./db.ts";
import { EngineHandle, resolveEngineCommand } from "./engine/process.ts";
import { StockfishPlayer } from "./players.ts";
import { GameService } from "./service.ts";
import { apiRoutes } from "./api.ts";
import { MOVE_TIME_LIMIT_MS } from "../shared/rules.ts";

const store = new GameStore(process.env.DB_PATH ?? "data/regent.sqlite");
const stale = store.abortStale();
if (stale) console.log(`Marked ${stale} unfinished game(s) as aborted`);

const playEngine = new EngineHandle();
const analysisEngine = new EngineHandle();

const service = new GameService({
  store,
  createClaudePlayer: () => new ClaudePlayer(),
  createStockfishPlayer: async () => {
    const movetime = Number(process.env.STOCKFISH_MOVETIME_MS ?? MOVE_TIME_LIMIT_MS - 1000);
    return StockfishPlayer.create(await playEngine.get(), movetime);
  },
  getAnalysisEngine: () => analysisEngine.get(),
  analysisDepth: Number(process.env.ANALYSIS_DEPTH ?? 12),
});

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": homepage,
    ...apiRoutes(service),
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`Regent Chess running at ${server.url}`);

// Check the engine up front so problems show here rather than as a failed game start.
try {
  console.log(`Stockfish command: ${resolveEngineCommand().join(" ")}`);
  await playEngine.get();
  console.log("Stockfish is ready");
} catch (err) {
  console.error(`Stockfish failed to start: ${err instanceof Error ? err.message : err}`);
}
