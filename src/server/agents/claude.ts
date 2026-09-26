import type { AgentLauncher, AgentLaunchResult } from "./runner.ts";

/**
 * The headless run may read the project, run the agents' CLI, write report files under data/agent-reports and
 * start the two subagents, all without asking. With --permission-mode dontAsk, anything else it tries is denied.
 * The rules also go in as settings, which the subagents inherit.
 */
const TOOLS = ["Bash", "Read", "Grep", "Glob", "Write", "Edit", "Agent"];
const ALLOWED = ["Read", "Grep", "Glob", "Agent", "Bash(bun scripts/agents.ts *)", "Edit(data/agent-reports/**)"];

/** Variables that mark a process as part of a running Claude Code session; a server started from Claude Code passes them on. */
const SESSION_VARIABLE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|SESSION_ATTENDED|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN))$/;

/** Claude Code: CLAUDE_PATH, else `claude` on PATH, else null. */
export function resolveClaudeCommand(env: Record<string, string | undefined> = process.env): string[] | null {
  if (env.CLAUDE_PATH) return [env.CLAUDE_PATH];
  const found = Bun.which("claude", { PATH: env.PATH ?? "" });
  return found ? [found] : null;
}

export function claudeCodeArgs(gameId: number): string[] {
  return [
    "-p",
    `/analyze-games ${gameId}`,
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--tools",
    TOOLS.join(","),
    "--allowedTools",
    ALLOWED.join(","),
    "--settings",
    JSON.stringify({ permissions: { allow: ALLOWED } }),
    "--strict-mcp-config",
    "--name",
    `SchackMars agents: game #${gameId}`,
  ];
}

/** Runs the /analyze-games skill on a game in headless Claude Code (`claude -p`), signed in as the user. */
export function claudeCodeLauncher(opts: {
  command: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
}): AgentLauncher {
  return async (gameId) => {
    const env = Object.fromEntries(
      Object.entries(opts.env ?? process.env).filter(([name, value]) => value !== undefined && !SESSION_VARIABLE.test(name)),
    ) as Record<string, string>;
    // Foreground subagents: the run ends when both are done, not at the idle limit -p puts on background work.
    env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
    const proc = Bun.spawn([...opts.command, ...claudeCodeArgs(gameId)], { cwd: opts.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, opts.timeoutMs);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (timedOut) {
      const limit = opts.timeoutMs >= 60_000 ? `${Math.round(opts.timeoutMs / 60_000)} minutes` : `${opts.timeoutMs / 1000} s`;
      return { ok: false, error: `Claude Code timed out after ${limit}` };
    }
    return parseClaudeOutput(stdout, stderr, code);
  };
}

/** Read the single JSON result that `claude -p --output-format json` prints. */
export function parseClaudeOutput(stdout: string, stderr: string, exitCode: number): AgentLaunchResult {
  let result: { is_error?: boolean; subtype?: string; result?: string; session_id?: string } | null = null;
  try {
    result = JSON.parse(stdout);
  } catch {}
  const ok = exitCode === 0 && result !== null && !result.is_error;
  const detail = result?.result?.trim() || result?.subtype || stderr.trim().slice(-500) || stdout.trim().slice(-500);
  return {
    ok,
    error: ok ? undefined : `Claude Code exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
    sessionId: result?.session_id,
    summary: result?.result,
  };
}
