import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyseGame } from "../../src/server/analysis.ts";
import { GameStore } from "../../src/server/db.ts";
import { fakeEngine } from "../helpers/fakes.ts";

// The command-line tools the analysis agents use, run as the agents run them, against a scratch database.
const dir = mkdtempSync(join(tmpdir(), "regent-agents-"));
const DB_PATH = join(dir, "games.sqlite");

function cli(args: string[], stdin = "", env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bun", join(import.meta.dir, "../../scripts/agents.ts"), ...args], {
    env: { ...process.env, DB_PATH, ...env },
    stdin: Buffer.from(stdin),
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

const report = (betterMove: string) =>
  JSON.stringify({
    summary: "Lc0 mated quickly.",
    keyMoments: [{ ply: 4, title: "Mate", comment: "Qh4 mates.", betterMove }],
    suggestions: [{ title: "Keep punishing weak openings", priority: "high", area: "tactics", detail: "It found mate.", plies: [4], change: "Nothing.", verify: "Watch the next games." }],
  });

beforeAll(async () => {
  const store = new GameStore(DB_PATH);
  const { engine } = fakeEngine();
  await engine.init();
  // Lc0 plays Black and delivers Fool's mate.
  const moves = ["f3", "e5", "g4", "Qh4#"];
  const game = store.create({ aiColor: "black", white: "Stockfish (1600)", black: "Lc0" });
  store.finish(game.id, { status: "finished", result: "0-1", termination: "checkmate", sanMoves: moves, pgn: "", error: null, ratingBefore: 1500, ratingAfter: 1516 });
  const analysis = await analyseGame(engine, moves, { depth: 1 });
  store.saveAnalysis(game.id, analysis, analysis.black.estimatedElo);
  store.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/agents.ts", () => {
  test("lists the games still waiting for reports, and prints one for analysis", () => {
    expect(cli(["pending"]).out).toBe("#1 needs grandmaster and engine\n");
    const game = cli(["game", "1"]);
    expect(game.code).toBe(0);
    expect(game.out).toStartWith("# SchackMars game #1\n");
    expect(game.out).toContain("Result: 0-1 by checkmate after 4 plies (Lc0 won).");
    expect(game.out).toContain("2... Qh4# (Lc0): eval");
  });

  test("saves only reports that pass the check, and says exactly what to fix", () => {
    const notJson = cli(["save", "1", "grandmaster"], "{ nope");
    expect(notJson.code).toBe(2);
    expect(notJson.err).toContain("The report was not saved: it is not valid JSON");

    const illegal = cli(["save", "1", "grandmaster"], report("Qh5"));
    expect(illegal.code).toBe(2);
    expect(illegal.err).toContain('keyMoments[0].betterMove "Qh5" is not a legal move in the position before ply 4');

    const saved = cli(["save", "1", "grandmaster"], report("Qh4#"));
    expect(saved.code).toBe(0);
    expect(saved.out).toBe("Saved the grandmaster report on game #1: 1 key moments, 1 suggestions.\n");
    expect(cli(["status", "1"]).out).toMatch(/^#1 0-1, Lc0 as black: grandmaster \d{4}-\d\d-\d\d \d\d:\d\d, engine missing\n$/);
    expect(cli(["pending"]).out).toBe("#1 needs engine\n");
    expect(cli(["save", "1", "wizard"], report("Qh4#")).err).toContain("The agent must be one of: grandmaster, engine");
  });

  test("saves from a file, and clears the agents' working copy in data/agent-reports once saved", () => {
    const outside = join(dir, "report.json");
    writeFileSync(outside, report("Qh4#"));
    const kept = cli(["save", "1", "engine", outside]);
    expect(kept.code).toBe(0);
    expect(existsSync(outside)).toBe(true);

    const inside = join(import.meta.dir, `../../data/agent-reports/test-${process.pid}.json`);
    mkdirSync(dirname(inside), { recursive: true });
    writeFileSync(inside, report("Qh4#"));
    expect(cli(["save", "1", "engine", inside]).code).toBe(0);
    expect(existsSync(inside)).toBe(false);
    expect(cli(["save", "1", "engine", join(dir, "missing.json")]).err).toContain("There is no file");
  });

  test("prints saved reports in full, or every suggestion ranked", () => {
    const full = cli(["reports", "1"]).out;
    expect(full).toContain("## Game #1: grandmaster report");
    expect(full).toContain("- ply 4 (2... Qh4#), Mate: Qh4 mates. Better: Qh4#.");
    expect(full).toContain("  Change: Nothing.");
    expect(cli(["reports", "--suggestions"]).out).toBe(
      "[high] game #1, grandmaster, tactics: Keep punishing weak openings\n    change: Nothing.\n" +
        "[high] game #1, engine, tactics: Keep punishing weak openings\n    change: Nothing.\n",
    );
  });

  test("won't run Lc0 while a game is being played", () => {
    const store = new GameStore(DB_PATH);
    const live = store.create({ aiColor: "white", white: "Lc0", black: "Stockfish (1600)" });
    store.close();
    // A made-up Lc0 path: the probe must refuse before it tries to start anything.
    const probe = cli(["lc0", "--game", "1", "--ply", "3"], "", { LC0_PATH: "/nonexistent/lc0" });
    expect(probe.code).toBe(2);
    expect(probe.err).toContain("Lc0 is busy");
    const cleanup = new GameStore(DB_PATH);
    cleanup.abortStale();
    cleanup.close();
    expect(live.status).toBe("in_progress");
  });

  test("asks Stockfish about a position, and knows when the game is over", () => {
    const mateInOne = cli(["stockfish", "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1", "--depth", "8", "--lines", "2"]);
    expect(mateInOne.code).toBe(0);
    expect(mateInOne.out).toMatch(/^1\. #1 +1\. Qxf7#$/m);
    expect(cli(["stockfish", "--game", "1", "--ply", "5"]).out).toContain("final position of game #1, White to move. FEN");
    expect(cli(["stockfish", "--game", "1", "--ply", "5"]).out).toContain("The game is over in this position.");
    expect(cli(["stockfish", "--game", "1", "--ply", "2", "--moves", "Ke7"]).err).toContain('"Ke7" is not legal after no moves from game #1 before ply 2 (1... e5)');
  }, 30_000);
});
