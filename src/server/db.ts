import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Color, GameAnalysis, GameRecord, GameResult, GameStatus, Termination } from "../shared/types.ts";

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
}

export class GameStore {
  private db: Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
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
      analysis TEXT
    )`);
    this.migrate();
  }

  /** Databases from when our AI was Claude used claude_* column names. */
  private migrate(): void {
    const columns = new Set(this.db.query<{ name: string }, []>("PRAGMA table_info(games)").all().map((c) => c.name));
    if (columns.has("claude_color")) this.db.run("ALTER TABLE games RENAME COLUMN claude_color TO ai_color");
    if (columns.has("claude_elo_estimate")) this.db.run("ALTER TABLE games RENAME COLUMN claude_elo_estimate TO ai_elo_estimate");
  }

  create(game: { aiColor: Color; white: string; black: string }): GameRecord {
    const row = this.db
      .query<GameRow, [Color, string, string]>(
        "INSERT INTO games (status, ai_color, white, black) VALUES ('in_progress', ?, ?, ?) RETURNING *",
      )
      .get(game.aiColor, game.white, game.black)!;
    return toRecord(row);
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
    },
  ): void {
    this.db
      .query(
        `UPDATE games SET status = ?, result = ?, termination = ?, san_moves = ?, pgn = ?, error = ?,
         rating_before = ?, rating_after = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
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
        id,
      );
  }

  saveAnalysis(id: number, analysis: GameAnalysis, aiEloEstimate: number): void {
    this.db
      .query("UPDATE games SET analysis = ?, ai_elo_estimate = ? WHERE id = ?")
      .run(JSON.stringify(analysis), aiEloEstimate, id);
  }

  get(id: number): GameRecord | null {
    const row = this.db.query<GameRow, [number]>("SELECT * FROM games WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  list(sort: GameSort = "date", order: SortOrder = "desc"): GameRecord[] {
    const dir = order === "asc" ? "ASC" : "DESC";
    // Games without an estimate sort last either way.
    const orderBy =
      sort === "elo"
        ? `ai_elo_estimate IS NULL, ai_elo_estimate ${dir}, id ${dir}`
        : `created_at ${dir}, id ${dir}`;
    return this.db.query<GameRow, []>(`SELECT * FROM games ORDER BY ${orderBy}`).all().map(toRecord);
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

function toRecord(row: GameRow): GameRecord {
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
  };
}
