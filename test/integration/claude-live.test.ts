import { expect, test } from "bun:test";
import { Chess } from "chess.js";
import { ClaudePlayer } from "../../src/server/claude-player.ts";
import { MOVE_TIME_LIMIT_MS } from "../../src/shared/rules.ts";

// Calls the real Anthropic API; runs only when ANTHROPIC_API_KEY is set.
test.skipIf(!process.env.ANTHROPIC_API_KEY)("Claude returns a legal move", async () => {
  const chess = new Chess();
  chess.move("e4");
  const move = await new ClaudePlayer().getMove({
    fen: chess.fen(),
    color: "black",
    sanHistory: chess.history(),
    legalMoves: chess.moves(),
    rejectedAttempts: [],
    timeLeftMs: MOVE_TIME_LIMIT_MS,
    signal: AbortSignal.timeout(30_000),
  });
  expect(chess.moves()).toContain(move);
}, 60_000);
