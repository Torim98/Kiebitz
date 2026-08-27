/**
 * Der Zug, den ein Brett hervorhebt.
 *
 * Zwei Wege führen zu ihm: das Nachspielen einer Zugliste (Analyse, Repertoire)
 * und der Unterschied zweier Stellungen (Aufgaben, Endspiele). Beide müssen
 * dieselben zwei Felder liefern, sonst markieren zwei Bretter der App
 * denselben Zug verschieden.
 */
import { describe, expect, it } from "vitest";
import { fenAfter, moveBetween, replaySans } from "./position";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("replaying a line", () => {
  it("gives the position and every move it played", () => {
    const { fen, moves } = replaySans(["e4", "e5", "Nf3"]);
    expect(fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    expect(moves).toEqual([
      { from: "e2", to: "e4" },
      { from: "e7", to: "e5" },
      { from: "g1", to: "f3" },
    ]);
  });

  it("stops at the first move the position does not allow", () => {
    const { fen, moves } = replaySans(["e4", "Qh8", "e5"]);
    expect(moves).toEqual([{ from: "e2", to: "e4" }]);
    expect(fen).toBe(fenAfter(["e4"]));
  });

  it("counts halfmoves, so a board that pages back keeps its own move", () => {
    const last = (sans: string[], count?: number) => {
      const { moves } = replaySans(sans, count);
      return moves[moves.length - 1] ?? null;
    };
    expect(last(["e4", "e5", "Nf3"], 2)).toEqual({ from: "e7", to: "e5" });
    expect(last(["e4"], 0)).toBeNull();
    expect(last([])).toBeNull();
  });

  it("starts from a shared position when one is given", () => {
    const base = "8/4P3/8/8/8/4k3/8/4K3 w - - 0 60";
    expect(replaySans(["e8=Q+"], undefined, base).moves).toEqual([
      { from: "e7", to: "e8", promo: "q" },
    ]);
  });
});

describe("the move between two positions", () => {
  it("reads a quiet move off the difference", () => {
    expect(moveBetween(START, fenAfter(["e4"]))).toEqual({ from: "e2", to: "e4" });
  });

  it("reads a capture, where one piece leaves the board", () => {
    const before = fenAfter(["e4", "d5"]);
    expect(moveBetween(before, fenAfter(["e4", "d5", "exd5"]))).toEqual({ from: "e4", to: "d5" });
  });

  it("names the king's move when the rook came along", () => {
    const before = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const after = "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1";
    expect(moveBetween(before, after)).toEqual({ from: "e1", to: "g1" });
  });

  it("ignores the pawn that en passant takes off a third square", () => {
    const before = "8/8/8/3pP3/8/8/8/4K2k w - d6 0 3";
    const after = "8/8/3P4/8/8/8/8/4K2k b - - 0 3";
    expect(moveBetween(before, after)).toEqual({ from: "e5", to: "d6" });
  });

  it("keeps the piece a pawn turned into", () => {
    const before = "8/4P3/8/8/8/8/8/4K2k w - - 0 1";
    const after = "4Q3/8/8/8/8/8/8/4K2k b - - 0 1";
    expect(moveBetween(before, after)).toEqual({ from: "e7", to: "e8", promo: "q" });
  });

  it("has no move for a position change · a new puzzle is not a move", () => {
    expect(moveBetween(START, "8/4P3/8/8/8/4k3/8/4K3 w - - 0 60")).toBeNull();
    expect(moveBetween(START, START)).toBeNull();
    expect(moveBetween("", START)).toBeNull();
    expect(moveBetween(START, "kaputt")).toBeNull();
  });
});
