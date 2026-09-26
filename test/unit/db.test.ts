import { describe, expect, test } from "bun:test";
import { GameStore } from "../../src/server/db.ts";
import type { AgentName, AgentReport, EngineSetup, GameAnalysis, MoveSearch } from "../../src/shared/types.ts";

const analysis = (elo: number): GameAnalysis => ({
  plies: [],
  depth: 1,
  white: { moves: 1, acpl: 0, accuracy: 100, estimatedElo: elo },
  black: { moves: 1, acpl: 0, accuracy: 100, estimatedElo: elo },
});

function finishedGame(store: GameStore, elo: number | null, rating = 1500) {
  const g = store.create({ aiColor: "white", white: "Lc0", black: "Stockfish" });
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
    expect(game).toMatchObject({ status: "finished", result: "1-0", sanMoves: ["f3", "e5"], pgn: "1. f3 e5", aiEloEstimate: 1800 });
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
    const aborted = store.create({ aiColor: "black", white: "S", black: "C" });
    store.finish(aborted.id, { status: "aborted", result: null, termination: null, sanMoves: [], pgn: "", error: "x", ratingBefore: null, ratingAfter: null });
    expect(store.latestRating()).toBe(1520);
    // The aborted game (Lc0 as Black) doesn't count for colour alternation either.
    expect(store.lastAiColor()).toBe("white");
  });

  test("marks games left in progress as aborted", () => {
    const store = new GameStore();
    const g = store.create({ aiColor: "white", white: "C", black: "S" });
    expect(store.hasRecentGameInProgress()).toBe(true);
    expect(store.abortStale()).toBe(1);
    expect(store.get(g.id)!.status).toBe("aborted");
    expect(store.hasRecentGameInProgress()).toBe(false);
  });

  test("stores our engine's setup with the game, and its search log apart from the game list", () => {
    const store = new GameStore();
    const g = store.create({ aiColor: "white", white: "Lc0", black: "Stockfish" });
    const setup: EngineSetup = { name: "Lc0 v0.32.1", command: ["lc0"], movetimeMs: 4000, options: { UCI_ShowWDL: true }, network: "42850.pb.gz", backend: null };
    const search: MoveSearch = { movetimeMs: 4000, timeMs: 3900, depth: 7, seldepth: 19, nodes: 6021, nps: 1880, eval: 35, wdl: [336, 469, 195], pv: ["f3"], candidates: [] };
    store.finish(g.id, {
      status: "finished", result: "1-0", termination: "checkmate", sanMoves: ["f3", "e5"], pgn: "", error: null,
      ratingBefore: null, ratingAfter: null, searchLog: [search, null], aiSetup: setup,
    });
    expect(store.get(g.id)!.aiSetup).toEqual(setup);
    expect(store.searchLog(g.id)).toEqual([search, null]);
    expect(store.list()[0]).not.toHaveProperty("searchLog");
  });

  test("keeps one report per agent and game: a new one replaces the old, and the grandmaster's comes first", () => {
    const store = new GameStore();
    const id = finishedGame(store, 2000);
    const report = (agent: AgentName, createdAt: string, summary: string): AgentReport => ({ gameId: id, agent, createdAt, summary, keyMoments: [], suggestions: [] });
    store.saveAgentReport(report("engine", "2026-09-26T10:00:00.000Z", "first"));
    store.saveAgentReport(report("grandmaster", "2026-09-26T10:01:00.000Z", "gm"));
    store.saveAgentReport(report("engine", "2026-09-26T10:02:00.000Z", "second"));
    expect(store.get(id)!.agentReports.map((r) => [r.agent, r.summary, r.createdAt])).toEqual([
      ["grandmaster", "gm", "2026-09-26T10:01:00.000Z"],
      ["engine", "second", "2026-09-26T10:02:00.000Z"],
    ]);
    expect(store.list()[0]!.agentReports).toHaveLength(2);
  });
});

test("migrates databases created when our AI was Claude", async () => {
  const { Database } = await import("bun:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "regent-db-"));
  const path = join(dir, "old.sqlite");
  const old = new Database(path);
  old.run(`CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT '2026-01-01', finished_at TEXT,
    status TEXT NOT NULL, claude_color TEXT NOT NULL, white TEXT NOT NULL, black TEXT NOT NULL, result TEXT,
    termination TEXT, san_moves TEXT NOT NULL DEFAULT '[]', pgn TEXT NOT NULL DEFAULT '', claude_elo_estimate INTEGER,
    rating_before INTEGER, rating_after INTEGER, error TEXT, analysis TEXT)`);
  old.run("INSERT INTO games (status, claude_color, white, black, claude_elo_estimate) VALUES ('finished', 'black', 'S', 'Claude', 1650)");
  old.close();

  const store = new GameStore(path);
  expect(store.get(1)).toMatchObject({ aiColor: "black", aiEloEstimate: 1650, black: "Claude", aiSetup: null, agentReports: [] });
  const g = store.create({ aiColor: "white", white: "Lc0", black: "S" });
  store.finish(g.id, { status: "aborted", result: null, termination: null, sanMoves: [], pgn: "", error: "x", ratingBefore: null, ratingAfter: null, searchLog: [] });
  expect(store.searchLog(g.id)).toEqual([]);
  expect(store.list()).toHaveLength(2);
  store.close();
  new GameStore(path).close(); // migrating twice is harmless
  rmSync(dir, { recursive: true, force: true });
});
