import { Chess } from "chess.js";
import type { AgentName, AgentReport, AgentSuggestion, KeyMoment } from "../../shared/types.ts";
import { moveLabel } from "../../shared/notation.ts";
import { tryMove } from "../game-loop.ts";

const PRIORITIES = ["high", "medium", "low"] as const;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Check a report an agent wrote against the game it is about, and return it in canonical form: moves in
 * standard SAN, unknown fields dropped. Throws one error listing every problem, so the agent can fix them in one go.
 */
export function parseAgentReport(
  input: unknown,
  game: { id: number; sanMoves: string[] },
  agent: AgentName,
  createdAt = new Date().toISOString(),
): AgentReport {
  const problems: string[] = [];
  const plyCount = game.sanMoves.length;
  const fens = positionsBefore(game.sanMoves);

  const object = (value: unknown, path: string): Json => {
    if (isObject(value)) return value;
    problems.push(`${path} must be a JSON object`);
    return {};
  };
  const text = (value: unknown, path: string): string => {
    if (typeof value === "string" && value.trim()) return value.trim();
    problems.push(`${path} must be a non-empty string`);
    return "";
  };
  const ply = (value: unknown, path: string): number => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= plyCount) return value;
    problems.push(`${path} must be a ply number from 1 to ${plyCount} (got ${JSON.stringify(value)})`);
    return 0;
  };
  const array = (value: unknown, path: string, min: number): unknown[] => {
    if (Array.isArray(value) && value.length >= min) return value;
    problems.push(min > 0 ? `${path} must be an array with at least ${min} entry` : `${path} must be an array`);
    return [];
  };

  const keyMoment = (value: unknown, path: string): KeyMoment => {
    const m = object(value, path);
    const moment: KeyMoment = { ply: ply(m.ply, `${path}.ply`), title: text(m.title, `${path}.title`), comment: text(m.comment, `${path}.comment`) };
    if (!moment.ply) return moment;
    const fen = fens[moment.ply - 1]!;
    const where = `in the position before ply ${moment.ply} (${moveLabel(moment.ply, game.sanMoves[moment.ply - 1]!)} was played there), FEN ${fen}`;
    if (m.betterMove !== undefined) {
      const move = typeof m.betterMove === "string" ? tryMove(new Chess(fen), m.betterMove) : null;
      if (move) moment.betterMove = move.san;
      else problems.push(`${path}.betterMove ${JSON.stringify(m.betterMove)} is not a legal move ${where}`);
    }
    if (m.line !== undefined) {
      if (!Array.isArray(m.line) || m.line.some((move) => typeof move !== "string")) {
        problems.push(`${path}.line must be an array of moves in SAN`);
        return moment;
      }
      const chess = new Chess(fen);
      const line: string[] = [];
      for (const [i, move] of (m.line as string[]).entries()) {
        const played = tryMove(chess, move);
        if (!played) {
          problems.push(`${path}.line[${i}] "${move}" is not legal after ${line.length ? `"${line.join(" ")}"` : "no moves"} ${where}`);
          break;
        }
        line.push(played.san);
      }
      if (moment.betterMove && line.length && line[0] !== moment.betterMove) {
        problems.push(`${path}.line must start with its betterMove (${moment.betterMove}), not ${line[0]}`);
      }
      moment.line = line;
    }
    return moment;
  };

  const suggestion = (value: unknown, path: string): AgentSuggestion => {
    const s = object(value, path);
    const priority = PRIORITIES.find((p) => p === s.priority);
    if (!priority) problems.push(`${path}.priority must be "high", "medium" or "low"`);
    const plies = s.plies === undefined ? [] : array(s.plies, `${path}.plies`, 0).map((p, i) => ply(p, `${path}.plies[${i}]`));
    return {
      title: text(s.title, `${path}.title`),
      priority: priority ?? "low",
      area: text(s.area, `${path}.area`),
      detail: text(s.detail, `${path}.detail`),
      plies: plies.filter((p) => p > 0),
      change: text(s.change, `${path}.change`),
      verify: text(s.verify, `${path}.verify`),
    };
  };

  const report = object(input, "The report");
  const summary = text(report.summary, "summary");
  const keyMoments = array(report.keyMoments, "keyMoments", 0).map((m, i) => keyMoment(m, `keyMoments[${i}]`));
  const suggestions = array(report.suggestions, "suggestions", 1).map((s, i) => suggestion(s, `suggestions[${i}]`));

  if (problems.length) throw new Error(`The report was not saved. Fix these problems and save it again:\n- ${problems.join("\n- ")}`);
  return { gameId: game.id, agent, createdAt, summary, keyMoments, suggestions };
}

/** The FEN before each ply of a game that starts from the standard position. */
function positionsBefore(sanMoves: string[]): string[] {
  const chess = new Chess();
  return sanMoves.map((san) => {
    const fen = chess.fen();
    chess.move(san);
    return fen;
  });
}
