import { Fragment, type ReactNode } from "react";
import { AGENT_NAMES, type AgentName, type AgentReport, type GameRecord } from "../../shared/types.ts";
import { moveLabel } from "../../shared/notation.ts";

const AGENT_TITLES: Record<AgentName, string> = { grandmaster: "Grandmaster", engine: "Engine developer" };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export interface AgentReportsProps {
  game: GameRecord;
  /** Whether the server runs the agents, and why not; null while unknown. */
  agents: { enabled: boolean; reason?: string } | null;
  onRun: () => void;
  onGoToPly: (ply: number) => void;
  error?: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The two Claude Code agents' reports on a game, and the state of their analysis. */
export function AgentReports({ game, agents, onRun, onGoToPly, error }: AgentReportsProps) {
  const run = game.agentRun;
  const busy = run?.status === "queued" || run?.status === "running";
  const ready = game.status === "finished" && !!game.analysis;
  const plyLink = (ply: number) => (
    <button className="ply-link" onClick={() => onGoToPly(ply)} title="Show on the board">
      {moveLabel(ply, game.sanMoves[ply - 1] ?? "?")}
    </button>
  );

  let status: ReactNode = null;
  if (run?.status === "queued") status = "Waiting for the agents…";
  else if (run?.status === "running") status = `The grandmaster and the engine developer are analysing this game (since ${when(run.since)})…`;
  else if (run?.status === "failed") {
    status = (
      <>
        The last agent run failed: {run.error}
        {run.sessionId && (
          <>
            {" "}
            See the session with <code>claude --resume {run.sessionId}</code>.
          </>
        )}
      </>
    );
  } else if (!game.agentReports.length) {
    status = ready ? "No agent reports yet." : "The agents analyse a game once it is finished and Stockfish has analysed it.";
  }

  return (
    <div className="agent-reports">
      {(status || (agents && ready) || error) && (
        <div className="agent-status" aria-live="polite">
          {status && <p className={run?.status === "failed" ? "error" : busy ? "busy" : "muted"}>{status}</p>}
          {agents?.enabled && ready && (
            <button onClick={onRun} disabled={busy}>
              {game.agentReports.length ? "Re-run agents" : "Run agents"}
            </button>
          )}
          {agents && !agents.enabled && ready && (
            <p className="muted">
              The server doesn't run the agents ({agents.reason}). In Claude Code, run <code>/analyze-games {game.id}</code>.
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
      {AGENT_NAMES.map((name) => {
        const report = game.agentReports.find((r) => r.agent === name);
        return report && <ReportView key={name} report={report} plyLink={plyLink} />;
      })}
    </div>
  );
}

function ReportView({ report, plyLink }: { report: AgentReport; plyLink: (ply: number) => ReactNode }) {
  const suggestions = [...report.suggestions].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return (
    <details className="agent-report" open>
      <summary>
        <h3>{AGENT_TITLES[report.agent]}</h3>
        <span className="muted">{when(report.createdAt)}</span>
      </summary>
      <p>{report.summary}</p>
      {report.keyMoments.length > 0 && (
        <>
          <h4>Key moments</h4>
          <ul className="moments">
            {report.keyMoments.map((m, i) => (
              <li key={i}>
                {plyLink(m.ply)} <strong>{m.title}</strong>
                <p>{m.comment}</p>
                {m.betterMove && <p className="muted">Better: {m.line?.length ? m.line.join(" ") : m.betterMove}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Suggestions</h4>
      <ol className="suggestions">
        {suggestions.map((s, i) => (
          <li key={i}>
            <p>
              <span className={`priority ${s.priority}`}>{s.priority}</span> <strong>{s.title}</strong> <span className="muted">· {s.area}</span>
            </p>
            <p>{s.detail}</p>
            <p className="change">
              <span className="label">Change</span> {s.change}
            </p>
            <p>
              <span className="label">Check</span> {s.verify}
            </p>
            {s.plies.length > 0 && (
              <p className="muted">
                Seen at{" "}
                {s.plies.map((p, j) => (
                  <Fragment key={p}>
                    {j > 0 && ", "}
                    {plyLink(p)}
                  </Fragment>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
