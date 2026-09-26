/**
 * Deep-space scenery behind the board: Mars, a black hole, a small ringed planet and moon (placed in
 * the empty corners around the diamond-shaped board), and a spaceship that now and then flies across.
 */
import type { PixelTarget } from "./pixels.ts";
import { fillCircle, hash, mix } from "./util.ts";

export interface SpherePalette {
  /** Darkest to lightest. */
  ramp: string[];
}

export interface CosmosPalette {
  mars: SpherePalette & { cap: string; marking: string };
  planet: SpherePalette & { ring: string; ringShade: string };
  moon: SpherePalette;
  blackHole: { hot: string; warm: string; cool: string; glow: string };
  ship: { hull: string; shade: string; window: string; flame: string[] };
}

/** 2×2 ordered-dither thresholds, so shading steps blend like hand-dithered pixel art. */
const BAYER = [
  [0, 0.5],
  [0.75, 0.25],
];

/**
 * A lit sphere, light from the upper left. `surface` can darken (+1 step) or recolour a pixel from
 * its normal and longitude (for markings, ice caps); longitude turns with `spin` so planets rotate.
 */
function drawSphere(
  t: PixelTarget,
  cx: number,
  cy: number,
  r: number,
  ramp: string[],
  spin: number,
  surface?: (lon: number, ny: number) => { darken?: number; color?: string } | null,
): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = (dx + 0.5) / r;
      const ny = (dy + 0.5) / r;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const light = Math.max(0, Math.min(1, 0.15 + nz * 0.55 - nx * 0.45 - ny * 0.3));
      let step = light * (ramp.length - 1) + BAYER[(dy + r) & 1]![(dx + r) & 1]! - 0.375;
      const feature = surface?.(Math.atan2(nx, nz) + spin, ny);
      if (feature?.color && light > 0.25) {
        t.fillRect(cx + dx, cy + dy, 1, 1, light > 0.6 ? feature.color : mix(feature.color, ramp[0]!, 0.35));
        continue;
      }
      step -= feature?.darken ?? 0;
      t.fillRect(cx + dx, cy + dy, 1, 1, ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(step)))]!);
    }
  }
}

function drawMars(t: PixelTarget, p: CosmosPalette["mars"], x: number, y: number, r: number, time: number): void {
  // One turn every ~4 minutes: visible if you watch, never distracting.
  const spin = (time / 240_000) * Math.PI * 2;
  drawSphere(t, x, y, r, p.ramp, spin, (lon, ny) => {
    if (ny < -0.78) return { color: p.cap };
    // Dark basalt markings: coarse noise in longitude/latitude bands.
    const cell = hash(Math.floor(((lon % (Math.PI * 2)) + Math.PI * 2) * 2.2), Math.floor((ny + 1) * 3.5));
    return cell > 0.62 ? { darken: 1 } : null;
  });
}

function drawRingedPlanet(t: PixelTarget, p: CosmosPalette["planet"], x: number, y: number, r: number): void {
  const ring = (front: boolean) => {
    const rx = r * 2.1;
    const ry = r * 0.55;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      if (front !== dy >= 0) continue;
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const d = Math.hypot(dx / rx, dy / ry);
        if (d < 0.66 || d > 1) continue;
        // Behind the planet the ring is hidden by the sphere.
        if (!front && Math.hypot(dx, dy) < r) continue;
        t.fillRect(x + dx, y + dy, 1, 1, d > 0.8 && d < 0.86 ? p.ringShade : p.ring);
      }
    }
  };
  ring(false);
  drawSphere(t, x, y, r, p.ramp, 0, (_lon, ny) => (Math.floor((ny + 1) * 4) % 2 === 0 ? { darken: 1 } : null));
  ring(true);
}

/**
 * A black hole with its accretion disk seen almost edge-on: the back of the disk passes behind the
 * hole, the front across it, and light from the far side is bent into a bright arc over the top.
 */
