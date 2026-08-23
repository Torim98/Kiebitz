import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, type SharePayload } from "./codec";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Nach 1. e4 c5: Schwarz hat gerade gezogen, Weiß hat ein e.p.-Feld hinter sich.
const SICILIAN = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2";
const ENDGAME = "8/8/4k3/8/8/4K3/4P3/8 w - - 12 47";

function roundTrip(payload: SharePayload): SharePayload {
  const decoded = decodeShare(encodeShare(payload));
  expect(decoded).not.toBeNull();
  return decoded!;
}

describe("share codec", () => {
  it("restores a position byte for byte, including castling, e.p. and clocks", () => {
    for (const fen of [START, SICILIAN, ENDGAME]) {
      expect(roundTrip({ kind: "analysis", fen, orientation: "white" }).fen).toBe(fen);
    }
  });

  it("keeps orientation, last move and variation", () => {
    const decoded = roundTrip({
      kind: "analysis",
      fen: SICILIAN,
      orientation: "black",
      lastMove: { from: "c7", to: "c5" },
      line: [
        { from: "g1", to: "f3" },
        { from: "d7", to: "d6" },
      ],
    });
    expect(decoded.orientation).toBe("black");
    expect(decoded.lastMove).toEqual({ from: "c7", to: "c5" });
    expect(decoded.line).toEqual([
      { from: "g1", to: "f3" },
      { from: "d7", to: "d6" },
    ]);
  });

  it("keeps a promotion piece", () => {
    const decoded = roundTrip({
      kind: "puzzle",
      fen: "8/4P3/8/8/8/4k3/8/4K3 w - - 0 1",
      orientation: "white",
      line: [{ from: "e7", to: "e8", promo: "n" }],
    });
    expect(decoded.line).toEqual([{ from: "e7", to: "e8", promo: "n" }]);
  });

  it("tells a mate score from a centipawn score", () => {
    expect(roundTrip({ kind: "analysis", fen: START, orientation: "white", eval: { cp: -240, mate: null } }).eval)
      .toEqual({ cp: -240, mate: null });
    expect(roundTrip({ kind: "analysis", fen: START, orientation: "white", eval: { cp: null, mate: -3 } }).eval)
      .toEqual({ cp: null, mate: -3 });
  });

  it("carries the puzzle extras", () => {
    const decoded = roundTrip({
      kind: "puzzle",
      fen: ENDGAME,
      orientation: "black",
      rating: 1780,
      theme: "backRankMate",
      title: "Findest du den Zug?",
    });
    expect(decoded.kind).toBe("puzzle");
    expect(decoded.rating).toBe(1780);
    expect(decoded.theme).toBe("backRankMate");
    expect(decoded.title).toBe("Findest du den Zug?");
  });

  it("cuts an over-long title on a character boundary", () => {
    const decoded = roundTrip({
      kind: "analysis",
      fen: START,
      orientation: "white",
      // Jedes Zeichen belegt zwei Bytes · die Grenze fällt mitten hinein.
      title: "ä".repeat(60),
    });
    expect(decoded.title).toBe("ä".repeat(40));
  });

  it("stays short enough for a chat line", () => {
    const payload = encodeShare({
      kind: "puzzle",
      fen: SICILIAN,
      orientation: "white",
      lastMove: { from: "c7", to: "c5" },
      line: [
        { from: "g1", to: "f3" },
        { from: "d7", to: "d6" },
      ],
      rating: 1600,
      theme: "fork",
    });
    expect(payload.length).toBeLessThan(80);
  });

  it("returns null for anything that is not one of our payloads", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("nonsense")).toBeNull();
    expect(decodeShare("!!!!")).toBeNull();
    // Abgeschnitten: die Belegung verspricht Figuren, die nicht mehr folgen.
    expect(decodeShare(encodeShare({ kind: "analysis", fen: START, orientation: "white" }).slice(0, 8))).toBeNull();
  });

  it("refuses a payload from a future format version", () => {
    const bytes = Uint8Array.from([2, 0, 0]);
    const future = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeShare(future)).toBeNull();
  });
});
