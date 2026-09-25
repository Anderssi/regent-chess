import { describe, expect, test } from "bun:test";
import { eloFromAcpl, expectedScore, moveAccuracy, updateRating, winPercent } from "../../src/server/elo.ts";

describe("winPercent", () => {
  test("is 50% at equality and symmetric", () => {
    expect(winPercent(0)).toBeCloseTo(50);
    expect(winPercent(300) + winPercent(-300)).toBeCloseTo(100);
  });
  test("clamps extreme evaluations", () => {
    expect(winPercent(100_000)).toBeCloseTo(winPercent(1000));
  });
});

describe("moveAccuracy", () => {
  test("a move that loses nothing is ~100% accurate", () => {
    expect(moveAccuracy(60, 60)).toBeCloseTo(100, 0);
  });
  test("an improving move counts as no loss", () => {
    expect(moveAccuracy(40, 70)).toBeCloseTo(100, 0);
  });
  test("a big drop gives low accuracy and stays within 0-100", () => {
    const acc = moveAccuracy(90, 10);
    expect(acc).toBeLessThan(10);
    expect(acc).toBeGreaterThanOrEqual(0);
  });
});

describe("eloFromAcpl", () => {
  test("decreases as average centipawn loss grows", () => {
    expect(eloFromAcpl(10)).toBeGreaterThan(eloFromAcpl(50));
    expect(eloFromAcpl(50)).toBeGreaterThan(eloFromAcpl(150));
  });
  test("is bounded", () => {
    expect(eloFromAcpl(0)).toBe(3100);
    expect(eloFromAcpl(10_000)).toBe(100);
  });
});

describe("Elo rating update", () => {
  test("expected score is 0.5 for equal ratings", () => {
    expect(expectedScore(1600, 1600)).toBeCloseTo(0.5);
  });
  test("win against a stronger opponent gains more than 16 points with K=32", () => {
    expect(updateRating(1500, 1600, 1, 32)).toBe(1520);
  });
  test("loss and draw", () => {
    expect(updateRating(1500, 1600, 0, 32)).toBe(1488);
    expect(updateRating(1500, 1600, 0.5, 32)).toBe(1504);
  });
});
