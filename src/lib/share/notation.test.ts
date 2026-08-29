import { describe, expect, it } from "vitest";
import { notationText, plyOffset, shareHistory, trimNotation } from "./notation";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Nach 1.e4 c5 · Weiß am Zug im zweiten Zug.
const SICILIAN = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2";

describe("plyOffset", () => {
  it("counts the half moves before a position", () => {
    expect(plyOffset(START)).toBe(0);
    expect(plyOffset(SICILIAN)).toBe(2);
    expect(plyOffset("8/8/4k3/8/8/4K3/4P3/8 b - - 12 47")).toBe(93);
  });

  it("falls back to the first move for a broken FEN", () => {
    expect(plyOffset("nonsense")).toBe(0);
  });
});

describe("notationText", () => {
  it("numbers the moves like the board does", () => {
    expect(notationText(["e4", "e5", "Nf3"])).toBe("1.e4 e5 2.Nf3");
  });

  it("says where a line starting with Black begins", () => {
    expect(notationText(["Nc6", "d4"], 5)).toBe("3...Nc6 4.d4");
  });

  it("leaves that number out when text already runs before it", () => {
    expect(notationText(["Nc6", "d4"], 5, true)).toBe("Nc6 4.d4");
  });
});

describe("trimNotation", () => {
  const long = notationText(Array.from({ length: 60 }, () => "Nf3"));

  it("keeps a line that fits", () => {
    expect(trimNotation("1.e4 c5", 120)).toBe("1.e4 c5");
  });

  it("drops the opening, not the recent moves", () => {
    const short = trimNotation(long, 40);
    expect(short.startsWith("…")).toBe(true);
    expect(short.endsWith("30.Nf3 Nf3")).toBe(true);
    expect(new TextEncoder().encode(short).length).toBeLessThanOrEqual(40);
  });

  it("always resumes at a numbered move", () => {
    // Nach dem Auslassungszeichen muss klar sein, bei welchem Zug man ist.
    expect(trimNotation(long, 40).split(" ")[1]).toMatch(/^\d+\./);
  });
});

describe("shareHistory", () => {
  it("continues the line that came in with a shared position", () => {
    expect(shareHistory(["Bg4", "Be2"], 5, "…3.d4 exd4")).toBe("…3.d4 exd4 Bg4 4.Be2");
  });

  it("is empty without moves", () => {
    expect(shareHistory([])).toBe("");
  });
});
