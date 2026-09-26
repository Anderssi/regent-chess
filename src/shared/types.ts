export type Color = "white" | "black";
export type GameResult = "1-0" | "0-1" | "1/2-1/2";
export type GameStatus = "in_progress" | "finished" | "aborted";

export type Termination =
  | "checkmate"
  | "stalemate"
  | "threefold_repetition"
  | "fifty_move_rule"
  | "insufficient_material"
  | "timeout"
  | "timeout_vs_insufficient_material";

export interface PlyAnalysis {
  ply: number;
  color: Color;
  san: string;
  fenBefore: string;
  fenAfter: string;
  /** Evaluation before the move, in centipawns from White's point of view (mates clamped). */
  evalBefore: number;
  /** Evaluation after the move, in centipawns from White's point of view (mates clamped). */
  evalAfter: number;
  /** Engine's preferred move in the position before, in SAN. */
  bestMove: string | null;
  /** Centipawns lost by the mover relative to the engine's best line (>= 0). */
  cpLoss: number;
  /** 0-100 accuracy for this move. */
  accuracy: number;
}

export interface SideSummary {
  moves: number;
  acpl: number;
  accuracy: number;
  estimatedElo: number;
}

export interface GameAnalysis {
  plies: PlyAnalysis[];
  white: SideSummary;
  black: SideSummary;
  depth: number;
}

/** One root move from Lc0's move statistics (VerboseMoveStats) at the end of a search. */
export interface CandidateMove {
  san: string;
  /** Visits (N) the move got. */
  visits: number;
  /** The network's policy prior (P), 0-100. */
  policy: number;
  /** Expected score (Q) from the mover's point of view, -1 to 1; null if never visited. */
  q: number | null;
}

/** What an engine reported about its own search for the move it played. */
export interface MoveSearch {
  /** Search time the engine was given, and the wall-clock time the move took, in ms. */
  movetimeMs: number;
  timeMs: number;
  depth: number;
  seldepth: number | null;
  nodes: number | null;
  nps: number | null;
  /** The engine's own evaluation, in centipawns from White's point of view (mates clamped). */
  eval: number | null;
  /** Win/draw/loss chances in per mille from White's point of view (Lc0 reports these). */
  wdl: [number, number, number] | null;
  /** Principal variation in SAN, starting with the move played. */
  pv: string[];
  /** Lc0's root moves, most visited first (empty for engines that don't report them). */
  candidates: CandidateMove[];
}

/** How our engine was set up for a game, so analysis can tie advice to settings. */
export interface EngineSetup {
  /** Name and version from the UCI handshake, e.g. "Lc0 v0.32.1+git.dirty". */
  name: string;
  /** Command line the engine process was started with. */
  command: string[];
  /** Search time per move in ms (always capped by the time left on the move clock). */
  movetimeMs: number;
  /** UCI options the app sets on top of the engine's defaults. */
  options: Record<string, string | number | boolean>;
  /** Network file and compute backend, as the engine reported them when it loaded. */
  network: string | null;
  backend: string | null;
}

export const AGENT_NAMES = ["grandmaster", "engine"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface KeyMoment {
  /** The ply whose move is discussed (1 = White's first move). */
  ply: number;
  title: string;
  comment: string;
  /** A better move in the position before `ply`, in SAN. */
  betterMove?: string;
  /** A checked continuation in SAN, starting with `betterMove`. */
  line?: string[];
}

export interface AgentSuggestion {
  title: string;
  priority: "high" | "medium" | "low";
  /** Topic, e.g. "endgame technique" or "time management". */
  area: string;
  /** What goes wrong and why, with the evidence. */
  detail: string;
  /** Plies that show the problem. */
  plies: number[];
  /** The concrete change to make. */
  change: string;
  /** How to check that the change helped. */
  verify: string;
}

/** A report from one of the Claude Code analysis agents (.claude/agents). */
export interface AgentReport {
  gameId: number;
  agent: AgentName;
  createdAt: string;
  summary: string;
  keyMoments: KeyMoment[];
  suggestions: AgentSuggestion[];
}

/** An agent analysis the server has queued, is running, or that failed. Finished runs leave only their reports. */
export interface AgentRun {
  status: "queued" | "running" | "failed";
  /** When the run was queued, started or failed. */
  since: string;
  error?: string;
  /** The Claude Code session, for `claude --resume <id>`. */
  sessionId?: string;
}

export interface GameRecord {
  id: number;
  createdAt: string;
  finishedAt: string | null;
  status: GameStatus;
  aiColor: Color;
  white: string;
  black: string;
  result: GameResult | null;
  termination: Termination | null;
  sanMoves: string[];
  pgn: string;
  /** Per-game Elo estimate for our AI from Stockfish analysis. */
  aiEloEstimate: number | null;
  /** Running rating from results, before and after this game. */
  ratingBefore: number | null;
  ratingAfter: number | null;
  error: string | null;
  analysis: GameAnalysis | null;
  /** Stockfish's strength (UCI_Elo) in this game. */
  stockfishElo: number;
  /** Our engine's setup, recorded for games played since search data was added. */
  aiSetup: EngineSetup | null;
  agentReports: AgentReport[];
  /** Set by the server while an agent analysis of this game is queued or running, or after it failed. */
  agentRun?: AgentRun | null;
}
