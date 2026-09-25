/** Minimal UCI client. The transport is abstracted so tests can drive a fake engine. */

export interface UciTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** Called once if the engine process exits unexpectedly. Optional for in-memory transports. */
  onExit?(listener: (error: Error) => void): void;
  close(): void;
}

export interface Score {
  /** Centipawns from the side-to-move's point of view, or null if a mate score. */
  cp: number | null;
  /** Moves to mate (positive: side to move mates), or null. */
  mate: number | null;
}

export interface SearchResult {
  bestMove: string | null;
  score: Score | null;
  depth: number;
}

export type EngineOptions = Record<string, string | number | boolean>;

export class UciEngine {
  private listeners = new Set<(line: string) => void>();
  private exitListeners = new Set<(error: Error) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Set once the engine process has died; every later request fails with it. */
  deadError: Error | null = null;

  constructor(
    private transport: UciTransport,
    private label = "UCI engine",
  ) {
    transport.onLine((line) => {
      for (const l of [...this.listeners]) l(line);
    });
    transport.onExit?.((error) => {
      if (this.closed) return;
      this.deadError = error;
      for (const l of [...this.exitListeners]) l(error);
    });
  }

  get isAlive(): boolean {
    return this.deadError === null && !this.closed;
  }

  send(command: string): void {
    if (this.deadError) throw this.deadError;
    this.transport.write(command);
  }

  /** Resolve with the first line matching `predicate`, collecting all lines seen until then. */
  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (this.deadError) return reject(this.deadError);
      const seen: string[] = [];
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        this.exitListeners.delete(onExit);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.label} did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      const listener = (line: string) => {
        seen.push(line);
        if (predicate(line)) {
          cleanup();
          resolve(seen);
        }
      };
      const onExit = (error: Error) => {
        cleanup();
        reject(error);
      };
      this.listeners.add(listener);
      this.exitListeners.add(onExit);
    });
  }

  /** Serialise engine conversations: UCI engines handle one search at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  init(timeoutMs = 30_000): Promise<void> {
    return this.exclusive(async () => {
      const ok = this.waitFor((l) => l.trim() === "uciok", timeoutMs);
      this.send("uci");
      await ok;
      await this.readyUnlocked(timeoutMs);
    });
  }

  /** Equivalent of python-chess `engine.configure({...})`. */
  configure(options: EngineOptions): Promise<void> {
    return this.exclusive(async () => {
      for (const [name, value] of Object.entries(options)) {
        this.send(`setoption name ${name} value ${value}`);
      }
      await this.readyUnlocked(10_000);
    });
  }

  newGame(): Promise<void> {
    return this.exclusive(async () => {
      this.send("ucinewgame");
      await this.readyUnlocked(10_000);
    });
  }

  private async readyUnlocked(timeoutMs: number): Promise<void> {
    const ready = this.waitFor((l) => l.trim() === "readyok", timeoutMs);
    this.send("isready");
    await ready;
  }

  /** Search a position. Give either `movetimeMs` or `depth`. */
  search(fen: string, limit: { movetimeMs?: number; depth?: number }): Promise<SearchResult> {
    return this.exclusive(async () => {
      const goArgs = limit.depth != null ? `depth ${limit.depth}` : `movetime ${limit.movetimeMs ?? 1000}`;
      const timeout = (limit.movetimeMs ?? 0) + 60_000;
      const done = this.waitFor((l) => l.startsWith("bestmove"), timeout);
      this.send(`position fen ${fen}`);
      this.send(`go ${goArgs}`);
      return parseSearchOutput(await done);
    });
  }

  quit(): void {
    this.closed = true;
    try {
      this.send("quit");
    } finally {
      this.transport.close();
    }
  }
}

export function parseInfoLine(line: string): { depth: number; score: Score; multipv: number } | null {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(/\s+/);
  const idx = tokens.indexOf("score");
  if (idx < 0) return null;
  const depthIdx = tokens.indexOf("depth");
  const mpvIdx = tokens.indexOf("multipv");
  const kind = tokens[idx + 1];
  const value = Number(tokens[idx + 2]);
  if (!Number.isFinite(value)) return null;
  // Ignore bound-only scores; they are not exact.
  const bound = tokens[idx + 3];
  if (bound === "lowerbound" || bound === "upperbound") return null;
  const score: Score = kind === "mate" ? { cp: null, mate: value } : { cp: value, mate: null };
  return {
    depth: depthIdx >= 0 ? Number(tokens[depthIdx + 1]) : 0,
    score,
    multipv: mpvIdx >= 0 ? Number(tokens[mpvIdx + 1]) : 1,
  };
}

export function parseSearchOutput(lines: string[]): SearchResult {
  let score: Score | null = null;
  let depth = 0;
  let bestMove: string | null = null;
  for (const line of lines) {
    const info = parseInfoLine(line);
    if (info && info.multipv === 1) {
      score = info.score;
      depth = info.depth;
    }
    if (line.startsWith("bestmove")) {
      const move = line.split(/\s+/)[1];
      bestMove = move && move !== "(none)" ? move : null;
    }
  }
  return { bestMove, score, depth };
}

/** Convert a score to centipawns from the side-to-move's view, mapping mates to large values. */
export function scoreToCp(score: Score | null, mateValue = 100_000): number {
  if (!score) return 0;
  if (score.mate != null) {
    if (score.mate === 0) return -mateValue; // side to move is mated
    return score.mate > 0 ? mateValue - score.mate : -mateValue - score.mate;
  }
  return score.cp ?? 0;
}
