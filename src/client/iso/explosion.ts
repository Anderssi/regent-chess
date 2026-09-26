/**
 * A pixel-art explosion for captures: a flash, a fireball that breaks up as it cools, sparks and bits
 * of the captured piece flung outwards under gravity, and smoke drifting up.
 */
import type { PixelTarget } from "./pixels.ts";
import { fillCircle, hash } from "./util.ts";

export interface ExplosionPalette {
  flash: string;
  hot: string;
  warm: string;
  ember: string;
  /** Translucent ("#rrggbbaa"). */
  smoke: string;
}

const ease = (x: number) => 1 - (1 - x) ** 3;

/**
 * A disc that loses chunks (`block`-pixel cells, matching the art's pixel size) as `fade` goes 0 → 1,
 * so it breaks up like cooling fire instead of dimming.
 */
function ditheredCircle(t: PixelTarget, cx: number, cy: number, r: number, color: string, fade: number, seed: number, block: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    for (let dx = -half; dx < half; dx++) {
      if (hash(Math.floor(dx / block), Math.floor(dy / block), seed) < fade) continue;
      t.fillRect(cx + dx, cy + dy, 1, 1, color);
    }
  }
}

/**
 * The explosion at (cx, cy), `progress` 0 → 1. `res` is scene pixels per art pixel; `seed` varies the
 * sparks per capture; `debris` are colours of the captured piece, for the fragments.
 */
export function drawExplosion(
  t: PixelTarget,
  p: ExplosionPalette,
  cx: number,
  cy: number,
  progress: number,
  res: number,
  seed: number,
  debris: string[],
): void {
  const q = Math.max(0, Math.min(1, progress));
  // Smoke, behind the fire: puffs that rise and spread late in the explosion
  if (q > 0.3) {
    const s = (q - 0.3) / 0.7;
    for (let i = 0; i < 4; i++) {
      const dx = Math.round((hash(i, seed, 1) - 0.5) * 16 * res);
      const rise = Math.round(s * (10 + 6 * hash(i, seed, 2)) * res);
      const r = Math.round((3 + 5 * s) * res);
      if (s < 0.85) fillCircle(t, cx + dx, cy - rise, r, p.smoke);
    }
  }
  // Fireball: grows fast, then breaks up from the outside in as it cools
  if (q < 0.65) {
    const f = q / 0.65;
    const r = Math.round((4 + 10 * ease(Math.min(1, f * 1.6))) * res);
    ditheredCircle(t, cx, cy, r, p.ember, f * 0.9, seed, res);
    ditheredCircle(t, cx, cy, Math.round(r * 0.75), p.warm, f * 0.95, seed + 1, res);
    ditheredCircle(t, cx, cy, Math.round(r * 0.45 * (1 - f * 0.6)), p.hot, f, seed + 2, res);
  }
  // Sparks and debris: fly out, arc down, wink out one by one
  const gravity = 30 * res;
  for (let i = 0; i < 22; i++) {
    const piece = i < 8;
    // Each particle has its own lifetime, all over before the explosion ends; debris lasts longer.
    const life = piece ? 0.55 + 0.44 * hash(i, seed, 3) : 0.3 + 0.6 * hash(i, seed, 3);
    if (q >= life) continue;
    const angle = hash(i, seed, 4) * Math.PI * 2;
    const speed = (piece ? 10 + 10 * hash(i, seed, 5) : 14 + 18 * hash(i, seed, 5)) * res;
    const x = cx + Math.round(Math.cos(angle) * speed * ease(q));
    const y = cy + Math.round(Math.sin(angle) * speed * 0.6 * ease(q) - 8 * res * q + gravity * q * q);
    const size = piece ? 2 * res : res;
    const color = piece ? debris[i % debris.length]! : q < 0.35 ? p.hot : q < 0.6 ? p.warm : p.ember;
    t.fillRect(x, y, size, size, color);
  }
  // Flash: the first instant, drawn last so the fireball and sparks emerge from it
  if (q < 0.07) fillCircle(t, cx, cy, Math.round((5 + 40 * q) * res), p.flash);
}
