import { afterAll, describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { GameStore } from "../../src/server/db.ts";
import { launchEngine, resolveLc0Command } from "../../src/server/engine/process.ts";
import type { UciEngine } from "../../src/server/engine/uci.ts";
import { Lc0Player, StockfishPlayer } from "../../src/server/players.ts";
import { GameService } from "../../src/server/service.ts";
import { parsePastedGame } from "../../src/shared/notation.ts";
import { MOVE_TIME_LIMIT_MS } from "../../src/shared/rules.ts";

const lc0Available = (() => {
  try {
    resolveLc0Command();
    return true;
  } catch {
    return false;
  }
})();

const engines: UciEngine[] = [];
afterAll(() => engines.forEach((e) => e.quit()));
const launch = async (cmd?: string[], name?: string) => {
  const e = await launchEngine(cmd, name);
  engines.push(e);
  return e;
};

describe.skipIf(!lc0Available)("real Lc0", () => {
  test("plays a legal move within the 5-second limit, even on its first move", async () => {
    const player = await Lc0Player.create(await launch(resolveLc0Command(), "Lc0"), 1000);
    const chess = new Chess();
    const started = Date.now();
    const { move } = await player.getMove({
      fen: chess.fen(),
      color: "white",
      sanHistory: [],
      legalMoves: chess.moves(),
      rejectedAttempts: [],
      timeLeftMs: MOVE_TIME_LIMIT_MS,
      signal: new AbortController().signal,
    });
    expect(Date.now() - started).toBeLessThan(MOVE_TIME_LIMIT_MS);
    expect(chess.move(move)).toBeTruthy();
  }, 60_000);

  test("a full game Lc0 vs Stockfish 1600 is played, stored, rated and analysed", async () => {
    const lc0 = await launch(resolveLc0Command(), "Lc0");
    const stockfish = await launch();
    const analysis = await launch();
    const service = new GameService({
      store: new GameStore(),
      createAiPlayer: () => Lc0Player.create(lc0, 50),
      createStockfishPlayer: () => StockfishPlayer.create(stockfish, 50),
      getAnalysisEngine: async () => analysis,
      analysisDepth: 4,
    });

    for (const expectedColor of ["white", "black"] as const) {
      const started = await service.startGame();
      expect(started.aiColor).toBe(expectedColor);
      await service.waitForActiveGame();
      const game = service.getGame(started.id)!;
      expect(game.status).toBe("finished");
      expect(game[expectedColor]).toBe("Pluto");
      expect(parsePastedGame(game.pgn).sanMoves).toEqual(game.sanMoves);
      expect(game.ratingAfter).not.toBeNull();
      expect(game.aiEloEstimate).toBe(game.analysis![expectedColor].estimatedElo);
    }
  }, 300_000);
});
