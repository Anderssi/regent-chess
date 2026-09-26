import type { GameRecord, MoveSearch, PlyAnalysis } from "../../shared/types.ts";
import { formatMovetext, moveLabel } from "../../shared/notation.ts";
import { MOVE_TIME_LIMIT_MS } from "../../shared/rules.ts";

/** Pawns with a sign. The analysis clamps evaluations at ±10 pawns, which also covers forced mates. */
function pawns(cp: number): string {
  if (cp >= 1000) return "≥+10";
  if (cp <= -1000) return "≤-10";
  return `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}
const count = (n: number) => Math.round(n).toLocaleString("en-US");
const seconds = (ms: number) => (ms / 1000).toFixed(2);
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Everything the analysis agents need about one game, as plain text: the result, Stockfish's analysis of
 * every move and, for games played since it was recorded, Lc0's setup and its own view of each of its moves.
 */
export function formatGameForAgents(game: GameRecord, searchLog: (MoveSearch | null)[] | null): string {
  const out: string[] = [];
  const opponent = game.aiColor === "white" ? game.black : game.white;
  const plies = game.analysis?.plies ?? [];
  const isLc0 = (ply: number) => (ply % 2 === 1) === (game.aiColor === "white");
  const label = (ply: number) => moveLabel(ply, game.sanMoves[ply - 1] ?? "?");

  out.push(`# SchackMars game #${game.id}`, "");
  const aiName = game.aiColor === "white" ? game.white : game.black;
  out.push(
    `Played ${game.createdAt.slice(0, 16).replace("T", " ")} UTC. White: ${game.white}. Black: ${game.black}. ` +
      `Lc0${aiName === "Lc0" ? "" : ` (named ${aiName} in the app)`} played ${game.aiColor === "white" ? "White" : "Black"}.`,
  );
  if (game.status === "finished") {
    const won = game.result === "1/2-1/2" ? "drawn" : (game.result === "1-0") === (game.aiColor === "white") ? "Lc0 won" : "Lc0 lost";
    out.push(`Result: ${game.result} by ${game.termination?.replaceAll("_", " ")} after ${game.sanMoves.length} plies (${won}).`);
  } else {
    out.push(`Status: ${game.status.replace("_", " ")}${game.error ? ` (${game.error})` : ""} after ${game.sanMoves.length} plies.`);
  }
  if (game.ratingBefore != null && game.ratingAfter != null) out.push(`Lc0's running rating: ${game.ratingBefore} → ${game.ratingAfter}.`);
  out.push("", `Moves: ${formatMovetext(game.sanMoves)}`, "");

  out.push(`## Stockfish analysis`);
  if (game.analysis) {
    out.push(`Full-strength Stockfish, depth ${game.analysis.depth}.`);
    for (const side of ["white", "black"] as const) {
      const s = game.analysis[side];
      out.push(`${side === "white" ? "White" : "Black"} (${game[side]}): accuracy ${s.accuracy}%, average centipawn loss ${s.acpl}, estimated Elo ${s.estimatedElo}.`);
    }
  } else {
    out.push("Not analysed yet.");
  }
  out.push("");

  out.push("## Lc0 setup");
  const setup = game.aiSetup;
  if (setup) {
    out.push(`${setup.name}. Network: ${setup.network ?? "not reported"}. Backend: ${setup.backend ?? "not reported"}.`);
    out.push(`Search time ${setup.movetimeMs} ms per move (the move limit is ${MOVE_TIME_LIMIT_MS} ms). Command: ${setup.command.join(" ") || "not recorded"}.`);
    out.push(`UCI options set by the app: ${Object.entries(setup.options).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}; everything else is at Lc0's defaults.`);
  } else {
    out.push("Not recorded: this game was played before the app recorded Lc0's setup and search data, so only the moves and Stockfish's analysis are available.");
  }
  out.push("");

  const lc0Plies = plies.filter((p) => isLc0(p.ply));
  const searches = (searchLog ?? []).flatMap((s, i) => (s && isLc0(i + 1) ? [{ ply: i + 1, s }] : []));
  out.push("## Highlights");
  const costly = [...lc0Plies].filter((p) => p.cpLoss > 0).sort((a, b) => b.cpLoss - a.cpLoss).slice(0, 5);
  if (costly.length) {
    out.push(`- Lc0's costliest moves: ${costly.map((p) => `ply ${p.ply} ${label(p.ply)} (lost ${p.cpLoss} cp; best ${p.bestMove ?? "?"})`).join("; ")}.`);
  }
  const sign = game.aiColor === "white" ? 1 : -1;
  const winning = plies.find((p) => sign * p.evalAfter >= 500);
  if (winning) {
    out.push(`- Lc0 first had a winning position (at least +5 pawns for Lc0) after ply ${winning.ply} ${label(winning.ply)}; the game ended ${game.sanMoves.length - winning.ply} plies later.`);
  }
  if (searches.length) {
    const times = searches.map(({ s }) => s.timeMs);
    const nodes = searches.flatMap(({ s }) => (s.nodes == null ? [] : [s.nodes]));
    const nps = searches.flatMap(({ s }) => (s.nps == null ? [] : [s.nps]));
    const early = searches.filter(({ s }) => s.timeMs < 0.9 * s.movetimeMs).length;
    out.push(`- Lc0's search on its ${searches.length} moves: ${seconds(average(times))} s used on average (${seconds(Math.min(...times))}–${seconds(Math.max(...times))} s) of ${seconds(searches[0]!.s.movetimeMs)} s given; stopped before 90% of its time on ${early} moves.`);
    if (nodes.length) out.push(`- Nodes per move: ${count(average(nodes))} on average (${count(Math.min(...nodes))}–${count(Math.max(...nodes))}); ${count(average(nps))} nodes/s on average; depth ${Math.round(average(searches.map(({ s }) => s.depth)))} on average.`);
    const disagreements = searches
      .flatMap(({ ply, s }) => {
        const p = plies[ply - 1];
        return p && s.eval != null ? [{ ply, lc0: s.eval, stockfish: p.evalBefore }] : [];
      })
      .sort((a, b) => Math.abs(b.lc0 - b.stockfish) - Math.abs(a.lc0 - a.stockfish))
      .slice(0, 3)
      .filter((d) => Math.abs(d.lc0 - d.stockfish) >= 100);
    if (disagreements.length) {
      out.push(`- Where Lc0's eval differed most from Stockfish's (position before the move, White's view): ${disagreements.map((d) => `ply ${d.ply} ${label(d.ply)} (Lc0 ${pawns(d.lc0)}, Stockfish ${pawns(d.stockfish)})`).join("; ")}.`);
    }
  }
  if (out.at(-1) === "## Highlights") out.push("- None.");
  out.push("");

  out.push("## Moves");
  out.push(
    "Evals come from the full-strength Stockfish analysis, in pawns from White's point of view, before → after the move. " +
      'Loss is the centipawns the move lost against Stockfish\'s best move ("?" 100+, "??" 300+). "≥+10" means a forced mate or at least ten pawns.',
  );
  if (searches.length) {
    out.push(
      "Lc0 lines are Lc0's own view when it chose the move: eval and win/draw/loss chances (White's point of view), nodes and speed, depth/selective depth, " +
        "time used of time given, principal variation, and its most visited root moves (N visits, P network policy %, Q expected score for Lc0 from -1 to 1). " +
        "* marks the move Stockfish preferred.",
    );
  }
  out.push("");
  game.sanMoves.forEach((_, i) => {
    const ply = i + 1;
    const a: PlyAnalysis | undefined = plies[i];
    const who = isLc0(ply) ? "Lc0" : opponent;
    const flag = a && a.cpLoss >= 300 ? "??" : a && a.cpLoss >= 100 ? "?" : "";
    out.push(
      a
        ? `${label(ply)}${flag} (${who}): eval ${pawns(a.evalBefore)} → ${pawns(a.evalAfter)}, best ${a.bestMove ?? "none"}, loss ${a.cpLoss}, accuracy ${a.accuracy}`
        : `${label(ply)} (${who})`,
    );
    if (a) out.push(`   before: ${a.fenBefore}`);
    const s = isLc0(ply) ? searchLog?.[i] : null;
    if (s) out.push(...describeLc0Search(s, a?.bestMove ?? null));
  });
  return out.join("\n") + "\n";
}

