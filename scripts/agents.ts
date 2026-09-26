/**
 * Command-line tools for the Claude Code analysis agents (.claude/agents, run by /analyze-games).
 * Run `bun scripts/agents.ts help` for the commands.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Chess } from "chess.js";
import { formatGameForAgents } from "../src/server/agents/bundle.ts";
import { parseAgentReport } from "../src/server/agents/report.ts";
import { GameStore } from "../src/server/db.ts";
import { lc0LockHolder, withLc0Lock } from "../src/server/engine/lock.ts";
import { launchAnalysisEngine, launchEngine, resolveLc0Command } from "../src/server/engine/process.ts";
import { scoreToCp, type UciEngine } from "../src/server/engine/uci.ts";
import { tryMove } from "../src/server/game-loop.ts";
import { describeSearch, LC0_OPTIONS } from "../src/server/players.ts";
import { moveLabel, uciToSanLine } from "../src/shared/notation.ts";
import { MOVE_TIME_LIMIT_MS } from "../src/shared/rules.ts";
import { AGENT_NAMES, type AgentName, type AgentReport, type GameRecord } from "../src/shared/types.ts";

const ROOT = join(import.meta.dir, "..");
/** Where the agents write their reports before saving them (the only place they may write). */
const REPORTS_DIR = join(ROOT, "data/agent-reports");

