import type { AgentRun, GameAnalysis, GameRecord } from "../shared/types.ts";

export interface Status {
  rating: number;
  playing: boolean;
  nextAiColor: "white" | "black";
  /** Whether the server runs the Claude Code analysis agents, and if not, why. */
  agents: { enabled: boolean; reason?: string };
}

export interface PastedAnalysis {
  sanMoves: string[];
  headers: Record<string, string>;
  startFen: string;
  analysis: GameAnalysis;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  status: () => request<Status>("/api/status"),
  listGames: (sort: "date" | "elo", order: "asc" | "desc") => request<GameRecord[]>(`/api/games?sort=${sort}&order=${order}`),
  getGame: (id: number) => request<GameRecord>(`/api/games/${id}`),
  startGame: () => request<GameRecord>("/api/games", { method: "POST" }),
  runAgents: (id: number) => request<AgentRun>(`/api/games/${id}/agents`, { method: "POST" }),
  analyse: (pgn: string) =>
    request<PastedAnalysis>("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pgn }),
    }),
};
