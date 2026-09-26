/** Minimal UCI client. The transport is abstracted so tests can drive a fake engine. */

export interface UciTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** Called once if the engine process exits unexpectedly. Optional for in-memory transports. */
  onExit?(listener: (error: Error) => void): void;
  /** What the process wrote to stderr as it started. Optional for in-memory transports. */
  startupLog?(): string;
  close(): void;
}

export interface Score {
  /** Centipawns from the side-to-move's point of view, or null if a mate score. */
  cp: number | null;
  /** Moves to mate (positive: side to move mates), or null. */
  mate: number | null;
}

/** One "info ... score ..." line. */
export interface SearchInfo {
  depth: number;
  seldepth: number | null;
  multipv: number;
  score: Score;
  /** Win/draw/loss in per mille from the side to move's point of view, for engines that report it. */
  wdl: [number, number, number] | null;
  nodes: number | null;
  nps: number | null;
  timeMs: number | null;
  /** Principal variation in UCI notation. */
  pv: string[];
}

/** A root move from Lc0's VerboseMoveStats output. */
export interface MoveStat {
  /** In UCI notation. */
  move: string;
  visits: number;
  /** Policy prior, 0-100. */
  policy: number;
  /** Expected score from the side to move's point of view, -1 to 1; null if never visited. */
  q: number | null;
}

export interface SearchResult {
  bestMove: string | null;
  /** Score and depth of the principal line (multipv 1). */
  score: Score | null;
  depth: number;
  /** The principal line's last info line. */
  info: SearchInfo | null;
  /** The last info line of each multipv line, best first. */
  lines: SearchInfo[];
  /** Lc0's root move statistics, when its VerboseMoveStats option is on. */
  moveStats: MoveStat[];
}

export type EngineOptions = Record<string, string | number | boolean>;

export class UciEngine {
  private listeners = new Set<(line: string) => void>();
  private exitListeners = new Set<(error: Error) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Set once the engine process has died; every later request fails with it. */
  deadError: Error | null = null;
  /** From the UCI handshake: the engine's name ("id name ...") and its "option name ..." lines. */
  name: string | null = null;
  optionLines: string[] = [];

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

  /** What the engine wrote to stderr as it started, e.g. which network Lc0 loaded. */
  get startupLog(): string {
    return this.transport.startupLog?.() ?? "";
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
    // Fail before registering any waiters once the engine is dead, so nothing is left unobserved.
    const guarded = () => (this.deadError ? Promise.reject(this.deadError) : fn());
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => undefined);
    return run;
  }

  init(timeoutMs = 30_000): Promise<void> {
    return this.exclusive(async () => {
      const ok = this.waitFor((l) => l.trim() === "uciok", timeoutMs);
      this.send("uci");
      const lines = await ok;
      this.name = lines.find((l) => l.startsWith("id name "))?.slice("id name ".length).trim() || null;
      this.optionLines = lines.filter((l) => l.startsWith("option name "));
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

  /**
   * Search a position until the first of the given limits is reached (`movetimeMs`, `depth`, `nodes`; 1 s if none).
   * With `moves` (UCI), the position is `fen`
   * followed by those moves, which lets the engine see the game's history: Lc0 feeds it to its network, reuses
   * its search tree from the previous move, and both engines know which positions have already occurred.
   */
  search(fen: string, limit: { movetimeMs?: number; depth?: number; nodes?: number }, moves: string[] = []): Promise<SearchResult> {
    return this.exclusive(async () => {
      const goArgs =
        [
          limit.depth != null && `depth ${limit.depth}`,
          limit.nodes != null && `nodes ${limit.nodes}`,
          limit.movetimeMs != null && `movetime ${limit.movetimeMs}`,
        ]
          .filter(Boolean)
          .join(" ") || "movetime 1000";
      const timeout = (limit.movetimeMs ?? 0) + 60_000;
      const done = this.waitFor((l) => l.startsWith("bestmove"), timeout);
      this.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(" ")}` : ""}`);
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

/** Parse an "info" line that carries an exact score. Other lines (and bound-only scores) give null. */
export function parseInfoLine(line: string): SearchInfo | null {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(/\s+/);
  if (tokens[1] === "string") return null;
  const num = (i: number) => (tokens[i] !== undefined && Number.isFinite(Number(tokens[i])) ? Number(tokens[i]) : null);
  let score: Score | null = null;
  const info: Omit<SearchInfo, "score"> = { depth: 0, seldepth: null, multipv: 1, wdl: null, nodes: null, nps: null, timeMs: null, pv: [] };
  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case "depth":
        info.depth = num(++i) ?? 0;
        break;
      case "seldepth":
        info.seldepth = num(++i);
        break;
      case "multipv":
        info.multipv = num(++i) ?? 1;
        break;
      case "nodes":
        info.nodes = num(++i);
        break;
      case "nps":
        info.nps = num(++i);
        break;
      case "time":
        info.timeMs = num(++i);
        break;
      case "score": {
        const kind = tokens[++i];
        const value = num(++i);
        if (value === null) return null;
        // Ignore bound-only scores; they are not exact.
        if (tokens[i + 1] === "lowerbound" || tokens[i + 1] === "upperbound") return null;
        score = kind === "mate" ? { cp: null, mate: value } : { cp: value, mate: null };
        break;
      }
      case "wdl": {
        const [w, d, l] = [num(i + 1), num(i + 2), num(i + 3)];
        if (w !== null && d !== null && l !== null) info.wdl = [w, d, l];
        i += 3;
        break;
      }
      case "pv":
        info.pv = tokens.slice(i + 1).filter(Boolean);
        i = tokens.length;
        break;
    }
  }
  return score ? { ...info, score } : null;
}

/** Lc0's VerboseMoveStats lines, e.g. "info string c3d5  (491 ) N:      21 (+ 3) (P: 22.81%) (WL: ...) ... (Q:  0.15261) ...". */
export function parseMoveStatLine(line: string): MoveStat | null {
  const m = /^info string ([a-h][1-8][a-h][1-8][qrbn]?)\s+\(\s*\d+\s*\)\s+N:\s+(\d+)\b.*?\(P:\s*([\d.]+)%\)(?:.*?\(Q:\s*(-?[\d.]+)\))?/.exec(line);
  if (!m) return null;
  const visits = Number(m[2]);
  return { move: m[1]!, visits, policy: Number(m[3]), q: visits > 0 && m[4] !== undefined ? Number(m[4]) : null };
}

export function parseSearchOutput(lines: string[]): SearchResult {
  const byPv = new Map<number, SearchInfo>();
  const stats = new Map<string, MoveStat>();
  let bestMove: string | null = null;
  for (const line of lines) {
    const info = parseInfoLine(line);
    if (info) byPv.set(info.multipv, info);
    const stat = parseMoveStatLine(line);
    if (stat) stats.set(stat.move, stat);
    if (line.startsWith("bestmove")) {
      const move = line.split(/\s+/)[1];
      bestMove = move && move !== "(none)" ? move : null;
    }
  }
  const info = byPv.get(1) ?? null;
  return {
    bestMove,
    score: info?.score ?? null,
    depth: info?.depth ?? 0,
    info,
    lines: [...byPv.values()].sort((a, b) => a.multipv - b.multipv),
    moveStats: [...stats.values()].sort((a, b) => b.visits - a.visits || b.policy - a.policy),
  };
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
