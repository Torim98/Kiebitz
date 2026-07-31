import { describe, expect, it } from "vitest";
import {
  buildAllocation,
  buildPrescriptions,
  buildWeekPlan,
  puzzleDose,
  referenceRating,
  templateArea,
  weakestTheme,
  type AreaNeed,
} from "./plan";
import type { Finding } from "./findings";
import type { DeepInsights } from "./insights";
import type { AreaLoad, StudyTemplate } from "./study";
import type { PuzzleInsights } from "./puzzles";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test",
    severity: 60,
    tone: "bad",
    tab: "strength",
    titleKey: "fnd.rushTitle",
    bodyKey: "fnd.rushBody",
    params: {},
    lever: { area: "tactics", trainability: 1 },
    ...overrides,
  };
}

const NO_LOAD: AreaLoad[] = [];

function share(allocation: AreaNeed[], area: string): number {
  return allocation.find((need) => need.area === area)!.target;
}

describe("buildAllocation", () => {
  it("starts from the rating-band prior when there are no findings", () => {
    // Unter 1.400 dominiert Taktik, über 2.000 gewinnen Eröffnung und Endspiel.
    const beginner = buildAllocation([], NO_LOAD, 300, 1150);
    const advanced = buildAllocation([], NO_LOAD, 300, 2200);
    expect(share(beginner, "tactics")).toBeGreaterThan(share(advanced, "tactics"));
    expect(share(advanced, "endgames")).toBeGreaterThan(share(beginner, "endgames"));
    // Die Summe bleibt eine Verteilung.
    const total = beginner.reduce((sum, need) => sum + need.target, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2);
  });

  it("shifts the prior towards areas with evidence, without replacing it", () => {
    const plain = buildAllocation([], NO_LOAD, 300, 1600);
    const withEndgame = buildAllocation(
      [finding({ id: "eg", severity: 90, lever: { area: "endgames", trainability: 1 } })],
      NO_LOAD,
      300,
      1600
    );
    expect(share(withEndgame, "endgames")).toBeGreaterThan(share(plain, "endgames"));
    // Verschoben, nicht ersetzt: Spielen bleibt der größte oder zweitgrößte Posten.
    expect(share(withEndgame, "play")).toBeGreaterThan(15);
  });

  it("weights a finding by how well it can actually be trained", () => {
    const trainable = buildAllocation(
      [finding({ severity: 80, lever: { area: "endgames", trainability: 1 } })],
      NO_LOAD,
      300,
      1600
    );
    const barely = buildAllocation(
      [finding({ severity: 80, lever: { area: "endgames", trainability: 0.1 } })],
      NO_LOAD,
      300,
      1600
    );
    expect(share(trainable, "endgames")).toBeGreaterThan(share(barely, "endgames"));
  });

  it("ignores praise · a compliment is not a training need", () => {
    const plain = buildAllocation([], NO_LOAD, 300, 1600);
    const praised = buildAllocation(
      [finding({ tone: "good", severity: 95, lever: { area: "endgames", trainability: 1 } })],
      NO_LOAD,
      300,
      1600
    );
    expect(share(praised, "endgames")).toBe(share(plain, "endgames"));
  });

  it("reports the actual share from the recorded load", () => {
    const load: AreaLoad[] = [
      { area: "play", items: 20, minutes: 300 },
      { area: "tactics", items: 40, minutes: 100 },
      { area: "openings", items: 0, minutes: 0 },
      { area: "endgames", items: 0, minutes: 0 },
      { area: "analysis", items: 0, minutes: 0 },
    ];
    const allocation = buildAllocation([], load, 400, 1600);
    expect(allocation.find((need) => need.area === "play")!.actual).toBe(75);
    expect(allocation.find((need) => need.area === "openings")!.actual).toBe(0);
    // 300 Minuten in 28 Tagen sind 75 pro Woche.
    expect(allocation.find((need) => need.area === "play")!.actualMinutes).toBe(75);
  });
});

