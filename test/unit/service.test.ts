import { describe, expect, test } from "bun:test";
import { GameStore } from "../../src/server/db.ts";
import { GameInProgressError, GameService } from "../../src/server/service.ts";
import type { Player } from "../../src/server/players.ts";
import { fakeEngine, scriptedPlayer } from "../helpers/fakes.ts";

/** Fool's mate: whoever plays White loses in 4 plies. */
const foolsMateWhite = () => ["f3", "g4"];
const foolsMateBlack = () => ["e5", "Qh4#"];

function makeService(opts: { ai?: () => Player; stockfish?: () => Player } = {}) {
  const store = new GameStore();
  const { engine } = fakeEngine();
  const ready = engine.init();
  let aiColor: "white" | "black" = "white";
  const service = new GameService({
    store,
    // By default Lc0 always gets mated: it plays the losing side of Fool's mate.
    createAiPlayer: async () => (opts.ai ?? (() => scriptedPlayer("Lc0", aiColor === "white" ? foolsMateWhite() : ["e5", "Qh4#"])))(),
    createStockfishPlayer: async () => (opts.stockfish ?? (() => scriptedPlayer("Stockfish", aiColor === "white" ? foolsMateBlack() : ["f3", "g4"])))(),
    getAnalysisEngine: async () => {
      await ready;
      return engine;
    },
    analysisDepth: 1,
  });
  const setAiColor = () => (aiColor = service.nextAiColor());
  return { service, store, setAiColor };
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
