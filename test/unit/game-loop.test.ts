import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { opponentCanCheckmate, playGame, tryMove } from "../../src/server/game-loop.ts";
import { PlayerFailure } from "../../src/server/players.ts";
import { scriptedPlayer } from "../helpers/fakes.ts";

describe("playGame", () => {
  test("plays to checkmate and records SAN moves and PGN", async () => {
    const white = scriptedPlayer("W", ["e4", "Bc4", "Qh5", "Qxf7#"]);
    const black = scriptedPlayer("B", ["e5", "Nc6", "Nf6"]);
    const out = await playGame({ white, black });
    expect(out).toMatchObject({ status: "finished", result: "1-0", termination: "checkmate" });
    expect(out.sanMoves).toEqual(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(out.pgn).toContain("1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0");
    expect(out.pgn).toContain('[White "W"]');
  });

  test("accepts moves in UCI notation too", async () => {
    const white = scriptedPlayer("W", ["f2f3", "g2g4"]);
    const black = scriptedPlayer("B", ["e7e5", "d8h4"]);
    const out = await playGame({ white, black });
    expect(out).toMatchObject({ result: "0-1", termination: "checkmate" });
    expect(out.sanMoves).toEqual(["f3", "e5", "g4", "Qh4#"]);
  });

  test("an illegal move is rejected and the player may retry within the time limit", async () => {
    const white = scriptedPlayer("W", ["e5", "nonsense", "f3", "g4"]);
    const black = scriptedPlayer("B", ["e5", "Qh4#"]);
    const out = await playGame({ white, black });
    expect(out.sanMoves).toEqual(["f3", "e5", "g4", "Qh4#"]);
    // The retry request told the player about the earlier illegal attempts.
    expect(white.requests[2]!.rejectedAttempts.map((a) => a.move)).toEqual(["e5", "nonsense"]);
  });

  test("a player that never finds a legal move before its time runs out loses on time", async () => {
    const white = scriptedPlayer("W", Array(1000).fill("Ke2"));
    const black = scriptedPlayer("B", []);
    const out = await playGame({ white, black, moveTimeLimitMs: 50 });
    expect(out).toMatchObject({ status: "finished", result: "0-1", termination: "timeout" });
  });

  test("a player that exceeds the time limit loses, and its request is aborted", async () => {
    let signal: AbortSignal | undefined;
    const white = scriptedPlayer("W", ["e4"]);
    const black = scriptedPlayer("B", [
      (req) => {
        signal = req.signal;
        return new Promise(() => {});
      },
    ]);
    const started = Date.now();
    const out = await playGame({ white, black, moveTimeLimitMs: 100 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out).toMatchObject({ result: "1-0", termination: "timeout", sanMoves: ["e4"] });
    expect(signal?.aborted).toBe(true);
  });

  test("the time limit defaults to 5 seconds and is reported to the player", async () => {
    const white = scriptedPlayer("W", ["f3", "g4"]);
    const black = scriptedPlayer("B", ["e5", "Qh4#"]);
    await playGame({ white, black });
    expect(white.requests[0]!.timeLeftMs).toBeGreaterThan(4900);
    expect(white.requests[0]!.timeLeftMs).toBeLessThanOrEqual(5000);
  });

  test("transient errors are retried until a legal move arrives", async () => {
    const white = scriptedPlayer("W", [() => Promise.reject(new Error("network down")), "f3", "g4"]);
    const black = scriptedPlayer("B", ["e5", "Qh4#"]);
    const out = await playGame({ white, black });
    expect(out.termination).toBe("checkmate");
  });

  test("a PlayerFailure aborts the game without a result", async () => {
    const white = scriptedPlayer("W", [() => Promise.reject(new PlayerFailure("engine crashed"))]);
    const out = await playGame({ white, black: scriptedPlayer("B", []) });
    expect(out).toMatchObject({ status: "aborted", result: null });
    expect(out.error).toContain("engine crashed");
  });

  test("stalemate is a draw", async () => {
    // Sam Loyd's 10-move stalemate.
    const moves = "e3 a5 Qh5 Ra6 Qxa5 h5 h4 Rah6 Qxc7 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6 Qe6".split(" ");
    const out = await playGame({
      white: scriptedPlayer("W", moves.filter((_, i) => i % 2 === 0)),
      black: scriptedPlayer("B", moves.filter((_, i) => i % 2 === 1)),
    });
    expect(out).toMatchObject({ result: "1/2-1/2", termination: "stalemate" });
  });

  test("threefold repetition is a draw", async () => {
    const out = await playGame({
      white: scriptedPlayer("W", ["Nf3", "Ng1", "Nf3", "Ng1"]),
      black: scriptedPlayer("B", ["Nf6", "Ng8", "Nf6", "Ng8"]),
    });
    expect(out).toMatchObject({ result: "1/2-1/2", termination: "threefold_repetition" });
  });

  test("onMove is called after every move", async () => {
    const seen: string[] = [];
    await playGame({
      white: scriptedPlayer("W", ["f3", "g4"]),
      black: scriptedPlayer("B", ["e5", "Qh4#"]),
      onMove: (san) => void seen.push(san),
    });
    expect(seen).toEqual(["f3", "e5", "g4", "Qh4#"]);
  });
});

describe("time forfeit against insufficient mating material", () => {
  test("lone king cannot checkmate", () => {
    const chess = new Chess("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
    expect(opponentCanCheckmate(chess, "white")).toBe(false);
    expect(opponentCanCheckmate(chess, "black")).toBe(true);
  });

  test("king and minor piece cannot checkmate a lone king", () => {
    expect(opponentCanCheckmate(new Chess("4k3/8/8/8/8/8/8/4KN2 b - - 0 1"), "black")).toBe(false);
  });

  test("king and minor piece can (help)mate when the flagged side has material", () => {
    expect(opponentCanCheckmate(new Chess("4k3/4p3/8/8/8/8/8/4KN2 b - - 0 1"), "black")).toBe(true);
  });
});

test("tryMove rejects illegal and unreadable input without changing the position", () => {
  const chess = new Chess();
  expect(tryMove(chess, "Ke2")).toBeNull();
  expect(tryMove(chess, "")).toBeNull();
  expect(tryMove(chess, "hello")).toBeNull();
  expect(chess.history()).toEqual([]);
  expect(tryMove(chess, "e2e4")?.san).toBe("e4");
});
