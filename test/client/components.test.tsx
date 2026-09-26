import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AgentReport, GameRecord } from "../../src/shared/types.ts";

// DOM globals only for this file; server tests need Bun's own fetch/Response. Testing Library registers its
// own hooks as it loads, which Bun allows only at the top of a file, so it is imported here once the DOM exists.
GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
const { render, fireEvent, cleanup } = await import("@testing-library/react");

const record = (overrides: Partial<GameRecord> = {}): GameRecord => ({
  id: 1, createdAt: "", finishedAt: "", status: "finished", aiColor: "black", white: "S", black: "C",
  result: "0-1", termination: "timeout", sanMoves: [], pgn: "", aiEloEstimate: 1700,
  ratingBefore: 1500, ratingAfter: 1521, error: null, analysis: null, stockfishElo: 1600, aiSetup: null, agentReports: [], ...overrides,
});

describe("client", () => {
  afterEach(() => cleanup());

  test("Board renders the position with pieces on the right squares", async () => {
    const { Board } = await import("../../src/client/components/Board.tsx");
    const { container } = render(<Board fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" lastMove={{ from: "e2", to: "e4" }} />);
    const squares = container.querySelectorAll("[data-square]");
    expect(squares).toHaveLength(64);
    expect(squares[0]!.getAttribute("data-square")).toBe("a8");
    expect(container.querySelector('[data-square="e4"]')!.getAttribute("data-piece")).toBe("wp");
    expect(container.querySelector('[data-square="e2"]')!.getAttribute("data-piece")).toBeNull();
    expect(container.querySelector('[data-square="e1"]')!.getAttribute("data-piece")).toBe("wk");
  });

  test("Board can be flipped to Black's view", async () => {
    const { Board } = await import("../../src/client/components/Board.tsx");
    const { container } = render(<Board fen="8/8/8/8/8/8/8/K6k w - - 0 1" orientation="black" />);
    expect(container.querySelector("[data-square]")!.getAttribute("data-square")).toBe("h1");
  });

  test("Board draws on a fixed-size pixel canvas and labels squares for screen readers", async () => {
    const { Board } = await import("../../src/client/components/Board.tsx");
    const { SCENE_W, SCENE_H } = await import("../../src/client/iso/render.ts");
    const { container } = render(<Board fen="4k3/8/8/8/8/8/8/4K2R w - - 0 1" />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(SCENE_W));
    expect(canvas.getAttribute("height")).toBe(String(SCENE_H));
    expect((container.querySelector(".board") as HTMLElement).style.width).toBe(`${SCENE_W}px`);
    expect(container.querySelector('[data-square="h1"]')!.getAttribute("aria-label")).toBe("h1, white rook");
    expect(container.querySelector('[data-square="d4"]')!.getAttribute("aria-label")).toBe("d4, empty");
  });

  test("GameViewer steps through moves", async () => {
    const { GameViewer } = await import("../../src/client/components/GameViewer.tsx");
    const { getByLabelText, getByText, container } = render(<GameViewer sanMoves={["e4", "e5", "Nf3"]} />);
    expect(getByText("0 / 3")).toBeTruthy();
    fireEvent.click(getByLabelText("Next move"));
    expect(getByText("1 / 3")).toBeTruthy();
    expect(container.querySelector('[data-square="e4"]')!.getAttribute("data-piece")).toBe("wp");
    fireEvent.click(getByLabelText("Last move"));
    expect(container.querySelector('[data-square="f3"]')!.getAttribute("data-piece")).toBe("wn");
    fireEvent.click(getByText("e5"));
    expect(getByText("2 / 3")).toBeTruthy();
  });

  test("GameViewer autoplays through a finished game, and manual steps pause it", async () => {
    const { render, fireEvent, waitFor } = await import("@testing-library/react");
    const { GameViewer } = await import("../../src/client/components/GameViewer.tsx");
    const { getByText, getByLabelText, queryByText } = render(<GameViewer sanMoves={["e4", "e5", "Nf3"]} autoplayMs={20} />);
    fireEvent.click(getByText("Autoplay"));
    await waitFor(() => expect(getByText("3 / 3")).toBeTruthy());
    // It stops at the end; pressing it again replays from the start.
    await waitFor(() => expect(getByText("Autoplay")).toBeTruthy());
    fireEvent.click(getByText("Autoplay"));
    await waitFor(() => expect(getByText("1 / 3")).toBeTruthy());
    fireEvent.click(getByLabelText("Previous move"));
    expect(queryByText("❚❚ Pause")).toBeNull();
    expect(getByText("0 / 3")).toBeTruthy();
  });

  test("autoplay is hidden while a game is being played live", async () => {
    const { render } = await import("@testing-library/react");
    const { GameViewer } = await import("../../src/client/components/GameViewer.tsx");
    const { queryByText } = render(<GameViewer sanMoves={["e4"]} live followLatest />);
    expect(queryByText("Autoplay")).toBeNull();
  });

  test("GameViewer's move drawer collapses and expands", async () => {
    const { GameViewer } = await import("../../src/client/components/GameViewer.tsx");
    localStorage.removeItem("regent.drawerOpen");
    const { getByRole, container } = render(<GameViewer sanMoves={["e4"]} />);
    const toggle = getByRole("button", { name: /Moves/ });
    const panel = container.querySelector("#viewer-drawer") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(localStorage.getItem("regent.drawerOpen")).toBe("false");
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(false);
  });

  test("GameViewer's second drawer tab holds a side panel that can move the board", async () => {
    const { GameViewer } = await import("../../src/client/components/GameViewer.tsx");
    localStorage.removeItem("regent.drawerTab");
    const { getByRole, getByText, queryByText, container } = render(
      <GameViewer sanMoves={["e4", "e5", "Nf3"]} sidePanel={{ label: "Agents", render: (goToPly) => <button onClick={() => goToPly(1)}>see 1. e4</button> }} />,
    );
    expect(queryByText("see 1. e4")).toBeNull();
    fireEvent.click(getByRole("tab", { name: "Agents" }));
    expect(queryByText("Nf3")).toBeNull();
    fireEvent.click(getByText("see 1. e4"));
    expect(getByText("1 / 3")).toBeTruthy();
    expect(container.querySelector('[data-square="e4"]')!.getAttribute("data-piece")).toBe("wp");
    expect(localStorage.getItem("regent.drawerTab")).toBe("panel");
    fireEvent.click(getByRole("tab", { name: "Moves" }));
    expect(getByText("Nf3")).toBeTruthy();
  });
});

describe("AgentReports", () => {
  afterEach(() => cleanup());

  const analysed = (overrides: Partial<GameRecord> = {}) =>
    record({
      sanMoves: ["e4", "e5", "Nf3", "Nc6"],
      analysis: { plies: [], depth: 12, white: { moves: 2, acpl: 5, accuracy: 98, estimatedElo: 2900 }, black: { moves: 2, acpl: 5, accuracy: 98, estimatedElo: 2900 } },
      ...overrides,
    });
  const reports: AgentReport[] = [
    {
      gameId: 1, agent: "engine", createdAt: "2026-09-26T10:02:00.000Z", summary: "The search was thin.", keyMoments: [],
      suggestions: [
        { title: "Use more of the clock", priority: "low", area: "time management", detail: "It stopped early.", plies: [3], change: "Set LC0_MOVETIME_MS=4600", verify: "Compare nodes per move." },
        { title: "Raise CPuct", priority: "high", area: "search", detail: "It missed Nc6.", plies: [], change: "Add CPuct: 2.2 to LC0_OPTIONS", verify: "Probe ply 4." },
      ],
    },
    {
      gameId: 1, agent: "grandmaster", createdAt: "2026-09-26T10:01:00.000Z", summary: "A clean opening.",
      keyMoments: [{ ply: 3, title: "Natural development", comment: "Nf3 is best.", betterMove: "Nf3", line: ["Nf3", "Nc6"] }],
      suggestions: [{ title: "Keep it up", priority: "medium", area: "opening", detail: "Good.", plies: [], change: "Nothing.", verify: "Watch the next games." }],
    },
  ];

  test("shows both reports, the grandmaster's first, with suggestions ranked and moves that jump the board", async () => {
    const { AgentReports } = await import("../../src/client/components/AgentReports.tsx");
    const plies: number[] = [];
    let runs = 0;
    const { container, getAllByText, getByText, getByRole } = render(
      <AgentReports game={analysed({ agentReports: reports })} agents={{ enabled: true }} onRun={() => runs++} onGoToPly={(p) => plies.push(p)} />,
    );
    expect([...container.querySelectorAll("summary h3")].map((h) => h.textContent)).toEqual(["Grandmaster", "Engine developer"]);
    const engineTitles = [...container.querySelectorAll(".agent-report")[1]!.querySelectorAll(".suggestions strong")].map((s) => s.textContent);
    expect(engineTitles).toEqual(["Raise CPuct", "Use more of the clock"]);
    expect(getByText("Better: Nf3 Nc6")).toBeTruthy();
    expect(getByText("Set LC0_MOVETIME_MS=4600")).toBeTruthy();
    getAllByText("2. Nf3").forEach((link) => fireEvent.click(link));
    expect(plies).toEqual([3, 3]);
    fireEvent.click(getByRole("button", { name: "Re-run agents" }));
    expect(runs).toBe(1);
  });

  test("shows a running analysis, and a failed one with its Claude Code session", async () => {
    const { AgentReports } = await import("../../src/client/components/AgentReports.tsx");
    const since = "2026-09-26T10:00:00.000Z";
    const running = render(<AgentReports game={analysed({ agentRun: { status: "running", since } })} agents={{ enabled: true }} onRun={() => {}} onGoToPly={() => {}} />);
    expect(running.getByText(/are analysing this game/)).toBeTruthy();
    expect((running.getByRole("button", { name: "Run agents" }) as HTMLButtonElement).disabled).toBe(true);
    running.unmount();

    const failed = render(
      <AgentReports game={analysed({ agentRun: { status: "failed", since, error: "Not logged in", sessionId: "abc" } })} agents={{ enabled: true }} onRun={() => {}} onGoToPly={() => {}} />,
    );
    expect(failed.getByText(/The last agent run failed: Not logged in/)).toBeTruthy();
    expect(failed.getByText("claude --resume abc")).toBeTruthy();
    expect((failed.getByRole("button", { name: "Run agents" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("points to Claude Code when the server doesn't run the agents", async () => {
    const { AgentReports } = await import("../../src/client/components/AgentReports.tsx");
    const { getByText, queryByRole } = render(
      <AgentReports game={analysed()} agents={{ enabled: false, reason: "turned off with AGENT_ANALYSIS=off" }} onRun={() => {}} onGoToPly={() => {}} />,
    );
    expect(getByText("No agent reports yet.")).toBeTruthy();
    expect(getByText("/analyze-games 1")).toBeTruthy();
    expect(queryByRole("button", { name: /agents/ })).toBeNull();
  });
});

test("replayPositions returns one position per ply plus the start", async () => {
  const { replayPositions } = await import("../../src/client/replay.ts");
  const positions = replayPositions(["e4", "e5"]);
  expect(positions).toHaveLength(3);
  expect(positions[2]!.lastMove).toEqual({ from: "e7", to: "e5" });
});

test("describeOutcome summarises finished games from Pluto's point of view", async () => {
  const { describeOutcome } = await import("../../src/client/format.ts");
  expect(describeOutcome(record())).toBe("0-1 by time forfeit · Pluto won · rating 1500 → 1521 (+21) · est. Elo this game: 1700");
});

test("games stored under the old name show as Pluto", async () => {
  const { playerName } = await import("../../src/client/format.ts");
  expect(playerName("Lc0")).toBe("Pluto");
  expect(playerName("Stockfish (1600)")).toBe("Stockfish (1600)");
});

test("agentNote sums up a game's agent analysis for the game list", async () => {
  const { agentNote } = await import("../../src/client/format.ts");
  const since = "2026-09-26T10:00:00.000Z";
  expect(agentNote(record())).toBe("");
  expect(agentNote(record({ agentRun: { status: "queued", since } }))).toBe("agents analysing…");
  expect(agentNote(record({ agentRun: { status: "failed", since, error: "x" } }))).toBe("agent run failed");
  expect(agentNote(record({ agentReports: [{ gameId: 1, agent: "engine", createdAt: since, summary: "s", keyMoments: [], suggestions: [] }] }))).toBe("1 agent report");
});
