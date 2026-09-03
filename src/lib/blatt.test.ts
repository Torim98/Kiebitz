import { describe, expect, it } from "vitest";
import { chooseDiagramSource, criticalPly, DIAGRAM_SOURCES } from "./blatt";
import type { MoveEvalRow } from "./analysis";

const row = (judgment: MoveEvalRow["judgment"], ply: number): MoveEvalRow => ({
  ply,
  san: "e4",
  eval_cp: 0,
  mate_in: null,
  best_uci: "",
  judgment,
  phase: "middlegame",
});

describe("chooseDiagramSource", () => {
  const nothing = { game: false, repertoire: false, puzzle: false, endgame: false };

  it("prefers a new game", () => {
    expect(chooseDiagramSource({ ...nothing, game: true, puzzle: true })).toBe("game");
  });

  it("moves on to the next source that has something", () => {
    expect(chooseDiagramSource({ ...nothing, repertoire: true, puzzle: true })).toBe("repertoire");
    expect(chooseDiagramSource({ ...nothing, puzzle: true, endgame: true })).toBe("puzzle");
    expect(chooseDiagramSource({ ...nothing, endgame: true })).toBe("endgame");
  });

  it("says so when no source has anything", () => {
    expect(chooseDiagramSource(nothing)).toBeNull();
  });

  it("keeps the order the design set", () => {
    expect([...DIAGRAM_SOURCES]).toEqual(["game", "repertoire", "puzzle", "endgame"]);
  });
});

describe("criticalPly", () => {
  it("stops in front of the first blunder", () => {
    const rows = [row("", 0), row("inaccuracy", 1), row("blunder", 2), row("mistake", 3)];
    expect(criticalPly(rows, 40)).toBe(2);
  });

  it("takes the first mistake when nothing was thrown away", () => {
    expect(criticalPly([row("", 0), row("mistake", 1)], 40)).toBe(1);
  });

  it("shows the final position when the game was never analysed", () => {
    expect(criticalPly([], 38)).toBe(38);
    expect(criticalPly([row("", 0), row("inaccuracy", 1)], 38)).toBe(38);
  });
});
