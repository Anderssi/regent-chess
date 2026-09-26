import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chess.js";
import { formatGameForAgents } from "../../src/server/agents/bundle.ts";
import { claudeCodeArgs, claudeCodeLauncher, parseClaudeOutput } from "../../src/server/agents/claude.ts";
import { parseAgentReport } from "../../src/server/agents/report.ts";
import { AgentRunner, type AgentLaunchResult } from "../../src/server/agents/runner.ts";
import { analyseGame } from "../../src/server/analysis.ts";
import type { AgentName, GameRecord, MoveSearch } from "../../src/shared/types.ts";
import { fakeEngine } from "../helpers/fakes.ts";

/** An Italian game where, before ply 23 (12. Be3), White could also play 12. Nd5 Nxd5 13. exd5. */
const MOVES = "e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3 Nf6 d3 O-O O-O d6 h3 h6 a3 a6 Kh1 Kh8 Rb1 Rb8 Ra1 Ra8 Be3 Bxe3 fxe3 Be6 Bxe6 fxe6 Qe2 Qe7".split(" ");
const GAME = { id: 7, sanMoves: MOVES };
/** FEN after each ply: FENS[22] is the position before ply 23. */
const FENS = (() => {
  const chess = new Chess();
  return [chess.fen(), ...MOVES.map((m) => (chess.move(m), chess.fen()))];
})();

const validReport = () => ({
  summary: "Lc0 drifted in a quiet Italian.",
  keyMoments: [{ ply: 23, title: "Missed Nd5", comment: "Nd5 wins space.", betterMove: "c3d5", line: ["Nd5", "Nxd5", "exd5"] }],
  suggestions: [{ title: "Play for space", priority: "medium" as const, area: "middlegame planning", detail: "It shuffled.", plies: [17, 23], change: "More search.", verify: "Re-test ply 23." }],
});

