import { AGENT_NAMES, type AgentName, type AgentRun } from "../../shared/types.ts";

export interface AgentLaunchResult {
  ok: boolean;
  error?: string;
  /** The Claude Code session, for `claude --resume <id>`. */
  sessionId?: string;
  /** Claude Code's closing message. */
  summary?: string;
}

/** Runs the analysis agents on one game and resolves when they are done. */
export type AgentLauncher = (gameId: number) => Promise<AgentLaunchResult>;

export interface AgentRunnerOptions {
  launch: AgentLauncher;
  /** Agents that have saved a report on the game since `since` (an ISO timestamp). */
  reportsSince: (gameId: number, since: string) => AgentName[];
  log?: (message: string) => void;
  now?: () => Date;
}

/**
 * Queues agent analyses and runs them one game at a time. Only unfinished and failed runs are kept here;
 * a successful run leaves its reports in the database.
 */
export class AgentRunner {
  private queue: number[] = [];
  private runs = new Map<number, AgentRun>();
  private draining: Promise<void> | null = null;

  constructor(private opts: AgentRunnerOptions) {}

  /** Queue a game. A game that is already queued or running keeps its place. */
  enqueue(gameId: number): AgentRun {
    const current = this.runs.get(gameId);
    if (current && current.status !== "failed") return current;
    const run: AgentRun = { status: "queued", since: this.now() };
    this.runs.set(gameId, run);
    this.queue.push(gameId);
    this.draining ??= this.drain();
    return run;
  }

  run(gameId: number): AgentRun | null {
    return this.runs.get(gameId) ?? null;
  }

  /** Resolves once the queue is empty. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    for (let gameId = this.queue.shift(); gameId !== undefined; gameId = this.queue.shift()) {
      const since = this.now();
      this.runs.set(gameId, { status: "running", since });
      this.log(`Agent analysis of game ${gameId} started`);
      let failure: Omit<AgentRun, "status" | "since"> | null = null;
      try {
        const result = await this.opts.launch(gameId);
        const saved = this.opts.reportsSince(gameId, since);
        const missing = AGENT_NAMES.filter((agent) => !saved.includes(agent));
        if (!result.ok) failure = { error: result.error ?? "Claude Code failed", sessionId: result.sessionId };
        else if (missing.length) failure = { error: `Claude Code finished without saving the ${missing.join(" and ")} report`, sessionId: result.sessionId };
      } catch (err) {
        failure = { error: err instanceof Error ? err.message : String(err) };
      }
      if (failure) {
        this.runs.set(gameId, { status: "failed", since: this.now(), ...failure });
        this.log(`Agent analysis of game ${gameId} failed: ${failure.error}${failure.sessionId ? ` (claude --resume ${failure.sessionId})` : ""}`);
      } else {
        this.runs.delete(gameId);
        this.log(`Agent analysis of game ${gameId} saved both reports`);
      }
    }
    // Cleared in the same tick the queue was found empty, so any game queued after this starts a new drain.
    this.draining = null;
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  private log(message: string): void {
    (this.opts.log ?? console.log)(message);
  }
}