describe("buildPrescriptions", () => {
  const allocation = buildAllocation([], NO_LOAD, 300, 1600);

  it("gives at most one prescription per area and at most three in total", () => {
    const findings = [
      finding({ id: "a", severity: 90, lever: { area: "tactics", trainability: 1 } }),
      finding({ id: "b", severity: 85, lever: { area: "tactics", trainability: 1 } }),
      finding({ id: "c", severity: 80, lever: { area: "openings", trainability: 1 } }),
      finding({ id: "d", severity: 75, lever: { area: "endgames", trainability: 1 } }),
      finding({ id: "e", severity: 70, lever: { area: "play", trainability: 1 } }),
    ];
    const out = buildPrescriptions(findings, allocation, null, 5);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((p) => p.area)).size).toBe(3);
    // Der stärkere Befund eines Bereichs gewinnt.
    expect(out.map((p) => p.id)).toContain("a");
    expect(out.map((p) => p.id)).not.toContain("b");
  });

  it("prefers a neglected area over a slightly heavier finding in a saturated one", () => {
    const saturated: AreaNeed[] = [
      { area: "tactics", target: 30, actual: 60, minutes: 90, actualMinutes: 180, evidence: 0 },
      { area: "endgames", target: 20, actual: 0, minutes: 60, actualMinutes: 0, evidence: 0 },
      { area: "play", target: 30, actual: 30, minutes: 90, actualMinutes: 90, evidence: 0 },
      { area: "openings", target: 15, actual: 10, minutes: 45, actualMinutes: 30, evidence: 0 },
      { area: "analysis", target: 5, actual: 0, minutes: 15, actualMinutes: 0, evidence: 0 },
    ];
    const out = buildPrescriptions(
      [
        finding({ id: "tactics", severity: 60, lever: { area: "tactics", trainability: 1 } }),
        finding({ id: "endgames", severity: 45, lever: { area: "endgames", trainability: 1 } }),
      ],
      saturated,
      null,
      5
    );
    expect(out[0].id).toBe("endgames");
  });

  it("keeps the puzzle band and motif on the action, not just in the text", () => {
    const dose = { minRating: 1400, maxRating: 1650, perDay: 12, theme: "fork" };
    const out = buildPrescriptions(
      [finding({ id: "tactics", lever: { area: "tactics", trainability: 1 } })],
      allocation,
      dose,
      5
    );
    expect(out[0].action).toMatchObject({
      kind: "puzzles",
      theme: "fork",
      minRating: 1400,
      maxRating: 1650,
    });
    expect(out[0].doseKey).toBe("plan.dosePuzzlesTheme");
  });

  it("skips findings without a lever · there is nothing to prescribe", () => {
    const out = buildPrescriptions([finding({ lever: undefined })], allocation, null, 5);
    expect(out).toHaveLength(0);
  });
});

describe("puzzleDose", () => {
  function puzzles(bucket: { key: number; attempts: number; solved: number }): PuzzleInsights {
    return {
      personal_rating: 1500,
      attempts: 100,
      solved: 60,
      avg_puzzle_rating: 1500,
      avg_solved_rating: 1480,
      best_run: 5,
      current_run: 1,
      themes: [],
      by_rating: [bucket],
      by_weekday: [],
      by_hour: [],
      timeline: [],
    };
  }

  it("moves the band down when the current material is too hard", () => {
    const dose = puzzleDose(puzzles({ key: 1200, attempts: 40, solved: 14 }), 90, 5)!;
    expect(dose.maxRating).toBe(1500);
    expect(dose.minRating).toBe(1250);
  });

  it("moves it up when everything is being solved", () => {
    const dose = puzzleDose(puzzles({ key: 1200, attempts: 40, solved: 36 }), 90, 5)!;
    expect(dose.minRating).toBe(1500);
    expect(dose.maxRating).toBe(1750);
  });

  it("keeps the band around the rating in the productive range", () => {
    const dose = puzzleDose(puzzles({ key: 1200, attempts: 40, solved: 26 }), 90, 5)!;
    expect(dose.minRating).toBe(1400);
    expect(dose.maxRating).toBe(1650);
    // 90 Minuten ÷ 1,5 min ÷ 5 Tage = 12 pro Tag.
    expect(dose.perDay).toBe(12);
  });

  it("keeps the daily dose in a range a human will actually do", () => {
    const tiny = puzzleDose(puzzles({ key: 1200, attempts: 40, solved: 26 }), 1, 7)!;
    const huge = puzzleDose(puzzles({ key: 1200, attempts: 40, solved: 26 }), 5_000, 1)!;
    expect(tiny.perDay).toBe(5);
    expect(huge.perDay).toBe(60);
  });

  it("returns nothing without puzzle data", () => {
    expect(puzzleDose(null, 90, 5)).toBeNull();
  });
});

describe("weakestTheme", () => {
  it("ignores generic Lichess tags and strong motifs", () => {
    expect(
      weakestTheme([
        { theme: "short", attempts: 50, solved: 5 },
        { theme: "middlegame", attempts: 50, solved: 5 },
        { theme: "pin", attempts: 20, solved: 18 },
        { theme: "fork", attempts: 20, solved: 8 },
      ])
    ).toBe("fork");
  });

  it("stays silent below the sample threshold", () => {
    expect(weakestTheme([{ theme: "fork", attempts: 3, solved: 0 }])).toBeUndefined();
  });
});

