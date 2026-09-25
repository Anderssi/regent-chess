import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { analyseGame } from "../../src/server/analysis.ts";
import { launchEngine } from "../../src/server/engine/process.ts";
import type { UciEngine } from "../../src/server/engine/uci.ts";
import { StockfishPlayer } from "../../src/server/players.ts";
import { MOVE_TIME_LIMIT_MS } from "../../src/shared/rules.ts";

let engine: UciEngine;
beforeAll(async () => {
  engine = await launchEngine();
}, 60_000);
afterAll(() => engine?.quit());

describe("real Stockfish", () => {
  test("plays a legal move at 1600 Elo within the 5-second limit", async () => {
    const player = await StockfishPlayer.create(engine, 300);
    const chess = new Chess();
    chess.move("e4");
    const started = Date.now();
    const move = await player.getMove({
      fen: chess.fen(),
      color: "black",
      sanHistory: chess.history(),
      legalMoves: chess.moves(),
      rejectedAttempts: [],
      timeLeftMs: MOVE_TIME_LIMIT_MS,
      signal: new AbortController().signal,
    });
    expect(Date.now() - started).toBeLessThan(MOVE_TIME_LIMIT_MS);
    expect(chess.move(move)).toBeTruthy();
  }, 20_000);

  test("analysis spots the losing move in Fool's mate", async () => {
    await engine.configure({ UCI_LimitStrength: false });
    const res = await analyseGame(engine, ["f3", "e5", "g4", "Qh4#"], { depth: 8 });
    const g4 = res.plies[2]!;
    expect(g4.san).toBe("g4");
    expect(g4.cpLoss).toBeGreaterThan(500);
    expect(res.plies[3]!.evalAfter).toBe(-1000);
    expect(res.black.accuracy).toBeGreaterThan(res.white.accuracy);
    expect(res.black.estimatedElo).toBeGreaterThan(res.white.estimatedElo);
  }, 30_000);

  test("finds mate in one as best move", async () => {
    const { bestMove, score } = await engine.search("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1", { depth: 6 });
    expect(bestMove).toBe("f3f7");
    expect(score?.mate).toBe(1);
  }, 30_000);
});