const HELP = `Tools for the SchackMars analysis agents. Positions are FENs in quotes, or --game <id> --ply <n> for the
position before ply n of a stored game (n = plies + 1 is the final position).

  bun scripts/agents.ts pending [--limit 10]     Finished, analysed games still missing an agent report, oldest first
  bun scripts/agents.ts status [id ...]          Which agent reports each game has, and when they were saved
  bun scripts/agents.ts game <id>                The game for analysis: moves, Stockfish's analysis, Lc0's setup and search data
  bun scripts/agents.ts stockfish <position> [--moves "Nf3 d5 ..."] [--depth 20] [--lines 3]
                                                 Full-strength Stockfish on a position (after optional moves), best lines first
  bun scripts/agents.ts lc0 <position> [--moves ...] [--nodes N | --movetime MS] [--option Name=Value ...] [--weights file]
                                                 Lc0 with the app's settings, optionally changed. Refuses while Lc0 is busy elsewhere
  bun scripts/agents.ts lc0 --list-options       Every Lc0 UCI option with its default
  bun scripts/agents.ts save <id> <${AGENT_NAMES.join("|")}> [file.json]
                                                 Check and save a report (JSON from the file, or stdin). A file in
                                                 data/agent-reports is deleted once it's saved
  bun scripts/agents.ts reports [id ...] [--suggestions]
                                                 Saved reports in full, or every suggestion ranked by priority
`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(["suggestions", "list-options"]);

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    let name = arg.slice(2);
    let value: string | undefined;
    if (name.includes("=")) [name, value] = [name.slice(0, name.indexOf("=")), name.slice(name.indexOf("=") + 1)];
    if (BOOLEAN_FLAGS.has(name)) value = "true";
    else value ??= argv[++i];
    if (value === undefined) throw new UsageError(`--${name} needs a value`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  const flag = (name: string) => flags.get(name)?.at(-1);
  const number = (name: string, fallback?: number) => {
    const raw = flag(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} must be a positive number`);
    return n;
  };
  return { positional, flag, number, all: (name: string) => flags.get(name) ?? [] };
}
type Args = ReturnType<typeof parseArgs>;

function openStore(): GameStore {
  const path = resolve(ROOT, process.env.DB_PATH ?? "data/regent.sqlite");
  if (!existsSync(path)) throw new UsageError(`No game database at ${path}. Start the app and play a game first.`);
  return new GameStore(path);
}

function loadGame(store: GameStore, idText: string | undefined): GameRecord {
  const id = Number(idText);
  if (!Number.isInteger(id)) throw new UsageError(`Give a game id (got ${JSON.stringify(idText)})`);
  const game = store.get(id);
  if (!game) throw new UsageError(`There is no game #${id}`);
  return game;
}

interface Position {
  fen: string;
  description: string;
  /** How to send it to an engine: a start position and moves in UCI, so a stored game's history comes along as in play. */
  start: string;
  moves: string[];
}

/** The position from a FEN argument or --game/--ply, then --moves played from it. */
function position(args: Args, store: () => GameStore): Position {
  let chess: Chess;
  let description: string;
  if (args.flag("game")) {
    const game = loadGame(store(), args.flag("game"));
    const ply = args.number("ply");
    if (!ply || !Number.isInteger(ply) || ply > game.sanMoves.length + 1) {
      throw new UsageError(`--ply must be a whole number from 1 to ${game.sanMoves.length + 1} for game #${game.id}`);
    }
    chess = new Chess();
    game.sanMoves.slice(0, ply - 1).forEach((san) => chess.move(san));
    description = ply > game.sanMoves.length ? `final position of game #${game.id}` : `game #${game.id} before ply ${ply} (${moveLabel(ply, game.sanMoves[ply - 1]!)})`;
  } else {
    try {
      chess = new Chess(args.positional[0] ?? "");
    } catch (err) {
      throw new UsageError(`Give a position as a FEN in quotes, or --game <id> --ply <n>. ${(err as Error).message}`);
    }
    description = "the given position";
  }
  const played: string[] = [];
  for (const move of (args.flag("moves") ?? "").split(/\s+/).map((m) => m.replace(/^\d+\.(\.\.)?/, "")).filter(Boolean)) {
    const result = tryMove(chess, move);
    if (!result) {
      throw new UsageError(`"${move}" is not legal after ${played.length ? `"${played.join(" ")}"` : "no moves"} from ${description}. Legal moves: ${chess.moves().join(" ")}`);
    }
    played.push(result.san);
  }
  if (played.length) description += `, after ${played.join(" ")}`;
  const history = chess.history({ verbose: true });
  return {
    fen: chess.fen(),
    description,
    start: history[0]?.before ?? chess.fen(),
    moves: history.map((m) => m.from + m.to + (m.promotion ?? "")),
  };
}

/** SAN moves numbered from the position they start in: "12... Nc6 13. Bb5". */
function numbered(fen: string, san: string[]): string {
  const [, turn, , , , fullmove] = fen.split(" ");
  let number = Number(fullmove) || 1;
  let white = turn === "w";
  return san
    .map((move, i) => {
      const text = white ? `${number}. ${move}` : i === 0 ? `${number}... ${move}` : move;
      if (!white) number++;
      white = !white;
      return text;
    })
    .join(" ");
}

function pawns(whiteCp: number): string {
  if (Math.abs(whiteCp) >= 90_000) return `${whiteCp > 0 ? "" : "-"}#${100_000 - Math.abs(whiteCp)}`;
  return `${whiteCp >= 0 ? "+" : ""}${(whiteCp / 100).toFixed(2)}`;
}

const sideToMove = (fen: string) => (fen.split(" ")[1] === "w" ? "White" : "Black");

async function withEngine<T>(launch: () => Promise<UciEngine>, fn: (engine: UciEngine) => Promise<T>): Promise<T> {
  const engine = await launch();
  try {
    return await fn(engine);
  } finally {
    engine.quit();
  }
}

async function stockfish(args: Args): Promise<void> {
  const { fen, description, start, moves } = position(args, openStore);
  const depth = args.number("depth", 20)!;
  const lines = args.number("lines", 3)!;
  const sign = sideToMove(fen) === "White" ? 1 : -1;
  console.log(`Position: ${description}, ${sideToMove(fen)} to move. FEN ${fen}`);
  if (new Chess(fen).isGameOver()) {
    console.log("The game is over in this position.");
    return;
  }
  // The app's analysis settings (threads, hash), so these checks match the per-move analysis.
  await withEngine(() => launchAnalysisEngine(), async (engine) => {
    await engine.configure({ MultiPV: lines });
    // Deep searches can take minutes under load; stop at the depth or after 30 s, whichever comes first.
    const result = await engine.search(start, { depth, movetimeMs: 30_000 }, moves);
    if (!result.lines.length) {
      console.log("Stockfish returned no lines.");
      return;
    }
    console.log(`${engine.name ?? "Stockfish"} at depth ${result.depth}, evals in pawns from White's point of view (#n = mate in n):`);
    result.lines.forEach((line, i) => console.log(`${i + 1}. ${pawns(sign * scoreToCp(line.score)).padEnd(6)} ${numbered(fen, uciToSanLine(fen, line.pv).slice(0, 14))}`));
  });
}

/** Lc0 shares the GPU with games and match batches; a probe would slow them down and skew their results. */
function lc0Busy(store: GameStore): string | null {
  const holder = lc0LockHolder();
  if (holder) return `${holder.what} (pid ${holder.pid}, since ${holder.since})`;
  return store.hasRecentGameInProgress() ? "a game being played right now" : null;
}

async function lc0(args: Args): Promise<void> {
  const weights = args.flag("weights");
  const cmd = resolveLc0Command(weights ? { ...process.env, LC0_WEIGHTS: resolve(weights) } : process.env);
  if (args.flag("list-options")) {
    await withEngine(() => launchEngine(cmd, "Lc0"), async (engine) => console.log(engine.optionLines.map((l) => l.replace(/^option name /, "")).join("\n")));
    return;
  }
  const store = openStore();
  const { fen, description, start, moves } = position(args, () => store);
  const busy = lc0Busy(store);
  if (busy) {
    throw new UsageError(`Lc0 is busy: ${busy}. A second Lc0 search now would slow that down and skew both. Base your advice on the recorded search data, or try again later.`);
  }
  const changes = Object.fromEntries(
    args.all("option").map((pair) => {
      const [name, ...value] = pair.split("=");
      if (!name || !value.length) throw new UsageError(`--option takes Name=Value (got "${pair}")`);
      return [name, value.join("=")];
    }),
  );
  await withLc0Lock("an agents lc0 probe", () =>
    withEngine(() => launchEngine(cmd, "Lc0"), async (engine) => {
      const known = new Map(engine.optionLines.map((l) => [/^option name (.+?) type /.exec(l)?.[1] ?? "", l]));
      for (const name of Object.keys(changes)) {
        if (known.has(name)) continue;
        const close = [...known.keys()].filter((k) => k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase()));
        throw new UsageError(`Lc0 has no option "${name}"${close.length ? `. Did you mean ${close.join(", ")}?` : ""} See: bun scripts/agents.ts lc0 --list-options`);
      }
      await engine.configure({ ...LC0_OPTIONS, ...changes });
      await engine.newGame();
      await engine.search(new Chess().fen(), { nodes: 1 }); // load the network first, as before a game
      const nodes = args.number("nodes");
      const movetimeMs = args.number("movetime", Number(process.env.LC0_MOVETIME_MS ?? MOVE_TIME_LIMIT_MS - 1000))!;
      const started = performance.now();
      const result = await engine.search(start, nodes ? { nodes } : { movetimeMs }, moves);
      const s = describeSearch(fen, result, nodes ? 0 : movetimeMs, performance.now() - started);
      const network = /Loading weights file from: (.+)/.exec(engine.startupLog)?.[1]?.trim() ?? "network not reported";
      console.log(`Position: ${description}, ${sideToMove(fen)} to move. FEN ${fen}`);
      console.log(`${engine.name ?? "Lc0"}, ${network}. Changed options: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.`);
      console.log(`Search: ${nodes ? `${nodes} nodes asked` : `${movetimeMs} ms given`}; ${s.nodes ?? "?"} nodes in ${(s.timeMs / 1000).toFixed(2)} s (${s.nps ?? "?"} nodes/s), depth ${s.depth}/${s.seldepth ?? "?"}.`);
      console.log(`Best: ${s.pv[0] ?? "none"}. Eval ${s.eval == null ? "?" : pawns(s.eval)} from White's point of view${s.wdl ? `, W/D/L ${s.wdl.map((x) => Math.round(x / 10)).join("/")}%` : ""}.`);
      if (s.pv.length) console.log(`PV: ${numbered(fen, s.pv)}`);
      if (s.candidates.length) {
        console.log("Root moves (N visits, P policy, Q expected score for the side to move):");
        for (const c of s.candidates.slice(0, 10)) console.log(`  ${c.san.padEnd(7)} N=${String(c.visits).padEnd(7)} P=${c.policy.toFixed(1).padStart(5)}%  Q=${c.q == null ? "-" : c.q.toFixed(3)}`);
      }
    }),
  );
}

