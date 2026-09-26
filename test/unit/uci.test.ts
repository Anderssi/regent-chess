import { describe, expect, test } from "bun:test";
import { parseInfoLine, parseMoveStatLine, parseSearchOutput, scoreToCp } from "../../src/server/engine/uci.ts";
import { describeSearch, Lc0Player, PlayerFailure, StockfishPlayer, type MoveRequest } from "../../src/server/players.ts";
import { UciEngine, type UciTransport } from "../../src/server/engine/uci.ts";
import { uciToSanLine } from "../../src/shared/notation.ts";
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
    expect(res).toMatchObject({ bestMove: "d2d4", score: { cp: 25, mate: null }, depth: 2 });
    expect(res.lines.map((l) => [l.multipv, l.pv[0]])).toEqual([
      [1, "d2d4"],
      [2, "a2a3"],
    ]);
  });

  test("reads Lc0's full info line: selective depth, nodes, speed, time, win/draw/loss and the principal variation", () => {
    const info = parseInfoLine("info depth 7 seldepth 19 time 3107 nodes 6021 score cp 35 wdl 336 469 195 nps 1880 tbhits 0 pv c3d5 h7h6 c2c3");
    expect(info).toEqual({
      depth: 7,
      seldepth: 19,
      multipv: 1,
      score: { cp: 35, mate: null },
      wdl: [336, 469, 195],
      nodes: 6021,
      nps: 1880,
      timeMs: 3107,
      pv: ["c3d5", "h7h6", "c2c3"],
    });
  });

  test("reads Lc0's move statistics, most visited first; unvisited moves have no Q", () => {
    const res = parseSearchOutput([
      "info string a2a3  (204 ) N:       3 (+ 0) (P:  5.23%) (WL:  0.11715) (D: 0.459) (M: 154.3) (Q:  0.11715) (U: 0.15856) (S:  0.27414) (V:  0.1238) ",
      "info string c4a6  (730 ) N:       0 (+ 0) (P:  0.42%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q:  0.82544) (U: 0.00726) (S:  0.83270) (V:  -.----) ",
      "info string c3d5  (491 ) N:      21 (+ 3) (P: 22.81%) (WL:  0.15261) (D: 0.459) (M: 153.6) (Q: -0.15261) (U: 0.11062) (S:  0.26515) (V:  0.0931) ",
      "info string node  (  37) N:      49 (+ 4) (P: 69.39%) (WL:  0.13162) (D: 0.461) (M: 155.2) (Q:  0.13162) (V:  0.1945) ",
      "bestmove c3d5 ponder h7h6",
    ]);
    expect(res.moveStats).toEqual([
      { move: "c3d5", visits: 21, policy: 22.81, q: -0.15261 },
      { move: "a2a3", visits: 3, policy: 5.23, q: 0.11715 },
      { move: "c4a6", visits: 0, policy: 0.42, q: null },
    ]);
    expect(parseMoveStatLine("info string node  (  37) N:      49 (+ 4) (P: 69.39%)")).toBeNull();
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

  test("keeps the engine's name, its options and what it wrote to stderr at startup", async () => {
    const { engine } = lc0Like();
    await engine.init();
    expect(engine.name).toBe("Lc0 v0.32.1");
    expect(engine.optionLines).toEqual(["option name CPuct type string default 1.745000"]);
    expect(engine.startupLog).toContain("Loading weights file from: /nets/42850.pb.gz");
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
    const { move } = await player.getMove({
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
    expect((await player.getMove(startRequest())).move).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(sent).toContain("go movetime 4000");
  });

  test("turns on the search statistics recorded with each move, and describes its setup", async () => {
    const { engine, sent } = lc0Like();
    await engine.init();
    const player = await Lc0Player.create(engine, 4000, ["lc0", "--minibatch-size=32"]);
    expect(sent).toContain("setoption name UCI_ShowWDL value true");
    expect(sent).toContain("setoption name VerboseMoveStats value true");
    expect(player.setup).toEqual({
      name: "Lc0 v0.32.1",
      command: ["lc0", "--minibatch-size=32"],
      movetimeMs: 4000,
      options: { UCI_ShowWDL: true, VerboseMoveStats: true },
      network: "/nets/42850.pb.gz",
      backend: "metal backend on device Apple M4",
    });
  });

  test("returns the engine's search with its move", async () => {
    const { engine } = lc0Like();
    await engine.init();
    const player = await Lc0Player.create(engine, 4000);
    const { move, search } = await player.getMove(startRequest());
    expect(move).toBe("e2e4");
    expect(search).toMatchObject({ movetimeMs: 4000, depth: 7, nodes: 6021, eval: 35, wdl: [336, 469, 195], pv: ["e4", "e5"] });
    expect(search!.candidates.map((c) => c.san)).toEqual(["e4", "d4"]);
  });

  test("never searches past the time left on the clock", async () => {
    const { engine, sent } = fakeEngine();
    await engine.init();
    const player = await Lc0Player.create(engine, 4000);
    await player.getMove({ ...startRequest(), timeLeftMs: 1000 });
    expect(sent).toContain("go movetime 750");
  });
});

describe("describeSearch", () => {
  test("records moves in SAN and turns the engine's evaluation into White's point of view", () => {
    // Black to move after 1. e4: the engine thinks Black is slightly worse (-20 for the side to move).
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const result = parseSearchOutput([
      "info depth 5 seldepth 9 time 900 nodes 1200 score cp -20 wdl 150 500 350 nps 1333 pv c7c5 g1f3",
      "info string c7c5  (1 ) N:     800 (+ 0) (P: 30.00%) (WL: -0.1) (D: 0.5) (M: 100) (Q: -0.10000) (U: 0.1) (S: 0.1) (V: 0.1) ",
      "info string e7e5  (2 ) N:     300 (+ 0) (P: 25.00%) (WL: -0.1) (D: 0.5) (M: 100) (Q: -0.12000) (U: 0.1) (S: 0.1) (V: 0.1) ",
      "bestmove c7c5",
    ]);
    const search = describeSearch(fen, result, 4000, 950.4);
    expect(search).toEqual({
      movetimeMs: 4000,
      timeMs: 950,
      depth: 5,
      seldepth: 9,
      nodes: 1200,
      nps: 1333,
      eval: 20,
      wdl: [350, 500, 150],
      pv: ["c5", "Nf3"],
      candidates: [
        { san: "c5", visits: 800, policy: 30, q: -0.1 },
        { san: "e5", visits: 300, policy: 25, q: -0.12 },
      ],
    });
  });
});

describe("castling written as the king taking its rook", () => {
  // White can castle short: Lc0's move statistics (and possibly its pv) write that as e1h1, bestmove as e1g1.
  const fen = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

  test("is read as castling in the root candidates and the principal variation", () => {
    const result = parseSearchOutput([
      "info depth 6 seldepth 12 time 1000 nodes 5029 score cp 30 wdl 300 500 200 nps 5000 pv e1h1 g8f6",
      "info string e1h1  (1 ) N:    3000 (+ 0) (P: 40.00%) (WL: 0.1) (D: 0.5) (M: 100) (Q:  0.10000) (U: 0.1) (S: 0.1) (V: 0.1) ",
      "info string c2c3  (2 ) N:     157 (+ 0) (P: 10.00%) (WL: 0.1) (D: 0.5) (M: 100) (Q:  0.05000) (U: 0.1) (S: 0.1) (V: 0.1) ",
      "bestmove e1g1",
    ]);
    const search = describeSearch(fen, result, 4000, 1000);
    expect(search.candidates.map((c) => c.san)).toEqual(["O-O", "c3"]);
    expect(search.pv).toEqual(["O-O", "Nf6"]);
  });

  test("but a rook really moving from e1 to h1 stays a rook move", () => {
    expect(uciToSanLine("4k3/8/8/8/8/8/8/K3R3 w - - 0 1", ["e1h1"])).toEqual(["Rh1"]);
  });
});

/** An engine that answers like Lc0 with UCI_ShowWDL and VerboseMoveStats on. */
function lc0Like(): { engine: UciEngine; sent: string[] } {
  const sent: string[] = [];
  let listener: (line: string) => void = () => {};
  const emit = (...lines: string[]) => queueMicrotask(() => lines.forEach((l) => listener(l)));
  const transport: UciTransport = {
    write(line) {
      sent.push(line);
      if (line === "uci") emit("id name Lc0 v0.32.1", "option name CPuct type string default 1.745000", "uciok");
      else if (line === "isready") emit("readyok");
      else if (line.startsWith("go")) {
        emit(
          "info depth 7 seldepth 19 time 3107 nodes 6021 score cp 35 wdl 336 469 195 nps 1880 tbhits 0 pv e2e4 e7e5",
          "info string d2d4  (293 ) N:    1200 (+ 0) (P: 29.50%) (WL:  0.05) (D: 0.6) (M: 150) (Q:  0.05000) (U: 0.1) (S: 0.1) (V: 0.1) ",
          "info string e2e4  (322 ) N:    4012 (+ 0) (P: 31.20%) (WL:  0.07) (D: 0.6) (M: 150) (Q:  0.07000) (U: 0.1) (S: 0.1) (V: 0.1) ",
          "bestmove e2e4",
        );
      }
    },
    onLine: (l) => void (listener = l),
    startupLog: () => "Loading weights file from: /nets/42850.pb.gz\nInitialized metal backend on device Apple M4\n",
    close() {},
  };
  return { engine: new UciEngine(transport), sent };
}

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
