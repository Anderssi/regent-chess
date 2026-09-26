import { useCallback, useEffect, useState } from "react";
import type { GameRecord } from "../../shared/types.ts";
import { AI_NAME, MOVE_TIME_LIMIT_MS, STOCKFISH_ELO } from "../../shared/rules.ts";
import { api, type Status } from "../api.ts";
import { GameViewer } from "./GameViewer.tsx";
import { describeOutcome, playerName } from "../format.ts";

export function PlayMode() {
  const [status, setStatus] = useState<Status | null>(null);
  const [game, setGame] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => api.status().then(setStatus).catch((e) => setError(e.message)), []);
  useEffect(() => void refreshStatus(), [refreshStatus]);

  // Open on the most recent game (live or finished), so the board is never empty.
  useEffect(() => {
    api
      .listGames("date", "desc")
      .then((games) => setGame((current) => current ?? games[0] ?? null))
      .catch((e) => setError(e.message));
  }, []);

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
    <section className="mode">
      <div className="box info">
        <div className="toolbar">
          <button className="primary" onClick={start} disabled={!!busy}>
            {busy ? "Game in progress…" : "Start new game"}
          </button>
          {status && (
            <span className="muted">
              {AI_NAME}'s rating: <strong>{status.rating}</strong> · next game {AI_NAME} plays {game?.status === "in_progress" ? game.aiColor : status.nextAiColor} · Stockfish {STOCKFISH_ELO} · {MOVE_TIME_LIMIT_MS / 1000}s per move
            </span>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {game ? (
          <>
            <h2>
              {playerName(game.white)} vs {playerName(game.black)}
            </h2>
            <p className="muted">{describeOutcome(game)}</p>
          </>
        ) : (
          <>
            <h2>The board awaits</h2>
            <p className="muted">Start a game to watch {AI_NAME} face Stockfish.</p>
          </>
        )}
      </div>
      {game ? (
        <GameViewer sanMoves={game.sanMoves} analysis={game.analysis} orientation={game.aiColor} followLatest />
      ) : (
        <GameViewer sanMoves={[]} orientation="white" />
      )}
    </section>
  );
}
