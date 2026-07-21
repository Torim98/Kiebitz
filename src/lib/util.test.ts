import { describe, it, expect, beforeEach } from "vitest";
import { de, deInt, evalLabel, winProb, fenAfter, setFormatLocale } from "./util";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("number formatting", () => {
  beforeEach(() => setFormatLocale("de"));

  it("de() uses German decimal comma with fixed digits", () => {
    expect(de(0.5, 1)).toBe("0,5");
    expect(de(1234.5, 1)).toBe("1.234,5");
    expect(de(2, 0)).toBe("2");
  });

  it("deInt() groups thousands", () => {
    expect(deInt(1477)).toBe("1.477");
    expect(deInt(1000000)).toBe("1.000.000");
  });

  it("follows the active locale", () => {
    setFormatLocale("en");
    expect(de(1234.5, 1)).toBe("1,234.5");
    expect(deInt(1477)).toBe("1,477");
  });
});

describe("evalLabel", () => {
  beforeEach(() => setFormatLocale("de"));

  it("prefixes a plus for non-negative and a real minus sign otherwise", () => {
    expect(evalLabel(50)).toBe("+0,5");
    expect(evalLabel(0)).toBe("+0,0");
    expect(evalLabel(-120)).toBe("−1,2"); // U+2212, not ASCII hyphen
  });
});

describe("winProb", () => {
  it("is 50% at an equal position and saturates with the advantage", () => {
    expect(winProb(0)).toBeCloseTo(50, 5);
    expect(winProb(1000)).toBeGreaterThan(97);
    expect(winProb(-1000)).toBeLessThan(3);
  });
});

describe("fenAfter", () => {
  it("returns the start position for empty/undefined input", () => {
    expect(fenAfter(undefined)).toBe(START_FEN);
    expect(fenAfter([])).toBe(START_FEN);
  });

  it("applies moves and respects the count limit", () => {
    const afterE4 = fenAfter(["e4"]);
    expect(afterE4.split(" ")[0]).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
    expect(afterE4.split(" ")[1]).toBe("b"); // black to move

    // count limits how many plies are applied
    expect(fenAfter(["e4", "e5", "Nf3"], 1)).toBe(afterE4);
  });

  it("stops at the last legal move on invalid input instead of throwing", () => {
    const fen = fenAfter(["e4", "totally-illegal"]);
    expect(fen.split(" ")[0]).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
  });
});
