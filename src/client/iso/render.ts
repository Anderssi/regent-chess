import type { BoardTheme, PieceCode, PieceType, SpriteKey, TilePalette } from "../theme.ts";
import { glyph } from "./font.ts";
import type { PixelTarget } from "./pixels.ts";

/** Native (unscaled) geometry of the isometric scene. */
export const TILE_W = 32;
export const TILE_H = 16;
export const SLAB_DEPTH = 12;
const MARGIN_X = 4;
/** Headroom above the back tile for the tallest sprite (the king). */
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 4;

export const SCENE_W = TILE_W * 8 + MARGIN_X * 2;
export const SCENE_H = MARGIN_TOP + TILE_H * 8 + SLAB_DEPTH + MARGIN_BOTTOM;
const ORIGIN_X = MARGIN_X + TILE_W * 4 - TILE_W / 2;
const ORIGIN_Y = MARGIN_TOP;

const FILES = "abcdefgh";

export interface SceneState {
  /** Board contents: rank 8 first, like chess.js `board()`. */
  board: ({ type: PieceType; color: "w" | "b" } | null)[][];
  orientation: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  /** Animation time in ms; 0 for a still frame. */
  time?: number;
  /** Native canvas size; the sky fills it. Defaults to SCENE_W × SCENE_H. */
  width?: number;
  height?: number;
  /** Top-left of the board scene within the canvas, in native pixels. Defaults to centred. */
  boardX?: number;
  boardY?: number;
}

/**
 * Screen grid position of a square: col runs left-to-right along one diagonal, row along the other.
 * From White's side, a8 is the top corner, a1 the left, h1 the bottom (nearest) and h8 the right.
 */
export function squareToGrid(square: string, orientation: "white" | "black"): { col: number; row: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

export function gridToSquare(col: number, row: number, orientation: "white" | "black"): string {
  return orientation === "white" ? `${FILES[col]}${8 - row}` : `${FILES[7 - col]}${row + 1}`;
}

/** Top-left of the tile's bounding box. */
export function tileOrigin(col: number, row: number): { x: number; y: number } {
  return { x: ORIGIN_X + (col - row) * (TILE_W / 2), y: ORIGIN_Y + (col + row) * (TILE_H / 2) };
}

/** Horizontal extent of a pixel-art diamond on row y (0..TILE_H-1): 2:1 steps, 2px flat corners. */
function diamondRow(y: number): [number, number] {
  const half = y < TILE_H / 2 ? 2 * (y + 1) : 2 * (TILE_H - y);
  return [TILE_W / 2 - half, 2 * half];
}

function fillDiamond(t: PixelTarget, x: number, y: number, color: string | ((dx: number) => string)): void {
  for (let dy = 0; dy < TILE_H; dy++) {
    const [start, width] = diamondRow(dy);
    if (typeof color === "string") t.fillRect(x + start, y + dy, width, 1, color);
    else {
      // Split at the centre so each half can have its own colour (slab faces).
      t.fillRect(x + start, y + dy, width / 2, 1, color(-1));
      t.fillRect(x + TILE_W / 2, y + dy, width / 2, 1, color(1));
    }
  }
}

/** Deterministic pseudo-random number in [0, 1) from integers. */
function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v + 0x9e3779b9), 16777619);
  // Final avalanche, so neighbouring inputs don't land on visible lines (e.g. rows of stars).
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Stars drift slowly left; the nearer (bright) ones faster than the far ones. Pixels per second. */
const STAR_DRIFT = { near: 2, far: 0.8 };
/** A shooting star crosses the sky once per period, taking SHOOTING_MS. */
const SHOOTING_PERIOD_MS = 9000;
const SHOOTING_MS = 700;

function drawSky(t: PixelTarget, theme: BoardTheme, time: number, width: number, height: number): void {
  const bands = theme.sky;
  const bandH = Math.ceil(height / bands.length);
  bands.forEach((color, i) => t.fillRect(0, i * bandH, width, bandH, color));
  // Keep the star density of the original scene when the sky is larger.
  const stars = Math.round((70 * width * height) / (SCENE_W * SCENE_H));
  for (let i = 0; i < stars; i++) {
    const bright = hash(i, 3) > 0.8;
    const drift = Math.floor((time / 1000) * (bright ? STAR_DRIFT.near : STAR_DRIFT.far));
    const x = (((Math.floor(hash(i, 1) * width) - drift) % width) + width) % width;
    const y = Math.floor(hash(i, 2) * height);
    const twinkle = time > 0 && hash(i, Math.floor(time / 600)) > 0.85;
    t.fillRect(x, y, 1, 1, bright && !twinkle ? theme.stars.bright : theme.stars.dim);
    if (bright && !twinkle && hash(i, 4) > 0.6) {
      t.fillRect(x - 1, y, 1, 1, theme.stars.dim);
      t.fillRect(x + 1, y, 1, 1, theme.stars.dim);
      t.fillRect(x, y - 1, 1, 1, theme.stars.dim);
      t.fillRect(x, y + 1, 1, 1, theme.stars.dim);
    }
  }
  drawMist(t, theme, time, width, height);
  if (time > 0) drawShootingStar(t, theme, time, width, height);
}

