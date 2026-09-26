import { describe, expect, test } from "bun:test";
import { parseInfoLine, parseSearchOutput, scoreToCp } from "../../src/server/engine/uci.ts";
import { Lc0Player, PlayerFailure, StockfishPlayer, type MoveRequest } from "../../src/server/players.ts";
import { UciEngine } from "../../src/server/engine/uci.ts";
import { fakeEngine } from "../helpers/fakes.ts";

describe("UCI parsing", () => {
  test("parses centipawn and mate scores", () => {
    expect(parseInfoLine("info depth 12 seldepth 18 multipv 1 score cp 34 nodes 1000 pv e2e4")).toMatchObject({
      depth: 12,
      score: { cp: 34, mate: null },
    });
    expect(parseInfoLine("info depth 20 score mate -3 pv h7h8")?.score).toEqual({ cp: null, mate: -3 });
  });

  test("ignores bound scores and non-score lines", () => {
    expect(parseInfoLine("info depth 10 score cp 50 lowerbound")).toBeNull();
    expect(parseInfoLine("info string NNUE enabled")).toBeNull();
    expect(parseInfoLine("bestmove e2e4")).toBeNull();
  });

  test("search output takes the last multipv-1 score and the best move", () => {
    const res = parseSearchOutput([
      "info depth 1 multipv 1 score cp 10 pv e2e4",
      "info depth 2 multipv 1 score cp 25 pv d2d4",
      "info depth 2 multipv 2 score cp -80 pv a2a3",
      "bestmove d2d4 ponder d7d5",
    ]);
    expect(res).toEqual({ bestMove: "d2d4", score: { cp: 25, mate: null }, depth: 2 });
  });

  test("no legal move is reported as null", () => {
    expect(parseSearchOutput(["bestmove (none)"]).bestMove).toBeNull();
  });

  test("mate scores map to large values, sooner mates larger", () => {
    expect(scoreToCp({ cp: null, mate: 1 })).toBeGreaterThan(scoreToCp({ cp: null, mate: 5 }));
    expect(scoreToCp({ cp: null, mate: -1 })).toBeLessThan(-10_000);
    expect(scoreToCp({ cp: 42, mate: null })).toBe(42);
  });
});

describe("UciEngine", () => {
  test("configure sends setoption commands", async () => {
    const { engine, sent } = fakeEngine();
    await engine.init();
    await engine.configure({ UCI_LimitStrength: true, UCI_Elo: 1600 });
    expect(sent).toContain("setoption name UCI_LimitStrength value true");
    expect(sent).toContain("setoption name UCI_Elo value 1600");
  });

  test("concurrent searches are serialised", async () => {
    const { engine } = fakeEngine({ evaluate: (fen) => ({ cp: fen.includes(" b ") ? -10 : 10 }) });
    await engine.init();
    const [a, b] = await Promise.all([
      engine.search("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", { depth: 1 }),
      engine.search("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", { depth: 1 }),
    ]);
    expect(a.score?.cp).toBe(10);
    expect(b.score?.cp).toBe(-10);
  });
});

describe("StockfishPlayer", () => {
  test("is limited to 1600 Elo and searches within the move time", async () => {
    const { engine, sent } = fakeEngine();
    await engine.init();
    const player = await StockfishPlayer.create(engine, 4000);
    const move = await player.getMove({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      color: "white",
      sanHistory: [],
      legalMoves: [],
      rejectedAttempts: [],
      timeLeftMs: 5000,
      signal: new AbortController().signal,
    });
    expect(move).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(sent).toContain("setoption name UCI_LimitStrength value true");
    expect(sent).toContain("setoption name UCI_Elo value 1600");
    expect(sent).toContain("go movetime 4000");
  });
});

const startRequest = (): MoveRequest => ({
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  color: "white",
  sanHistory: [],
  legalMoves: [],
  rejectedAttempts: [],
  timeLeftMs: 5000,
  signal: new AbortController().signal,
});

describe("Lc0Player", () => {
  test("plays at full strength and loads its network before the clock starts", async () => {
    const { engine, sent } = fakeEngine();
    await engine.init();
    const player = await Lc0Player.create(engine, 4000);
    expect(player.name).toBe("Pluto");
    expect(sent).toContain("go nodes 1"); // warm-up search
    expect(sent.some((l) => l.includes("UCI_LimitStrength") || l.includes("UCI_Elo"))).toBe(false);
    sent.length = 0;
    expect(await player.getMove(startRequest())).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(sent).toContain("go movetime 4000");
  });

  test("never searches past the time left on the clock", async () => {
    const { engine, sent } = fakeEngine();
    await engine.init();
    const player = await Lc0Player.create(engine, 4000);
    await player.getMove({ ...startRequest(), timeLeftMs: 1000 });
    expect(sent).toContain("go movetime 750");
  });
});

test("an engine that dies mid-game aborts the game instead of losing on time", async () => {
  let exit: (e: Error) => void = () => {};
  const engine = new UciEngine({
    write: () => {},
    onLine: () => {},
    onExit: (l) => void (exit = l),
    close: () => {},
  });
  const { EnginePlayer } = await import("../../src/server/players.ts");
  const player = new EnginePlayer("Lc0", engine, 1000);
  const move = player.getMove(startRequest());
  exit(new Error("Engine process (lc0) exited with code 139"));
  const err = await move.catch((e) => e);
  expect(err).toBeInstanceOf(PlayerFailure);
  expect(err.message).toContain("exited with code 139");
});
