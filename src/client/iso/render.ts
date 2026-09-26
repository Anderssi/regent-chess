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
  /** Native canvas size; the sky fills it and the board is centred. Defaults to SCENE_W × SCENE_H. */
  width?: number;
  height?: number;
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
  return ((h >>> 0) % 10007) / 10007;
}

/** Stars drift slowly left; the nearer (bright) ones faster than the far ones. Pixels per second. */
const STAR_DRIFT = { near: 0.8, far: 0.35 };
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
  if (time > 0) drawShootingStar(t, theme, time, width, height);
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

function drawCandles(t: PixelTarget, theme: BoardTheme, time: number): void {
  const c = theme.candles;
  if (!c) return;
  CANDLES.forEach((candle, i) => {
    const bob = time > 0 ? Math.round(Math.sin(time / 700 + i * 1.7)) : 0;
    const x = candle.x;
    const y = candle.y + bob;
    // Glow
    t.fillRect(x - 4, y - 7, 11, 9, c.glow);
    t.fillRect(x - 2, y - 9, 7, 13, c.glow);
    // Wax with a shaded right edge and a drip
    t.fillRect(x, y, 3, candle.h, c.wax);
    t.fillRect(x + 2, y, 1, candle.h, c.waxShade);
    t.fillRect(x, y, 1, 3 + (i % 2), c.wax);
    t.fillRect(x - 1, y + 1, 1, 2, c.wax);
    // Flame: flickers between frames
    const frame = time > 0 ? Math.floor(time / 180 + i) % 3 : 0;
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

function drawSprite(t: PixelTarget, sprite: string[], palette: Record<SpriteKey, string>, x: number, y: number, mirror: boolean): void {
  sprite.forEach((line, dy) => {
    for (let dx = 0; dx < line.length; dx++) {
      const key = line[mirror ? line.length - 1 - dx : dx] as SpriteKey | ".";
      if (key !== ".") t.fillRect(x + dx, y + dy, 1, 1, palette[key]);
    }
  });
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
  const t = offsetTarget(target, Math.floor((width - SCENE_W) / 2), Math.floor((height - SCENE_H) / 2));
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
