import { beforeEach, describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { setFormatLocale } from "./format";
import type { MetricValue, MetricWindow } from "./insights";
import type { LoadDay } from "./study";
import type { Prescription } from "./plan";
import {
  buildWeeklyReport,
  compareMetric,
  formatDelta,
  metricNoise,
  previousWeek,
  reportHeadline,
  reportWeek,
  weeklyReportSeen,
  markWeeklyReportSeen,
} from "./weekly";

const t = translator("de");
const DAY = 86_400;

beforeEach(() => setFormatLocale("de-DE"));

function metric(overrides: Partial<MetricValue> & { key: string }): MetricValue {
  return {
    value: null,
    n: 0,
    sd: null,
    unit: "pct",
    lower_is_better: false,
    ...overrides,
  };
}

function window(from: number, metrics: MetricValue[], games = 12): MetricWindow {
  return { from_ts: from, to_ts: from + 7 * DAY, games, metrics, ratings: [] };
}

/** Eine Woche gemessener Tage ab `start`, mit fester Verteilung je Tag. */
function days(start: number, perDay: Partial<LoadDay>): LoadDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
    day_ts: start + offset * DAY,
    play: 0,
    tactics: 0,
    openings: 0,
    endgames: 0,
    analysis: 0,
    ...perDay,
  }));
}

