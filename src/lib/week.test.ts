import { describe, expect, it } from "vitest";
import { buildWeekBudget, lastWeekDeficit, weekStartOf } from "./week";
import type { AreaNeed } from "./plan";
import type { LoadDay } from "./study";

const DAY = 86_400;

/** Donnerstag, 13. August 2026 · Wochenbeginn ist Montag, der 10. */
const NOW = new Date("2026-08-13T09:00:00Z");
const MONDAY = weekStartOf(NOW);

function day(offset: number, values: Partial<Omit<LoadDay, "day_ts">>): LoadDay {
  return {
    day_ts: Math.floor(MONDAY.getTime() / 1000) + offset * DAY,
    play: 0,
    tactics: 0,
    openings: 0,
    endgames: 0,
    analysis: 0,
    ...values,
  };
}

const allocation: AreaNeed[] = [
  { area: "play", target: 30, minutes: 60, evidence: 0 },
  { area: "tactics", target: 30, minutes: 60, evidence: 0 },
  { area: "openings", target: 20, minutes: 40, evidence: 0 },
  { area: "endgames", target: 10, minutes: 20, evidence: 0 },
  { area: "analysis", target: 10, minutes: 20, evidence: 0 },
];

describe("weekStartOf", () => {
  it("anchors on Monday, including on a Sunday", () => {
    expect(weekStartOf(new Date("2026-08-13T23:00:00Z")).toISOString()).toBe(
      "2026-08-10T00:00:00.000Z"
    );
    // Sonntag gehört zur ablaufenden Woche, nicht zur nächsten.
    expect(weekStartOf(new Date("2026-08-16T12:00:00Z")).toISOString()).toBe(
      "2026-08-10T00:00:00.000Z"
    );
    expect(weekStartOf(new Date("2026-08-17T00:30:00Z")).toISOString()).toBe(
      "2026-08-17T00:00:00.000Z"
    );
  });
});

describe("buildWeekBudget", () => {
  const days = [
    day(0, { play: 40, tactics: 15 }),
    day(1, { openings: 10 }),
    day(3, { tactics: 20, analysis: 12 }),
    // Vorwoche und Folgewoche dürfen nicht mitzählen.
    day(-3, { play: 500 }),
    day(9, { play: 500 }),
  ];

  it("sums only the requested week", () => {
    const week = buildWeekBudget(days, allocation, MONDAY, NOW);
    expect(week.minutes).toBe(97);
    expect(week.target).toBe(200);
  });

  it("reports today separately", () => {
    // NOW ist Donnerstag, also Offset 3.
    expect(buildWeekBudget(days, allocation, MONDAY, NOW).today).toBe(32);
  });

  it("separates the budget shortfall from the sum of area gaps", () => {
    // Weit über dem Spielsoll, dafür überall sonst darunter: das Wochenbudget
    // ist erfüllt, die Bereichslücken bleiben es trotzdem.
    const week = buildWeekBudget([day(0, { play: 220 })], allocation, MONDAY, NOW);
    expect(week.minutes).toBe(220);
    expect(week.open).toBe(0);
    expect(week.remaining).toBe(140);
  });

  it("names the gap per area and never counts a surplus as one", () => {
    const week = buildWeekBudget(days, allocation, MONDAY, NOW);
    const gaps = Object.fromEntries(week.byArea.map((entry) => [entry.area, entry.gap]));
    expect(gaps).toEqual({
      play: 20,
      tactics: 25,
      openings: 30,
      endgames: 20,
      analysis: 8,
    });

    const rich = buildWeekBudget([day(0, { endgames: 90 })], allocation, MONDAY, NOW);
    expect(rich.byArea.find((entry) => entry.area === "endgames")?.gap).toBe(0);
  });

  it("keeps the weakness evidence available to the planner", () => {
    const withEvidence = allocation.map((need) =>
      need.area === "tactics" ? { ...need, evidence: 1.25 } : need
    );
    const week = buildWeekBudget([], withEvidence, MONDAY, NOW);
    expect(week.byArea.find((entry) => entry.area === "tactics")?.evidence).toBe(1.25);
  });

  it("caps the progress bar but not the numbers", () => {
    const week = buildWeekBudget([day(0, { play: 400 })], allocation, MONDAY, NOW);
    expect(week.minutes).toBe(400);
    expect(week.progress).toBe(100);
  });

  it("stays at zero without any target", () => {
    const week = buildWeekBudget([], [], MONDAY, NOW);
    expect(week).toMatchObject({ minutes: 0, target: 0, progress: 0, open: 0, remaining: 0 });
  });
});

describe("lastWeekDeficit", () => {
  it("carries over what the previous week left open", () => {
    const days = [day(-7, { play: 60, tactics: 50 })];
    const deficit = lastWeekDeficit(days, allocation, MONDAY, NOW);

    // play war erfüllt, tactics fehlten 10 Minuten · das ist unter der
    // Meldeschwelle und zählt nicht als Rückstand.
    expect(deficit.play).toBeUndefined();
    expect(deficit.tactics).toBeUndefined();
    expect(deficit.openings).toBe(40);
    expect(deficit.endgames).toBe(20);
  });

  it("never carries more than one week's target", () => {
    const deficit = lastWeekDeficit([], allocation, MONDAY, NOW);
    expect(deficit.openings).toBe(40);
    expect(deficit.play).toBe(60);
  });
});