/** Faint clouds drifting right across the sky, each at its own height and speed (pixels per second). */
const MIST = [
  { y: 0.12, w: 90, h: 10, speed: 1.4, phase: 0.1 },
  { y: 0.3, w: 130, h: 14, speed: 0.9, phase: 0.55 },
  { y: 0.55, w: 70, h: 8, speed: 1.8, phase: 0.8 },
  { y: 0.78, w: 110, h: 12, speed: 1.1, phase: 0.35 },
];

function drawMist(t: PixelTarget, theme: BoardTheme, time: number, width: number, height: number): void {
  if (!theme.mist) return;
  for (const cloud of MIST) {
    // Wrap over the sky plus the cloud's own width, so it slides fully out before reappearing.
    const span = width + cloud.w;
    const left = Math.floor((cloud.phase * span + (time / 1000) * cloud.speed) % span) - cloud.w;
    const top = Math.floor(cloud.y * height);
    // A pixel-art lens: rows widen towards the middle, stacked twice for a denser core.
    for (let dy = 0; dy < cloud.h; dy++) {
      const bulge = 1 - Math.abs((dy + 0.5) / cloud.h - 0.5) * 2;
      const rowW = Math.round(cloud.w * (0.35 + 0.65 * Math.sqrt(bulge)));
      const x = left + Math.floor((cloud.w - rowW) / 2);
      t.fillRect(x, top + dy, rowW, 1, theme.mist);
      if (bulge > 0.5) t.fillRect(x + Math.floor(rowW / 4), top + dy, Math.floor(rowW / 2), 1, theme.mist);
    }
  }
}

function drawShootingStar(t: PixelTarget, theme: BoardTheme, time: number, width: number, height: number): void {
  const n = Math.floor(time / SHOOTING_PERIOD_MS);
  const elapsed = time - n * SHOOTING_PERIOD_MS;
  if (elapsed > SHOOTING_MS) return;
  // Falls down-left at the isometric 2:1 slope, starting somewhere in the upper sky.
  const startX = Math.floor(width * (0.3 + 0.6 * hash(n, 7)));
  const startY = Math.floor(height * 0.35 * hash(n, 8));
  const travel = Math.floor((elapsed / SHOOTING_MS) * 90);
  const headX = startX - travel;
  const headY = startY + Math.floor(travel / 2);
  for (let k = 0; k < 10; k++) {
    t.fillRect(headX + k * 2, headY - k, 2, 1, k < 3 ? theme.stars.bright : theme.stars.dim);
  }
}

const CANDLES = [
  { x: 30, y: 20, h: 9 },
  { x: 58, y: 34, h: 6 },
  { x: 86, y: 14, h: 7 },
  { x: SCENE_W - 90, y: 18, h: 8 },
  { x: SCENE_W - 60, y: 32, h: 6 },
  { x: SCENE_W - 32, y: 12, h: 9 },
];

/** Candles float on slow sine waves: up to FLOAT_PX up and down, with a smaller sideways sway. */
const FLOAT_PX = 3;

function drawCandles(t: PixelTarget, theme: BoardTheme, time: number): void {
  const c = theme.candles;
  if (!c) return;
  CANDLES.forEach((candle, i) => {
    // Each candle has its own period (4.5-6.5 s) and phase, so they drift independently.
    const period = 4500 + (i % 3) * 1000;
    const bob = time > 0 ? Math.round(FLOAT_PX * Math.sin((time / period) * 2 * Math.PI + i * 1.7)) : 0;
    const sway = time > 0 ? Math.round(Math.sin((time / (period * 1.7)) * 2 * Math.PI + i)) : 0;
    const x = candle.x + sway;
    const y = candle.y + bob;
    // Glow: breathes a pixel wider on alternate flame frames
    const frame = time > 0 ? Math.floor(time / 180 + i) % 3 : 0;
    const pulse = frame === 0 ? 1 : 0;
    t.fillRect(x - 4 - pulse, y - 7 - pulse, 11 + pulse * 2, 9 + pulse * 2, c.glow);
    t.fillRect(x - 2, y - 9, 7, 13, c.glow);
    // Wax with a shaded right edge and a drip
    t.fillRect(x, y, 3, candle.h, c.wax);
    t.fillRect(x + 2, y, 1, candle.h, c.waxShade);
    t.fillRect(x, y, 1, 3 + (i % 2), c.wax);
    t.fillRect(x - 1, y + 1, 1, 2, c.wax);
    // Flame: flickers between frames
    const [core, mid, outer] = c.flame;
    t.fillRect(x + 1, y - 4 + (frame === 2 ? 1 : 0), 1, 1, outer!);
    t.fillRect(x, y - 3, 3, 2, mid!);
    t.fillRect(x + (frame === 1 ? 0 : 1), y - 3, 1, 1, outer!);
    t.fillRect(x + 1, y - 2, 1, 2, core!);
  });
}

