import { describe, expect, it } from "vitest";
import { PIECE_KINDS } from "./art";
import { PIECE_SETS, glyphKey, isPieceSetId, pieceGlyphs, pieceSetDef } from "./sets";

const CODES = PIECE_KINDS.flatMap((kind) => [`w${kind.toUpperCase()}`, `b${kind.toUpperCase()}`]);

describe("piece sets", () => {
  it("draws all twelve pieces in every set", () => {
    for (const set of PIECE_SETS) {
      const glyphs = pieceGlyphs(set.id);
      expect(Object.keys(glyphs).sort()).toEqual([...CODES].sort());
      for (const code of CODES) expect(glyphs[code]).toMatch(/^<g>.*<\/g>$/s);
    }
  });

  // Weiß und Schwarz sind dieselbe Zeichnung in zwei Paletten · wären sie
  // gleich, hätte eine Figur die falsche Farbe und verschwände auf ihrem Feld.
  it("gives black and white their own palette", () => {
    for (const set of PIECE_SETS) {
      const glyphs = pieceGlyphs(set.id);
      for (const kind of PIECE_KINDS) {
        const code = kind.toUpperCase();
        expect(glyphs[`w${code}`]).not.toBe(glyphs[`b${code}`]);
      }
    }
  });

  it("hands out the same table twice", () => {
    expect(pieceGlyphs("kiebitz")).toBe(pieceGlyphs("kiebitz"));
  });

  it("keeps exactly one free set", () => {
    expect(PIECE_SETS.filter((set) => !set.plus).map((set) => set.id)).toEqual(["classic"]);
  });

  it("discards values it does not know", () => {
    expect(isPieceSetId("kiebitz")).toBe(true);
    expect(isPieceSetId("origami")).toBe(false);
    expect(pieceSetDef("origami" as never).id).toBe("classic");
  });

  it("reads a FEN letter as a glyph key", () => {
    expect(glyphKey("P")).toBe("wP");
    expect(glyphKey("k")).toBe("bK");
  });
});
