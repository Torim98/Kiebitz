import { describe, expect, it } from "vitest";
import { chooseDiagramSource, criticalPly, DIAGRAM_SOURCES } from "./blatt";

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
    expect(criticalPly([undefined, "?!", "??", "?"], 40)).toBe(2);
  });

  it("takes the first mistake when nothing was thrown away", () => {
    expect(criticalPly([undefined, "?"], 40)).toBe(1);
  });

  it("shows the final position when the game was never analysed", () => {
    expect(criticalPly([], 38)).toBe(38);
    expect(criticalPly([undefined, "?!"], 38)).toBe(38);
  });
});