function drawBlackHole(t: PixelTarget, p: CosmosPalette["blackHole"], x: number, y: number, r: number, time: number): void {
  const swirl = time / 1400;
  const rx = r * 3;
  const ry = r * 0.9;
  const disk = (front: boolean) => {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      if (front !== dy >= 0) continue;
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const d = Math.hypot(dx / rx, dy / ry);
        if (d < 0.42 || d > 1) continue;
        if (!front && Math.hypot(dx, dy) <= r) continue;
        // Hotter towards the middle; bright streaks travel around the disk.
        const angle = Math.atan2(dy / ry, dx / rx);
        const streak = 0.5 + 0.5 * Math.sin(angle * 3 - swirl + d * 9);
        const heat = (1 - d) * 1.6 + streak * 0.45 + BAYER[dy & 1]![dx & 1]! * 0.3;
        t.fillRect(x + dx, y + dy, 1, 1, heat > 1.1 ? p.hot : heat > 0.7 ? p.warm : p.cool);
      }
    }
  };
  fillCircle(t, x, y, Math.round(r * 2.2), p.glow);
  fillCircle(t, x, y, Math.round(r * 1.5), p.glow);
  disk(false);
  // Lensed image of the disk's far side: a thin bright arc hugging the top of the hole.
  for (let dx = -r - 2; dx <= r + 2; dx++) {
    const arc = Math.round(Math.sqrt(Math.max(0, (r + 2) ** 2 - dx * dx)));
    t.fillRect(x + dx, y - arc - 1, 1, 2, Math.abs(dx) < r * 0.6 ? p.hot : p.warm);
  }
  fillCircle(t, x, y, r, "#000000");
  disk(true);
}

/** The ship flies across once per period, alternating direction, at a different height each pass. */
const SHIP_PERIOD_MS = 24_000;
const SHIP_FLIGHT_MS = 7_000;

function drawShip(t: PixelTarget, p: CosmosPalette["ship"], time: number, width: number, height: number): void {
  const n = Math.floor(time / SHIP_PERIOD_MS);
  const elapsed = time - n * SHIP_PERIOD_MS;
  if (elapsed > SHIP_FLIGHT_MS) return;
  const dir = n % 2 === 0 ? 1 : -1;
  const progress = elapsed / SHIP_FLIGHT_MS;
  const span = width + 120;
  const x = Math.round(dir > 0 ? -60 + progress * span : width + 60 - progress * span);
  const y = Math.round(height * (0.06 + 0.28 * hash(n, 11)) + Math.sin(elapsed / 500) * 2);
  // Draw in ship space (nose towards +x), mirrored when flying left.
  const px = (dx: number, dy: number, w: number, h: number, color: string) =>
    t.fillRect(dir > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, color);
  // Engine trail, fading behind the ship
  const [core, outer] = p.flame;
  for (let k = 0; k < 16; k++) {
    const alpha = Math.round(200 * (1 - k / 16)).toString(16).padStart(2, "0");
    px(-4 - k * 3, 0, 3, k < 5 ? 2 : 1, (k < 3 ? core! : outer!) + alpha);
  }
  // Hull: a sleek wedge with a raised cockpit and a tail fin
  px(0, -1, 16, 3, p.hull);
  px(2, -2, 10, 1, p.hull);
  px(16, 0, 3, 1, p.hull);
  px(16, -1, 1, 1, p.hull);
  px(1, 1, 15, 1, p.shade);
  px(0, 2, 12, 1, p.shade);
  px(10, -3, 4, 2, p.window);
  px(11, -3, 1, 1, "#ffffff");
  px(1, -5, 3, 3, p.shade);
  px(-2, -1, 2, 3, core!);
}

/**
 * Scenery in board-scene coordinates (drawn before the board, so it only shows in the open corners).
 * `res` is the scene's pixels per art pixel.
 */
export function drawCosmos(t: PixelTarget, p: CosmosPalette, res: number, time: number): void {
  drawBlackHole(t, p.blackHole, 40 * res, 24 * res, 5 * res, time);
  drawMars(t, p.mars, 222 * res, 26 * res, 12 * res, time);
  drawRingedPlanet(t, p.planet, 24 * res, 135 * res, 6 * res);
  drawSphere(t, 240 * res, 140 * res, 4 * res, p.moon.ramp, 0);
}

/** The flyby, in canvas coordinates so it crosses the whole sky. */
export function drawFlyby(t: PixelTarget, p: CosmosPalette, time: number, width: number, height: number): void {
  if (time > 0) drawShip(t, p.ship, time, width, height);
}
