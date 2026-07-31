import { describe, expect, it } from "vitest";
import {
  cycleProgress,
  cycleWindows,
  measureEffect,
  measureRating,
  noiseFloor,
  ratingNoise,
} from "./effect";
import type { MetricValue, MetricWindow, RatingPoint } from "./insights";

function metric(overrides: Partial<MetricValue> = {}): MetricValue {
  return {
    key: "blunders_per100",
    value: 3,
    n: 1_200,
    sd: null,
    unit: "per100",
    lower_is_better: true,
    ...overrides,
  };
}

function windowOf(metrics: MetricValue[], ratings: RatingPoint[] = []): MetricWindow {
  return { from_ts: 0, to_ts: 1, games: 40, metrics, ratings };
}

describe("measureEffect", () => {
  it("calls a change within the noise floor unchanged", () => {
    // 3,0 → 2,8 bei 1.200 Zügen: das ist die übliche Schwankung, kein Erfolg.
    const before = windowOf([metric({ value: 3.0 })]);
    const after = windowOf([metric({ value: 2.8 })]);
    const result = measureEffect("blunders_per100", before, after);
    expect(result.verdict).toBe("unchanged");
    expect(result.delta).toBeCloseTo(-0.2, 5);
    expect(result.noise).toBeGreaterThan(0.2);
  });

  it("recognises a change that clears the noise floor", () => {
    const before = windowOf([metric({ value: 3.4 })]);
    const after = windowOf([metric({ value: 1.9 })]);
    const result = measureEffect("blunders_per100", before, after);
    expect(result.verdict).toBe("improved");
    expect(result.better).toBe(true);
  });

  it("respects the direction of the metric", () => {
    // Genauigkeit: mehr ist besser, also ist ein Rückgang eine Verschlechterung.
    const before = windowOf([
      metric({ key: "acc_overall", value: 78, sd: 8, n: 60, unit: "pct", lower_is_better: false }),
    ]);
    const after = windowOf([
      metric({ key: "acc_overall", value: 71, sd: 8, n: 60, unit: "pct", lower_is_better: false }),
    ]);
    const result = measureEffect("acc_overall", before, after);
    expect(result.verdict).toBe("worse");
    expect(result.better).toBe(false);
  });

  it("refuses a verdict when the sample is too small and says what is missing", () => {
    const before = windowOf([metric({ value: 3.0 })]);
    const after = windowOf([metric({ value: 1.0, n: 120 })]);
    const result = measureEffect("blunders_per100", before, after);
    expect(result.verdict).toBe("insufficient");
    expect(result.missing).toBe(280);
    // Der Stand darf trotzdem angezeigt werden · nur das Urteil fehlt.
    expect(result.after).toBe(1);
    expect(result.delta).toBeNull();
  });

  it("stays silent when a metric is missing entirely", () => {
    const result = measureEffect("acc_endgame", windowOf([]), windowOf([]));
    expect(result.verdict).toBe("insufficient");
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
  });

  it("shrinks the noise floor as the sample grows", () => {
    const small = noiseFloor(metric({ n: 200 }), metric({ n: 200 }))!;
    const large = noiseFloor(metric({ n: 5_000 }), metric({ n: 5_000 }))!;
    expect(large).toBeLessThan(small);
  });
});

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

describe("cycle helpers", () => {
  it("puts equally long windows before and after the start", () => {
    const start = 1_000_000;
    const { before, after } = cycleWindows(start, 14, start + 5 * 86_400);
    expect(before.to_ts).toBe(start);
    expect(start - before.from_ts).toBe(14 * 86_400);
    expect(after.from_ts).toBe(start);
  });

  it("caps the progress at a full cycle", () => {
    const start = 1_000_000;
    expect(cycleProgress(start, 14, start)).toBe(0);
    expect(cycleProgress(start, 14, start + 7 * 86_400)).toBe(50);
    expect(cycleProgress(start, 14, start + 30 * 86_400)).toBe(100);
  });
});