describe("report window", () => {
  it("reports the last completed week, not the running one", () => {
    // Mittwoch, 12.08.2026 · berichtet wird über Montag, den 03.08.
    const week = reportWeek(new Date("2026-08-12T18:00:00Z"));
    expect(new Date(week.start * 1_000).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(new Date(week.end * 1_000).toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("keeps reporting the finished week on its last day", () => {
    // Sonntag: die laufende Woche endet erst heute Nacht · sie wird nicht
    // berichtet, sonst stünde ein halber Zeitraum gegen einen ganzen.
    const sunday = reportWeek(new Date("2026-08-16T23:00:00Z"));
    expect(new Date(sunday.start * 1_000).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    // Montag darauf rückt der Bericht eine Woche weiter.
    const monday = reportWeek(new Date("2026-08-17T06:00:00Z"));
    expect(new Date(monday.start * 1_000).toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("puts the comparison week directly before it", () => {
    const week = reportWeek(new Date("2026-08-12T18:00:00Z"));
    expect(previousWeek(week).end).toBe(week.start);
    expect(week.start - previousWeek(week).start).toBe(7 * DAY);
  });
});

describe("noise", () => {
  it("uses the measured spread wherever the backend sends one", () => {
    const value = metric({ key: "acc_overall", value: 78, n: 16, sd: 8 });
    expect(metricNoise(value)).toBeCloseTo(2, 5);
  });

  it("models rates and shares where there is no spread", () => {
    // Zähldaten: 4 Patzer je 100 Züge über 400 Züge · sqrt(4 · 100 / 400) = 1.
    const rate = metric({ key: "blunders_per100", value: 4, n: 400, unit: "per100" });
    expect(metricNoise(rate)).toBeCloseTo(1, 5);
    // Anteile: 50 % aus 100 Versuchen · 5 Prozentpunkte.
    const share = metric({ key: "puzzle_solve_pct", value: 50, n: 100 });
    expect(metricNoise(share)).toBeCloseTo(5, 5);
  });

  it("never reports a rate of zero as measured without doubt", () => {
    // Ohne Boden wäre die Grenze null, und jede Null-Woche ein Durchbruch.
    const none = metric({ key: "blunders_per100", value: 0, n: 300, unit: "per100" });
    expect(metricNoise(none)).toBeGreaterThan(0);
    const perfect = metric({ key: "puzzle_solve_pct", value: 100, n: 30 });
    expect(metricNoise(perfect)).toBeGreaterThan(0);
  });

  it("has no comparison without a value", () => {
    expect(metricNoise(metric({ key: "acc_overall", value: null, n: 12 }))).toBeNull();
    expect(metricNoise(metric({ key: "acc_overall", value: 80, n: 0 }))).toBeNull();
  });
});

describe("comparing two weeks", () => {
  const before = window(0, [
    metric({ key: "blunders_per100", value: 4.1, n: 600, unit: "per100", lower_is_better: true }),
    metric({ key: "acc_overall", value: 78.4, n: 12, sd: 7.5 }),
  ]);

  it("marks a change that clears its own noise", () => {
    const after = window(7 * DAY, [
      metric({ key: "blunders_per100", value: 2.4, n: 600, unit: "per100", lower_is_better: true }),
      metric({ key: "acc_overall", value: 79.1, n: 12, sd: 7.5 }),
    ]);
    const blunders = compareMetric(before, after, "blunders_per100");
    expect(blunders?.moved).toBe(true);
    // Weniger Patzer ist besser · das steht in `lower_is_better`, nicht im
    // Vorzeichen.
    expect(blunders?.better).toBe(true);
    expect(blunders?.delta).toBe(-1.7);

    // Dieselbe Woche, andere Kennzahl: 0,7 Punkte Genauigkeit sind bei dieser
    // Streuung nichts.
    expect(compareMetric(before, after, "acc_overall")?.moved).toBe(false);
  });

  it("calls a worse number worse, whichever direction that is", () => {
    const after = window(7 * DAY, [
      metric({ key: "blunders_per100", value: 6.8, n: 600, unit: "per100", lower_is_better: true }),
      metric({ key: "acc_overall", value: 78.4, n: 12, sd: 7.5 }),
    ]);
    const blunders = compareMetric(before, after, "blunders_per100");
    expect(blunders?.moved).toBe(true);
    expect(blunders?.better).toBe(false);
    expect(formatDelta(blunders!)).toBe("+2,7");
  });

  it("stays silent about a metric that is missing on either side", () => {
    const after = window(7 * DAY, [metric({ key: "acc_overall", value: 80, n: 12, sd: 7 })]);
    expect(compareMetric(before, after, "blunders_per100")).toBeNull();
    expect(compareMetric(before, after, "in_book_pct")).toBeNull();
  });
});

describe("the report", () => {
  const week = reportWeek(new Date("2026-08-12T18:00:00Z"));
  const earlier = previousWeek(week);

  const quiet = [
    metric({ key: "blunders_per100", value: 4.0, n: 600, unit: "per100", lower_is_better: true }),
    metric({ key: "acc_overall", value: 78.4, n: 12, sd: 7.5 }),
    metric({ key: "acc_endgame", value: 71.0, n: 90 }),
  ];
  const better = [
    metric({ key: "blunders_per100", value: 2.3, n: 600, unit: "per100", lower_is_better: true }),
    metric({ key: "acc_overall", value: 79.0, n: 12, sd: 7.5 }),
    metric({ key: "acc_endgame", value: 82.0, n: 90 }),
  ];

  const prescription: Prescription = {
    id: "punishment",
    area: "tactics",
    finding: {
      id: "punishment",
      severity: 63,
      tone: "bad",
      tab: "strength",
      titleKey: "fnd.punishTitle",
      bodyKey: "fnd.punishBody",
      params: { p: 44.5, n: 96, m: 43 },
    },
    doseKey: "plan.dosePuzzles",
    doseParams: { n: 15, lo: 1420, hi: 1670 },
    action: { kind: "puzzles" },
  };

  it("puts what moved first and says what to do next", () => {
    const report = buildWeeklyReport({
      week,
      metrics: window(week.start, better),
      previous: window(earlier.start, quiet),
      days: [...days(earlier.start, { tactics: 4 }), ...days(week.start, { tactics: 9 })],
      allocation: [
        { area: "tactics", target: 30, minutes: 74, evidence: 0.6 },
        { area: "play", target: 30, minutes: 66, evidence: 0 },
      ],
      prescriptions: [prescription],
    })!;

    expect(report.changes[0].key).toBe("blunders_per100");
    expect(report.quiet).toBeNull();
    expect(report.minutes).toBe(63);
    expect(report.previousMinutes).toBe(28);
    expect(report.target).toBe(140);
    expect(report.activeDays).toBe(7);
    expect(report.next).toBe(prescription);
    expect(reportHeadline(report, t)).toBe("Besser geworden: Patzer/100 Züge von 4,0 auf 2,3.");
  });

  it("links each trained area to the number it would show up in", () => {
    const report = buildWeeklyReport({
      week,
      metrics: window(week.start, better),
      previous: window(earlier.start, quiet),
      // Endspiele geübt, Eröffnungen kaum angefasst.
      days: [
        ...days(earlier.start, { endgames: 3 }),
        ...days(week.start, { endgames: 6, openings: 1 }),
      ],
    })!;

    const endgames = report.byArea.find((entry) => entry.area === "endgames")!;
    expect(endgames.minutes).toBe(42);
    expect(endgames.change?.key).toBe("acc_endgame");
    expect(endgames.change?.moved).toBe(true);

    // Sieben Minuten sind keine Trainingswoche · daneben stünde sonst eine
    // Kennzahl, als hätte das eine mit dem anderen zu tun.
    const openings = report.byArea.find((entry) => entry.area === "openings")!;
    expect(openings.minutes).toBe(7);
    expect(openings.change).toBeNull();
  });

  it("shows the biggest movement as noise when nothing cleared its grenze", () => {
    const report = buildWeeklyReport({
      week,
      metrics: window(week.start, quiet),
      previous: window(earlier.start, quiet),
      days: days(week.start, { tactics: 10 }),
    })!;

    expect(report.changes).toEqual([]);
    expect(report.quiet).not.toBeNull();
    expect(report.quiet?.moved).toBe(false);
    expect(reportHeadline(report, t)).toBe(
      "Deine Zahlen sind stabil geblieben · 70 Min. Training in dieser Woche."
    );
  });

  it("has nothing to report about an empty week", () => {
    expect(
      buildWeeklyReport({
        week,
        metrics: window(week.start, quiet, 0),
        previous: window(earlier.start, quiet),
        days: days(earlier.start, { tactics: 20 }),
      })
    ).toBeNull();
  });

  it("still reports a week that was trained but not played", () => {
    // Keine Partien, aber gemessene Zeit · das ist eine Trainingswoche.
    const report = buildWeeklyReport({
      week,
      metrics: window(week.start, quiet, 0),
      previous: window(earlier.start, quiet),
      days: days(week.start, { tactics: 12 }),
    });
    expect(report?.minutes).toBe(84);
  });

  it("counts only the days inside the reported week", () => {
    const report = buildWeeklyReport({
      week,
      metrics: window(week.start, quiet),
      previous: window(earlier.start, quiet),
      days: [
        ...days(earlier.start, { play: 30 }),
        ...days(week.start, { play: 10 }),
        // Die laufende Woche · sie gehört in keinen der beiden Zeiträume.
        ...days(week.end, { play: 99 }),
      ],
    })!;
    expect(report.minutes).toBe(70);
    expect(report.previousMinutes).toBe(210);
  });
});

describe("the read marker", () => {
  it("forgets itself as soon as the next week is reported", () => {
    localStorage.clear();
    const week = reportWeek(new Date("2026-08-12T18:00:00Z"));
    expect(weeklyReportSeen(week)).toBe(false);
    markWeeklyReportSeen(week);
    expect(weeklyReportSeen(week)).toBe(true);
    // Der Bericht der Folgewoche trägt einen anderen Anfang und kommt damit
    // von selbst wieder.
    expect(weeklyReportSeen(reportWeek(new Date("2026-08-19T18:00:00Z")))).toBe(false);
  });
});
