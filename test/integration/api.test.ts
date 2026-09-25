import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { apiRoutes } from "../../src/server/api.ts";
import { GameStore } from "../../src/server/db.ts";
import type { Player } from "../../src/server/players.ts";
import { GameService } from "../../src/server/service.ts";
import type { GameRecord } from "../../src/shared/types.ts";
import { fakeEngine, scriptedPlayer } from "../helpers/fakes.ts";

let server: Server<unknown>;
let base: string;
let service: GameService;
let gate: Promise<void> = Promise.resolve();

beforeAll(async () => {
  const { engine } = fakeEngine();
  await engine.init();
  let claudeWhite = true;
  // Claude plays the losing side of Fool's mate; the first move waits on `gate` so tests can observe a live game.
  const gated = (moves: string[]): Player => {
    const p = scriptedPlayer("x", moves);
    return { name: "Claude", getMove: async (req) => (await gate, p.getMove(req)) };
  };
  service = new GameService({
    store: new GameStore(),
    createClaudePlayer: () => {
      claudeWhite = service.nextClaudeColor() === "white";
      return gated(claudeWhite ? ["f3", "g4"] : ["e5", "Qh4#"]);
    },
    createStockfishPlayer: async () => ({ ...scriptedPlayer("x", claudeWhite ? ["e5", "Qh4#"] : ["f3", "g4"]), name: "Stockfish (1600)" }),
    getAnalysisEngine: async () => engine,
    analysisDepth: 1,
  });
  server = Bun.serve({ port: 0, routes: apiRoutes(service) });
  base = server.url.origin;
});
afterAll(() => server.stop(true));

const get = (path: string) => fetch(base + path);
const post = (path: string, body?: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("HTTP API", () => {
  test("status reports the starting rating and Claude's next colour", async () => {
    expect(await (await get("/api/status")).json()).toEqual({ rating: 1500, playing: false, nextClaudeColor: "white" });
  });

  test("starting a game, rejecting a second one while it runs, then reading the result", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const res = await post("/api/games");
    expect(res.status).toBe(201);
    const game = (await res.json()) as GameRecord;
    expect(game).toMatchObject({ status: "in_progress", claudeColor: "white" });

    expect((await post("/api/games")).status).toBe(409);
    release();
    await service.waitForActiveGame();

    const finished = (await (await get(`/api/games/${game.id}`)).json()) as GameRecord;
    expect(finished).toMatchObject({ status: "finished", result: "0-1", sanMoves: ["f3", "e5", "g4", "Qh4#"] });
    expect(finished.analysis).not.toBeNull();
  });

  test("the PGN endpoint downloads the game in algebraic notation", async () => {
    const res = await get("/api/games/1/pgn");
    expect(res.headers.get("content-type")).toContain("application/x-chess-pgn");
    const pgn = await res.text();
    expect(pgn).toContain("1. f3 e5 2. g4 Qh4# 0-1");
    expect(pgn).toContain('[Termination "checkmate"]');
  });

  test("games can be listed sorted by estimated Elo", async () => {
    gate = Promise.resolve();
    await post("/api/games"); // Claude as Black wins this one
    await service.waitForActiveGame();
    const byElo = (await (await get("/api/games?sort=elo&order=desc")).json()) as GameRecord[];
    const elos = byElo.map((g) => g.claudeEloEstimate!);
    expect(elos).toHaveLength(2);
    expect(elos).toEqual([...elos].sort((a, b) => b - a));
    const asc = (await (await get("/api/games?sort=elo&order=asc")).json()) as GameRecord[];
    expect(asc.map((g) => g.id)).toEqual(byElo.map((g) => g.id).reverse());
  });

  test("unknown games are 404", async () => {
    expect((await get("/api/games/999")).status).toBe(404);
  });

  test("a pasted game is analysed", async () => {
    const res = await post("/api/analyse", { pgn: "1. e4 e5 2. Nf3 Nc6" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sanMoves).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(body.analysis.plies).toHaveLength(4);
  });

  test("an illegal pasted game is rejected with a helpful message", async () => {
    const res = await post("/api/analyse", { pgn: "1. e4 e5 2. Ke3" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Ke3");
    expect((await post("/api/analyse", {})).status).toBe(400);
  });
});
