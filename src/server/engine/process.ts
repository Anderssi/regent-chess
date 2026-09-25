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
  const native = findNativeStockfish(env.PATH);
  if (native) return [native];
  const node = Bun.which("node", { PATH: env.PATH ?? "" });
  const wasmJs = join(import.meta.dir, "../../../node_modules/stockfish/bin/stockfish-19-lite-single.js");
  if (node && existsSync(wasmJs)) return [node, wasmJs];
  throw new Error(
    "No Stockfish engine found. Install stockfish (e.g. `brew install stockfish`), set STOCKFISH_PATH, or install Node.js to run the bundled WASM engine.",
  );
}

/**
 * A `stockfish` binary on PATH, skipping node_modules/.bin: `bun run` puts that on PATH, and the npm
 * package's `stockfish` there is a wrapper script, not an engine (it needs a postinstall step Bun blocks).
 */
function findNativeStockfish(path = ""): string | null {
  const dirs = path.split(delimiter).filter((dir) => dir && !dir.split(sep).includes("node_modules"));
  return Bun.which("stockfish", { PATH: dirs.join(delimiter) });
}

export function spawnTransport(cmd: string[]): UciTransport {
  const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const listeners: ((line: string) => void)[] = [];
  const exitListeners: ((error: Error) => void)[] = [];
  let stderrTail = "";
  (async () => {
    for await (const chunk of proc.stderr) stderrTail = (stderrTail + new TextDecoder().decode(chunk)).slice(-2000);
  })();
  proc.exited.then(async (code) => {
    await Bun.sleep(50); // let the last stderr output arrive
    const detail = stderrTail.trim() ? `: ${stderrTail.trim()}` : "";
    const error = new Error(`Stockfish process (${cmd.join(" ")}) exited with code ${code}${detail}`);
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
        throw new Error(`Could not write to Stockfish process (${cmd.join(" ")}): ${(err as Error).message}`);
      }
    },
    onExit(listener) {
      exitListeners.push(listener);
    },
    onLine(listener) {
      listeners.push(listener);
    },
    close() {
      try {
        proc.stdin.end();
      } catch {}
      setTimeout(() => proc.kill(), 500).unref?.();
    },
  };
}

export async function launchEngine(cmd = resolveEngineCommand()): Promise<UciEngine> {
  const engine = new UciEngine(spawnTransport(cmd), `Stockfish (${cmd.join(" ")})`);
  try {
    await engine.init();
  } catch (err) {
    engine.quit();
    throw err;
  }
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
