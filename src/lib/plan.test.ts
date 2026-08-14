import { describe, expect, it } from "vitest";
import {
  buildAllocation,
  buildHygiene,
  buildPrescriptions,
  buildWeekPlan,
  puzzleDose,
  referenceRating,
  sessionMinutes,
  weakestTheme,
  type AreaNeed,
} from "./plan";
import type { Finding } from "./findings";
import type { DeepInsights } from "./insights";
import type { Area, StudyTemplate } from "./study";
import type { WeekArea } from "./week";
import type { PuzzleInsights } from "./puzzles";
import type { LiveInsights } from "./stats";
import { demoDeepInsights } from "../pages/insights/demo";

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

function share(allocation: AreaNeed[], area: string): number {
  return allocation.find((need) => need.area === area)!.target;
}

describe("buildAllocation", () => {
  it("starts from the rating-band prior when there are no findings", () => {
    // Unter 1.400 dominiert Taktik, über 2.000 gewinnen Eröffnung und Endspiel.
    const beginner = buildAllocation([], 300, 1150);
    const advanced = buildAllocation([], 300, 2200);
    expect(share(beginner, "tactics")).toBeGreaterThan(share(advanced, "tactics"));
    expect(share(advanced, "endgames")).toBeGreaterThan(share(beginner, "endgames"));
    // Die Summe bleibt eine Verteilung.
    const total = beginner.reduce((sum, need) => sum + need.target, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2);
  });

  it("shifts the prior towards areas with evidence, without replacing it", () => {
    const plain = buildAllocation([], 300, 1600);
    const withEndgame = buildAllocation(
      [finding({ id: "eg", severity: 90, lever: { area: "endgames", trainability: 1 } })],
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
      300,
      1600
    );
    const barely = buildAllocation(
      [finding({ severity: 80, lever: { area: "endgames", trainability: 0.1 } })],
      300,
      1600
    );
    expect(share(trainable, "endgames")).toBeGreaterThan(share(barely, "endgames"));
  });

  it("ignores praise · a compliment is not a training need", () => {
    const plain = buildAllocation([], 300, 1600);
    const praised = buildAllocation(
      [finding({ tone: "good", severity: 95, lever: { area: "endgames", trainability: 1 } })],
      300,
      1600
    );
    expect(share(praised, "endgames")).toBe(share(plain, "endgames"));
  });

});

