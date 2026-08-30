import { describe, expect, it } from "vitest";
import { moveTargetStyles, selectionStyles } from "./boardMoves";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Weißer Springer auf f3, schwarzer Bauer auf e5 · ein Schlag- und drei
// ruhige Züge.
const CAPTURE = "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2";

describe("board move hints", () => {
  it("marks every legal target of the selected piece", () => {
    const styles = moveTargetStyles(START, "e2");
    expect(Object.keys(styles).sort()).toEqual(["e3", "e4"]);
  });

  it("uses a ring for captures and a dot for quiet moves", () => {
    const styles = moveTargetStyles(CAPTURE, "f3");
    expect(String(styles.e5.background)).toContain("transparent 56%");
    expect(String(styles.g5.background)).toContain("20%");
  });

  it("returns nothing for empty squares or the opponent's pieces", () => {
    expect(moveTargetStyles(START, "e4")).toEqual({});
    expect(moveTargetStyles(START, "e7")).toEqual({});
    expect(moveTargetStyles(START, null)).toEqual({});
  });

  it("highlights the selected square alongside its targets", () => {
    const styles = selectionStyles(START, "g1");
    expect(Object.keys(styles).sort()).toEqual(["f3", "g1", "h3"]);
    // Die Farbe kommt aus dem Thema · geprüft wird, dass markiert wird.
    expect(String(styles.g1.background)).toBe("var(--color-mark)");
  });
});
