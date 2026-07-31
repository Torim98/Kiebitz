import { describe, expect, it } from "vitest";
import { toReference } from "./formatScale";

describe("Zeitformat-Skala", () => {
  it("lässt die Referenzskala unverändert", () => {
    expect(toReference(1500, "chess.com", "blitz")).toEqual({
      value: 1500,
      confidence: "measured",
    });
  });

  it("rechnet chess.com Rapid nach unten, weil der Pool schwächer ist", () => {
    // 1255 Rapid entspricht 1000 Blitz · Rapid ist unten deutlich aufgeblasen.
    expect(toReference(1255, "chess.com", "rapid")?.value).toBe(1000);
    // Oben schließt sich die Lücke: 1995 Rapid ≈ 2000 Blitz.
    expect(toReference(1995, "chess.com", "rapid")?.value).toBe(2000);
  });

  it("beantwortet die Ausgangsfrage: Rapid 1000 gegen Blitz 1100", () => {
    const rapid = toReference(1000, "chess.com", "rapid")!;
    const blitz = toReference(1100, "chess.com", "blitz")!;
    // Entgegen der Intuition ist das Blitz-Rating hier klar mehr wert.
    expect(blitz.value).toBeGreaterThan(rapid.value);
  });

  it("interpoliert zwischen den Stützstellen von Lichess Blitz", () => {
    expect(toReference(1425, "lichess", "blitz")?.value).toBe(1000);
    expect(toReference(2080, "lichess", "blitz")?.value).toBe(2000);
    const middle = toReference(1655, "lichess", "blitz")!;
    expect(middle.value).toBeGreaterThan(1000);
    expect(middle.value).toBeLessThan(2000);
    expect(middle.confidence).toBe("measured");
  });

  it("kennzeichnet Werte außerhalb der Messspanne", () => {
    expect(toReference(2600, "lichess", "blitz")?.confidence).toBe("extrapolated");
    expect(toReference(600, "lichess", "blitz")?.confidence).toBe("extrapolated");
  });

  it("kennzeichnet Pools ohne Messwerte als Schätzung", () => {
    const classical = toReference(1600, "lichess", "classical");
    expect(classical?.confidence).toBe("estimated");
    // Der Klassisch-Pool ist schwächer besetzt · dasselbe Rating ist weniger wert.
    expect(classical!.value).toBeLessThan(toReference(1600, "lichess", "blitz")!.value);
  });

  it("gibt für Pools ohne Rating nichts zurück", () => {
    expect(toReference(1500, "manual", "rapid")).toBeNull();
    expect(toReference(null, "chess.com", "blitz")).toBeNull();
    expect(toReference(0, "chess.com", "blitz")).toBeNull();
  });

  it("bleibt monoton: mehr Rating heißt mehr auf der Vergleichsskala", () => {
    for (const [source, tc] of [
      ["chess.com", "blitz"],
      ["chess.com", "rapid"],
      ["chess.com", "bullet"],
      ["lichess", "blitz"],
    ] as const) {
      let previous = -Infinity;
      for (let rating = 600; rating <= 2600; rating += 50) {
        const value = toReference(rating, source, tc)!.value;
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });
});
