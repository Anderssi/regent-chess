import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { PixelBuffer } from "../../src/client/iso/pixels.ts";
import { glyph } from "../../src/client/iso/font.ts";
import {
  gridToSquare,
  pieceSprite,
  renderScene,
  RES,
  SCENE_H,
  SCENE_W,
  spriteOrigin,
  squareToGrid,
  tileOrigin,
  TILE_H,
  TILE_W,
} from "../../src/client/iso/render.ts";
import { spaceTheme, wizardTheme, type SpriteKey } from "../../src/client/theme.ts";

/** A tile's centre, relative to its origin. */
const CX = TILE_W / 2;
const CY = TILE_H / 2;

const render = (fen: string, orientation: "white" | "black" = "white", extra = {}) => {
  const buf = new PixelBuffer(SCENE_W, SCENE_H);
  renderScene(buf, wizardTheme, { board: new Chess(fen, { skipValidation: true }).board(), orientation, ...extra });
  return buf;
};

/** Pixels of the sprite for the piece on `square` that are drawn with the palette's outline colour. */
function spriteOutlineMatches(buf: PixelBuffer, square: string, type: keyof typeof wizardTheme.sprites, color: "w" | "b", orientation: "white" | "black" = "white") {
  const sprite = pieceSprite(wizardTheme.sprites[type]);
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
  test("every sprite in every theme is 16 pixels wide and uses only palette keys", () => {
    for (const theme of [wizardTheme, spaceTheme]) {
      const keys = new Set<string>([".", ...(Object.keys(theme.pieces.w) as SpriteKey[])]);
      for (const [type, sprite] of Object.entries(theme.sprites)) {
        for (const line of sprite) {
          expect({ theme: theme.name, type, width: line.length }).toEqual({ theme: theme.name, type, width: 16 });
          for (const ch of line) expect(keys.has(ch)).toBe(true);
        }
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
    expect(spriteOrigin(0, 0, pieceSprite(wizardTheme.sprites.k).length).y).toBeGreaterThanOrEqual(0);
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
      const sprite = pieceSprite(wizardTheme.sprites.r);
      const origin = spriteOrigin(col, row, sprite.length);
      // A plain body row of the tower (art row 9, "...ohbbbbbbso..."): compare its left, middle and right.
      const dy = 9 * RES;
      const body = [...sprite[dy]!].flatMap((ch, dx) => (ch === "o" || ch === "." ? [] : [dx]));
      const [left, mid, right] = [body[0]!, body[body.length >> 1]!, body[body.length - 1]!];
      const y = origin.y + dy;
      expect(lum(buf.get(origin.x + left, y))).toBeGreaterThan(lum(buf.get(origin.x + mid, y)));
      expect(lum(buf.get(origin.x + mid, y))).toBeGreaterThan(lum(buf.get(origin.x + right, y)));
    }
  });

  test("highlights the last move", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const plain = render(fen);
    const lit = render(fen, "white", { lastMove: { from: "b3", to: "c5" } });
    const { col, row } = squareToGrid("b3", "white");
    const { x, y } = tileOrigin(col, row);
    expect(lit.get(x + CX, y + CY)).not.toBe(plain.get(x + CX, y + CY));
    const other = tileOrigin(...(Object.values(squareToGrid("g6", "white")) as [number, number]));
    expect(lit.get(other.x + CX, other.y + CY)).toBe(plain.get(other.x + CX, other.y + CY));
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
    expect(late.get(x + CX, y + CY)).toBe(early.get(x + CX, y + CY));
  });

  test("a larger canvas fills with sky and centres the board", () => {
    const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const small = render(fen);
    const width = SCENE_W + 100;
    const height = SCENE_H + 60;
    const big = new PixelBuffer(width, height);
    renderScene(big, wizardTheme, { board: new Chess(fen).board(), orientation: "white", width, height });
    const { x, y } = tileOrigin(3, 4);
    expect(big.get(x + CX + 50, y + CY + 30)).toBe(small.get(x + CX, y + CY));
    // Every pixel is painted, including the corners beyond the original scene.
    expect(big.data[(height * width - 1) * 4 + 3]).toBe(255);
  });
});

describe("space scenery", () => {
  test("the space theme adds planets and a black hole to the sky without touching the board", () => {
    const board = new Chess().board();
    const plain = new PixelBuffer(SCENE_W, SCENE_H);
    renderScene(plain, { ...spaceTheme, cosmos: null }, { board, orientation: "white" });
    const space = new PixelBuffer(SCENE_W, SCENE_H);
    renderScene(space, spaceTheme, { board, orientation: "white" });
    // The black hole's centre (art pixel 40, 24) is pure black.
    expect(space.get(40 * RES, 24 * RES)).toBe("#000000");
    expect(plain.get(40 * RES, 24 * RES)).not.toBe("#000000");
    const { x, y } = tileOrigin(3, 4);
    expect(space.get(x + CX, y + CY)).toBe(plain.get(x + CX, y + CY));
  });
});

