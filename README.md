# SchackMars

Our AI, **Pluto**, plays chess against Stockfish (limited to 1600 Elo by default, adjustable up to 3190) and builds up a rating. Under the hood Pluto is [Leela Chess Zero](https://lczero.org/) (Lc0); the rest of this README calls it Lc0 when talking about the engine. Games are stored in algebraic notation and can be replayed and analysed with Stockfish, as can any game you paste in.

## Running

```sh
brew install lc0       # Lc0 plus its default network
bun install
bun run dev            # http://localhost:3000
```

On startup the server checks both engines and prints `Lc0 is ready` and `Stockfish is ready`, or the error.

**Lc0.** Uses `LC0_PATH` if set, otherwise `lc0` on your `PATH`. Homebrew's build includes a network (42850, 15×192) that Lc0 finds automatically. To use a different network, set `LC0_WEIGHTS` to its file (see [Choosing a network](#choosing-a-network)). Lc0 loads its network with a short warm-up search before each game, so loading time doesn't count against the first move.

**Stockfish.** The app talks UCI to a Stockfish process. It uses, in order: `STOCKFISH_PATH`, a `stockfish` binary on your `PATH` (`brew install stockfish`), or the bundled Stockfish 19 WASM build (npm `stockfish`) run with Node. Node is needed because the WASM build doesn't run under Bun directly.

| Env var | Default | |
|---|---|---|
| `LC0_PATH` | auto | Lc0 binary |
| `LC0_WEIGHTS` | Homebrew's 42850 | Lc0 network file |
| `LC0_MINIBATCH_SIZE` | `32` | Positions Lc0 evaluates per GPU batch (`0` = Lc0's own default, which is much slower on Apple silicon) |
| `LC0_MOVETIME_MS` | `4000` | Lc0's search time per move (under the 5 s limit) |
| `STOCKFISH_PATH` | auto | Native Stockfish binary |
| `STOCKFISH_MOVETIME_MS` | `4000` | Stockfish's search time per move (under the 5 s limit) |
| `ANALYSIS_DEPTH` | `12` | Search depth for analysis |
| `DB_PATH` | `data/regent.sqlite` | Game log |
| `PORT` | `3000` | |
| `AGENT_ANALYSIS` | on | `off` stops the server from running the [analysis agents](#agent-analysis) |
| `CLAUDE_PATH` | `claude` on `PATH` | Claude Code binary for the analysis agents |
| `AGENT_TIMEOUT_MS` | `2700000` (45 min) | Longest an agent run may take |

## Modes

- **Play:** starts a game of Pluto (Lc0) vs Stockfish and shows it live. Lc0 alternates between White and Black from game to game, starting with White.
- **Analyse:** pick a previous game (sortable by date or estimated Elo) or paste a game (PGN or plain moves like `1. e4 e5 2. Nf3`). Stockfish analyses every move and reports eval, centipawn loss, accuracy and the best move. Each stored game has a PGN download, and an **Agents** tab with the [analysis agents'](#agent-analysis) reports.
- **Viewing a game:** step through moves with the buttons, the arrow keys or the move list, or press **Autoplay** to play a finished game through at one move every 1.2 s (any manual step pauses it).

## Rules

Standard chess rules come from [chess.js](https://github.com/jhlywa/chess.js). On top of those, the brief adds:

- **5 seconds per move for each player** (`src/shared/rules.ts`). Both engines search for a fixed time under the limit. If a player returns an illegal or unreadable move, it's told which moves were illegal and may try again within the same 5 seconds. A player that has no legal move in by the time limit loses on time. Under FIDE 6.9 it's a draw instead if the opponent has no mating material.
- **Stockfish is set to 1600 Elo** by default, with `UCI_LimitStrength: true, UCI_Elo: 1600`, as the brief specifies. It can be turned up (or down) per game in the Play panel, from 1320 to 3190 (Stockfish's `UCI_Elo` range); each game stores the strength it was played at. Via the API: `POST /api/games` with `{"stockfishElo": 2400}`. Lc0 plays at full strength; the brief doesn't set a limit for it.
- The game ends automatically on checkmate, stalemate, insufficient material, threefold repetition or the fifty-move rule. chess.js treats the last two as automatic draws, not claims.
- If a game can't continue for reasons outside chess (an engine that crashes or won't start), it is **aborted**. It isn't rated and doesn't count toward color alternation.

## Ratings

Stockfish doesn't output Elo ratings, so the app keeps two numbers:

1. **Estimated Elo per game.** A full-strength Stockfish analyses each game. Lc0's average centipawn loss (ACPL) is mapped with the heuristic `Elo ≈ 3100 · e^(−0.01·ACPL)`. Accuracy uses the Lichess win-percentage model. See `src/server/elo.ts`. This is an estimate and is shown as one.
2. **Running rating from results.** The standard Elo formula against each game's Stockfish strength (1600 unless turned up), starting at 1500 with K = 32.

## Agent analysis

Once Stockfish has analysed a game, two [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) study it and write reports with concrete suggestions for improving Lc0:

- **Grandmaster** (`.claude/agents/chess-grandmaster.md`): a world-class player at Magnus Carlsen's playing strength. Judges Lc0's play and turns what it sees into chess-level advice: positions Lc0 misjudges, slow conversions, missed tactics.
- **Engine developer** (`.claude/agents/engine-developer.md`): an Lc0 specialist. Diagnoses Lc0's search from its own data (below) and suggests exact changes to the network, UCI options, move time or app code, each with a way to test it.

Each report has a summary, key moments and ranked suggestions, each with the change to make and how to check that it helped. The agents check their lines with Stockfish rather than trusting their own calculation, and saving a report fails if it names a move that is illegal in the position or a ply the game doesn't have.

**How it runs.** When a game ends and Stockfish has analysed it, the server starts Claude Code headless (`claude -p "/analyze-games <id>"`) signed in as you, so no API key is needed. That run may only read the project, run `bun scripts/agents.ts`, write report files in `data/agent-reports` and start the two subagents. Runs go one game at a time; each takes several minutes and uses your Claude plan. The **Agents** tab next to the moves on the analysis page shows the reports and the state of a run, and has a button to run the agents (again). Clicking a move in a report shows it on the board.

You can also run `/analyze-games` in Claude Code. Without arguments it takes up to 10 finished games that are missing a report, oldest first; with game ids it (re-)runs those. The first time a subagent runs `bun scripts/agents.ts` or writes its report file, Claude Code asks for permission; allow it for the session, or add `Bash(bun scripts/agents.ts *)` and `Edit(data/agent-reports/**)` to the project's permission allow list.

**Lc0's search data.** For each of its moves the app records what Lc0 reported: eval and win/draw/loss chances, nodes, nodes per second, depth, time used out of time given, principal variation, and the visits, policy and Q of each root move (Lc0's `UCI_ShowWDL` and `VerboseMoveStats`, which don't slow it down). Each game also records Lc0's version, network, backend and options. Games from before this was added have only their moves and Stockfish's analysis.

**Tools.** `bun scripts/agents.ts` is how the agents read games and save reports, and it's handy by hand too (`bun scripts/agents.ts help` lists everything):

```sh
bun scripts/agents.ts pending                  # games still missing a report
bun scripts/agents.ts game 12                  # everything the agents see about game 12
bun scripts/agents.ts reports --suggestions    # every suggestion so far, highest priority first
bun scripts/agents.ts lc0 --game 12 --ply 23 --nodes 20000 --option CPuct=2.2   # re-test a position
```

`lc0` refuses to run while a game or a match batch is using Lc0 (`data/lc0.lock`), so a probe can't skew their results.

## Board design

The board is isometric pixel art: a starlit board with a space crew for pieces (astronaut pawns, rocket knights, alien bishops, station-tower rooks, ringed-planet queens and a star-crowned commander king). The whole scene is drawn at native resolution (528 × 316 px, twice the resolution the art is designed at) and scaled with nearest-neighbour sampling so the pixels stay sharp. The 16 px sprites and the 3×5 coordinate font are doubled with Scale2x, which rounds off diagonals, and the doubled outlines are thinned back to one pixel (`src/client/iso/upscale.ts`); tiles, stars and candles are drawn at the full resolution. In the app the scene is a full-window backdrop: the sky covers the whole screen, the page's controls float over it in translucent panels, and the board is scaled to fit and centred in the open space between them.

- `src/client/theme.ts` holds everything visual: tile, slab, sky, candle and highlight colors, the piece palettes for each side, and the piece sprites. Sprites are 16 px wide text grids using the palette keys (`o` outline, `b` base, `s` shade, `h` highlight, `a` accent, `d` shadow, `e` glow). The app uses `spaceTheme`; `wizardTheme` has the original wizard pieces. To redesign, edit or copy one and point `defaultTheme` at it.
- `src/client/iso/render.ts` is the renderer: isometric geometry, drawing back to front, piece lighting (pieces are shaded as rounded solids lit from the upper left), coordinates engraved on the slab, move animation (a piece lifts, glides and sets down over 0.45 s; castling moves both pieces, a captured piece stays until the mover lands and then explodes, in `src/client/iso/explosion.ts`; `src/client/iso/motion.ts` works out what moved), and the sky animation: twinkling and drifting stars, drifting mist, the odd shooting star, floating candles for themes that have them (the wizard theme does), and for the space theme Mars, a black hole, a ringed planet, a moon and a spaceship that flies past every so often (`src/client/iso/cosmos.ts`) (turned off when the OS asks for reduced motion). It draws onto any `PixelTarget`, which is the canvas in the app and a pixel buffer in tests.
- Preview a design without starting the app: `bun scripts/render-board.ts "<fen>" board.png white 3` writes a PNG.
- The canvas is hidden from screen readers. A visually hidden grid lists every square and its piece instead.

## Tests

```sh
bun test                 # unit, client and integration tests
bun run typecheck
```

- `test/unit`: rules, game loop (timeouts, retries, draws), UCI parsing (including Lc0's search statistics), engine players, analysis, Elo math, storage (including the migration from Claude-era databases), the service, and agent analysis (report checks, the game as the agents see it, the run queue, the headless Claude Code launch, and that the report format the agents are given passes the checks)
- `test/client`: renderer (sprites, isometric geometry, pieces drawn on the right squares, highlights) and the board, game viewer and agent report components (happy-dom)
- `test/integration`: real Stockfish (1600-Elo play, analysis), real Lc0 (a legal first move within the limit, and full Lc0 vs Stockfish games as each color), engine crash and restart handling, the HTTP API, and the agents' command-line tools. The Lc0 tests skip if `lc0` isn't installed. No test calls Claude.

## Layout

```
src/shared   rules, types, notation parsing (used by server and client)
src/server   Bun server: API, game loop, players (Lc0, Stockfish), UCI engine, analysis, SQLite
             agents/: report checks, the game as text for the agents, run queue, headless Claude Code launch
src/client   React UI (served by Bun's HTML bundler); iso/ is the pixel-art renderer
scripts      render-board.ts: PNG preview of the board; agents.ts: the analysis agents' tools
.claude      agents/: the grandmaster and engine developer; skills/analyze-games: runs them on games
```
