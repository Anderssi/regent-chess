import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { PixelBuffer } from "../../src/client/iso/pixels.ts";
import { glyph } from "../../src/client/iso/font.ts";
import { gridToSquare, renderScene, SCENE_H, SCENE_W, spriteOrigin, squareToGrid, tileOrigin, TILE_W } from "../../src/client/iso/render.ts";
import { wizardTheme, type SpriteKey } from "../../src/client/theme.ts";

const render = (fen: string, orientation: "white" | "black" = "white", extra = {}) => {
  const buf = new PixelBuffer(SCENE_W, SCENE_H);
  renderScene(buf, wizardTheme, { board: new Chess(fen, { skipValidation: true }).board(), orientation, ...extra });
  return buf;
};

/** Pixels of the sprite for the piece on `square` that are drawn with the palette's outline colour. */
function spriteOutlineMatches(buf: PixelBuffer, square: string, type: keyof typeof wizardTheme.sprites, color: "w" | "b", orientation: "white" | "black" = "white") {
  const sprite = wizardTheme.sprites[type];
  const { col, row } = squareToGrid(square, orientation);
  const origin = spriteOrigin(col, row, sprite.length);
  const palette = wizardTheme.pieces[color];
  let total = 0;
  let matches = 0;
  sprite.forEach((line, dy) =>
    [...line].forEach((ch, dx) => {
      const mirrored = color === "b" && wizardTheme.mirrorBlack ? line[line.length - 1 - dx] : ch;
      if (mirrored === "o") {
        total++;
        if (buf.get(origin.x + dx, origin.y + dy) === palette.o) matches++;
      }
    }),
  );
  return matches / total;
}

describe("piece sprites", () => {
  test("every sprite is 16 pixels wide and uses only palette keys", () => {
    const keys = new Set<string>([".", ...(Object.keys(wizardTheme.pieces.w) as SpriteKey[])]);
    for (const [type, sprite] of Object.entries(wizardTheme.sprites)) {
      for (const line of sprite) {
        expect({ type, width: line.length }).toEqual({ type, width: 16 });
        for (const ch of line) expect(keys.has(ch)).toBe(true);
      }
    }
  });

  test("the coordinate font has every file and rank", () => {
    for (const ch of "abcdefgh12345678") expect(glyph(ch)).toHaveLength(5);
  });
});

describe("isometric geometry", () => {
  test("White's view: a8 at the top corner, h1 nearest the viewer", () => {
    expect(squareToGrid("a8", "white")).toEqual({ col: 0, row: 0 });
    expect(squareToGrid("h1", "white")).toEqual({ col: 7, row: 7 });
    expect(tileOrigin(7, 7).y).toBeGreaterThan(tileOrigin(0, 0).y);
  });

  test("Black's view is rotated 180 degrees", () => {
    expect(squareToGrid("h1", "black")).toEqual({ col: 0, row: 0 });
    expect(squareToGrid("a8", "black")).toEqual({ col: 7, row: 7 });
  });

  test("grid and square conversions round-trip", () => {
    for (const orientation of ["white", "black"] as const) {
      for (const sq of ["a1", "e4", "h8", "c7"]) {
        const { col, row } = squareToGrid(sq, orientation);
        expect(gridToSquare(col, row, orientation)).toBe(sq);
      }
    }
  });

  test("the whole board fits inside the scene", () => {
    expect(tileOrigin(0, 7).x).toBeGreaterThanOrEqual(0);
    expect(tileOrigin(7, 0).x + TILE_W).toBeLessThanOrEqual(SCENE_W);
    expect(spriteOrigin(0, 0, wizardTheme.sprites.k.length).y).toBeGreaterThanOrEqual(0);
  });
});

describe("renderScene", () => {
  test("draws each piece's sprite on its square", () => {
    const buf = render("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1");
    expect(spriteOutlineMatches(buf, "e4", "p", "w")).toBeGreaterThan(0.9);
    expect(spriteOutlineMatches(buf, "e8", "k", "b")).toBeGreaterThan(0.9);
    expect(spriteOutlineMatches(buf, "e1", "k", "w")).toBeGreaterThan(0.9);
    expect(spriteOutlineMatches(buf, "d4", "p", "w")).toBeLessThan(0.3);
  });

  test("flips with the orientation", () => {
    const buf = render("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1", "black");
    expect(spriteOutlineMatches(buf, "e4", "p", "w", "black")).toBeGreaterThan(0.9);
    expect(spriteOutlineMatches(buf, "e4", "p", "w", "white")).toBeLessThan(0.3);
  });

  test("pieces are lit from the left for both colours, so they read as rounded", () => {
    const lum = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    for (const color of ["w", "b"] as const) {
      const fen = color === "w" ? "4k3/8/8/8/8/8/8/R3K3 w - - 0 1" : "r3k3/8/8/8/8/8/8/4K3 w - - 0 1";
      const buf = render(fen);
      const square = color === "w" ? "a1" : "a8";
      const { col, row } = squareToGrid(square, "white");
      const origin = spriteOrigin(col, row, wizardTheme.sprites.r.length);
      // Rook row 9 ("...ohbbbbbbso..."): body pixels run x = 4..11.
      const y = origin.y + 9;
      expect(lum(buf.get(origin.x + 4, y))).toBeGreaterThan(lum(buf.get(origin.x + 8, y)));
      expect(lum(buf.get(origin.x + 8, y))).toBeGreaterThan(lum(buf.get(origin.x + 11, y)));
    }
  });

  test("highlights the last move", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const plain = render(fen);
    const lit = render(fen, "white", { lastMove: { from: "b3", to: "c5" } });
    const { col, row } = squareToGrid("b3", "white");
    const { x, y } = tileOrigin(col, row);
    expect(lit.get(x + 16, y + 8)).not.toBe(plain.get(x + 16, y + 8));
    const other = tileOrigin(...(Object.values(squareToGrid("g6", "white")) as [number, number]));
    expect(lit.get(other.x + 16, other.y + 8)).toBe(plain.get(other.x + 16, other.y + 8));
  });

  test("a still frame is deterministic", () => {
    const a = render("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    const b = render("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  test("the sky moves over time but the board stays put", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const early = render(fen, "white", { time: 1000 });
    const late = render(fen, "white", { time: 20000 });
    expect(Buffer.from(early.data).equals(Buffer.from(late.data))).toBe(false);
    const { x, y } = tileOrigin(4, 4);
    expect(late.get(x + 16, y + 8)).toBe(early.get(x + 16, y + 8));
  });

  test("a larger canvas fills with sky and centres the board", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const small = render(fen);
    const width = SCENE_W + 100;
    const height = SCENE_H + 60;
    const big = new PixelBuffer(width, height);
    renderScene(big, wizardTheme, { board: new Chess(fen).board(), orientation: "white", width, height });
    const { x, y } = tileOrigin(3, 4);
    expect(big.get(x + 16 + 50, y + 8 + 30)).toBe(small.get(x + 16, y + 8));
    // Every pixel is painted, including the corners beyond the original scene.
    expect(big.data[(height * width - 1) * 4 + 3]).toBe(255);
  });
});