function drawSlab(t: PixelTarget, theme: BoardTheme): void {
  const { slab } = theme;
  for (let i = 0; i < 8; i++) {
    for (const [col, row] of [
      [i, 7],
      [7, i],
    ] as const) {
      const { x, y } = tileOrigin(col, row);
      for (let d = SLAB_DEPTH; d >= 1; d--) {
        const shade = (side: number) =>
          d === 1 ? (side < 0 ? slab.trim : slab.trimShade) : d === SLAB_DEPTH ? slab.bottom : side < 0 ? slab.left : slab.right;
        fillDiamond(t, x, y + d, shade);
      }
    }
  }
}

function drawCoordinates(t: PixelTarget, theme: BoardTheme, orientation: "white" | "black"): void {
  for (let i = 0; i < 8; i++) {
    // Files along the front-left face, ranks along the front-right face.
    const fileSquare = gridToSquare(i, 7, orientation);
    const rankSquare = gridToSquare(7, i, orientation);
    const left = tileOrigin(i, 7);
    const right = tileOrigin(7, i);
    // The slab face starts ~13px below the tile's top; centre the 5px glyph in what's left of it.
    const dy = 13 + Math.floor((SLAB_DEPTH - 7) / 2);
    drawGlyph(t, fileSquare[0]!, left.x + 7, left.y + dy, theme.slab.engraving);
    drawGlyph(t, rankSquare[1]!, right.x + 23, right.y + dy, theme.slab.engraving);
  }
}

function drawGlyph(t: PixelTarget, char: string, x: number, y: number, color: string): void {
  glyph(char)?.forEach((line, dy) => {
    for (let dx = 0; dx < line.length; dx++) if (line[dx] === "1") t.fillRect(x + dx, y + dy, 1, 1, color);
  });
}

function drawTile(t: PixelTarget, palette: TilePalette, col: number, row: number): void {
  const { x, y } = tileOrigin(col, row);
  fillDiamond(t, x, y, palette.base);
  // Lit upper edges
  for (let dy = 0; dy < TILE_H / 2; dy++) {
    const [start, width] = diamondRow(dy);
    t.fillRect(x + start, y + dy, 2, 1, palette.edge);
    t.fillRect(x + start + width - 2, y + dy, 2, 1, palette.edge);
  }
  // Stone speckles
  for (let i = 0; i < 6; i++) {
    const dy = 2 + Math.floor(hash(col, row, i) * (TILE_H - 4));
    const [start, width] = diamondRow(dy);
    const dx = start + 2 + Math.floor(hash(row, col, i, 9) * Math.max(1, width - 4));
    t.fillRect(x + dx, y + dy, hash(i, col, row) > 0.5 ? 2 : 1, 1, palette.speckle);
  }
}

/**
 * Draws a sprite with procedural lighting so pieces read as rounded solids. The light comes from the
 * upper left in screen space (so mirrored sprites are lit the same way). Across each row the body
 * runs highlight → base → shade → deep shade like a lit cylinder (trim more gently, so it keeps its
 * colour); body surfaces facing up catch extra light, and the lowest rows darken near the board.
 * Outline, shadow (d) and glow (e) pixels keep their flat colours.
 */
