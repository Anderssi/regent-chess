import homepage from "../client/index.html";
import { GameStore } from "./db.ts";
import { EngineHandle, launchEngine, resolveEngineCommand, resolveLc0Command } from "./engine/process.ts";
import { Lc0Player, StockfishPlayer } from "./players.ts";
import { GameService } from "./service.ts";
import { apiRoutes } from "./api.ts";
import { MOVE_TIME_LIMIT_MS } from "../shared/rules.ts";

const store = new GameStore(process.env.DB_PATH ?? "data/regent.sqlite");
const stale = store.abortStale();
if (stale) console.log(`Marked ${stale} unfinished game(s) as aborted`);

const lc0Engine = new EngineHandle(() => launchEngine(resolveLc0Command(), "Lc0"));
const playEngine = new EngineHandle();
const analysisEngine = new EngineHandle();
const movetime = (name: string) => Number(process.env[name] ?? MOVE_TIME_LIMIT_MS - 1000);

const service = new GameService({
  store,
  createAiPlayer: async () => Lc0Player.create(await lc0Engine.get(), movetime("LC0_MOVETIME_MS")),
  createStockfishPlayer: async () => StockfishPlayer.create(await playEngine.get(), movetime("STOCKFISH_MOVETIME_MS")),
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

// Check the engines up front so problems show here rather than as a failed game start.
for (const [name, resolve, handle] of [
  ["Stockfish", resolveEngineCommand, playEngine],
  ["Lc0", resolveLc0Command, lc0Engine],
] as const) {
  try {
    console.log(`${name} command: ${resolve().join(" ")}`);
    await handle.get();
    console.log(`${name} is ready`);
  } catch (err) {
    console.error(`${name} failed to start: ${err instanceof Error ? err.message : err}`);
  }
}
