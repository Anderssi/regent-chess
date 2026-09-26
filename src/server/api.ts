import type { GameSort, SortOrder } from "./db.ts";
import { AgentRequestError, GameInProgressError, InvalidGameSettingsError, type GameService } from "./service.ts";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status: number) => json({ error: message }, status);
const AGENT_ERROR_STATUS = { not_found: 404, not_ready: 409, unavailable: 503 } as const;

/** API route table for Bun.serve. Kept separate from the server so tests can mount it with fakes. */
export function apiRoutes(service: GameService) {
  return {
    "/api/status": {
      GET: () =>
        json({ rating: service.currentRating(), playing: service.isPlaying(), nextAiColor: service.nextAiColor(), agents: service.agentStatus() }),
    },
    "/api/games": {
      GET: (req: Request) => {
        const url = new URL(req.url);
        const sort = url.searchParams.get("sort") === "elo" ? "elo" : "date";
        const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
        return json(service.listGames(sort as GameSort, order as SortOrder));
      },
      POST: async (req: Request) => {
        // Optional JSON body: { stockfishElo }. No body plays the brief's default.
        let settings: { stockfishElo?: number } = {};
        const body = await req.text();
        if (body.trim()) {
          try {
            settings = JSON.parse(body);
          } catch {
            return error("Request body must be JSON", 400);
          }
        }
        try {
          return json(await service.startGame({ stockfishElo: settings?.stockfishElo }), 201);
        } catch (err) {
          if (err instanceof GameInProgressError) return error(err.message, 409);
          if (err instanceof InvalidGameSettingsError) return error(err.message, 400);
          return error(err instanceof Error ? err.message : String(err), 500);
        }
      },
    },
    "/api/games/:id": {
      GET: (req: Request & { params: { id: string } }) => {
        const game = service.getGame(Number(req.params.id));
        return game ? json(game) : error("Game not found", 404);
      },
    },
    "/api/games/:id/agents": {
      /** Queue the Claude Code analysis agents on a game (again). */
      POST: (req: Request & { params: { id: string } }) => {
        try {
          return json(service.requestAgentAnalysis(Number(req.params.id)), 202);
        } catch (err) {
          if (err instanceof AgentRequestError) return error(err.message, AGENT_ERROR_STATUS[err.reason]);
          return error(err instanceof Error ? err.message : String(err), 500);
        }
      },
    },
    "/api/games/:id/pgn": {
      GET: (req: Request & { params: { id: string } }) => {
        const game = service.getGame(Number(req.params.id));
        if (!game) return error("Game not found", 404);
        return new Response(game.pgn, {
          headers: {
            "Content-Type": "application/x-chess-pgn",
            "Content-Disposition": `attachment; filename="regent-game-${game.id}.pgn"`,
          },
        });
      },
    },
    "/api/analyse": {
      POST: async (req: Request) => {
        let body: { pgn?: unknown };
        try {
          body = await req.json();
        } catch {
          return error("Expected a JSON body", 400);
        }
        if (typeof body.pgn !== "string" || !body.pgn.trim()) return error("Paste a game in the 'pgn' field", 400);
        try {
          return json(await service.analysePasted(body.pgn));
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err), 422);
        }
      },
    },
  };
}
