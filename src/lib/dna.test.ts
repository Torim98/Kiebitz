import { describe, expect, it } from "vitest";
import { buildDna, weakestAxis } from "./dna";
import { buildInsights } from "./stats";
import type { DeepInsights } from "./insights";
import { DEMO_RECORDS, demoDeepInsights } from "../pages/insights/demo";

const live = buildInsights(DEMO_RECORDS, "de");
const axis = (deep: DeepInsights, key: string) =>
  buildDna(deep, live).find((a) => a.key === key)!;

describe("Spieler-DNA", () => {
  it("liefert sechs Achsen im Bereich 0 bis 100", () => {
    const axes = buildDna(demoDeepInsights(), live);
    expect(axes).toHaveLength(6);
    for (const a of axes) {
      expect(a.value).toBeGreaterThanOrEqual(0);
      expect(a.value).toBeLessThanOrEqual(100);
    }
  });

  it("dreht die Taktik-Achse: weniger Patzer heißt mehr Punkte", () => {
    const clean = demoDeepInsights();
    clean.benchmark.me!.blunders_per_100 = 0.8;
    const messy = demoDeepInsights();
    messy.benchmark.me!.blunders_per_100 = 5.5;
    expect(axis(clean, "tactics").value).toBeGreaterThan(axis(messy, "tactics").value);
  });

  it("stellt den Feldwert nur dort daneben, wo er berechenbar ist", () => {
    const axes = buildDna(demoDeepInsights(), live);
    expect(axes.find((a) => a.key === "tactics")!.field).not.toBeNull();
    // Verwertung und Verteidigung lassen sich für den Gegner nicht messen.
    expect(axes.find((a) => a.key === "conversion")!.field).toBeNull();
    expect(axes.find((a) => a.key === "defense")!.field).toBeNull();
  });

  it("markiert Achsen mit zu dünner Datenlage als unzuverlässig", () => {
    const thin = demoDeepInsights();
    thin.benchmark.me!.moves = 40;
    thin.content.conversion.games = 3;
    thin.time.games = 2;
    thin.time.moves = 20;
    const axes = buildDna(thin, live);
    expect(axes.find((a) => a.key === "tactics")!.reliable).toBe(false);
    expect(axes.find((a) => a.key === "conversion")!.reliable).toBe(false);
    expect(axes.find((a) => a.key === "time")!.reliable).toBe(false);
  });

  it("wählt als schwächste Achse nur eine belastbare", () => {
    const deep = demoDeepInsights();
    // Die Zeit-Achse wäre die schlechteste, hat aber keine Datengrundlage.
    deep.time.games = 1;
    deep.time.moves = 5;
    deep.time.trouble.share_pct = 90;
    const weakest = weakestAxis(buildDna(deep, live));
    expect(weakest?.reliable).toBe(true);
    expect(weakest?.key).not.toBe("time");
  });

  it("gibt ohne jede belastbare Achse null zurück", () => {
    const axes = buildDna(demoDeepInsights(), live).map((a) => ({ ...a, reliable: false }));
    expect(weakestAxis(axes)).toBeNull();
  });
});
