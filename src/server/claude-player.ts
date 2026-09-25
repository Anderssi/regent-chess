import Anthropic from "@anthropic-ai/sdk";
import { formatMovetext } from "../shared/notation.ts";
import { PlayerFailure, type MoveRequest, type Player } from "./players.ts";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

const MOVE_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      move: { type: "string", description: "Your move in Standard Algebraic Notation, exactly as written in the legal move list" },
    },
    required: ["move"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are playing a game of chess against Stockfish. Play the strongest move you can find.
You have 5 seconds per move, so decide quickly.
Reply with your chosen move in Standard Algebraic Notation (SAN), copied exactly from the list of legal moves.`;

export function buildMovePrompt(req: MoveRequest): string {
  const lines = [
    `You are playing ${req.color}.`,
    `Position (FEN): ${req.fen}`,
    `Moves so far: ${req.sanHistory.length ? formatMovetext(req.sanHistory) : "(none, this is the first move)"}`,
    `Legal moves: ${req.legalMoves.join(" ")}`,
  ];
  const illegal = req.rejectedAttempts.filter((a) => a.move);
  if (illegal.length) {
    lines.push(`These moves you tried are not legal here: ${illegal.map((a) => a.move).join(", ")}. Choose from the legal moves.`);
  }
  return lines.join("\n");
}

export class ClaudePlayer implements Player {
  readonly name: string;

  constructor(
    private client: Anthropic = new Anthropic({ maxRetries: 0 }),
    private model: string = process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
  ) {
    this.name = `Claude (${model})`;
  }

  async getMove(req: MoveRequest): Promise<string> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 4000,
          // Low effort keeps thinking short enough to answer inside the 5-second move clock.
          output_config: { effort: "low", format: MOVE_FORMAT },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildMovePrompt(req) }],
        },
        { signal: req.signal, timeout: Math.max(1, req.timeLeftMs), maxRetries: 0 },
      );
    } catch (err) {
      if (isRetryable(err)) throw err;
      // Configuration problems (missing/invalid key, unknown model, bad request) won't fix themselves:
      // abort the game rather than letting Claude forfeit on time.
      throw new PlayerFailure(`Anthropic API error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.stop_reason === "refusal") throw new Error("model declined to answer");
    const text = response.content.find((b) => b.type === "text")?.text;
    const move = text ? (JSON.parse(text) as { move?: unknown }).move : undefined;
    if (typeof move !== "string" || !move) throw new Error(`no move in response (stop_reason: ${response.stop_reason})`);
    return move;
  }
}

/** Overload, rate limits, server errors, network failures and our own time-limit abort are worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIUserAbortError) return true;
  if (err instanceof Anthropic.APIError) return err.status === 408 || err.status === 409 || err.status === 429 || (err.status ?? 0) >= 500;
  return false;
}
