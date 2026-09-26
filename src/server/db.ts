import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_NAMES,
  type AgentName,
  type AgentReport,
  type Color,
  type EngineSetup,
  type GameAnalysis,
  type GameRecord,
  type GameResult,
  type GameStatus,
  type MoveSearch,
  type Termination,
} from "../shared/types.ts";

export type GameSort = "date" | "elo";
export type SortOrder = "asc" | "desc";

interface GameRow {
  id: number;
  created_at: string;
  finished_at: string | null;
  status: GameStatus;
  ai_color: Color;
  white: string;
  black: string;
  result: GameResult | null;
  termination: Termination | null;
  san_moves: string;
  pgn: string;
  ai_elo_estimate: number | null;
  rating_before: number | null;
  rating_after: number | null;
  error: string | null;
  analysis: string | null;
  ai_setup: string | null;
}

interface ReportRow {
  game_id: number;
  agent: AgentName;
  created_at: string;
  report: string;
}

/** Every games column except search_log, which is large and only read on its own (see searchLog()). */
const GAME_COLUMNS =
  "id, created_at, finished_at, status, ai_color, white, black, result, termination, san_moves, pgn, ai_elo_estimate, rating_before, rating_after, error, analysis, ai_setup";

export class GameStore {
  private db: Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    // The server, match scripts and the agents' CLI may all write at the same moment.
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run(`CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      finished_at TEXT,
      status TEXT NOT NULL,
      ai_color TEXT NOT NULL,
      white TEXT NOT NULL,
      black TEXT NOT NULL,
      result TEXT,
      termination TEXT,
      san_moves TEXT NOT NULL DEFAULT '[]',
      pgn TEXT NOT NULL DEFAULT '',
      ai_elo_estimate INTEGER,
      rating_before INTEGER,
      rating_after INTEGER,
      error TEXT,
      analysis TEXT,
      ai_setup TEXT,
      search_log TEXT
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS agent_reports (
      game_id INTEGER NOT NULL REFERENCES games(id),
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      report TEXT NOT NULL,
      PRIMARY KEY (game_id, agent)
    )`);
    this.migrate();
  }

  private migrate(): void {
    const columns = new Set(this.db.query<{ name: string }, []>("PRAGMA table_info(games)").all().map((c) => c.name));
    // Databases from when our AI was Claude used claude_* column names.
    if (columns.has("claude_color")) this.db.run("ALTER TABLE games RENAME COLUMN claude_color TO ai_color");
    if (columns.has("claude_elo_estimate")) this.db.run("ALTER TABLE games RENAME COLUMN claude_elo_estimate TO ai_elo_estimate");
    // Engine setup and search data came later. Another process may be adding them at the same moment.
    for (const column of ["ai_setup", "search_log"]) {
      if (columns.has(column)) continue;
      try {
        this.db.run(`ALTER TABLE games ADD COLUMN ${column} TEXT`);
      } catch (err) {
        if (!String(err).includes("duplicate column")) throw err;
      }
    }
  }

  create(game: { aiColor: Color; white: string; black: string }): GameRecord {
    const row = this.db
      .query<GameRow, [Color, string, string]>(
        `INSERT INTO games (status, ai_color, white, black) VALUES ('in_progress', ?, ?, ?) RETURNING ${GAME_COLUMNS}`,
      )
      .get(game.aiColor, game.white, game.black)!;
    return toRecord(row, []);
  }

  updateMoves(id: number, sanMoves: string[], pgn: string): void {
    this.db.query("UPDATE games SET san_moves = ?, pgn = ? WHERE id = ?").run(JSON.stringify(sanMoves), pgn, id);
  }

  finish(
    id: number,
    data: {
      status: "finished" | "aborted";
      result: GameResult | null;
      termination: Termination | null;
      sanMoves: string[];
      pgn: string;
      error: string | null;
      ratingBefore: number | null;
      ratingAfter: number | null;
      searchLog?: (MoveSearch | null)[];
      aiSetup?: EngineSetup | null;
    },
  ): void {
    this.db
      .query(
        `UPDATE games SET status = ?, result = ?, termination = ?, san_moves = ?, pgn = ?, error = ?,
         rating_before = ?, rating_after = ?, search_log = ?, ai_setup = ?,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
      .run(
        data.status,
        data.result,
        data.termination,
        JSON.stringify(data.sanMoves),
        data.pgn,
        data.error,
        data.ratingBefore,
        data.ratingAfter,
        data.searchLog ? JSON.stringify(data.searchLog) : null,
        data.aiSetup ? JSON.stringify(data.aiSetup) : null,
        id,
      );
  }

  saveAnalysis(id: number, analysis: GameAnalysis, aiEloEstimate: number): void {
    this.db
      .query("UPDATE games SET analysis = ?, ai_elo_estimate = ? WHERE id = ?")
      .run(JSON.stringify(analysis), aiEloEstimate, id);
  }

  get(id: number): GameRecord | null {
    const row = this.db.query<GameRow, [number]>(`SELECT ${GAME_COLUMNS} FROM games WHERE id = ?`).get(id);
    if (!row) return null;
    const reports = this.db.query<ReportRow, [number]>("SELECT * FROM agent_reports WHERE game_id = ?").all(id);
    return toRecord(row, reports);
  }

  list(sort: GameSort = "date", order: SortOrder = "desc"): GameRecord[] {
    const dir = order === "asc" ? "ASC" : "DESC";
    // Games without an estimate sort last either way.
    const orderBy =
      sort === "elo"
        ? `ai_elo_estimate IS NULL, ai_elo_estimate ${dir}, id ${dir}`
        : `created_at ${dir}, id ${dir}`;
    const reports = Map.groupBy(this.db.query<ReportRow, []>("SELECT * FROM agent_reports").all(), (r) => r.game_id);
    return this.db
      .query<GameRow, []>(`SELECT ${GAME_COLUMNS} FROM games ORDER BY ${orderBy}`)
      .all()
      .map((row) => toRecord(row, reports.get(row.id) ?? []));
  }

  /** Each engine's own search for each ply of a game, or null if it wasn't recorded. */
  searchLog(id: number): (MoveSearch | null)[] | null {
    const row = this.db.query<{ search_log: string | null }, [number]>("SELECT search_log FROM games WHERE id = ?").get(id);
    return row?.search_log ? JSON.parse(row.search_log) : null;
  }

  /** Save an agent's report on a game, replacing its earlier one. */
  saveAgentReport(report: AgentReport): void {
    const { gameId, agent, createdAt, ...content } = report;
    this.db
      .query(
        `INSERT INTO agent_reports (game_id, agent, created_at, report) VALUES (?, ?, ?, ?)
         ON CONFLICT (game_id, agent) DO UPDATE SET created_at = excluded.created_at, report = excluded.report`,
      )
      .run(gameId, agent, createdAt, JSON.stringify(content));
  }

  /** Whether a game is being played right now, by the server or a match script. Older rows are left over from crashes. */
  hasRecentGameInProgress(): boolean {
    return !!this.db
      .query("SELECT 1 FROM games WHERE status = 'in_progress' AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')")
      .get();
  }

  /** The colour our AI played in the most recent finished game, if any. Aborted games don't count. */
  lastAiColor(): Color | null {
    const row = this.db
      .query<{ ai_color: Color }, []>("SELECT ai_color FROM games WHERE status = 'finished' ORDER BY id DESC LIMIT 1")
      .get();
    return row?.ai_color ?? null;
  }

  latestRating(): number | null {
    const row = this.db
      .query<{ rating_after: number }, []>(
        "SELECT rating_after FROM games WHERE status = 'finished' AND rating_after IS NOT NULL ORDER BY id DESC LIMIT 1",
      )
      .get();
    return row?.rating_after ?? null;
  }

  /** Games left in progress by a crash or restart cannot be resumed; mark them aborted. */
  abortStale(): number {
    return this.db
      .query("UPDATE games SET status = 'aborted', error = 'server stopped during game' WHERE status = 'in_progress'")
      .run().changes;
  }

  close(): void {
    this.db.close();
  }
}

function toRecord(row: GameRow, reports: ReportRow[]): GameRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    status: row.status,
    aiColor: row.ai_color,
    white: row.white,
    black: row.black,
    result: row.result,
    termination: row.termination,
    sanMoves: JSON.parse(row.san_moves),
    pgn: row.pgn,
    aiEloEstimate: row.ai_elo_estimate,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    error: row.error,
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    aiSetup: row.ai_setup ? JSON.parse(row.ai_setup) : null,
    agentReports: reports
      .map((r) => ({ gameId: r.game_id, agent: r.agent, createdAt: r.created_at, ...JSON.parse(r.report) }))
      .sort((a, b) => AGENT_NAMES.indexOf(a.agent) - AGENT_NAMES.indexOf(b.agent)),
  };
}
