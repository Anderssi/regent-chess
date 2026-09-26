import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM globals only for this file; server tests need Bun's own fetch/Response.
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe("client", () => {
  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });

  test("Board renders the position with pieces on the right squares", async () => {
    const { render } = await import("@testing-library/react");
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
    const { render } = await import("@testing-library/react");
    const { Board } = await import("../../src/client/components/Board.tsx");
    const { container } = render(<Board fen="8/8/8/8/8/8/8/K6k w - - 0 1" orientation="black" />);
    expect(container.querySelector("[data-square]")!.getAttribute("data-square")).toBe("h1");
  });

  test("Board draws on a fixed-size pixel canvas and labels squares for screen readers", async () => {
    const { render } = await import("@testing-library/react");
    const { Board } = await import("../../src/client/components/Board.tsx");
    const { SCENE_W, SCENE_H } = await import("../../src/client/iso/render.ts");
    const { container } = render(<Board fen="4k3/8/8/8/8/8/8/4K2R w - - 0 1" />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("width")).toBe(String(SCENE_W));
    expect(canvas.getAttribute("height")).toBe(String(SCENE_H));
    expect((container.querySelector(".board") as HTMLElement).style.width).toBe(`${SCENE_W * 2}px`);
    expect(container.querySelector('[data-square="h1"]')!.getAttribute("aria-label")).toBe("h1, white rook");
    expect(container.querySelector('[data-square="d4"]')!.getAttribute("aria-label")).toBe("d4, empty");
  });

  test("GameViewer steps through moves", async () => {
    const { render, fireEvent } = await import("@testing-library/react");
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

  test("GameViewer's move drawer collapses and expands", async () => {
    const { render, fireEvent } = await import("@testing-library/react");
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
});

test("replayPositions returns one position per ply plus the start", async () => {
  const { replayPositions } = await import("../../src/client/replay.ts");
  const positions = replayPositions(["e4", "e5"]);
  expect(positions).toHaveLength(3);
  expect(positions[2]!.lastMove).toEqual({ from: "e7", to: "e5" });
});

test("describeOutcome summarises finished games from Lc0's point of view", async () => {
  const { describeOutcome } = await import("../../src/client/format.ts");
  const text = describeOutcome({
    id: 1, createdAt: "", finishedAt: "", status: "finished", aiColor: "black", white: "S", black: "C",
    result: "0-1", termination: "timeout", sanMoves: [], pgn: "", aiEloEstimate: 1700,
    ratingBefore: 1500, ratingAfter: 1521, error: null, analysis: null,
  });
  expect(text).toBe("0-1 by time forfeit · Lc0 won · rating 1500 → 1521 (+21) · est. Elo this game: 1700");
});
