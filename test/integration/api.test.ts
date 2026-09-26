import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { AgentRunner } from "../../src/server/agents/runner.ts";
import { apiRoutes } from "../../src/server/api.ts";
import { GameStore } from "../../src/server/db.ts";
import { PlayerFailure, type Player } from "../../src/server/players.ts";
import { GameService } from "../../src/server/service.ts";
import type { GameRecord } from "../../src/shared/types.ts";
import { fakeEngine, firstMovePlayer, scriptedPlayer } from "../helpers/fakes.ts";

let server: Server<unknown>;
let base: string;
let service: GameService;
let gate: Promise<void> = Promise.resolve();

beforeAll(async () => {
  const { engine } = fakeEngine();
  await engine.init();
  let aiWhite = true;
  // Lc0 plays the losing side of Fool's mate; the first move waits on `gate` so tests can observe a live game.
  const gated = (moves: string[]): Player => {
    const p = scriptedPlayer("x", moves);
    return { name: "Lc0", getMove: async (req) => (await gate, p.getMove(req)) };
  };
  service = new GameService({
    store: new GameStore(),
    createAiPlayer: async () => {
      aiWhite = service.nextAiColor() === "white";
      return gated(aiWhite ? ["f3", "g4"] : ["e5", "Qh4#"]);
    },
    createStockfishPlayer: async () => ({ ...scriptedPlayer("x", aiWhite ? ["e5", "Qh4#"] : ["f3", "g4"]), name: "Stockfish (1600)" }),
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
  test("status reports the starting rating, Lc0's next colour and whether agent analysis is on", async () => {
    expect(await (await get("/api/status")).json()).toEqual({
      rating: 1500,
      playing: false,
      nextAiColor: "white",
      agents: { enabled: false, reason: "agent analysis is not set up" },
    });
  });

  test("starting a game, rejecting a second one while it runs, then reading the result", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const res = await post("/api/games");
    expect(res.status).toBe(201);
    const game = (await res.json()) as GameRecord;
    expect(game).toMatchObject({ status: "in_progress", aiColor: "white" });

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
    await post("/api/games"); // Lc0 as Black wins this one
    await service.waitForActiveGame();
    const byElo = (await (await get("/api/games?sort=elo&order=desc")).json()) as GameRecord[];
    const elos = byElo.map((g) => g.aiEloEstimate!);
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

  test("games can't go to the agents while agent analysis is off", async () => {
    const res = await post("/api/games/1/agents");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Agent analysis is off: agent analysis is not set up");
  });
});

describe("HTTP API with agent analysis on", () => {
  test("a finished game is queued for the agents and shows the run; unknown and aborted games are refused", async () => {
    const { engine } = fakeEngine();
    await engine.init();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agents = new AgentRunner({ launch: async () => (await gate, { ok: true }), reportsSince: () => ["grandmaster", "engine"], log: () => {} });
    let crash = false;
    const service = new GameService({
      store: new GameStore(),
      createAiPlayer: async () => (crash ? { name: "Lc0", getMove: () => Promise.reject(new PlayerFailure("crashed")) } : scriptedPlayer("Lc0", ["f3", "g4"])),
      // Once Lc0 crashes it plays Black, so White has to make a legal first move.
      createStockfishPlayer: async () => (crash ? firstMovePlayer("Stockfish (1600)") : scriptedPlayer("Stockfish (1600)", ["e5", "Qh4#"])),
      getAnalysisEngine: async () => engine,
      analysisDepth: 1,
      agents,
    });
    const agentServer = Bun.serve({ port: 0, routes: apiRoutes(service) });
    const url = (path: string) => agentServer.url.origin + path;
    try {
      const game = await service.startGame();
      await service.waitForActiveGame();
      expect(((await (await fetch(url(`/api/games/${game.id}`))).json()) as GameRecord).agentRun?.status).toBe("running");
      release();
      await agents.idle();
      const queued = await fetch(url(`/api/games/${game.id}/agents`), { method: "POST" });
      expect(queued.status).toBe(202);
      expect((await queued.json()).status).toBe("queued");
      await agents.idle();

      crash = true;
      const aborted = await service.startGame();
      await service.waitForActiveGame();
      expect((await fetch(url(`/api/games/${aborted.id}/agents`), { method: "POST" })).status).toBe(409);
      expect((await fetch(url("/api/games/999/agents"), { method: "POST" })).status).toBe(404);
      expect(await (await fetch(url("/api/status"))).json()).toMatchObject({ agents: { enabled: true } });
    } finally {
      agentServer.stop(true);
    }
  });
});
