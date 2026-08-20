import { describe, expect, it } from "vitest";
import { capturedFromFen } from "./captured";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Geschlagene Figuren", () => {
  it("zeigt in der Grundstellung nichts an", () => {
    expect(capturedFromFen(START)).toEqual({ white: [], black: [], diff: 0 });
  });

  it("listet fehlende Figuren der Gegenseite auf", () => {
    // Weiß fehlt ein Bauer, Schwarz fehlen ein Springer und ein Turm.
    const fen = "1nbqkb1r/pppppppp/8/8/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1";
    const view = capturedFromFen(fen);
    expect(view.white).toEqual(["n", "r"]);
    expect(view.black).toEqual(["p"]);
    // 5 + 3 gegen 1 · Weiß führt mit sieben Bauerneinheiten.
    expect(view.diff).toBe(7);
  });

  it("rechnet den Materialstand aus dem Rest, nicht aus der Schlagliste", () => {
    // Der b2-Bauer steht als zweite Dame auf a3. Geschlagen hat niemand etwas;
    // die Liste kann das nicht wissen und führt den Bauern als fehlend · der
    // Materialstand kommt deshalb aus dem Rest und sagt korrekt +8.
    const fen = "rnbqkbnr/pppppppp/8/8/8/Q7/1PPPPPPP/RNBQKBNR b KQkq - 0 1";
    const view = capturedFromFen(fen);
    expect(view.white).toEqual([]);
    expect(view.black).toEqual(["p"]);
    expect(view.diff).toBe(8);
  });

  it("bleibt bei gestellten Aufgaben stumm", () => {
    // Ein Endspiel-Drill ist keine Partie aus der Grundstellung · eine
    // Schlagliste gegen die Grundstellung wäre dort frei erfunden.
    expect(capturedFromFen("8/8/8/4k3/8/8/4K3/4R3 w - - 0 1", false)).toEqual({
      white: [],
      black: [],
      diff: 0,
    });
  });

  it("schweigt ohne beide Könige", () => {
    expect(capturedFromFen("8/8/8/4k3/8/8/8/8 w - - 0 1").white).toEqual([]);
  });

  it("verträgt leere Eingaben", () => {
    expect(capturedFromFen(null).diff).toBe(0);
    expect(capturedFromFen(undefined).diff).toBe(0);
  });
});
