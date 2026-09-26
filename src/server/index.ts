import { join } from "node:path";
import homepage from "../client/index.html";
import { claudeCodeLauncher, resolveClaudeCommand } from "./agents/claude.ts";
import { AgentRunner } from "./agents/runner.ts";
import { GameStore } from "./db.ts";
import { EngineHandle, launchEngine, resolveEngineCommand, resolveLc0Command } from "./engine/process.ts";
import { Lc0Player, StockfishPlayer } from "./players.ts";
import { GameService } from "./service.ts";
import { apiRoutes } from "./api.ts";
import { MOVE_TIME_LIMIT_MS } from "../shared/rules.ts";

// `bun --hot` re-runs this module on every save without restarting the process. The previous run may
// still be playing a game, so it isn't treated as a restart, and its engines are quit once it's done.
const hot = globalThis as typeof globalThis & { regentPrevious?: { service: GameService; engines: EngineHandle[] } };
const previous = hot.regentPrevious;

const store = new GameStore(process.env.DB_PATH ?? "data/regent.sqlite");
if (!previous) {
  const stale = store.abortStale();
  if (stale) console.log(`Marked ${stale} unfinished game(s) as aborted`);
}

const lc0Engine = new EngineHandle(() => launchEngine(resolveLc0Command(), "Lc0"));
const playEngine = new EngineHandle();
const analysisEngine = new EngineHandle();
const movetime = (name: string) => Number(process.env[name] ?? MOVE_TIME_LIMIT_MS - 1000);

// After Stockfish has analysed a game, headless Claude Code runs /analyze-games on it with the two agents in .claude/agents.
const claude = resolveClaudeCommand();
const agentsOff =
  process.env.AGENT_ANALYSIS === "off" ? "turned off with AGENT_ANALYSIS=off" : claude ? undefined : "Claude Code (claude) wasn't found: install it or set CLAUDE_PATH";
const agents =
  claude && !agentsOff
    ? new AgentRunner({
        launch: claudeCodeLauncher({ command: claude, cwd: join(import.meta.dir, "../.."), timeoutMs: Number(process.env.AGENT_TIMEOUT_MS || 45 * 60_000) }),
        reportsSince: (id, since) => (store.get(id)?.agentReports ?? []).filter((r) => r.createdAt >= since).map((r) => r.agent),
      })
    : undefined;

const service = new GameService({
  store,
  createAiPlayer: async () => Lc0Player.create(await lc0Engine.get(), movetime("LC0_MOVETIME_MS"), resolveLc0Command()),
  createStockfishPlayer: async () => StockfishPlayer.create(await playEngine.get(), movetime("STOCKFISH_MOVETIME_MS")),
  getAnalysisEngine: () => analysisEngine.get(),
  analysisDepth: Number(process.env.ANALYSIS_DEPTH ?? 12),
  agents,
  agentsOff,
});

hot.regentPrevious = { service, engines: [lc0Engine, playEngine, analysisEngine] };
if (previous) void previous.service.waitForActiveGame().then(() => previous.engines.forEach((engine) => void engine.dispose()));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": homepage,
    ...apiRoutes(service),
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`SchackMars running at ${server.url}`);
console.log(agents ? `Agent analysis: ${claude!.join(" ")} runs /analyze-games after each game` : `Agent analysis is off: ${agentsOff}`);

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
