import { Chess } from "chess.js";
import { UciEngine, type UciTransport } from "../../src/server/engine/uci.ts";
import type { MoveRequest, Player } from "../../src/server/players.ts";

/**
 * A scripted UCI engine. `evaluate` returns the score (side-to-move POV) for a FEN;
 * the best move is the first legal move unless `bestMove` is given.
 */
export function fakeEngine(opts: {
  evaluate?: (fen: string) => { cp?: number; mate?: number };
  bestMove?: (fen: string) => string | null;
} = {}): { engine: UciEngine; sent: string[] } {
  const sent: string[] = [];
  let listener: (line: string) => void = () => {};
  let fen = new Chess().fen();
  const emit = (line: string) => queueMicrotask(() => listener(line));
  const transport: UciTransport = {
    write(line) {
      sent.push(line);
      if (line === "uci") {
        emit("id name FakeFish");
        emit("uciok");
      } else if (line === "isready") emit("readyok");
      else if (line.startsWith("position fen ")) fen = line.slice("position fen ".length);
      else if (line.startsWith("go")) {
        const score = opts.evaluate?.(fen) ?? { cp: 0 };
        const scoreText = score.mate != null ? `mate ${score.mate}` : `cp ${score.cp ?? 0}`;
        const move = opts.bestMove ? opts.bestMove(fen) : firstLegalUci(fen);
        emit(`info depth 5 multipv 1 score ${scoreText} pv ${move ?? ""}`);
        emit(`bestmove ${move ?? "(none)"}`);
      }
    },
    onLine(l) {
      listener = l;
    },
    close() {},
  };
  return { engine: new UciEngine(transport), sent };
}

export function firstLegalUci(fen: string): string | null {
  const m = new Chess(fen).moves({ verbose: true })[0];
  return m ? m.from + m.to + (m.promotion ?? "") : null;
}

/** A player that answers from a script; each entry is a move string or a function. */
export function scriptedPlayer(
  name: string,
  script: (string | ((req: MoveRequest) => Promise<string> | string))[],
): Player & { requests: MoveRequest[] } {
  const requests: MoveRequest[] = [];
  let i = 0;
  return {
    name,
    requests,
    async getMove(req) {
      requests.push(req);
      const step = script[i++];
      if (step === undefined) throw new Error(`${name} ran out of scripted moves`);
      return typeof step === "function" ? step(req) : step;
    },
  };
}

/** Plays the first legal move every time. Deterministic and instant. */
export function firstMovePlayer(name = "First-move bot"): Player {
  return { name, getMove: async (req) => req.legalMoves[0]! };
}
