import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lc0LockHolder, withLc0Lock } from "../../src/server/engine/lock.ts";

const dir = mkdtempSync(join(tmpdir(), "lc0-lock-"));
const path = join(dir, "lc0.lock");
afterEach(() => rmSync(path, { force: true }));

describe("Lc0 lock", () => {
  test("is held while the work runs and released afterwards, even when it fails", async () => {
    await withLc0Lock("test run", async () => {
      const lock = JSON.parse(readFileSync(path, "utf8"));
      expect(lock).toMatchObject({ pid: process.pid, what: "test run" });
      expect(Date.parse(lock.since)).not.toBeNaN();
    }, path);
    expect(existsSync(path)).toBe(false);
    await expect(withLc0Lock("failing run", async () => { throw new Error("boom"); }, path)).rejects.toThrow("boom");
    expect(existsSync(path)).toBe(false);
  });

  test("refuses while another live process holds it", async () => {
    const other = Bun.spawn(["sleep", "5"]);
    try {
      writeFileSync(path, JSON.stringify({ pid: other.pid, since: "2026-09-26T08:00:00.000Z", what: "match batch" }));
      expect(lc0LockHolder(path)?.what).toBe("match batch");
      await expect(withLc0Lock("bench", async () => "ran", path)).rejects.toThrow(`Lc0 is in use by pid ${other.pid} (match batch)`);
      expect(existsSync(path)).toBe(true);
    } finally {
      other.kill();
    }
  });

  test("ignores a lock left behind by a process that has exited", async () => {
    const dead = Bun.spawn(["true"]);
    await dead.exited;
    writeFileSync(path, JSON.stringify({ pid: dead.pid, since: "2026-09-26T08:00:00.000Z", what: "crashed batch" }));
    expect(lc0LockHolder(path)).toBeNull();
    expect(await withLc0Lock("bench", async () => "ran", path)).toBe("ran");
  });
});
