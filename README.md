# Regent Chess App

Our AI, [Leela Chess Zero](https://lczero.org/) (Lc0), plays chess against Stockfish (limited to 1600 Elo) and builds up a rating. Games are stored in algebraic notation and can be replayed and analysed with Stockfish, as can any game you paste in.

## Running

```sh
brew install lc0       # Lc0 plus its default network
bun install
bun run dev            # http://localhost:3000
```

On startup the server checks both engines and prints `Lc0 is ready` and `Stockfish is ready`, or the error.

**Lc0.** Uses `LC0_PATH` if set, otherwise `lc0` on your `PATH`. Homebrew's build includes a network (42850, 15×192) that Lc0 finds automatically. To use a different network, point `LC0_PATH` at a wrapper script that passes `--weights=<file>`. Lc0 loads its network with a short warm-up search before each game, so loading time doesn't count against the first move.

**Stockfish.** The app talks UCI to a Stockfish process. It uses, in order: `STOCKFISH_PATH`, a `stockfish` binary on your `PATH` (`brew install stockfish`), or the bundled Stockfish 19 WASM build (npm `stockfish`) run with Node. Node is needed because the WASM build doesn't run under Bun directly.

| Env var | Default | |
|---|---|---|
| `LC0_PATH` | auto | Lc0 binary |
| `LC0_MOVETIME_MS` | `4000` | Lc0's search time per move (under the 5 s limit) |
| `STOCKFISH_PATH` | auto | Native Stockfish binary |
| `STOCKFISH_MOVETIME_MS` | `4000` | Stockfish's search time per move (under the 5 s limit) |
| `ANALYSIS_DEPTH` | `12` | Search depth for analysis |
| `DB_PATH` | `data/regent.sqlite` | Game log |
| `PORT` | `3000` | |

## Modes

- **Play:** starts a game of Lc0 vs Stockfish and shows it live. Lc0 alternates between White and Black from game to game, starting with White.
- **Analyse:** pick a previous game (sortable by date or estimated Elo) or paste a game (PGN or plain moves like `1. e4 e5 2. Nf3`). Stockfish analyses every move and reports eval, centipawn loss, accuracy and the best move. Each stored game has a PGN download.

## Rules

Standard chess rules come from [chess.js](https://github.com/jhlywa/chess.js). On top of those, the brief adds:

- **5 seconds per move for each player** (`src/shared/rules.ts`). Both engines search for a fixed time under the limit. If a player returns an illegal or unreadable move, it's told which moves were illegal and may try again within the same 5 seconds. A player that has no legal move in by the time limit loses on time. Under FIDE 6.9 it's a draw instead if the opponent has no mating material.
- **Stockfish is set to 1600 Elo** with `UCI_LimitStrength: true, UCI_Elo: 1600`. Lc0 plays at full strength; the brief doesn't set a limit for it.
- The game ends automatically on checkmate, stalemate, insufficient material, threefold repetition or the fifty-move rule. chess.js treats the last two as automatic draws, not claims.
- If a game can't continue for reasons outside chess (an engine that crashes or won't start), it is **aborted**. It isn't rated and doesn't count toward color alternation.

## Ratings

Stockfish doesn't output Elo ratings, so the app keeps two numbers:

1. **Estimated Elo per game.** A full-strength Stockfish analyses each game. Lc0's average centipawn loss (ACPL) is mapped with the heuristic `Elo ≈ 3100 · e^(−0.01·ACPL)`. Accuracy uses the Lichess win-percentage model. See `src/server/elo.ts`. This is an estimate and is shown as one.
2. **Running rating from results.** The standard Elo formula against a 1600 opponent, starting at 1500 with K = 32.

## Board design

The board is isometric pixel art with a wizard's-tower theme. The whole scene is drawn at native resolution (288 × 194 px) and scaled up by a whole number (×2 = 576 × 388 px), so the pixels stay crisp. The board keeps that size on wide screens and only scales down when the screen is narrower.

- `src/client/theme.ts` holds everything visual: tile, slab, sky, candle and highlight colors, the piece palettes for each side, and the piece sprites. Sprites are 16 px wide text grids using the palette keys (`o` outline, `b` base, `s` shade, `h` highlight, `a` accent, `d` shadow, `e` glow). To redesign, edit or copy `wizardTheme`.
- `src/client/iso/render.ts` is the renderer: isometric geometry, drawing back to front, coordinates engraved on the slab, and the candle and star animation (turned off when the OS asks for reduced motion). It draws onto any `PixelTarget`, which is the canvas in the app and a pixel buffer in tests.
- Preview a design without starting the app: `bun scripts/render-board.ts "<fen>" board.png white 3` writes a PNG.
- The canvas is hidden from screen readers. A visually hidden grid lists every square and its piece instead.

## Tests

```sh
bun test                 # unit, client and integration tests
bun run typecheck
```

- `test/unit`: rules, game loop (timeouts, retries, draws), UCI parsing, engine players, analysis, Elo math, storage (including the migration from Claude-era databases) and the service
- `test/client`: renderer (sprites, isometric geometry, pieces drawn on the right squares, highlights) and the board and game viewer components (happy-dom)
- `test/integration`: real Stockfish (1600-Elo play, analysis), real Lc0 (a legal first move within the limit, and full Lc0 vs Stockfish games as each color), engine crash and restart handling, and the HTTP API. The Lc0 tests skip if `lc0` isn't installed.

## Layout

```
src/shared   rules, types, notation parsing (used by server and client)
src/server   Bun server: API, game loop, players (Lc0, Stockfish), UCI engine, analysis, SQLite
src/client   React UI (served by Bun's HTML bundler); iso/ is the pixel-art renderer
scripts      render-board.ts: PNG preview of the board
```
