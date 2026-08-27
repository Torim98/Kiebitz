import { describe, expect, it } from "vitest";
import { measureRating, ratingNoise } from "./effect";
import type { MetricValue, MetricWindow, RatingPoint } from "./insights";

function windowOf(metrics: MetricValue[], ratings: RatingPoint[] = []): MetricWindow {
  return { from_ts: 0, to_ts: 1, games: 40, metrics, ratings };
}

describe("measureRating", () => {
  it("converts every pool before comparing", () => {
    // 100 Punkte chess.com Rapid sind auf der Referenzskala *mehr* als 100
    // Punkte: der Rapid-Pool ist in diesem Bereich gestaucht. Genau solche
    // Verzerrungen soll die Umrechnung sichtbar machen, statt Zahlen aus
    // verschiedenen Pools naiv gleichzusetzen.
    const rapid = measureRating([
      windowOf([], [
        { source: "chess.com", time_class: "rapid", first: 1400, last: 1500, games: 30 },
      ]),
    ])!;
    expect(rapid.pools).toBe(1);
    expect(rapid.games).toBe(30);
    expect(rapid.delta).toBeGreaterThan(100);

    // Blitz ist die Referenz selbst · dort bleiben 100 Punkte 100 Punkte.
    const blitz = measureRating([
      windowOf([], [
        { source: "chess.com", time_class: "blitz", first: 1400, last: 1500, games: 30 },
      ]),
    ])!;
    expect(blitz.delta).toBe(100);
    expect(rapid.delta).toBeGreaterThan(blitz.delta);
  });

  it("weights pools by games and keeps the weakest confidence", () => {
    const result = measureRating([
      windowOf([], [
        { source: "chess.com", time_class: "blitz", first: 1200, last: 1250, games: 80 },
        // Lichess-Klassisch hat keine gemessenen Stützstellen.
        { source: "lichess", time_class: "classical", first: 1700, last: 1700, games: 4 },
      ]),
    ])!;
    expect(result.pools).toBe(2);
    expect(result.confidence).toBe("estimated");
    // Der große Pool dominiert.
    expect(result.delta).toBeGreaterThan(40);
  });

  it("returns nothing without usable ratings", () => {
    expect(measureRating([windowOf([])])).toBeNull();
  });

  it("scales its noise floor with the number of games", () => {
    expect(ratingNoise(0)).toBe(0);
    expect(ratingNoise(100)).toBeGreaterThan(ratingNoise(25));
    // Vierfache Partienzahl heißt doppeltes Rauschen, nicht vierfaches.
    expect(ratingNoise(100)).toBe(2 * ratingNoise(25));
  });
});