describe("referenceRating", () => {
  it("weights the pools by games instead of averaging raw numbers", () => {
    const deep = {
      formats: {
        comparable: 2,
        formats: [
          { source: "chess.com", time_class: "blitz", rating: 1500, games: 90 },
          { source: "chess.com", time_class: "rapid", rating: 1500, games: 10 },
        ],
      },
    } as unknown as DeepInsights;
    const rating = referenceRating(deep)!;
    // Dieselbe Zahl bedeutet in beiden Pools nicht dasselbe: Rapid-Ratings
    // liegen bei schwächeren Spielern über dem Blitz-Rating derselben Person,
    // also steht Rapid 1500 für *weniger* Spielstärke. Der große Blitz-Pool
    // hält das Ergebnis trotzdem dicht bei 1500 · genau das leistet die
    // Gewichtung nach Partien.
    expect(rating).toBeLessThan(1500);
    expect(rating).toBeGreaterThan(1470);

    // Umgekehrte Gewichtung, gleiche Rohzahlen · das Ergebnis muss sich
    // verschieben, sonst würde nur der Mittelwert der Rohwerte gebildet.
    const rapidHeavy = referenceRating({
      formats: {
        comparable: 2,
        formats: [
          { source: "chess.com", time_class: "blitz", rating: 1500, games: 10 },
          { source: "chess.com", time_class: "rapid", rating: 1500, games: 90 },
        ],
      },
    } as unknown as DeepInsights)!;
    expect(rapidHeavy).toBeLessThan(rating);
  });

  it("returns null without any rated games", () => {
    const deep = { formats: { comparable: 0, formats: [] } } as unknown as DeepInsights;
    expect(referenceRating(deep)).toBeNull();
  });
});

describe("buildWeekPlan", () => {
  const templates: StudyTemplate[] = [
    { id: 1, title: "Opening training", duration_min: 20, tool: "Kiebitz Repertoire", description: "" },
    { id: 2, title: "Tactics", duration_min: 20, tool: "Kiebitz Puzzles", description: "" },
    { id: 3, title: "Endgame training", duration_min: 20, tool: "Kiebitz Endgames", description: "" },
  ];
  const monday = new Date(Date.UTC(2026, 6, 27));

  it("maps templates to areas through their tool", () => {
    expect(templateArea(templates[0])).toBe("openings");
    expect(templateArea(templates[1])).toBe("tactics");
    expect(templateArea(templates[2])).toBe("endgames");
    expect(templateArea({ ...templates[0], tool: "Notizbuch", title: "Nachdenken" })).toBeNull();
  });

  it("puts repertoire units on the days with the most due cards", () => {
    const allocation: AreaNeed[] = [
      { area: "openings", target: 100, actual: 0, minutes: 40, actualMinutes: 0, evidence: 1 },
    ];
    // Fälligkeitsspitzen an Tag 2 und 4.
    const plan = buildWeekPlan(allocation, templates, [0, 0, 30, 0, 25, 0, 0], [], monday);
    expect(plan).toHaveLength(2);
    expect(plan.map((unit) => unit.day)).toEqual(["2026-07-29", "2026-07-31"]);
  });

  it("respects the chosen training days", () => {
    const allocation: AreaNeed[] = [
      { area: "tactics", target: 100, actual: 0, minutes: 100, actualMinutes: 0, evidence: 1 },
    ];
    // Nur Montag und Dienstag.
    const plan = buildWeekPlan(allocation, templates, [], [true, true, false, false, false, false, false], monday);
    expect(plan.length).toBeGreaterThan(0);
    expect(new Set(plan.map((unit) => unit.day))).toEqual(
      new Set(["2026-07-27", "2026-07-28"])
    );
  });

  it("skips areas without a matching template instead of inventing one", () => {
    const allocation: AreaNeed[] = [
      { area: "play", target: 100, actual: 0, minutes: 120, actualMinutes: 0, evidence: 1 },
    ];
    expect(buildWeekPlan(allocation, templates, [], [], monday)).toHaveLength(0);
  });

  it("plans nothing for an area below a single unit's worth of budget", () => {
    const allocation: AreaNeed[] = [
      { area: "tactics", target: 2, actual: 0, minutes: 5, actualMinutes: 0, evidence: 0 },
    ];
    expect(buildWeekPlan(allocation, templates, [], [], monday)).toHaveLength(0);
  });
});
