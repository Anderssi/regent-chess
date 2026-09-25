import { describe, expect, test } from "bun:test";
import { formatMovetext, parsePastedGame } from "../../src/shared/notation.ts";

describe("parsePastedGame", () => {
  test("parses numbered movetext", () => {
    expect(parsePastedGame("1. e4 e5 2. Nf3 Nc6 3. Bb5").sanMoves).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
  });

  test("parses full PGN with headers, comments and result", () => {
    const pgn = `[Event "Test"]
[White "Alice"]
[Black "Bob"]

1. e4 {best by test} e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;
    const game = parsePastedGame(pgn);
    expect(game.sanMoves).toEqual(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);
    expect(game.headers.White).toBe("Alice");
  });

  test("parses bare moves without numbers", () => {
    expect(parsePastedGame("d4 d5 c4").sanMoves).toEqual(["d4", "d5", "c4"]);
  });

  test("supports games from a custom start position", () => {
    const pgn = `[SetUp "1"]
[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]

1. e4 Kd7`;
    const game = parsePastedGame(pgn);
    expect(game.sanMoves).toEqual(["e4", "Kd7"]);
    expect(game.startFen).toBe("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
  });

  test("rejects illegal moves, naming the move", () => {
    expect(() => parsePastedGame("1. e4 e5 2. Ke3")).toThrow(/Ke3/);
  });

  test("rejects empty input", () => {
    expect(() => parsePastedGame("   ")).toThrow();
  });
});

test("formatMovetext numbers moves", () => {
  expect(formatMovetext(["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
});