describe("buildPrescriptions", () => {
  const allocation = buildAllocation([], 300, 1600);

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

  it("orders coaching insights strictly by finding priority", () => {
    const saturated: AreaNeed[] = [
      { area: "tactics", target: 30, minutes: 90, evidence: 0 },
      { area: "endgames", target: 20, minutes: 60, evidence: 0 },
      { area: "play", target: 30, minutes: 90, evidence: 0 },
      { area: "openings", target: 15, minutes: 45, evidence: 0 },
      { area: "analysis", target: 5, minutes: 15, evidence: 0 },
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
    expect(out[0].id).toBe("tactics");
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

describe("buildHygiene", () => {
  it("keeps the weaker pool-corrected format as the training focus", () => {
    const deep = demoDeepInsights();
    deep.formats.formats = [
      { ...deep.formats.formats[0], key: "cc/blitz", source: "chess.com", time_class: "blitz", rating: 1700, games: 40 },
      { ...deep.formats.formats[0], key: "cc/rapid", source: "chess.com", time_class: "rapid", rating: 1720, games: 160 },
    ];
    const tips = buildHygiene(deep, { byTimeSlot: [] } as unknown as LiveInsights);
    expect(tips[0]).toMatchObject({
      id: "format",
      key: "plan.hygieneFormatContinue",
      params: { best: "blitz", weak: "rapid", p: 80 },
    });
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
  function template(id: number, area: Area, builtin = true): StudyTemplate {
    return {
      id,
      title: area,
      duration_min: 0,
      tool: "",
      description: "",
      area,
      areas: [area],
      builtin: builtin ? area : "",
      i18n_key: "",
    };
  }
  const templates: StudyTemplate[] = [
    template(1, "openings"),
    template(2, "tactics"),
    template(3, "endgames"),
  ];
  const monday = new Date(Date.UTC(2026, 6, 27));

  /** Eine Woche, in der nur `area` ein Ziel hat. */
  function week(area: Area, target: number, minutes = 0): WeekArea[] {
    return [{ area, minutes, target, share: 100, gap: Math.max(0, target - minutes) }];
  }

  function plan(week: WeekArea[], overrides: Record<string, unknown> = {}) {
    return buildWeekPlan({
      week,
      templates,
      dueWeek: [],
      trainingDayMask: [],
      startDay: monday,
      ...overrides,
    });
  }

  it("plans the gap, not the target", () => {
    // Dieselbe Vorgabe, aber 60 Minuten sind schon gemessen · es bleibt weniger
    // zu planen. Genau das war vorher nicht so: der Vorschlag rechnete immer
    // wieder gegen das volle Wochensoll.
    const open = plan(week("tactics", 100));
    const partly = plan(week("tactics", 100, 60));
    const sum = (units: { minutes: number }[]) =>
      units.reduce((total, unit) => total + unit.minutes, 0);
    expect(sum(partly)).toBeLessThan(sum(open));
    expect(partly.length).toBeLessThan(open.length);
  });

  it("derives the session length from the gap instead of a typed-in duration", () => {
    // 60 Minuten Endspiel bei einem Richtwert von 20 sind drei Sitzungen.
    const units = plan(week("endgames", 60));
    expect(units).toHaveLength(3);
    expect(units.every((unit) => unit.minutes === 20)).toBe(true);
  });

  it("keeps sessions in a length a human will actually sit through", () => {
    expect(sessionMinutes(2)).toBe(10);
    expect(sessionMinutes(23)).toBe(25);
    expect(sessionMinutes(500)).toBe(90);
  });

  it("puts repertoire units on the days with the most due cards", () => {
    const units = plan(week("openings", 24), { dueWeek: [0, 0, 30, 0, 25, 0, 0] });
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.day)).toEqual(["2026-07-29", "2026-07-31"]);
  });

  it("counts what is already planned by hand as covered", () => {
    const full = plan(week("tactics", 100));
    const topUp = plan(week("tactics", 100), { planned: { tactics: 60 } });
    expect(topUp.length).toBeLessThan(full.length);
    expect(plan(week("tactics", 100), { planned: { tactics: 100 } })).toHaveLength(0);
  });

  it("adds what the previous week left open", () => {
    expect(plan(week("endgames", 20))).toHaveLength(1);
    expect(plan(week("endgames", 20), { carryOver: { endgames: 40 } })).toHaveLength(3);
  });

  it("respects the chosen training days", () => {
    const units = plan(week("tactics", 100), {
      trainingDayMask: [true, true, false, false, false, false, false],
    });
    expect(units.length).toBeGreaterThan(0);
    expect(new Set(units.map((unit) => unit.day))).toEqual(
      new Set(["2026-07-27", "2026-07-28"])
    );
  });

  it("uses any unit that covers the area when the built-in one is gone", () => {
    const custom: StudyTemplate = {
      ...template(9, "tactics", false),
      title: "Tactica y finales",
      areas: ["tactics", "endgames"],
    };
    const units = buildWeekPlan({
      week: week("endgames", 40),
      templates: [custom],
      dueWeek: [],
      trainingDayMask: [],
      startDay: monday,
    });
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].templateId).toBe(9);
  });

  it("plans nothing for an area whose gap is not worth a session", () => {
    expect(plan(week("tactics", 5))).toHaveLength(0);
  });

  it("covers the coming week's share once the window reaches into it", () => {
    // Samstag: funf der sieben Tage gehoren schon zur nachsten Woche. Selbst
    // bei erfulltem Wochenziel ist da etwas zu planen.
    const saturday = new Date(Date.UTC(2026, 7, 1));
    const units = buildWeekPlan({
      week: week("tactics", 70, 70),
      templates,
      dueWeek: [9, 0, 0, 0, 0, 0, 0],
      trainingDayMask: [],
      startDay: saturday,
    });
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((unit) => unit.day >= "2026-08-01")).toBe(true);
  });
});