describe("agent reports", () => {
  test("a valid report is saved in canonical form", () => {
    const report = parseAgentReport({ ...validReport(), extra: "dropped" }, GAME, "grandmaster", "2026-09-26T10:00:00.000Z");
    expect(report).toEqual({
      gameId: 7,
      agent: "grandmaster",
      createdAt: "2026-09-26T10:00:00.000Z",
      ...validReport(),
      keyMoments: [{ ply: 23, title: "Missed Nd5", comment: "Nd5 wins space.", betterMove: "Nd5", line: ["Nd5", "Nxd5", "exd5"] }],
    });
  });

  test("every problem is listed at once, with the position for illegal moves", () => {
    const bad = {
      summary: " ",
      keyMoments: [
        { ply: 31, title: "Too late", comment: "x" },
        { ply: 23, title: "Illegal", comment: "x", betterMove: "Qh5", line: ["Nd5", "Nxd5", "Qxd5"] },
        { ply: 23, title: "Mismatch", comment: "x", betterMove: "Nd5", line: ["a4"] },
      ],
      suggestions: [{ title: "t", priority: "urgent", area: "a", detail: "d", plies: [0], change: "c", verify: "v" }],
    };
    let message = "";
    try {
      parseAgentReport(bad, GAME, "engine");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toStartWith("The report was not saved.");
    expect(message).toContain("- summary must be a non-empty string");
    expect(message).toContain("- keyMoments[0].ply must be a ply number from 1 to 30 (got 31)");
    expect(message).toContain(`keyMoments[1].betterMove "Qh5" is not a legal move in the position before ply 23 (12. Be3 was played there), FEN ${FENS[22]}`);
    expect(message).toContain('keyMoments[1].line[2] "Qxd5" is not legal after "Nd5 Nxd5"');
    expect(message).toContain("keyMoments[2].line must start with its betterMove (Nd5), not a4");
    expect(message).toContain('suggestions[0].priority must be "high", "medium" or "low"');
    expect(message).toContain("suggestions[0].plies[0] must be a ply number from 1 to 30 (got 0)");
  });

  test("a report needs at least one suggestion", () => {
    expect(() => parseAgentReport({ ...validReport(), suggestions: [] }, GAME, "engine")).toThrow("suggestions must be an array with at least 1 entry");
  });

  test.each(["chess-grandmaster", "engine-developer"])("the format documented to the %s agent passes the check", (agent) => {
    const doc = readFileSync(join(import.meta.dir, `../../.claude/agents/${agent}.md`), "utf8");
    const example = /```json\n([\s\S]+?)\n```/.exec(doc)![1]!;
    expect(() => parseAgentReport(JSON.parse(example), GAME, "grandmaster")).not.toThrow();
  });
});

describe("the game as the agents see it", () => {
  const record = async (overrides: Partial<GameRecord> = {}): Promise<GameRecord> => {
    // Stockfish (faked) has White at +0.20 throughout, except that 12. Be3 drops to -1.30 where Nd5 was best.
    const { engine } = fakeEngine({
      evaluate: (fen) => ({ cp: fen === FENS[23] ? 130 : fen.split(" ")[1] === "w" ? 20 : -20 }),
      bestMove: (fen) => (fen === FENS[22] ? "c3d5" : null),
    });
    await engine.init();
    return {
      id: 7, createdAt: "2026-09-26T07:23:35.445Z", finishedAt: null, status: "finished", aiColor: "white", white: "Lc0", black: "Stockfish (1600)",
      result: "1/2-1/2", termination: "threefold_repetition", sanMoves: MOVES, pgn: "", aiEloEstimate: 2400, ratingBefore: 1610, ratingAfter: 1602,
      error: null, analysis: await analyseGame(engine, MOVES, { depth: 1 }), aiSetup: null, agentReports: [], ...overrides,
    };
  };

  test("an older game says its search data wasn't recorded", async () => {
    const text = formatGameForAgents(await record(), null);
    expect(text).toStartWith("# SchackMars game #7\n");
    expect(text).toContain("Result: 1/2-1/2 by threefold repetition after 30 plies (drawn).");
    expect(text).toContain("Moves: 1. e4 e5 2. Nf3 Nc6");
    expect(text).toContain("Not recorded: this game was played before the app recorded Lc0's setup and search data");
    expect(text).toContain("\n12. Be3? (Lc0): eval ");
    expect(text).toContain("best Nd5, loss 150");
    expect(text).toContain(`   before: ${FENS[22]}`);
    expect(text).toContain("- Lc0's costliest moves: ply 23 12. Be3 (lost 150 cp; best Nd5)");
    expect(text).not.toContain("Lc0 candidates");
  });

  test("a newer game shows Lc0's setup and its own view of each of its moves", async () => {
    const search = (ply: number): MoveSearch => ({
      movetimeMs: 4000, timeMs: ply === 23 ? 1200 : 3900, depth: 7, seldepth: 19, nodes: 6021, nps: 1880, eval: ply === 23 ? 60 : 20, wdl: [336, 469, 195],
      pv: [MOVES[ply - 1]!],
      candidates: ply === 23 ? [
        { san: "Be3", visits: 4000, policy: 31.2, q: 0.07 }, { san: "a4", visits: 900, policy: 20, q: 0.05 },
        { san: "Rb1", visits: 300, policy: 9, q: 0.01 }, { san: "Nd5", visits: 3, policy: 0.4, q: -0.2 },
      ] : [],
    });
    const log = MOVES.map((_, i) => (i % 2 === 0 ? search(i + 1) : null));
    const setup = { name: "Lc0 v0.32.1", command: ["lc0", "--minibatch-size=32"], movetimeMs: 4000, options: { UCI_ShowWDL: true }, network: "/nets/42850.pb.gz", backend: "metal backend on device Apple M4" };
    const text = formatGameForAgents(await record({ aiSetup: setup, white: "Pluto" }), log);
    expect(text).toContain("White: Pluto. Black: Stockfish (1600). Lc0 (named Pluto in the app) played White.");
    expect(text).toContain("Lc0 v0.32.1. Network: /nets/42850.pb.gz. Backend: metal backend on device Apple M4.");
    expect(text).toContain("Search time 4000 ms per move (the move limit is 5000 ms). Command: lc0 --minibatch-size=32.");
    expect(text).toContain("   Lc0: eval +0.60, W/D/L 34/47/20%, 6,021 nodes at 1,880/s, depth 7/19, 1.20 of 4.00 s");
    expect(text).toContain("   Lc0 candidates: Be3 N=4000 P=31.2% Q=+0.07 · a4 N=900 P=20.0% Q=+0.05 · Rb1 N=300 P=9.0% Q=+0.01 · Nd5* N=3 P=0.4% Q=-0.20");
    expect(text).toContain("- Lc0's search on its 15 moves: 3.72 s used on average (1.20–3.90 s) of 4.00 s given; stopped before 90% of its time on 1 moves.");
    expect(text).toContain("* marks the move Stockfish preferred.");
  });
});

describe("AgentRunner", () => {
  const setup = (launch: (gameId: number) => Promise<AgentLaunchResult>, saved: (gameId: number) => AgentName[] = () => ["grandmaster", "engine"]) => {
    const log: string[] = [];
    const runner = new AgentRunner({ launch, reportsSince: saved, log: (m) => void log.push(m) });
    return { runner, log };
  };

  test("runs one game at a time, in order, and forgets runs that saved both reports", async () => {
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { runner } = setup(async (id) => {
      started.push(id);
      await gate;
      return { ok: true };
    });
    expect(runner.enqueue(1).status).toBe("queued");
    runner.enqueue(2);
    await Bun.sleep(0);
    expect(started).toEqual([1]);
    expect(runner.run(1)?.status).toBe("running");
    expect(runner.run(2)?.status).toBe("queued");
    expect(runner.enqueue(2).status).toBe("queued"); // already queued: keeps its place
    release();
    await runner.idle();
    expect(started).toEqual([1, 2]);
    expect(runner.run(1)).toBeNull();
    expect(runner.run(2)).toBeNull();
  });

  test("a failed run is kept with its error and session, and can be queued again", async () => {
    let attempts = 0;
    const { runner, log } = setup(async () => (++attempts === 1 ? { ok: false, error: "not logged in", sessionId: "s1" } : { ok: true }));
    runner.enqueue(5);
    await runner.idle();
    expect(runner.run(5)).toMatchObject({ status: "failed", error: "not logged in", sessionId: "s1" });
    expect(log.at(-1)).toBe("Agent analysis of game 5 failed: not logged in (claude --resume s1)");
    runner.enqueue(5);
    await runner.idle();
    expect(runner.run(5)).toBeNull();
  });

  test("a run that ends without both reports has failed", async () => {
    const { runner } = setup(async () => ({ ok: true }), () => ["grandmaster"]);
    runner.enqueue(3);
    await runner.idle();
    expect(runner.run(3)?.error).toBe("Claude Code finished without saving the engine report");
  });
});

describe("headless Claude Code", () => {
  test("runs the /analyze-games skill on the game, limited to the agents' tools", () => {
    const args = claudeCodeArgs(7);
    expect(args.slice(0, 2)).toEqual(["-p", "/analyze-games 7"]);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--output-format")).toBe("json");
    expect(value("--permission-mode")).toBe("dontAsk");
    expect(value("--tools")).toBe("Bash,Read,Grep,Glob,Write,Edit,Agent");
    expect(value("--allowedTools")).toBe("Read,Grep,Glob,Agent,Bash(bun scripts/agents.ts *),Edit(data/agent-reports/**)");
    expect(JSON.parse(value("--settings")!).permissions.allow).toEqual(value("--allowedTools")!.split(","));
  });

  test("reads the JSON result: success, a reported error, or no JSON at all", () => {
    expect(parseClaudeOutput('{"type":"result","subtype":"success","is_error":false,"result":"Saved both.","session_id":"s1"}', "", 0)).toEqual({
      ok: true, error: undefined, sessionId: "s1", summary: "Saved both.",
    });
    expect(parseClaudeOutput('{"is_error":true,"result":"Not logged in · Please run /login","session_id":"s2"}', "", 1).error).toBe(
      "Claude Code exited with code 1: Not logged in · Please run /login",
    );
    expect(parseClaudeOutput("", "command not found\n", 127)).toMatchObject({ ok: false, error: "Claude Code exited with code 127: command not found" });
  });

  test("starts Claude Code without the variables of a Claude Code session the server may run in", async () => {
    // A stand-in for `claude` that reports what it was given.
    const script = 'printf \'{"is_error":false,"session_id":"s3","result":"%s|%s|%s"}\' "${CLAUDECODE:-unset}" "$CLAUDE_CODE_DISABLE_BACKGROUND_TASKS" "$2"';
    const launch = claudeCodeLauncher({ command: ["sh", "-c", script, "claude"], cwd: import.meta.dir, timeoutMs: 10_000, env: { PATH: process.env.PATH, CLAUDECODE: "1" } });
    expect(await launch(9)).toMatchObject({ ok: true, sessionId: "s3", summary: "unset|1|/analyze-games 9" });
  });

  test("a run that takes too long is stopped", async () => {
    const launch = claudeCodeLauncher({ command: ["sh", "-c", "sleep 10", "claude"], cwd: import.meta.dir, timeoutMs: 100 });
    expect(await launch(1)).toEqual({ ok: false, error: "Claude Code timed out after 0.1 s" });
  });
});
