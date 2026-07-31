import { describe, expect, it } from "vitest";
import { accuraciesFromMoveEvals, accuracyFromLosses } from "./accuracy";
import type { MoveEvalRow } from "./analysis";

const row = (ply: number, evalCp: number, phase: MoveEvalRow["phase"]): MoveEvalRow => ({
  ply,
  san: "",
  eval_cp: evalCp,
  mate_in: null,
  best_uci: "",
  judgment: "",
  phase,
});

describe("analysis accuracy", () => {
  it("uses the same rounded loss formula as the native analyzer", () => {
    expect(accuracyFromLosses([0, 0, 0.01])).toBe(98.5);
    expect(accuracyFromLosses([])).toBeNull();
  });

  it("separates both players and phases from persisted move evaluations", () => {
    const result = accuraciesFromMoveEvals([
      row(1, 20, "opening"),
      row(2, 120, "opening"), // black loses winning probability
      row(3, 20, "middlegame"), // white loses winning probability
      row(4, 300, "endgame"),
    ], "black");

    // Perspective is deliberately black: mine and opponent must be swapped.
    expect(result.mine.opening).not.toBeNull();
    expect(result.mine.endgame).not.toBeNull();
    expect(result.mine.middlegame).toBeNull();
    expect(result.opponent.opening).toBe(100);
    expect(result.opponent.middlegame).not.toBeNull();
    expect(result.opponent.endgame).toBeNull();
    expect(result.mine.overall).not.toBe(result.opponent.overall);
  });

  it("keeps the overall fallback usable for legacy rows without a phase", () => {
    const legacy = {
      ...row(1, -80, "opening"),
      phase: "" as MoveEvalRow["phase"],
    };

    const result = accuraciesFromMoveEvals([legacy], "white");
    expect(result.mine.overall).not.toBeNull();
    expect(result.mine.opening).toBeNull();
    expect(result.mine.middlegame).toBeNull();
    expect(result.mine.endgame).toBeNull();
  });
});
