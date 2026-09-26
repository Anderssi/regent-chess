import { describe, expect, test } from "bun:test";
import { AgentRunner } from "../../src/server/agents/runner.ts";
import { GameStore } from "../../src/server/db.ts";
import { AgentRequestError, GameInProgressError, GameService, InvalidGameSettingsError } from "../../src/server/service.ts";
import type { Player } from "../../src/server/players.ts";
import type { EngineSetup } from "../../src/shared/types.ts";
import { fakeEngine, scriptedPlayer } from "../helpers/fakes.ts";

/** Fool's mate: whoever plays White loses in 4 plies. */
const foolsMateWhite = () => ["f3", "g4"];
const foolsMateBlack = () => ["e5", "Qh4#"];

function makeService(opts: { ai?: () => Player; stockfish?: () => Player; agents?: AgentRunner } = {}) {
  const stockfishElos: number[] = [];
  const store = new GameStore();
  const { engine } = fakeEngine();
  const ready = engine.init();
  let aiColor: "white" | "black" = "white";
  const service = new GameService({
    store,
    // By default Lc0 always gets mated: it plays the losing side of Fool's mate.
    createAiPlayer: async () => (opts.ai ?? (() => scriptedPlayer("Lc0", aiColor === "white" ? foolsMateWhite() : ["e5", "Qh4#"])))(),
    createStockfishPlayer: async (elo) => (stockfishElos.push(elo), opts.stockfish ?? (() => scriptedPlayer("Stockfish", aiColor === "white" ? foolsMateBlack() : ["f3", "g4"])))(),
    getAnalysisEngine: async () => {
      await ready;
      return engine;
    },
    analysisDepth: 1,
    agents: opts.agents,
  });
  const setAiColor = () => (aiColor = service.nextAiColor());
  return { service, store, setAiColor, stockfishElos };
}

describe("GameService", () => {
  test("Lc0 alternates between White and Black", async () => {
    const { service, setAiColor } = makeService();
    const colors: string[] = [];
    for (let i = 0; i < 3; i++) {
      setAiColor();
      const g = await service.startGame();
      colors.push(g.aiColor);
      await service.waitForActiveGame();
    }
    expect(colors).toEqual(["white", "black", "white"]);
  });

  test("records the result, updates the running rating and stores an Elo estimate", async () => {
    const { service, setAiColor } = makeService();
    setAiColor();
    const started = await service.startGame();
    expect(started.white).toBe("Lc0");
    await service.waitForActiveGame();
    const game = service.getGame(started.id)!;
    expect(game).toMatchObject({ status: "finished", result: "0-1", termination: "checkmate", ratingBefore: 1500, ratingAfter: 1488 });
    expect(game.sanMoves).toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(game.pgn).toContain("2. g4 Qh4# 0-1");
    expect(game.analysis?.plies).toHaveLength(4);
    expect(game.aiEloEstimate).toBe(game.analysis!.white.estimatedElo);
    expect(service.currentRating()).toBe(1488);
  });

  test("a Lc0 win as Black raises the rating", async () => {
    const { service, setAiColor } = makeService();
    setAiColor();
    await service.startGame();
    await service.waitForActiveGame();
    setAiColor(); // Lc0 is Black now, and delivers Fool's mate
    const g = await service.startGame();
    await service.waitForActiveGame();
    expect(service.getGame(g.id)).toMatchObject({ aiColor: "black", result: "0-1", ratingBefore: 1488, ratingAfter: 1509 });
  });

  test("Stockfish can be turned up: the chosen Elo is played, stored and used for the rating", async () => {
    const { service, setAiColor, stockfishElos } = makeService();
    setAiColor();
    const g = await service.startGame({ stockfishElo: 2400 });
    await service.waitForActiveGame();
    expect(stockfishElos).toEqual([2400]);
    // Losing to a 2400 costs a 1500 far less than losing to the default 1600 (-12, see above).
    expect(service.getGame(g.id)).toMatchObject({ stockfishElo: 2400, result: "0-1", ratingBefore: 1500, ratingAfter: 1500 });
  });

  test("Stockfish plays at 1600 unless asked otherwise, and out-of-range strengths are refused", async () => {
    const { service, store, setAiColor, stockfishElos } = makeService();
    for (const stockfishElo of [1000, 3500, 1600.5]) {
      await expect(service.startGame({ stockfishElo })).rejects.toBeInstanceOf(InvalidGameSettingsError);
    }
    expect(store.list()).toHaveLength(0);
    setAiColor();
    expect((await service.startGame()).stockfishElo).toBe(1600);
    await service.waitForActiveGame();
    expect(stockfishElos).toEqual([1600]);
  });

  test("only one game at a time", async () => {
    const hang: Player = { name: "Slow", getMove: () => new Promise(() => {}) };
    const { service } = makeService({ ai: () => hang, stockfish: () => hang });
    await service.startGame();
    expect(service.isPlaying()).toBe(true);
    await expect(service.startGame()).rejects.toBeInstanceOf(GameInProgressError);
  });

  test("aborted games are not rated", async () => {
    const { PlayerFailure } = await import("../../src/server/players.ts");
    const broken: Player = { name: "Lc0", getMove: () => Promise.reject(new PlayerFailure("engine crashed")) };
    const { service } = makeService({ ai: () => broken });
    const g = await service.startGame();
    await service.waitForActiveGame();
    expect(service.getGame(g.id)).toMatchObject({ status: "aborted", ratingAfter: null, analysis: null });
    expect(service.currentRating()).toBe(1500);
    expect(service.nextAiColor()).toBe("white");
  });

  test("analyses a pasted game", async () => {
    const { service } = makeService();
    const res = await service.analysePasted("1. e4 e5 2. Nf3");
    expect(res.sanMoves).toEqual(["e4", "e5", "Nf3"]);
    expect(res.analysis.plies).toHaveLength(3);
  });
});

