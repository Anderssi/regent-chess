import type { PixelTarget } from "./pixels.ts";

/** Small drawing helpers shared by the scene renderer and the sky objects. */

/** Deterministic pseudo-random number in [0, 1) from integers. */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v + 0x9e3779b9), 16777619);
  // Final avalanche, so neighbouring inputs don't land on visible lines (e.g. rows of stars).
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Blend two "#rrggbb" colours; amount 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function fillCircle(t: PixelTarget, cx: number, cy: number, r: number, color: string): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    t.fillRect(cx - half, cy + dy, half * 2, 1, color);
  }
}
