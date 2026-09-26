import { useEffect, useState } from "react";
import type { GameAnalysis, GameRecord } from "../../shared/types.ts";
import { api, type Status } from "../api.ts";
import { AI_NAME } from "../../shared/rules.ts";
import { agentNote, aiScore, describeOutcome, playerName } from "../format.ts";
import { AgentReports } from "./AgentReports.tsx";
import { GameViewer } from "./GameViewer.tsx";

interface Selected {
  title: string;
  subtitle: string;
  sanMoves: string[];
  startFen?: string;
  analysis: GameAnalysis | null;
  orientation: "white" | "black";
  pgnUrl?: string;
  /** For stored games: the record, kept fresh while its agent analysis runs. */
  game?: GameRecord;
}

const AGENT_POLL_MS = 3000;

export function AnalyseMode() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [sort, setSort] = useState<"date" | "elo">("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pasted, setPasted] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Status["agents"] | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);

  useEffect(() => {
    api.listGames(sort, order).then(setGames).catch((e) => setError(e.message));
  }, [sort, order]);

  useEffect(() => {
    api.status().then((s) => setAgents(s.agents)).catch(() => setAgents(null));
  }, []);

  /** Replace a stored game everywhere it is shown. */
  const refreshGame = (fresh: GameRecord) => {
    setGames((list) => list.map((g) => (g.id === fresh.id ? fresh : g)));
    setSelected((s) => (s?.game?.id === fresh.id ? { ...s, game: fresh, subtitle: describeOutcome(fresh) } : s));
  };

  // While the agents are on the selected game, poll it until their reports arrive or the run fails.
  const watched = selected?.game;
  useEffect(() => {
    if (!watched?.agentRun || watched.agentRun.status === "failed") return;
    const t = setTimeout(() => api.getGame(watched.id).then(refreshGame).catch((e) => setAgentError(e.message)), AGENT_POLL_MS);
    return () => clearTimeout(t);
  }, [watched]);

  const openGame = (g: GameRecord) => {
    setAgentError(null);
    setSelected({
      title: `#${g.id} ${playerName(g.white)} vs ${playerName(g.black)}`,
      subtitle: describeOutcome(g),
      sanMoves: g.sanMoves,
      analysis: g.analysis,
      orientation: g.aiColor,
      pgnUrl: `/api/games/${g.id}/pgn`,
      game: g,
    });
  };

  const runAgents = async (id: number) => {
    setAgentError(null);
    try {
      await api.runAgents(id);
      refreshGame(await api.getGame(id));
    } catch (e) {
      setAgentError((e as Error).message);
    }
  };

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

  const gameInfo = selected && (
    <p className="muted">
      {selected.subtitle}
      {selected.pgnUrl && (
        <>
          {" · "}
          <a href={selected.pgnUrl}>Download PGN</a>
        </>
      )}
    </p>
  );

  // Once a game is open the picker can be folded away, leaving a slim bar with the game's title.
  const hidden = panelHidden && selected !== null;

  return (
    <section className="mode with-side analyse">
      {!hidden && (
        <aside className="box side-panel">
          <div className="info">
            {selected ? (
              <>
                <button className="hide-panel" onClick={() => setPanelHidden(true)} aria-label="Hide game picker">
                  « Hide
                </button>
                <h2>{selected.title}</h2>
                {gameInfo}
              </>
            ) : (
              <p className="muted">Pick a previous game or paste one to analyse it.</p>
            )}
          </div>
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
                  <span>#{g.id} {AI_NAME} as {g.aiColor}</span>
                  <span className={`badge ${aiScore(g) ?? g.status}`}>{g.result ?? g.status.replace("_", " ")}</span>
                  <span className="muted">
                    Elo {g.aiEloEstimate ?? "—"}
                    {agentNote(g) && ` · ${agentNote(g)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <div className="analyse-main">
        {hidden && (
          <div className="box analyse-bar">
            <button onClick={() => setPanelHidden(false)} aria-label="Show game picker">
              » Games
            </button>
            <div className="info">
              <h2>{selected.title}</h2>
              {gameInfo}
            </div>
          </div>
        )}
        <GameViewer
          key={selected ? selected.title + selected.sanMoves.length : "empty"}
          sanMoves={selected?.sanMoves ?? []}
          startFen={selected?.startFen}
          analysis={selected?.analysis}
          orientation={selected?.orientation ?? "white"}
          sidePanel={
            selected?.game && {
              label: selected.game.agentReports.length ? `Agents (${selected.game.agentReports.length})` : "Agents",
              render: (goToPly) => (
                <AgentReports game={selected.game!} agents={agents} onRun={() => runAgents(selected.game!.id)} onGoToPly={goToPly} error={agentError} />
              ),
            }
          }
        />
      </div>
    </section>
  );
}

/** PGN uses "?" for unknown tags. */
function nameOr(value: string | undefined, fallback: string): string {
  return value && value !== "?" ? value : fallback;
}
