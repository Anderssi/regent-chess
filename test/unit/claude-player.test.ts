import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { buildMovePrompt, ClaudePlayer } from "../../src/server/claude-player.ts";
import { PlayerFailure, type MoveRequest } from "../../src/server/players.ts";

const request = (overrides: Partial<MoveRequest> = {}): MoveRequest => ({
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  color: "black",
  sanHistory: ["e4"],
  legalMoves: ["e5", "c5", "Nf6"],
  rejectedAttempts: [],
  timeLeftMs: 5000,
  signal: new AbortController().signal,
  ...overrides,
});

/** An Anthropic client whose HTTP layer returns a canned response. */
function clientReturning(status: number, body: unknown, seen: unknown[] = []) {
  return new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
}

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("buildMovePrompt", () => {
  test("includes colour, FEN, history and legal moves", () => {
    const prompt = buildMovePrompt(request());
    expect(prompt).toContain("You are playing black.");
    expect(prompt).toContain("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(prompt).toContain("Moves so far: 1. e4");
    expect(prompt).toContain("Legal moves: e5 c5 Nf6");
  });

  test("mentions earlier illegal attempts", () => {
    const prompt = buildMovePrompt(request({ rejectedAttempts: [{ move: "Ke2", reason: "illegal" }] }));
    expect(prompt).toContain("not legal here: Ke2");
  });
});

describe("ClaudePlayer", () => {
  test("returns the move from Claude's structured output", async () => {
    const seen: any[] = [];
    const player = new ClaudePlayer(clientReturning(200, message('{"move":"e5"}'), seen), "claude-opus-5");
    expect(await player.getMove(request())).toBe("e5");
    expect(seen[0].model).toBe("claude-opus-5");
    expect(seen[0].output_config.effort).toBe("low");
    expect(seen[0].output_config.format.type).toBe("json_schema");
  });

  test("authentication errors abort the game instead of costing time", async () => {
    const player = new ClaudePlayer(clientReturning(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }));
    await expect(player.getMove(request())).rejects.toBeInstanceOf(PlayerFailure);
  });

  test("missing credentials abort the game instead of forfeiting it on time", async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const client = new Anthropic({ apiKey: null, authToken: null, maxRetries: 0, fetch: (() => Promise.reject(new Error("should not be called"))) as unknown as typeof fetch });
      await expect(new ClaudePlayer(client).getMove(request())).rejects.toBeInstanceOf(PlayerFailure);
    } finally {
      if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
  });

  test("server errors are ordinary (retryable) errors", async () => {
    const player = new ClaudePlayer(clientReturning(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }));
    const err = await player.getMove(request()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlayerFailure);
  });

  test("a refusal is an ordinary error", async () => {
    const player = new ClaudePlayer(clientReturning(200, message("", "refusal")));
    await expect(player.getMove(request())).rejects.toThrow(/declined/);
  });
});
