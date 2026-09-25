import { useCallback, useEffect, useState } from "react";
import type { GameRecord } from "../../shared/types.ts";
import { MOVE_TIME_LIMIT_MS, STOCKFISH_ELO } from "../../shared/rules.ts";
import { api, type Status } from "../api.ts";
import { GameViewer } from "./GameViewer.tsx";
import { describeOutcome } from "../format.ts";

export function PlayMode() {
  const [status, setStatus] = useState<Status | null>(null);
  const [game, setGame] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => api.status().then(setStatus).catch((e) => setError(e.message)), []);
  useEffect(() => void refreshStatus(), [refreshStatus]);

  // Poll the live game until it is finished and analysed.
  useEffect(() => {
    if (!game) return;
    const done = game.status !== "in_progress" && (game.status === "aborted" || game.analysis || game.sanMoves.length === 0);
    if (done) {
      void refreshStatus();
      return;
    }
    const t = setTimeout(() => api.getGame(game.id).then(setGame).catch((e) => setError(e.message)), 700);
    return () => clearTimeout(t);
  }, [game, refreshStatus]);

  const start = async () => {
    setError(null);
    try {
      setGame(await api.startGame());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = game?.status === "in_progress" || status?.playing;

  return (
    <section>
      <div className="toolbar">
        <button className="primary" onClick={start} disabled={!!busy}>
          {busy ? "Game in progress…" : "Start new game"}
        </button>
        {status && (
          <span className="muted">
            Claude's rating: <strong>{status.rating}</strong> · next game Claude plays {game?.status === "in_progress" ? game.claudeColor : status.nextClaudeColor} · Stockfish {STOCKFISH_ELO} · {MOVE_TIME_LIMIT_MS / 1000}s per move
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {game && (
        <>
          <h2>
            {game.white} vs {game.black}
          </h2>
          <p className="muted">{describeOutcome(game)}</p>
          <GameViewer sanMoves={game.sanMoves} analysis={game.analysis} orientation={game.claudeColor} followLatest={game.status === "in_progress"} />
        </>
      )}
    </section>
  );
}
