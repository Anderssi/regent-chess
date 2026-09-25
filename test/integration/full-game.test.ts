import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStore } from "../../src/server/db.ts";
import { launchEngine } from "../../src/server/engine/process.ts";
import type { UciEngine } from "../../src/server/engine/uci.ts";
import { StockfishPlayer } from "../../src/server/players.ts";
import { GameService } from "../../src/server/service.ts";
import { parsePastedGame } from "../../src/shared/notation.ts";
import { firstMovePlayer } from "../helpers/fakes.ts";

const dir = mkdtempSync(join(tmpdir(), "regent-"));
const engines: UciEngine[] = [];
afterAll(() => {
  engines.forEach((e) => e.quit());
  rmSync(dir, { recursive: true, force: true });
});

test("a full game against real Stockfish is played, stored, rated and analysed", async () => {
  const store = new GameStore(join(dir, "games.sqlite"));
  const play = await launchEngine();
  const analysis = await launchEngine();
  engines.push(play, analysis);

  // A trivial bot stands in for Claude so the test needs no API key.
  const service = new GameService({
    store,
    createClaudePlayer: () => firstMovePlayer("Stand-in"),
    createStockfishPlayer: () => StockfishPlayer.create(play, 30),
    getAnalysisEngine: async () => analysis,
    analysisDepth: 4,
  });

  const started = await service.startGame();
  expect(started.claudeColor).toBe("white");
  await service.waitForActiveGame();

  const game = service.getGame(started.id)!;
  expect(game.status).toBe("finished");
  expect(game.result).not.toBeNull();
  expect(game.white).toBe("Stand-in");
  expect(game.black).toBe("Stockfish (1600)");
  // The stored algebraic notation replays to the same game.
  expect(parsePastedGame(game.pgn).sanMoves).toEqual(game.sanMoves);
  expect(game.ratingBefore).toBe(1500);
  expect(game.ratingAfter).not.toBeNull();
  expect(game.analysis?.plies).toHaveLength(game.sanMoves.length);
  expect(game.claudeEloEstimate).toBe(game.analysis!.white.estimatedElo);

  // Next game Claude plays Black.
  expect(service.nextClaudeColor()).toBe("black");
  store.close();
}, 180_000);
