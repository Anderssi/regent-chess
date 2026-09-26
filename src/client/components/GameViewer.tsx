import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameAnalysis } from "../../shared/types.ts";
import { replayPositions } from "../replay.ts";
import { Board } from "./Board.tsx";

/** A second tab in the drawer, next to the moves. */
export interface SidePanel {
  label: string;
  /** `goToPly` shows the position after that ply on the board. */
  render: (goToPly: (ply: number) => void) => ReactNode;
}

export interface GameViewerProps {
  sanMoves: string[];
  startFen?: string;
  analysis?: GameAnalysis | null;
  orientation?: "white" | "black";
  /** Open on the final position and keep jumping to the newest move as moves arrive (live games). */
  followLatest?: boolean;
  sidePanel?: SidePanel;
}

const DRAWER_KEY = "regent.drawerOpen";
const TAB_KEY = "regent.drawerTab";

function readDrawerOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_KEY) !== "false";
  } catch {
    return true;
  }
}

function readTab(): "moves" | "panel" {
  try {
    return localStorage.getItem(TAB_KEY) === "panel" ? "panel" : "moves";
  } catch {
    return "moves";
  }
}

function formatEval(cp: number): string {
  if (Math.abs(cp) >= 1000) return cp > 0 ? "+M" : "-M";
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export function GameViewer({ sanMoves, startFen, analysis, orientation = "white", followLatest, sidePanel }: GameViewerProps) {
  const positions = useMemo(() => replayPositions(sanMoves, startFen), [sanMoves, startFen]);
  const [ply, setPly] = useState(followLatest ? sanMoves.length : 0);
  const [drawerOpen, setDrawerOpen] = useState(readDrawerOpen);
  const [tab, setTab] = useState(readTab);
  const boardRef = useRef<HTMLDivElement>(null);
  const toggleDrawer = () =>
    setDrawerOpen((open) => {
      try {
        localStorage.setItem(DRAWER_KEY, String(!open));
      } catch {}
      return !open;
    });
  const chooseTab = (next: "moves" | "panel") => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {}
  };
  const goToPly = (p: number) => {
    setPly(Math.max(0, Math.min(sanMoves.length, p)));
    // On narrow screens the drawer sits below the board.
    boardRef.current?.scrollIntoView?.({ block: "nearest" });
  };
  const panel = tab === "panel" ? sidePanel : undefined;

  useEffect(() => {
    if (followLatest) setPly(sanMoves.length);
    else setPly((p) => Math.min(p, sanMoves.length));
  }, [sanMoves.length, followLatest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(sanMoves.length, p + 1));
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
        <button className={`move ${p === ply ? "current" : ""}`} onClick={() => setPly(p)} title={info ? `accuracy ${info.accuracy}%, loss ${info.cpLoss}cp` : undefined}>
          {sanMoves[p - 1]}
          {info && info.cpLoss >= 100 && <span className="blunder">{info.cpLoss >= 300 ? "??" : "?"}</span>}
        </button>
      </td>
    );
  };

  return (
    <div className="viewer">
      <div className="viewer-board" ref={boardRef}>
        <div className="stage">
          <Board fen={position.fen} orientation={orientation} lastMove={position.lastMove} fullscreen />
        </div>
        <div className="box nav-box">
          <div className="nav">
            <button onClick={() => setPly(0)} aria-label="First move">⏮</button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Previous move">◀</button>
            <span className="ply-counter">{ply} / {sanMoves.length}</span>
            <button onClick={() => setPly((p) => Math.min(sanMoves.length, p + 1))} aria-label="Next move">▶</button>
            <button onClick={() => setPly(sanMoves.length)} aria-label="Last move">⏭</button>
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
          <span className="drawer-label">
            {analysis ? "Moves · Accuracy" : "Moves"}
            {sidePanel && ` · ${sidePanel.label}`}
          </span>
        </button>
        <div className={`viewer-side ${panel ? "wide" : ""}`} id="viewer-drawer" hidden={!drawerOpen}>
          {sidePanel && (
            <div className="side-tabs" role="tablist" aria-label="Drawer">
              <button role="tab" aria-selected={!panel} onClick={() => chooseTab("moves")}>
                Moves
              </button>
              <button role="tab" aria-selected={!!panel} onClick={() => chooseTab("panel")}>
                {sidePanel.label}
              </button>
            </div>
          )}
          {panel && (
            <div role="tabpanel" className="drawer-panel">
              {panel.render(goToPly)}
            </div>
          )}
          {!panel && analysis && (
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
          {!panel && (
            <div className="moves">
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
          )}
        </div>
      </aside>
    </div>
  );
}
