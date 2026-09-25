import { describe, expect, test } from "bun:test";
import { GameStore } from "../../src/server/db.ts";
import type { GameAnalysis } from "../../src/shared/types.ts";

const analysis = (elo: number): GameAnalysis => ({
  plies: [],
  depth: 1,
  white: { moves: 1, acpl: 0, accuracy: 100, estimatedElo: elo },
  black: { moves: 1, acpl: 0, accuracy: 100, estimatedElo: elo },
});

function finishedGame(store: GameStore, elo: number | null, rating = 1500) {
  const g = store.create({ claudeColor: "white", white: "Claude", black: "Stockfish" });
  store.finish(g.id, {
    status: "finished",
    result: "1-0",
    termination: "checkmate",
    sanMoves: ["f3", "e5"],
    pgn: "1. f3 e5",
    error: null,
    ratingBefore: 1500,
    ratingAfter: rating,
  });
  if (elo != null) store.saveAnalysis(g.id, analysis(elo), elo);
  return g.id;
}

describe("GameStore", () => {
  test("stores games with moves in algebraic notation", () => {
    const store = new GameStore();
    const id = finishedGame(store, 1800);
    const game = store.get(id)!;
    expect(game).toMatchObject({ status: "finished", result: "1-0", sanMoves: ["f3", "e5"], pgn: "1. f3 e5", claudeEloEstimate: 1800 });
    expect(game.analysis?.white.estimatedElo).toBe(1800);
  });

  test("sorts by estimated Elo, with unanalysed games last", () => {
    const store = new GameStore();
    const low = finishedGame(store, 1200);
    const none = finishedGame(store, null);
    const high = finishedGame(store, 2100);
    expect(store.list("elo", "desc").map((g) => g.id)).toEqual([high, low, none]);
    expect(store.list("elo", "asc").map((g) => g.id)).toEqual([low, high, none]);
  });

  test("sorts by date", () => {
    const store = new GameStore();
    const a = finishedGame(store, 1);
    const b = finishedGame(store, 2);
    expect(store.list("date", "desc").map((g) => g.id)).toEqual([b, a]);
    expect(store.list("date", "asc").map((g) => g.id)).toEqual([a, b]);
  });

  test("latest rating ignores aborted games", () => {
    const store = new GameStore();
    expect(store.latestRating()).toBeNull();
    finishedGame(store, 1500, 1520);
    const aborted = store.create({ claudeColor: "black", white: "S", black: "C" });
    store.finish(aborted.id, { status: "aborted", result: null, termination: null, sanMoves: [], pgn: "", error: "x", ratingBefore: null, ratingAfter: null });
    expect(store.latestRating()).toBe(1520);
    // The aborted game (Claude as Black) doesn't count for colour alternation either.
    expect(store.lastClaudeColor()).toBe("white");
  });

  test("marks games left in progress as aborted", () => {
    const store = new GameStore();
    const g = store.create({ claudeColor: "white", white: "C", black: "S" });
    expect(store.abortStale()).toBe(1);
    expect(store.get(g.id)!.status).toBe("aborted");
  });
});
