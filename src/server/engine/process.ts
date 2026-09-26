import { existsSync } from "node:fs";
import { delimiter, join, sep } from "node:path";
import { UciEngine, type UciTransport } from "./uci.ts";

/**
 * Work out how to launch Stockfish:
 * 1. STOCKFISH_PATH (native binary), 2. `stockfish` on PATH, 3. the bundled WASM build run by node.
 * (The WASM build cannot run under Bun directly: it mistakes Bun for a browser worker.)
 */
export function resolveEngineCommand(env: Record<string, string | undefined> = process.env): string[] {
  if (env.STOCKFISH_PATH) return [env.STOCKFISH_PATH];
  const native = findNative("stockfish", env.PATH);
  if (native) return [native];
  const node = Bun.which("node", { PATH: env.PATH ?? "" });
  const wasmJs = join(import.meta.dir, "../../../node_modules/stockfish/bin/stockfish-19-lite-single.js");
  if (node && existsSync(wasmJs)) return [node, wasmJs];
  throw new Error(
    "No Stockfish engine found. Install stockfish (e.g. `brew install stockfish`), set STOCKFISH_PATH, or install Node.js to run the bundled WASM engine.",
  );
}

/**
 * Lc0's own default (0 = "backend suggested") is far slower on Apple's Metal backend: on an M2 Pro,
 * batches of 32 searched 3-7× more positions per second than the default, for every network tried.
 */
export const DEFAULT_LC0_MINIBATCH_SIZE = 32;

/**
 * Leela Chess Zero: LC0_PATH, else `lc0` on PATH. The Homebrew build (`brew install lc0`)
 * ships with a default network next to the binary, which Lc0 finds on its own; LC0_WEIGHTS
 * picks another. LC0_MINIBATCH_SIZE overrides the batch size (0 = Lc0's own default).
 */
export function resolveLc0Command(env: Record<string, string | undefined> = process.env): string[] {
  const binary = env.LC0_PATH || findNative("lc0", env.PATH);
  if (!binary) throw new Error("Leela Chess Zero (lc0) not found. Install it with `brew install lc0` or set LC0_PATH.");
  const args = [`--minibatch-size=${env.LC0_MINIBATCH_SIZE || DEFAULT_LC0_MINIBATCH_SIZE}`];
  if (env.LC0_WEIGHTS) args.push(`--weights=${env.LC0_WEIGHTS}`);
  return [binary, ...args];
}

/**
 * A binary on PATH, skipping node_modules/.bin: `bun run` puts that on PATH, and the npm stockfish
 * package's `stockfish` there is a wrapper script, not an engine (it needs a postinstall step Bun blocks).
 */
function findNative(name: string, path = ""): string | null {
  const dirs = path.split(delimiter).filter((dir) => dir && !dir.split(sep).includes("node_modules"));
  return Bun.which(name, { PATH: dirs.join(delimiter) });
}

export function spawnTransport(cmd: string[]): UciTransport {
  const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const listeners: ((line: string) => void)[] = [];
  const exitListeners: ((error: Error) => void)[] = [];
  // The head holds startup messages (Lc0 names its network and backend there); the tail goes into exit errors.
  let stderrHead = "";
  let stderrTail = "";
  (async () => {
    for await (const chunk of proc.stderr) {
      const text = new TextDecoder().decode(chunk);
      if (stderrHead.length < 4000) stderrHead = (stderrHead + text).slice(0, 4000);
      stderrTail = (stderrTail + text).slice(-2000);
    }
  })();
  proc.exited.then(async (code) => {
    await Bun.sleep(50); // let the last stderr output arrive
    const detail = stderrTail.trim() ? `: ${stderrTail.trim()}` : "";
    const error = new Error(`Engine process (${cmd.join(" ")}) exited with code ${code}${detail}`);
    for (const l of exitListeners) l(error);
  });
  (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        for (const l of listeners) l(line);
      }
    }
  })();
  return {
    write(line) {
      try {
        proc.stdin.write(line + "\n");
        proc.stdin.flush();
      } catch (err) {
        throw new Error(`Could not write to engine process (${cmd.join(" ")}): ${(err as Error).message}`);
      }
    },
    onExit(listener) {
      exitListeners.push(listener);
    },
    onLine(listener) {
      listeners.push(listener);
    },
    startupLog: () => stderrHead,
    close() {
      try {
        proc.stdin.end();
      } catch {}
      setTimeout(() => proc.kill(), 500).unref?.();
    },
  };
}

export async function launchEngine(cmd = resolveEngineCommand(), name = "Stockfish"): Promise<UciEngine> {
  const engine = new UciEngine(spawnTransport(cmd), `${name} (${cmd.join(" ")})`);
  try {
    await engine.init();
  } catch (err) {
    engine.quit();
    throw err;
  }
  return engine;
}

/** Analysis search threads and hash; Stockfish's own defaults (1 thread, 16 MB) make deep analysis slow. */
export const DEFAULT_ANALYSIS_THREADS = 4;
export const DEFAULT_ANALYSIS_HASH_MB = 256;

/**
 * A full-strength Stockfish for analysis, with ANALYSIS_THREADS and ANALYSIS_HASH_MB applied as far as the
 * engine allows (the bundled WASM build is single-threaded).
 */
export async function launchAnalysisEngine(env: Record<string, string | undefined> = process.env): Promise<UciEngine> {
  const engine = await launchEngine(resolveEngineCommand(env));
  const max = (option: string) => Number(/ max (\d+)/.exec(engine.optionLines.find((l) => l.startsWith(`option name ${option} `)) ?? "")?.[1] ?? 0);
  const threads = Math.min(Number(env.ANALYSIS_THREADS || DEFAULT_ANALYSIS_THREADS), max("Threads"));
  const hash = Math.min(Number(env.ANALYSIS_HASH_MB || DEFAULT_ANALYSIS_HASH_MB), max("Hash"));
  await engine.configure({ ...(threads > 1 && { Threads: threads }), ...(hash > 0 && { Hash: hash }) });
  return engine;
}

/**
 * Keeps one engine process alive: launches it on first use and relaunches it if it died
 * or a previous launch failed (a failed launch is not cached).
 */
export class EngineHandle {
  private current: Promise<UciEngine> | null = null;

  constructor(private launch: () => Promise<UciEngine> = () => launchEngine()) {}

  async get(): Promise<UciEngine> {
    if (this.current) {
      const engine = await this.current.catch(() => null);
      if (engine?.isAlive) return engine;
    }
    this.current = this.launch();
    return this.current;
  }

  async dispose(): Promise<void> {
    const engine = await this.current?.catch(() => null);
    engine?.quit();
  }
}
