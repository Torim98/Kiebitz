import { describe, expect, it } from "vitest";
import { PIECE_KINDS } from "./art";
import { loadPieceGlyphs, pieceGlyphs, pieceGlyphsReady } from "./glyphs";
import { PIECE_SETS } from "./sets";

const CODES = PIECE_KINDS.flatMap((kind) => [`w${kind.toUpperCase()}`, `b${kind.toUpperCase()}`]);

/** Jedes Set einmal geholt · danach arbeiten die Prüfungen unten synchron. */
async function allGlyphs() {
  return Object.fromEntries(
    await Promise.all(PIECE_SETS.map(async (set) => [set.id, await loadPieceGlyphs(set.id)] as const))
  );
}

describe("piece glyphs", () => {
  it("draws all twelve pieces in every set", async () => {
    for (const [id, glyphs] of Object.entries(await allGlyphs())) {
      expect(Object.keys(glyphs).sort(), id).toEqual([...CODES].sort());
      // Zeichenbares SVG, kein Rest einer misslungenen Ableitung. Eine feste
      // Hülle gibt es nicht: Die Fremdsätze kommen als Gruppe, der klassische
      // Satz seit react-chessboard 5 als einzelner Pfad.
      for (const code of CODES) {
        expect(glyphs[code], `${id} ${code}`).toMatch(/^<(g|path|circle|use)[\s\S]*>$/);
      }
    }
  });

  // Weiß und Schwarz sind zwei Zeichnungen · wären sie gleich, hätte eine Figur
  // die falsche Farbe und verschwände auf ihrem Feld.
  it("gives black and white their own drawing", async () => {
    for (const [id, glyphs] of Object.entries(await allGlyphs())) {
      for (const kind of PIECE_KINDS) {
        const code = kind.toUpperCase();
        expect(glyphs[`w${code}`], `${id} ${code}`).not.toBe(glyphs[`b${code}`]);
      }
    }
  });

  // Der billigste Fehler beim Aufnehmen eines Sets ist die kopierte Zeile, die
  // niemand zu Ende geändert hat. Auf dem Brett stünden dann zwei gleiche
  // Figuren.
  it("draws every figure of a set differently", async () => {
    for (const [id, glyphs] of Object.entries(await allGlyphs())) {
      const drawings = PIECE_KINDS.map((kind) => glyphs[`w${kind.toUpperCase()}`]);
      expect(new Set(drawings).size, id).toBe(PIECE_KINDS.length);
    }
  });

  // Zwölf Figuren stehen gleichzeitig in einem Dokument. IDs gelten dort
  // dokumentweit, also darf keine zweimal vorkommen · sonst holen sich elf
  // Bauern den Verlauf des ersten (siehe scripts/generate-vendor-pieces.mjs).
  it("keeps every id of a set to itself", async () => {
    for (const [id, glyphs] of Object.entries(await allGlyphs())) {
      const seen = new Set<string>();
      for (const glyph of Object.values(glyphs)) {
        for (const [, name] of glyph.matchAll(/\sid="([^"]+)"/g)) {
          expect(seen.has(name), `${id}: ${name}`).toBe(false);
          seen.add(name);
        }
      }
    }
  });

  // Ein <style>-Block in einem eingebetteten SVG gilt für die ganze Seite.
  it("carries no stylesheet into the document", async () => {
    for (const [id, glyphs] of Object.entries(await allGlyphs())) {
      for (const glyph of Object.values(glyphs)) expect(glyph, id).not.toContain("<style");
    }
  });

  it("hands out the same table twice", async () => {
    expect(await loadPieceGlyphs("merida")).toBe(await loadPieceGlyphs("merida"));
    expect(pieceGlyphsReady("merida")).toBe(true);
    expect(pieceGlyphs("merida")).toBe(await loadPieceGlyphs("merida"));
  });
});
