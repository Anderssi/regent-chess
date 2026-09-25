import { Chess } from "chess.js";
import type { Color, GameAnalysis, PlyAnalysis, SideSummary } from "../shared/types.ts";
import { clampEval, eloFromAcpl, moveAccuracy, winPercent } from "./elo.ts";
import { scoreToCp, type UciEngine } from "./engine/uci.ts";
import { tryMove } from "./game-loop.ts";

export const DEFAULT_ANALYSIS_DEPTH = 12;

interface PositionEval {
  /** Centipawns from White's point of view, clamped. */
  whiteCp: number;
  bestMoveUci: string | null;
}

/** Evaluate a position at full strength. Terminal positions are scored without searching. */
async function evaluate(engine: UciEngine, chess: Chess, depth: number): Promise<PositionEval> {
  const whiteToMove = chess.turn() === "w";
  if (chess.isCheckmate()) return { whiteCp: whiteToMove ? -1000 : 1000, bestMoveUci: null };
  if (chess.isDraw()) return { whiteCp: 0, bestMoveUci: null };
  const { score, bestMove } = await engine.search(chess.fen(), { depth });
  const stmCp = clampEval(scoreToCp(score));
  return { whiteCp: whiteToMove ? stmCp : -stmCp, bestMoveUci: bestMove };
}

function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  const move = tryMove(new Chess(fen), uci);
  return move?.san ?? null;
}

function summarise(plies: PlyAnalysis[], color: Color): SideSummary {
  const mine = plies.filter((p) => p.color === color);
  if (mine.length === 0) return { moves: 0, acpl: 0, accuracy: 0, estimatedElo: 0 };
  const acpl = mine.reduce((s, p) => s + p.cpLoss, 0) / mine.length;
  const accuracy = mine.reduce((s, p) => s + p.accuracy, 0) / mine.length;
  return {
    moves: mine.length,
    acpl: Math.round(acpl * 10) / 10,
    accuracy: Math.round(accuracy * 10) / 10,
    estimatedElo: eloFromAcpl(acpl),
  };
}

/**
 * Analyse a game with Stockfish at full strength: evaluate every position, then measure how much
 * each move lost compared with the engine's evaluation of the position before it.
 * The engine must not be strength-limited.
 */
export async function analyseGame(
  engine: UciEngine,
  sanMoves: string[],
  opts: { depth?: number; startFen?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<GameAnalysis> {
  const depth = opts.depth ?? DEFAULT_ANALYSIS_DEPTH;
  const chess = opts.startFen ? new Chess(opts.startFen) : new Chess();
  await engine.newGame();

  const fens = [chess.fen()];
  const evals: PositionEval[] = [await evaluate(engine, chess, depth)];
  const moves: { san: string; color: Color }[] = [];
  for (const san of sanMoves) {
    const color: Color = chess.turn() === "w" ? "white" : "black";
    const move = tryMove(chess, san);
    if (!move) throw new Error(`Illegal move "${san}" at ply ${moves.length + 1}`);
    moves.push({ san: move.san, color });
    fens.push(chess.fen());
    evals.push(await evaluate(engine, chess, depth));
    opts.onProgress?.(moves.length, sanMoves.length);
  }

  const plies: PlyAnalysis[] = moves.map((m, i) => {
    const before = evals[i]!;
    const after = evals[i + 1]!;
    const sign = m.color === "white" ? 1 : -1;
    const moverBefore = sign * before.whiteCp;
    const moverAfter = sign * after.whiteCp;
    return {
      ply: i + 1,
      color: m.color,
      san: m.san,
      fenBefore: fens[i]!,
      fenAfter: fens[i + 1]!,
      evalBefore: before.whiteCp,
      evalAfter: after.whiteCp,
      bestMove: uciToSan(fens[i]!, before.bestMoveUci),
      cpLoss: Math.max(0, moverBefore - moverAfter),
      accuracy: Math.round(moveAccuracy(winPercent(moverBefore), winPercent(moverAfter)) * 10) / 10,
    };
  });

  return { plies, white: summarise(plies, "white"), black: summarise(plies, "black"), depth };
}