describe("upscaling", () => {
  test("Scale2x doubles a sprite and rounds its diagonals", async () => {
    const { scale2x } = await import("../../src/client/iso/upscale.ts");
    const up = scale2x([".o.", "ooo", ".o."]);
    expect(up).toHaveLength(6);
    expect(up.every((line) => line.length === 6)).toBe(true);
    // A plus sign's inner corners fill in, so it reads as a rounded blob, not a blocky cross.
    expect(up[1]).toBe(".oooo.");
  });

  test("silhouette outlines are thinned back to one pixel, inner details are kept", async () => {
    const { hiResSprite } = await import("../../src/client/iso/upscale.ts");
    const hi = hiResSprite(["oooo", "obbo", "oeeo", "oooo"]);
    expect(hi[3]).toBe("obbbbbbo"); // left/right edges one pixel thick
    expect(hi[4]!.includes("e")).toBe(true);
  });
});

describe("move animation", () => {
  const boardAfter = (fen: string, ...moves: string[]) => {
    const chess = new Chess(fen);
    const before = chess.board();
    for (const m of moves) chess.move(m);
    return { before, after: chess.board() };
  };

  test("a plain move glides one piece", async () => {
    const { diffBoards } = await import("../../src/client/iso/motion.ts");
    const { before, after } = boardAfter(new Chess().fen(), "Nf3");
    expect(diffBoards(before, after)).toEqual({ motions: [{ from: "g1", to: "f3", piece: { type: "n", color: "w" } }], ghosts: [] });
  });

  test("a capture keeps the captured piece as a ghost until the mover lands", async () => {
    const { diffBoards } = await import("../../src/client/iso/motion.ts");
    const { before, after } = boardAfter("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "exd5");
    const anim = diffBoards(before, after)!;
    expect(anim.motions).toEqual([{ from: "e4", to: "d5", piece: { type: "p", color: "w" } }]);
    expect(anim.ghosts).toEqual([{ square: "d5", piece: { type: "p", color: "b" } }]);
  });

  test("castling moves king and rook together, promotion turns the pawn into the new piece", async () => {
    const { diffBoards } = await import("../../src/client/iso/motion.ts");
    const castle = boardAfter("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "O-O");
    expect(diffBoards(castle.before, castle.after)!.motions.map((m) => `${m.from}-${m.to}`).sort()).toEqual(["e1-g1", "h1-f1"]);
    const promote = boardAfter("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a8=Q");
    expect(diffBoards(promote.before, promote.after)!.motions).toEqual([{ from: "a7", to: "a8", piece: { type: "q", color: "w" } }]);
  });

  test("stepping back animates too, but a jump of several moves does not", async () => {
    const { diffBoards } = await import("../../src/client/iso/motion.ts");
    const { before, after } = boardAfter("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "exd5");
    // Backwards: the pawn returns to e4 and the captured pawn simply reappears.
    expect(diffBoards(after, before)).toEqual({ motions: [{ from: "d5", to: "e4", piece: { type: "p", color: "w" } }], ghosts: [] });
    const jump = boardAfter(new Chess().fen(), "e4", "e5", "Nf3", "Nc6");
    expect(diffBoards(jump.before, jump.after)).toBeNull();
  });

  test("the lift-glide-land path starts and ends on the board", async () => {
    const { motionPath } = await import("../../src/client/iso/motion.ts");
    expect(motionPath(0)).toEqual({ travel: 0, lift: 0 });
    expect(motionPath(0.5)).toEqual({ travel: 0.5, lift: 1 });
    expect(motionPath(1)).toEqual({ travel: 1, lift: 0 });
  });

  test("mid-move the piece is drawn in the air between its squares, not on its target", async () => {
    const { diffBoards } = await import("../../src/client/iso/motion.ts");
    const { before, after } = boardAfter("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "Ra5");
    const anim = diffBoards(before, after)!;
    const still = render("4k3/8/8/R7/8/8/8/4K3 w - - 0 1");
    const mid = new PixelBuffer(SCENE_W, SCENE_H);
    renderScene(mid, wizardTheme, { board: after, orientation: "white", animation: { ...anim, progress: 0.5 } });
    // The rook isn't standing on a5 yet...
    expect(spriteOutlineMatches(still, "a5", "r", "w")).toBeGreaterThan(0.9);
    expect(spriteOutlineMatches(mid, "a5", "r", "w")).toBeLessThan(0.3);
    // ...and a frame after landing is identical to the still position.
    const done = new PixelBuffer(SCENE_W, SCENE_H);
    renderScene(done, wizardTheme, { board: after, orientation: "white", animation: { ...anim, progress: 1 } });
    expect(Buffer.from(done.data).equals(Buffer.from(still.data))).toBe(true);
  });
});

describe("capture explosion", () => {
  test("blows up over the captured square and leaves the board untouched once it's over", () => {
    const board = new Chess("4k3/8/8/3P4/8/8/8/4K3 w - - 0 1").board();
    const still = new PixelBuffer(SCENE_W, SCENE_H);
    renderScene(still, wizardTheme, { board, orientation: "white" });
    const { col, row } = squareToGrid("d5", "white");
    const { x, y } = tileOrigin(col, row);
    const centre = [x + CX, y + CY - 6 * RES] as const;
    const boom = (progress: number) => {
      const buf = new PixelBuffer(SCENE_W, SCENE_H);
      renderScene(buf, wizardTheme, { board, orientation: "white", explosions: [{ square: "d5", piece: { type: "n", color: "b" }, progress }] });
      return buf;
    };
    expect(boom(0.02).get(...centre)).toBe(wizardTheme.explosion.flash);
    expect(boom(0.2).get(...centre)).not.toBe(still.get(...centre));
    expect(Buffer.from(boom(1).data).equals(Buffer.from(still.data))).toBe(true);
  });
});