function describeLc0Search(s: MoveSearch, stockfishBest: string | null): string[] {
  const facts = [
    `eval ${s.eval == null ? "?" : pawns(s.eval)}`,
    s.wdl ? `W/D/L ${s.wdl.map((x) => Math.round(x / 10)).join("/")}%` : null,
    s.nodes == null ? null : `${count(s.nodes)} nodes${s.nps == null ? "" : ` at ${count(s.nps)}/s`}`,
    `depth ${s.depth}${s.seldepth == null ? "" : `/${s.seldepth}`}`,
    `${seconds(s.timeMs)} of ${seconds(s.movetimeMs)} s`,
  ].filter(Boolean);
  const lines = [`   Lc0: ${facts.join(", ")}`];
  if (s.pv.length) lines.push(`   Lc0 pv: ${s.pv.join(" ")}`);
  if (s.candidates.length) {
    const shown = s.candidates.slice(0, 3);
    const best = s.candidates.find((c) => c.san === stockfishBest);
    if (best && !shown.includes(best)) shown.push(best);
    const q = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
    lines.push(`   Lc0 candidates: ${shown.map((c) => `${c.san}${c === best ? "*" : ""} N=${c.visits} P=${c.policy.toFixed(1)}% Q=${q(c.q)}`).join(" · ")}`);
  }
  return lines;
}
