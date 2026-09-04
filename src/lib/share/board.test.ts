import { describe, expect, it } from "vitest";
import { loadPieceGlyphs, pieceGlyphs } from "../pieces/glyphs";
import { boardSvg, squareOrigin } from "./board";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("share board", () => {
  it("draws 64 squares and 32 pieces from the starting position", () => {
    const svg = boardSvg({ fen: START, orientation: "white", size: 800 });
    expect(svg.match(/<rect /g)).toHaveLength(64);
    // Jede Figur ist ein eingebettetes <svg> mit dem Ausschnitt des Bretts.
    expect(svg.match(/viewBox="1 1 43 43"/g)).toHaveLength(32);
  });

  // Die geteilte Stellung zeigt die Figuren des Absenders · ohne Angabe bleibt
  // es beim klassischen Satz, damit ein Link ohne Kontext nicht rät.
  //
  // Geholt werden die Zeichnungen vorher: `boardSvg` zeichnet, was zur Hand
  // ist, und ein Set kommt nachgeladen. Die Karte wartet dafür an einer Stelle
  // (`drawShareCard`), damit das Bild nicht den klassischen Satz trägt,
  // während auf dem Bildschirm ein anderer steht.
  it("draws the chosen piece set", async () => {
    await loadPieceGlyphs("kiebitz");
    const plain = boardSvg({ fen: START, orientation: "white", size: 800 });
    const own = boardSvg({ fen: START, orientation: "white", size: 800, pieceSet: "kiebitz" });
    expect(plain).toContain(pieceGlyphs("classic").wK);
    expect(own).toContain(pieceGlyphs("kiebitz").wK);
    expect(own).not.toContain(pieceGlyphs("classic").wK);
    expect(own.match(/viewBox="1 1 43 43"/g)).toHaveLength(32);
  });

  it("puts a1 in the lower left and turns the board around with the view", () => {
    expect(squareOrigin("a1", "white", 800)).toEqual({ x: 0, y: 700 });
    expect(squareOrigin("a1", "black", 800)).toEqual({ x: 700, y: 0 });
    expect(squareOrigin("h8", "white", 800)).toEqual({ x: 700, y: 0 });
  });

  it("colours a1 dark and h1 light, whichever way the board faces", () => {
    for (const orientation of ["white", "black"] as const) {
      const svg = boardSvg({ fen: "8/8/8/8/8/8/8/8 w - - 0 1", orientation, size: 8 });
      const a1 = squareOrigin("a1", orientation, 8);
      const h1 = squareOrigin("h1", orientation, 8);
      expect(svg).toContain(`<rect x="${a1.x}" y="${a1.y}" width="1" height="1" fill="#6f8155"`);
      expect(svg).toContain(`<rect x="${h1.x}" y="${h1.y}" width="1" height="1" fill="#e6e3d3"`);
    }
  });

  it("tints both squares of the last move", () => {
    const svg = boardSvg({
      fen: START,
      orientation: "white",
      size: 800,
      lastMove: { from: "e2", to: "e4" },
    });
    expect(svg.match(/fill="rgba\(34, 192, 138, 0\.32\)"/g)).toHaveLength(2);
  });

  it("adds shaft and head only when an arrow was asked for", () => {
    const plain = boardSvg({ fen: START, orientation: "white", size: 800 });
    expect(plain).not.toContain("<polygon");
    const arrow = boardSvg({
      fen: START,
      orientation: "white",
      size: 800,
      arrow: { from: "g1", to: "f3" },
    });
    expect(arrow).toContain("<line");
    expect(arrow).toContain("<polygon");
  });

  it("survives a position that is missing pieces or squares", () => {
    const svg = boardSvg({ fen: "8/8/8/8/8/8/8/8 w - - 0 1", orientation: "white", size: 400 });
    expect(svg.match(/<rect /g)).toHaveLength(64);
    expect(svg).not.toContain("viewBox=\"1 1 43 43\"");
  });
});
