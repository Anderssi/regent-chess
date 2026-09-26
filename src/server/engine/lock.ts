import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lc0 shares one GPU. Scripts that run Lc0 for a long time (match batches, benchmarks, the agents' probe)
 * hold this file while they do, so their measurements don't slow each other down.
 */
export const LC0_LOCK_PATH = join(import.meta.dir, "../../../data/lc0.lock");

export interface Lc0Lock {
  pid: number;
  since: string;
  what: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The lock held by another live process, if any. Locks left by dead processes don't count. */
export function lc0LockHolder(path = LC0_LOCK_PATH): Lc0Lock | null {
  if (!existsSync(path)) return null;
  try {
    const lock = JSON.parse(readFileSync(path, "utf8")) as Lc0Lock;
    return lock.pid !== process.pid && isAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

/** Run `fn` holding the Lc0 lock. Fails straight away if another live process holds it. */
export async function withLc0Lock<T>(what: string, fn: () => Promise<T>, path = LC0_LOCK_PATH): Promise<T> {
  const holder = lc0LockHolder(path);
  if (holder) throw new Error(`Lc0 is in use by pid ${holder.pid} (${holder.what}) since ${holder.since}`);
  writeFileSync(path, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), what } satisfies Lc0Lock));
  const release = () => {
    try {
      if ((JSON.parse(readFileSync(path, "utf8")) as Lc0Lock).pid === process.pid) rmSync(path);
    } catch {}
  };
  const onSignal = () => {
    release();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await fn();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    release();
  }
}
