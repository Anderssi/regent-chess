import { describe, expect, test } from "bun:test";
import { analyseGame } from "../../src/server/analysis.ts";
import { fakeEngine } from "../helpers/fakes.ts";

describe("analyseGame", () => {
  test("measures centipawn loss per move from the mover's point of view", async () => {
    // Evaluations (side-to-move POV): start +20; after e4 (black to move) -30; after f6 (white to move) +250.
    const evals: Record<string, number> = { w0: 20, b1: -30, w2: 250 };
    let n = 0;
    const { engine } = fakeEngine({ evaluate: () => ({ cp: Object.values(evals)[n++] ?? 0 }) });
    await engine.init();
    const res = await analyseGame(engine, ["e4", "f6"], { depth: 1 });

    expect(res.plies).toHaveLength(2);
    const [e4, f6] = res.plies;
    // White: +20 -> +30 (White POV), gained ground, so no loss.
    expect(e4).toMatchObject({ san: "e4", color: "white", evalBefore: 20, evalAfter: 30, cpLoss: 0 });
    // Black: from Black's POV -30 -> -250, lost 220cp.
    expect(f6).toMatchObject({ san: "f6", color: "black", evalBefore: 30, evalAfter: 250, cpLoss: 220 });
    expect(res.white.acpl).toBe(0);
    expect(res.black.acpl).toBe(220);
    expect(res.white.estimatedElo).toBeGreaterThan(res.black.estimatedElo);
    expect(res.white.accuracy).toBeGreaterThan(res.black.accuracy);
  });

  test("scores checkmate without searching and reports best moves in SAN", async () => {
    const { engine } = fakeEngine({ evaluate: () => ({ cp: 0 }), bestMove: () => "e2e4" });
    await engine.init();
    const res = await analyseGame(engine, ["f3", "e5", "g4", "Qh4#"], { depth: 1 });
    expect(res.plies[3]!.evalAfter).toBe(-1000);
    expect(res.plies[0]!.bestMove).toBe("e4");
    expect(res.plies[2]!.cpLoss).toBe(0); // g4 evaluated 0 -> 0 by the fake engine
  });

  test("rejects illegal moves", async () => {
    const { engine } = fakeEngine();
    await engine.init();
    await expect(analyseGame(engine, ["e4", "e4"])).rejects.toThrow(/Illegal move "e4" at ply 2/);
  });
});