describe("agent analysis", () => {
  const SETUP: EngineSetup = { name: "Lc0 v0.32.1", command: ["lc0"], movetimeMs: 4000, options: {}, network: "42850.pb.gz", backend: null };

  /** Agents whose runs wait for `release()`, recording which games they were started on. */
  function gatedAgents() {
    const launched: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agents = new AgentRunner({
      launch: async (id) => (launched.push(id), await gate, { ok: true }),
      reportsSince: () => ["grandmaster", "engine"],
      log: () => {},
    });
    return { agents, launched, release };
  }

  test("each game goes to the agents once Stockfish has analysed it, and Lc0's setup is saved with it", async () => {
    const { agents, launched, release } = gatedAgents();
    const { service, setAiColor } = makeService({ agents, ai: () => Object.assign(scriptedPlayer("Lc0", ["f3", "g4"]), { setup: SETUP }) });
    setAiColor();
    const g = await service.startGame();
    await service.waitForActiveGame();
    expect(launched).toEqual([g.id]);
    expect(service.getGame(g.id)).toMatchObject({ aiSetup: SETUP, agentRun: { status: "running" } });
    release();
    await agents.idle();
    expect(service.getGame(g.id)!.agentRun).toBeNull();
  });

  test("a finished, analysed game can be sent to the agents again; other requests are refused with a reason", async () => {
    const { agents, launched, release } = gatedAgents();
    const { PlayerFailure } = await import("../../src/server/players.ts");
    let crash = false;
    const { service, setAiColor } = makeService({
      agents,
      ai: () => (crash ? { name: "Lc0", getMove: () => Promise.reject(new PlayerFailure("engine crashed")) } : scriptedPlayer("Lc0", ["f3", "g4"])),
    });
    setAiColor();
    const finished = await service.startGame();
    await service.waitForActiveGame();
    release();
    await agents.idle();
    crash = true;
    setAiColor(); // Lc0 is Black now, and crashes after White's first move
    const aborted = await service.startGame();
    await service.waitForActiveGame();

    expect(service.requestAgentAnalysis(finished.id).status).toBe("queued");
    await agents.idle();
    expect(launched).toEqual([finished.id, finished.id]);
    const reason = (id: number) => {
      try {
        service.requestAgentAnalysis(id);
      } catch (err) {
        return err instanceof AgentRequestError ? err.reason : "unexpected";
      }
    };
    expect(reason(999)).toBe("not_found");
    expect(reason(aborted.id)).toBe("not_ready");
    expect(service.agentStatus()).toEqual({ enabled: true });
  });

  test("without a runner, agent analysis is off and says why", () => {
    const store = new GameStore();
    const service = new GameService({
      store,
      createAiPlayer: async () => scriptedPlayer("Lc0", []),
      createStockfishPlayer: async () => scriptedPlayer("Stockfish", []),
      getAnalysisEngine: async () => fakeEngine().engine,
      agentsOff: "Claude Code (claude) wasn't found",
    });
    expect(service.agentStatus()).toEqual({ enabled: false, reason: "Claude Code (claude) wasn't found" });
    expect(() => service.requestAgentAnalysis(1)).toThrow("Agent analysis is off: Claude Code (claude) wasn't found");
  });
});
