import { useEffect, useMemo, useState } from "react";
import type { GameAnalysis } from "../../shared/types.ts";
import { replayPositions } from "../replay.ts";
import { Board } from "./Board.tsx";

export interface GameViewerProps {
  sanMoves: string[];
  startFen?: string;
  analysis?: GameAnalysis | null;
  orientation?: "white" | "black";
  /** Keep jumping to the newest move as moves arrive (live games). */
  followLatest?: boolean;
}

function formatEval(cp: number): string {
  if (Math.abs(cp) >= 1000) return cp > 0 ? "+M" : "-M";
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export function GameViewer({ sanMoves, startFen, analysis, orientation = "white", followLatest }: GameViewerProps) {
  const positions = useMemo(() => replayPositions(sanMoves, startFen), [sanMoves, startFen]);
  const [ply, setPly] = useState(followLatest ? sanMoves.length : 0);

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
      <div className="viewer-board">
        <Board fen={position.fen} orientation={orientation} lastMove={position.lastMove} />
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
      <div className="viewer-side">
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
        <div className="moves">
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
    </div>
  );
}