async function save(args: Args): Promise<void> {
  const [idText, agent, file] = args.positional;
  if (!AGENT_NAMES.includes(agent as AgentName)) throw new UsageError(`The agent must be one of: ${AGENT_NAMES.join(", ")}`);
  const store = openStore();
  const game = loadGame(store, idText);
  if (file && !existsSync(file)) throw new UsageError(`There is no file ${file}`);
  const text = file ? readFileSync(file, "utf8") : await Bun.stdin.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`The report was not saved: it is not valid JSON (${(err as Error).message}).`);
  }
  const report = parseAgentReport(json, game, agent as AgentName);
  store.saveAgentReport(report);
  // Clear the agents' working copy, so the next run writes a fresh file.
  if (file && dirname(resolve(file)) === REPORTS_DIR) rmSync(file);
  console.log(`Saved the ${agent} report on game #${game.id}: ${report.keyMoments.length} key moments, ${report.suggestions.length} suggestions.`);
}

function selectGames(store: GameStore, ids: string[]): GameRecord[] {
  return ids.length ? ids.map((id) => loadGame(store, id)) : store.list("date", "asc");
}

const saved = (game: GameRecord, agent: AgentName) => game.agentReports.find((r) => r.agent === agent)?.createdAt;

function status(args: Args): void {
  const store = openStore();
  const games = selectGames(store, args.positional).filter((g) => args.positional.length || (g.status === "finished" && g.analysis));
  for (const game of games) {
    const reports = AGENT_NAMES.map((a) => `${a} ${saved(game, a)?.slice(0, 16).replace("T", " ") ?? "missing"}`);
    console.log(`#${game.id} ${game.status === "finished" ? game.result : game.status}, Lc0 as ${game.aiColor}${game.analysis ? "" : ", not analysed"}: ${reports.join(", ")}`);
  }
  if (!games.length) console.log("No finished, analysed games yet.");
}

