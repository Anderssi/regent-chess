import { useEffect, useMemo, useRef, useState } from "react";
import type { GameAnalysis } from "../../shared/types.ts";
import { replayPositions } from "../replay.ts";
import { Board } from "./Board.tsx";

export interface GameViewerProps {
  sanMoves: string[];
  startFen?: string;
  analysis?: GameAnalysis | null;
  orientation?: "white" | "black";
  /** Open on the final position and keep jumping to the newest move as moves arrive (live games). */
  followLatest?: boolean;
  /** The game is still being played: no autoplay. */
  live?: boolean;
  /** Time between moves when autoplaying. */
  autoplayMs?: number;
}

/** Long enough for the lift-and-place animation (and a capture's explosion) to finish between moves. */
const AUTOPLAY_MS = 1200;

const DRAWER_KEY = "regent.drawerOpen";

function readDrawerOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_KEY) !== "false";
  } catch {
    return true;
  }
}

function formatEval(cp: number): string {
  if (Math.abs(cp) >= 1000) return cp > 0 ? "+M" : "-M";
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export function GameViewer({ sanMoves, startFen, analysis, orientation = "white", followLatest, live, autoplayMs = AUTOPLAY_MS }: GameViewerProps) {
  const positions = useMemo(() => replayPositions(sanMoves, startFen), [sanMoves, startFen]);
  const [ply, setPly] = useState(followLatest ? sanMoves.length : 0);
  const [playing, setPlaying] = useState(false);
  const movesRef = useRef<HTMLDivElement>(null);
  /** The first step after pressing Autoplay comes quickly, so the button feels responsive. */
  const justStarted = useRef(false);
  /** Manual navigation; it pauses autoplay so the two never fight. */
  const go = (next: number | ((p: number) => number)) => {
    setPlaying(false);
    setPly(next);
  };
  const toggleAutoplay = () => {
    if (playing) return setPlaying(false);
    if (ply >= sanMoves.length) setPly(0); // at the end: play again from the start
    else justStarted.current = true;
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    if (ply >= sanMoves.length) return setPlaying(false);
    const delay = justStarted.current ? Math.min(250, autoplayMs) : autoplayMs;
    justStarted.current = false;
    const t = setTimeout(() => setPly((p) => Math.min(sanMoves.length, p + 1)), delay);
    return () => clearTimeout(t);
  }, [playing, ply, sanMoves.length, autoplayMs]);

  useEffect(() => {
    if (live) setPlaying(false);
  }, [live]);

  // Keep the current move visible in the list as the game plays through.
  useEffect(() => {
    movesRef.current?.querySelector(".move.current")?.scrollIntoView?.({ block: "nearest" });
  }, [ply]);
  const [drawerOpen, setDrawerOpen] = useState(readDrawerOpen);
  const toggleDrawer = () =>
    setDrawerOpen((open) => {
      try {
        localStorage.setItem(DRAWER_KEY, String(!open));
      } catch {}
      return !open;
    });

  useEffect(() => {
    if (followLatest) setPly(sanMoves.length);
    else setPly((p) => Math.min(p, sanMoves.length));
  }, [sanMoves.length, followLatest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") go((p) => Math.min(sanMoves.length, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sanMoves.length]);

  const position = positions[ply] ?? positions[0]!;
  const current = analysis?.plies[ply - 1];
  const rows: { num: number; white?: number; black?: number }[] = [];
  sanMoves.forEach((_, i) => {
    if (i % 2 === 0) rows.push({ num: i / 2 + 1, white: i + 1 });
    else rows[rows.length - 1]!.black = i + 1;
  });

  const moveCell = (p?: number) => {
    if (!p) return <td />;
    const info = analysis?.plies[p - 1];
    return (
      <td>
        <button className={`move ${p === ply ? "current" : ""}`} onClick={() => go(p)} title={info ? `accuracy ${info.accuracy}%, loss ${info.cpLoss}cp` : undefined}>
          {sanMoves[p - 1]}
          {info && info.cpLoss >= 100 && <span className="blunder">{info.cpLoss >= 300 ? "??" : "?"}</span>}
        </button>
      </td>
    );
  };

  return (
    <div className="viewer">
      <div className="viewer-board">
        <div className="stage">
          <Board fen={position.fen} orientation={orientation} lastMove={position.lastMove} fullscreen />
        </div>
        <div className="box nav-box">
          <div className="nav">
            <button onClick={() => go(0)} aria-label="First move">⏮</button>
            <button onClick={() => go((p) => Math.max(0, p - 1))} aria-label="Previous move">◀</button>
            <span className="ply-counter">{ply} / {sanMoves.length}</span>
            <button onClick={() => go((p) => Math.min(sanMoves.length, p + 1))} aria-label="Next move">▶</button>
            <button onClick={() => go(sanMoves.length)} aria-label="Last move">⏭</button>
            {!live && sanMoves.length > 0 && (
              <button className={`autoplay ${playing ? "playing" : ""}`} onClick={toggleAutoplay} aria-pressed={playing}>
                {playing ? "❚❚ Pause" : "Autoplay"}
              </button>
            )}
          </div>
          {current && (
            <p className="ply-info">
              {current.san}: eval {formatEval(current.evalAfter)}, accuracy {current.accuracy}%
              {current.bestMove && current.bestMove !== current.san && <> · best was {current.bestMove}</>}
            </p>
          )}
        </div>
      </div>
      <aside className={`drawer ${drawerOpen ? "open" : ""}`}>
        <button
          className="drawer-toggle"
          onClick={toggleDrawer}
          aria-expanded={drawerOpen}
          aria-controls="viewer-drawer"
          title={drawerOpen ? "Hide panel" : "Show panel"}
        >
          <span aria-hidden="true">{drawerOpen ? "▸" : "◂"}</span>
          <span className="drawer-label">{analysis ? "Moves · Accuracy" : "Moves"}</span>
        </button>
        <div className="viewer-side" id="viewer-drawer" hidden={!drawerOpen}>
          {analysis && (
            <table className="summary">
              <thead>
                <tr><th /><th>Accuracy</th><th>ACPL</th><th>Est. Elo</th></tr>
              </thead>
              <tbody>
                {(["white", "black"] as const).map((side) => (
                  <tr key={side}>
                    <th>{side === "white" ? "White" : "Black"}</th>
                    <td>{analysis[side].accuracy}%</td>
                    <td>{analysis[side].acpl}</td>
                    <td>{analysis[side].estimatedElo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="moves" ref={movesRef}>
            {rows.length === 0 && <p className="muted no-moves">No moves yet.</p>}
            <table>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.num}>
                    <td className="num">{r.num}.</td>
                    {moveCell(r.white)}
                    {moveCell(r.black)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>
  );
}
