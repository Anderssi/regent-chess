import { describe, expect, test } from "bun:test";
import { EngineHandle, launchEngine, spawnTransport } from "../../src/server/engine/process.ts";
import { UciEngine } from "../../src/server/engine/uci.ts";

describe("engine process failures", () => {
  test("an engine that crashes fails fast, with its stderr in the error", async () => {
    const started = Date.now();
    const err = await launchEngine(["sh", "-c", "echo 'engine exploded' >&2; exit 3"]).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(err.message).toContain("exited with code 3");
    expect(err.message).toContain("engine exploded");
  });

  test("an engine that never answers times out, naming the command", async () => {
    const engine = new UciEngine(spawnTransport(["sleep", "30"]), "Stockfish (sleep 30)");
    await expect(engine.init(200)).rejects.toThrow("Stockfish (sleep 30) did not respond within 200ms");
    engine.quit();
  });

  test("a failed launch is retried on the next request instead of being cached", async () => {
    let attempts = 0;
    const handle = new EngineHandle(async () => {
      attempts++;
      if (attempts === 1) throw new Error("first launch failed");
      return launchEngine();
    });
    await expect(handle.get()).rejects.toThrow("first launch failed");
    const engine = await handle.get();
    expect(engine.isAlive).toBe(true);
    expect(await handle.get()).toBe(engine);
    await handle.dispose();
  }, 30_000);

  test("an engine that dies is replaced", async () => {
    const handle = new EngineHandle(() => launchEngine());
    const first = await handle.get();
    first.send("quit"); // the process exits on its own
    await Bun.sleep(500);
    expect(first.isAlive).toBe(false);
    const second = await handle.get();
    expect(second).not.toBe(first);
    expect((await second.search("8/8/8/8/8/8/8/K6k w - - 0 1", { depth: 2 })).bestMove).not.toBeNull();
    await handle.dispose();
  }, 30_000);
});

describe("resolveEngineCommand", () => {
  test("ignores the npm package's wrapper script that `bun run` puts on PATH", async () => {
    const { resolveEngineCommand } = await import("../../src/server/engine/process.ts");
    const { join } = await import("node:path");
    const binDir = join(import.meta.dir, "../../node_modules/.bin");
    const cmd = resolveEngineCommand({ PATH: `${binDir}:${process.env.PATH}` });
    expect(cmd.join(" ")).not.toContain("node_modules/.bin");
    const engine = await launchEngine(cmd);
    engine.quit();
  }, 30_000);

  test("STOCKFISH_PATH wins", async () => {
    const { resolveEngineCommand } = await import("../../src/server/engine/process.ts");
    expect(resolveEngineCommand({ STOCKFISH_PATH: "/opt/sf", PATH: "" })).toEqual(["/opt/sf"]);
  });
});
