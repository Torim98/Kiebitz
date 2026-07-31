import { describe, expect, it } from "vitest";
import { lagComparison, weeklyLoad, weekStart, type WeekLoad } from "./balance";
import type { MetricWindow } from "./insights";
import type { LoadDay } from "./study";

const DAY = 86_400;

function day(dayTs: number, overrides: Partial<LoadDay> = {}): LoadDay {
  return {
    day_ts: dayTs,
    play: 0,
    tactics: 0,
    openings: 0,
    endgames: 0,
    analysis: 0,
    ...overrides,
  };
}

function window(value: number | null, n = 1_200): MetricWindow {
  return {
    from_ts: 0,
    to_ts: 1,
    games: 10,
    ratings: [],
    metrics: [
      {
        key: "blunders_per100",
        value,
        n: value == null ? 0 : n,
        sd: null,
        unit: "per100",
        lower_is_better: true,
      },
    ],
  };
}

describe("weekStart", () => {
  it("snaps to the Monday of the same week", () => {
    // 2026-07-31 ist ein Freitag.
    const friday = Date.UTC(2026, 6, 31) / 1000;
    expect(new Date(weekStart(friday) * 1000).toISOString().slice(0, 10)).toBe("2026-07-27");
    // Ein Sonntag gehört noch zur Woche davor.
    const sunday = Date.UTC(2026, 7, 2) / 1000;
    expect(new Date(weekStart(sunday) * 1000).toISOString().slice(0, 10)).toBe("2026-07-27");
  });
});

describe("weeklyLoad", () => {
  it("sums days into weeks and keeps the areas apart", () => {
    const monday = Date.UTC(2026, 6, 27) / 1000;
    const weeks = weeklyLoad([
      day(monday, { tactics: 20 }),
      day(monday + 2 * DAY, { tactics: 10, play: 45 }),
      day(monday + 7 * DAY, { openings: 15 }),
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].tactics).toBe(30);
    expect(weeks[0].play).toBe(45);
    expect(weeks[0].total).toBe(75);
    expect(weeks[1].openings).toBe(15);
  });

  it("keeps only the requested number of weeks, newest last", () => {
    const monday = Date.UTC(2026, 0, 5) / 1000;
    const days = Array.from({ length: 40 }, (_, index) =>
      day(monday + index * 7 * DAY, { tactics: index })
    );
    const weeks = weeklyLoad(days, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3].tactics).toBe(39);
  });
});

describe("lagComparison", () => {
  function weeks(totals: number[]): WeekLoad[] {
    return totals.map((total, index) => ({
      from_ts: index * 7 * DAY,
      to_ts: (index + 1) * 7 * DAY,
      play: 0,
      tactics: total,
      openings: 0,
      endgames: 0,
      analysis: 0,
      total,
    }));
  }

  it("compares the week after heavy training with the week after light training", () => {
    // Abwechselnd viel und wenig; die Folgewoche nach viel Training ist besser.
    const load = weeks([100, 10, 100, 10, 100, 10, 100, 10, 100, 10]);
    const metrics = load.map((_, index) =>
      // Index 0 ist die Woche selbst · gewertet wird immer der Nachfolger.
      window(index % 2 === 1 ? 1.5 : 3.5)
    );
    const lag = lagComparison(load, metrics, "blunders_per100")!;
    expect(lag.high).toBeCloseTo(1.5, 5);
    expect(lag.low).toBeCloseTo(3.5, 5);
    expect(lag.highWeeks).toBeGreaterThanOrEqual(3);
    expect(lag.lowWeeks).toBeGreaterThanOrEqual(3);
    expect(lag.lowerIsBetter).toBe(true);
  });

  it("stays silent below the minimum number of weeks", () => {
    const load = weeks([100, 10, 100, 10]);
    expect(lagComparison(load, load.map(() => window(2)), "blunders_per100")).toBeNull();
  });

  it("stays silent when one side has too few usable weeks", () => {
    // Nur eine einzige trainingsstarke Woche · daraus wird kein Vergleich.
    const load = weeks([10, 10, 10, 10, 10, 10, 10, 10, 10, 900]);
    expect(lagComparison(load, load.map(() => window(2)), "blunders_per100")).toBeNull();
  });

  it("ignores weeks without measurable games", () => {
    const load = weeks([100, 10, 100, 10, 100, 10, 100, 10, 100, 10]);
    const metrics = load.map(() => window(null));
    expect(lagComparison(load, metrics, "blunders_per100")).toBeNull();
  });

  it("refuses mismatched inputs instead of guessing the alignment", () => {
    const load = weeks([100, 10, 100, 10, 100, 10, 100, 10, 100, 10]);
    expect(lagComparison(load, [window(2)], "blunders_per100")).toBeNull();
  });
});
