# Regent Chess App

Claude plays chess against Stockfish (limited to 1600 Elo) and builds up a rating. Games are stored in algebraic notation and can be replayed and analysed with Stockfish, as can any game you paste in.

## Running

```sh
bun install
cp .env.example .env   # add ANTHROPIC_API_KEY
bun run dev            # http://localhost:3000
```

**Stockfish.** The app talks UCI to a Stockfish process. It uses, in order: `STOCKFISH_PATH`, a `stockfish` binary on your `PATH` (`brew install stockfish`), or the bundled Stockfish 19 WASM build (npm `stockfish`) run with Node. Node is needed because the WASM build doesn't run under Bun directly.

| Env var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required to play |
| `CLAUDE_MODEL` | `claude-opus-5` | Model Claude plays with |
| `STOCKFISH_PATH` | auto | Native Stockfish binary |
| `STOCKFISH_MOVETIME_MS` | `4000` | Stockfish's search time per move (under the 5 s limit) |
| `ANALYSIS_DEPTH` | `12` | Search depth for analysis |
| `DB_PATH` | `data/regent.sqlite` | Game log |
| `PORT` | `3000` | |

## Modes

- **Play:** starts a game of Claude vs Stockfish and shows it live. Claude alternates between White and Black from game to game, starting with White.
- **Analyse:** pick a previous game (sortable by date or estimated Elo) or paste a game (PGN or plain moves like `1. e4 e5 2. Nf3`). Stockfish analyses every move and reports eval, centipawn loss, accuracy and the best move. Each stored game has a PGN download.

## Rules

Standard chess rules come from [chess.js](https://github.com/jhlywa/chess.js). On top of those, the brief adds:

- **5 seconds per move for each player** (`src/shared/rules.ts`). If Claude sends an illegal or unreadable move, it's told which moves were illegal and may try again within the same 5 seconds. A player that has no legal move in by the time limit loses on time. Under FIDE 6.9 it's a draw instead if the opponent has no mating material.
- **Stockfish is set to 1600 Elo** with `UCI_LimitStrength: true, UCI_Elo: 1600`.
- The game ends automatically on checkmate, stalemate, insufficient material, threefold repetition or the fifty-move rule. chess.js treats the last two as automatic draws, not claims.
- If a game can't continue for reasons outside chess (missing or invalid API key, engine crash), it is **aborted**. It isn't rated and doesn't count toward color alternation.

## Ratings

Stockfish doesn't output Elo ratings, so the app keeps two numbers:

1. **Estimated Elo per game.** A full-strength Stockfish analyses each game. Claude's average centipawn loss (ACPL) is mapped with the heuristic `Elo ≈ 3100 · e^(−0.01·ACPL)`. Accuracy uses the Lichess win-percentage model. See `src/server/elo.ts`. This is an estimate and is shown as one.
2. **Running rating from results.** The standard Elo formula against a 1600 opponent, starting at 1500 with K = 32.

## Board design

The board is in `src/client/components/Board.tsx` and all its styling is in `src/client/theme.ts`. A `BoardTheme` sets the square colors, highlights and a `renderPiece` function. To restyle the board, add a theme, for example one with SVG or image pieces.

## Tests

```sh
bun test                 # unit, client and integration tests
bun run typecheck
```

- `test/unit`: rules, game loop (timeouts, retries, draws), UCI parsing, analysis, Elo math, storage, service, and the Claude player via a stubbed HTTP layer
- `test/client`: board and game viewer components (happy-dom)
- `test/integration`: real Stockfish (1600-Elo play, analysis), a full game stored and analysed in SQLite, and the HTTP API. `claude-live.test.ts` calls the real Anthropic API and runs only when `ANTHROPIC_API_KEY` is set.

## Layout

```
src/shared   rules, types, notation parsing (used by server and client)
src/server   Bun server: API, game loop, players (Claude, Stockfish), UCI engine, analysis, SQLite
src/client   React UI (served by Bun's HTML bundler)
```