function pending(args: Args): void {
  const store = openStore();
  const limit = args.number("limit", 10)!;
  const games = store.list("date", "asc").filter((g) => g.status === "finished" && g.analysis && AGENT_NAMES.some((a) => !saved(g, a)));
  for (const game of games.slice(0, limit)) console.log(`#${game.id} needs ${AGENT_NAMES.filter((a) => !saved(game, a)).join(" and ")}`);
  if (games.length > limit) console.log(`...and ${games.length - limit} more after these.`);
  if (!games.length) console.log("Every finished, analysed game has both agent reports.");
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function reports(args: Args): void {
  const store = openStore();
  const all = selectGames(store, args.positional).flatMap((g) => g.agentReports.map((report) => ({ game: g, report })));
  if (!all.length) {
    console.log("No agent reports yet.");
    return;
  }
  if (args.flag("suggestions")) {
    const rows = all.flatMap(({ game, report }) => report.suggestions.map((s) => ({ game, report, s })));
    rows.sort((a, b) => PRIORITY_ORDER[a.s.priority] - PRIORITY_ORDER[b.s.priority] || b.game.id - a.game.id);
    for (const { game, report, s } of rows) console.log(`[${s.priority}] game #${game.id}, ${report.agent}, ${s.area}: ${s.title}\n    change: ${s.change}`);
    return;
  }
  for (const { game, report } of all) console.log(formatReport(game, report));
}

function formatReport(game: GameRecord, report: AgentReport): string {
  const ply = (p: number) => `ply ${p} (${moveLabel(p, game.sanMoves[p - 1] ?? "?")})`;
  const lines = [`## Game #${game.id}: ${report.agent} report, saved ${report.createdAt.slice(0, 16).replace("T", " ")}`, "", report.summary, "", "Key moments:"];
  for (const m of report.keyMoments) {
    const better = m.betterMove ? ` Better: ${m.betterMove}${m.line?.length ? ` (${m.line.join(" ")})` : ""}.` : "";
    lines.push(`- ${ply(m.ply)}, ${m.title}: ${m.comment}${better}`);
  }
  lines.push("", "Suggestions:");
  for (const s of report.suggestions) {
    lines.push(`- [${s.priority}] ${s.title} (${s.area})`, `  ${s.detail}`, `  Change: ${s.change}`, `  Verify: ${s.verify}`);
    if (s.plies.length) lines.push(`  Seen at: ${s.plies.map(ply).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

const COMMANDS: Record<string, (args: Args) => void | Promise<void>> = {
  pending,
  status,
  game: (args) => {
    const store = openStore();
    const game = loadGame(store, args.positional[0]);
    process.stdout.write(formatGameForAgents(game, store.searchLog(game.id)));
  },
  stockfish,
  lc0,
  save,
  reports,
};

const [command, ...rest] = process.argv.slice(2);
const run = command ? COMMANDS[command] : undefined;
if (!run) {
  console.log(HELP);
  process.exit(command && command !== "help" ? 1 : 0);
}
try {
  await run(parseArgs(rest));
} catch (err) {
  // Usage and validation errors are meant for the agent to act on, so they print without a stack trace.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(err instanceof UsageError || (err instanceof Error && err.message.startsWith("The report was not saved")) ? 2 : 1);
}
