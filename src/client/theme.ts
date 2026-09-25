/**
 * Everything that controls how the board looks: colours, piece sprites, scene decoration.
 * Swap in a new theme to redesign the board without touching the renderer.
 */

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
/** Piece codes: colour (w/b) + piece letter. */
export type PieceCode = `${"w" | "b"}${PieceType}`;

/**
 * Sprite pixel keys: "." transparent, o outline, b base, s shade, h highlight,
 * a accent (trim), d deep shadow (faces under hoods), e glow (eyes, gems, magic).
 */
export type SpriteKey = "o" | "b" | "s" | "h" | "a" | "d" | "e";
export type PiecePalette = Record<SpriteKey, string>;

export interface TilePalette {
  base: string;
  speckle: string;
  edge: string;
}

export interface BoardTheme {
  name: string;
  /** Integer upscale of the native pixel art. */
  scale: number;
  sky: string[];
  stars: { bright: string; dim: string };
  tiles: { light: TilePalette; dark: TilePalette };
  slab: { left: string; right: string; trim: string; trimShade: string; bottom: string; engraving: string };
  highlight: { lastMove: string; check: string };
  shadow: string;
  candles: { wax: string; waxShade: string; flame: string[]; glow: string } | null;
  pieces: { w: PiecePalette; b: PiecePalette };
  /** 16-pixel-wide sprites, bottom row sits on the tile. */
  sprites: Record<PieceType, string[]>;
  /** Mirror Black's sprites horizontally (so knights face each other). */
  mirrorBlack: boolean;
}

const SPRITES: Record<PieceType, string[]> = {
  // Hooded acolyte
  p: [
    "......oooo......",
    ".....ohbbso.....",
    "....ohbbbbso....",
    "....obddddso....",
    "....obdeedso....",
    "....obddddso....",
    ".....obbbso.....",
    "....oabbbbao....",
    "....ohbbbbso....",
    "...ohbbbbbsso...",
    "...obbbbbbbso...",
    "..oaaaaaaaaaao..",
    "..oooooooooooo..",
  ],
  // Horse head
  n: [
    "......oo........",
    ".....oho.oo.....",
    "....ohbbohbo....",
    "...ohbbbbbbbo...",
    "..ohbebbbbbbso..",
    ".ohbbbbbbbbbbso.",
    ".obbbbbbaabbbso.",
    ".obdboooabbbbso.",
    "..ooo..oabbbbso.",
    "......ohabbbbso.",
    ".....ohbabbbbso.",
    ".....ohbbabbbso.",
    "....ohbbbbabbso.",
    "...oaaaaaaaaaao.",
    "...ohbbbbbbbbso.",
    "..oooooooooooooo",
  ],
  // Wizard with pointed hat and staff
  b: [
    ".........oo.....",
    "........ohao....",
    ".......ohbo.....",
    ".......ohbso....",
    "......ohbbso....",
    "......ohbbbso...",
    ".....ohbebbso...",
    ".....ohbbbbbso..",
    "..ooooaaaaaaaoo.",
    "...oohbbbbbbsoo.",
    ".....oddddddo...",
    ".....odeddedo...",
    "..e..oddddddo...",
    ".oeo.ohbbbbso...",
    "..o.ohbbbbbbso..",
    "..o.ohbabbbbso..",
    "..o.ohbbabbbso..",
    "..oohbbbbabbbso.",
    "..oaaaaaaaaaaao.",
    "..ooooooooooooo.",
  ],
  // Tower
  r: [
    "..ooo.oooo.ooo..",
    "..ohooohbsooso..",
    "..ohbbbbbbbbso..",
    "..oaaaaaaaaaao..",
    "...ohbbbbbbso...",
    "...ohbbooobso...",
    "...ohbboeobso...",
    "...ohbboeobso...",
    "...ohbbbbbbso...",
    "...ohbbbbbbso...",
    "...ohbbbbbbso...",
    "..oaaaaaaaaaao..",
    "..ohbbbbbbbbso..",
    ".oooooooooooooo.",
  ],
  // Sorceress with crown
  q: [
    "....a..e..a.....",
    "....aa.a.aa.....",
    "....aaaaaaa.....",
    "....oeaaaeao....",
    ".....ohbbso.....",
    "....ohddddso....",
    "....ohdeedso....",
    "....ohddddso....",
    ".....obbbso.....",
    "...ohhbbbbbso...",
    "..ohbbabbbbbso..",
    "..ohbbbabbbbso..",
    "...ohbbbabbso...",
    "...ohbbbbabso...",
    "..ohbbbbbbabso..",
    "..ohbbbbbbbbso..",
    ".ohbbbbbbbbbbso.",
    ".oaaaaaaaaaaaao.",
    ".oooooooooooooo.",
  ],
  // Crowned king
  k: [
    ".......oo.......",
    "......oaao......",
    ".....oaaaao.....",
    "......oaao......",
    "...oo.oaao.oo...",
    "...oaooaaooao...",
    "...oaaaaeaaao...",
    "...oaaaaaaaao...",
    "....ohbbbbso....",
    "....ohddddso....",
    "....ohdeedso....",
    "....ohddddso....",
    ".....ohbbso.....",
    "...oohbbbbsoo...",
    "..ohbbbaabbbso..",
    "..ohbbbaabbbso..",
    "..ohaaaaaaaaso..",
    "..ohbbbaabbbso..",
    "..ohbbbaabbbso..",
    ".ohbbbbbbbbbbso.",
    ".oaaaaaaaaaaaao.",
    ".oooooooooooooo.",
  ],
};

export const wizardTheme: BoardTheme = {
  name: "Wizard's Tower",
  scale: 2,
  sky: ["#0b0815", "#0d0a19", "#100c1e", "#130e23", "#161028", "#19122d", "#1c1432", "#1f1637"],
  stars: { bright: "#fff6e0", dim: "#7d72a8" },
  tiles: {
    light: { base: "#c9b48a", speckle: "#b39c70", edge: "#e2d2a6" },
    dark: { base: "#4a3b5c", speckle: "#3c2f4d", edge: "#5f4d75" },
  },
  slab: { left: "#2f2542", right: "#221a31", trim: "#d9a441", trimShade: "#9c6f22", bottom: "#140f1f", engraving: "#e9c46a" },
  highlight: { lastMove: "#ffd76a66", check: "#ff3b3b80" },
  shadow: "#0a061255",
  candles: { wax: "#efe6cf", waxShade: "#c4b48f", flame: ["#fff3b0", "#ffd76a", "#ff9b3d"], glow: "#ffd76a1c" },
  pieces: {
    w: { o: "#2a1a2e", b: "#e8dcc0", s: "#b8a47e", h: "#fffaf0", a: "#d9a441", d: "#5a4a6a", e: "#7fe0ff" },
    b: { o: "#07050c", b: "#3b3350", s: "#262036", h: "#6d6190", a: "#3fae6a", d: "#120e1c", e: "#9dff8a" },
  },
  sprites: SPRITES,
  mirrorBlack: true,
};

export const defaultTheme = wizardTheme;
