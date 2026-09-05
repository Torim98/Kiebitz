import { describe, expect, it } from "vitest";
import {
  chooseDiagramSource,
  criticalPly,
  DIAGRAM_SOURCES,
  naechsterZeitraum,
  zeitraumStart,
  ZEITRAEUME,
} from "./blatt";

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

describe("zeitraumStart", () => {
  // Mitten im Jahr, mitten im Monat, mitten am Tag · so unterscheiden sich die
  // drei Grenzen sichtbar voneinander.
  const jetzt = new Date(2026, 8, 5, 18, 43, 21);

  it("has no lower bound for all games", () => {
    expect(zeitraumStart("alle", jetzt)).toBe(0);
  });

  it("cuts at the local start of the day, month and year", () => {
    expect(zeitraumStart("heute", jetzt)).toBe(new Date(2026, 8, 5).getTime() / 1000);
    expect(zeitraumStart("monat", jetzt)).toBe(new Date(2026, 8, 1).getTime() / 1000);
    expect(zeitraumStart("jahr", jetzt)).toBe(new Date(2026, 0, 1).getTime() / 1000);
  });

  it("keeps the bounds in order, widest last", () => {
    const seit = ZEITRAEUME.filter((z) => z !== "alle").map((z) => zeitraumStart(z, jetzt));
    expect([...seit].sort((a, b) => b - a)).toEqual(seit);
  });
});

describe("naechsterZeitraum", () => {
  it("steps through the four fields and back to the start", () => {
    expect(naechsterZeitraum("alle")).toBe("heute");
    expect(naechsterZeitraum("heute")).toBe("monat");
    expect(naechsterZeitraum("monat")).toBe("jahr");
    expect(naechsterZeitraum("jahr")).toBe("alle");
  });
});