function drawSprite(t: PixelTarget, sprite: string[], palette: Record<SpriteKey, string>, x: number, y: number, mirror: boolean): void {
  const rows = sprite.map((line) => (mirror ? [...line].reverse().join("") : line));
  const ramps = lightingRamps(palette);
  const bottom = rows.length - 1;
  rows.forEach((line, dy) => {
    let first = -1;
    let last = -1;
    for (let dx = 0; dx < line.length; dx++) {
      if (SHADED.has(line[dx]!)) {
        if (first < 0) first = dx;
        last = dx;
      }
    }
    for (let dx = 0; dx < line.length; dx++) {
      const key = line[dx] as SpriteKey | ".";
      if (key === ".") continue;
      if (!SHADED.has(key)) {
        t.fillRect(x + dx, y + dy, 1, 1, palette[key]);
        continue;
      }
      // Position across the lit body, 0 = left edge, 1 = right edge.
      const u = last > first ? (dx - first) / (last - first) : 0.5;
      let step = u < 0.18 ? 0 : u < 0.42 ? 1 : u < 0.7 ? 2 : u < 0.88 ? 3 : 4;
      // Upward-facing body surfaces catch the light; trim (crowns, bands) keeps its colour.
      if (key !== "a" && (rows[dy - 1]?.[dx] === "o" || rows[dy - 1]?.[dx] === ".")) step -= 1;
      if (dy >= bottom - 2) step += 1;
      const ramp = key === "a" ? ramps.accent : ramps.body;
      t.fillRect(x + dx, y + dy, 1, 1, ramp[Math.max(0, Math.min(ramp.length - 1, step))]!);
    }
  });
}

/** Sprite keys that get lit; h and s are treated as body, since the lighting replaces them. */
const SHADED = new Set(["b", "h", "s", "a"]);

const rampCache = new WeakMap<Record<SpriteKey, string>, { body: string[]; accent: string[] }>();

/** Five-step colour ramps, brightest first, built from a piece palette. */
function lightingRamps(palette: Record<SpriteKey, string>): { body: string[]; accent: string[] } {
  let ramps = rampCache.get(palette);
  if (!ramps) {
    const { h, b, s, a, o } = palette;
    ramps = {
      body: [h, mix(h, b, 0.5), b, s, mix(s, o, 0.45)],
      accent: [mix(a, "#ffffff", 0.25), a, a, mix(a, o, 0.25), mix(a, o, 0.45)],
    };
    rampCache.set(palette, ramps);
  }
  return ramps;
}

/** Blend two "#rrggbb" colours; amount 0 = a, 1 = b. */
function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Where a piece standing on this grid cell is drawn: sprite's top-left, given its height. */
export function spriteOrigin(col: number, row: number, height: number): { x: number; y: number } {
  const { x, y } = tileOrigin(col, row);
  return { x: x + TILE_W / 2 - 8, y: y + TILE_H / 2 + 4 - height };
}

export function renderScene(target: PixelTarget, theme: BoardTheme, state: SceneState): void {
  const time = state.time ?? 0;
  const width = state.width ?? SCENE_W;
  const height = state.height ?? SCENE_H;
  drawSky(target, theme, time, width, height);
  const t = offsetTarget(target, state.boardX ?? Math.floor((width - SCENE_W) / 2), state.boardY ?? Math.floor((height - SCENE_H) / 2));
  drawCandles(t, theme, time);
  drawSlab(t, theme);
  drawCoordinates(t, theme, state.orientation);

  const highlights = new Map<string, string>();
  if (state.lastMove) {
    highlights.set(state.lastMove.from, theme.highlight.lastMove);
    highlights.set(state.lastMove.to, theme.highlight.lastMove);
  }
  if (state.checkSquare) highlights.set(state.checkSquare, theme.highlight.check);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = gridToSquare(col, row, state.orientation);
      const light = (FILES.indexOf(square[0]!) + Number(square[1])) % 2 === 1;
      drawTile(t, light ? theme.tiles.light : theme.tiles.dark, col, row);
      const hl = highlights.get(square);
      if (hl) {
        const { x, y } = tileOrigin(col, row);
        fillDiamond(t, x, y, hl);
      }
    }
  }

  // Pieces back to front, so nearer pieces overlap farther ones.
  for (let depth = 0; depth <= 14; depth++) {
    for (let col = 0; col <= depth; col++) {
      const row = depth - col;
      if (col > 7 || row > 7) continue;
      const square = gridToSquare(col, row, state.orientation);
      const piece = state.board[8 - Number(square[1])]![FILES.indexOf(square[0]!)];
      if (!piece) continue;
      const sprite = theme.sprites[piece.type];
      const { x: tx, y: ty } = tileOrigin(col, row);
      // Shadow
      t.fillRect(tx + 10, ty + 10, 12, 2, theme.shadow);
      t.fillRect(tx + 12, ty + 12, 8, 1, theme.shadow);
      const origin = spriteOrigin(col, row, sprite.length);
      drawSprite(t, sprite, theme.pieces[piece.color], origin.x, origin.y, piece.color === "b" && theme.mirrorBlack);
    }
  }
}

function offsetTarget(t: PixelTarget, dx: number, dy: number): PixelTarget {
  if (dx === 0 && dy === 0) return t;
  return { fillRect: (x, y, w, h, color) => t.fillRect(x + dx, y + dy, w, h, color) };
}

export type { PieceCode };
