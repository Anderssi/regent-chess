import { useEffect, useState } from "react";
import type { GameAnalysis, GameRecord } from "../../shared/types.ts";
import { api } from "../api.ts";
import { claudeScore, describeOutcome } from "../format.ts";
import { GameViewer } from "./GameViewer.tsx";

interface Selected {
  title: string;
  subtitle: string;
  sanMoves: string[];
  startFen?: string;
  analysis: GameAnalysis | null;
  orientation: "white" | "black";
  pgnUrl?: string;
}

export function AnalyseMode() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [sort, setSort] = useState<"date" | "elo">("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pasted, setPasted] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listGames(sort, order).then(setGames).catch((e) => setError(e.message));
  }, [sort, order]);

  const openGame = (g: GameRecord) =>
    setSelected({
      title: `#${g.id} ${g.white} vs ${g.black}`,
      subtitle: describeOutcome(g),
      sanMoves: g.sanMoves,
      analysis: g.analysis,
      orientation: g.claudeColor,
      pgnUrl: `/api/games/${g.id}/pgn`,
    });

  const analysePasted = async () => {
    setError(null);
    setAnalysing(true);
    try {
      const res = await api.analyse(pasted);
      setSelected({
        title: `${nameOr(res.headers.White, "White")} vs ${nameOr(res.headers.Black, "Black")}`,
        subtitle: `Pasted game · ${res.sanMoves.length} plies`,
        sanMoves: res.sanMoves,
        startFen: res.headers.FEN,
        analysis: res.analysis,
        orientation: "white",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <section className="analyse">
      <aside>
        <h3>Paste a game</h3>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="PGN or moves, e.g. 1. e4 e5 2. Nf3 Nc6 3. Bb5"
          rows={6}
        />
        <button className="primary" onClick={analysePasted} disabled={analysing || !pasted.trim()}>
          {analysing ? "Analysing with Stockfish…" : "Analyse"}
        </button>
        {error && <p className="error">{error}</p>}

        <h3>Previous games</h3>
        <div className="toolbar">
          <label>
            Sort by{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value as "date" | "elo")} aria-label="Sort by">
              <option value="date">Date</option>
              <option value="elo">Est. Elo</option>
            </select>
          </label>
          <button onClick={() => setOrder(order === "desc" ? "asc" : "desc")} aria-label="Toggle sort order">
            {order === "desc" ? "↓ desc" : "↑ asc"}
          </button>
        </div>
        <ul className="game-list">
          {games.length === 0 && <li className="muted">No games yet.</li>}
          {games.map((g) => (
            <li key={g.id}>
              <button onClick={() => openGame(g)}>
                <span>#{g.id} Claude as {g.claudeColor}</span>
                <span className={`badge ${claudeScore(g) ?? g.status}`}>{g.result ?? g.status.replace("_", " ")}</span>
                <span className="muted">Elo {g.claudeEloEstimate ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="analyse-main">
        {selected ? (
          <>
            <h2>{selected.title}</h2>
            <p className="muted">
              {selected.subtitle}
              {selected.pgnUrl && (
                <>
                  {" · "}
                  <a href={selected.pgnUrl}>Download PGN</a>
                </>
              )}
            </p>
            <GameViewer
              key={selected.title + selected.sanMoves.length}
              sanMoves={selected.sanMoves}
              startFen={selected.startFen}
              analysis={selected.analysis}
              orientation={selected.orientation}
            />
          </>
        ) : (
          <p className="muted">Pick a previous game or paste one to analyse it.</p>
        )}
      </div>
    </section>
  );
}

/** PGN uses "?" for unknown tags. */
function nameOr(value: string | undefined, fallback: string): string {
  return value && value !== "?" ? value : fallback;
}
