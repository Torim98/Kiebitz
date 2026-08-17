// @vitest-environment node
/**
 * Die Momentaufnahme ist alles, was ein Widget je zu sehen bekommt. Sie muss
 * denselben Tag beschreiben wie die App · und ohne Plus nichts verraten.
 */
import { describe, expect, it } from "vitest";
import { WIDGET_SNAPSHOT_VERSION, buildWidgetSnapshot, msUntilNextDay } from "./widgets";
import type { Settings } from "./settings";
import type { StudyCalendar, StudyData, StudyEvent, StudyTemplate } from "./study";

const NOW = new Date(2026, 7, 12, 10, 30); // Mittwoch, lokale Zeit

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...({
      locale: "de",
      weekly_minutes: 180,
      // Montag, Mittwoch, Freitag
      training_days: 0b0010101,
      puzzle_goal: 10,
    } as Settings),
    ...overrides,
  };
}

function template(title: string): StudyTemplate {
  return {
    id: 1,
    title,
    duration_min: 20,
    tool: "",
    description: "",
    area: "tactics",
    areas: ["tactics"],
    builtin: "",
    i18n_key: "",
  };
}

function event(day: string, title: string, patch: Partial<StudyEvent> = {}): StudyEvent {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    template_id: 1,
    day,
    position: 0,
    completed: false,
    completed_ts: 0,
    auto_done: false,
    repeat_rule: "",
    series_key: "",
    planned_min: 25,
    source: "",
    template: template(title),
    ...patch,
  };
}

function data(overrides: Partial<StudyData> = {}): StudyData {
  return {
    due_now: 4,
    due_week: [4, 0, 0, 0, 0, 0, 0],
    unanalyzed: 3,
    today_puzzle_attempts: 10,
    puzzle_goal: 10,
    activity: [{ day_ts: 0, puzzle_attempts: 0, puzzle_solved: 0, endgame_attempts: 2, rep_reviews: 0, game_reviews: 0 }],
    streak_days: 3,
    ...overrides,
  };
}

function calendar(events: StudyEvent[], minutes: Record<string, number>): StudyCalendar {
  return {
    templates: [template("x")],
    events,
    days: Object.entries(minutes).map(([day, actual_minutes]) => ({
      day,
      puzzle_attempts: 0,
      puzzle_solved: 0,
      endgame_attempts: 0,
      rep_reviews: 0,
      game_reviews: 0,
      actual_minutes,
      due_reviews: 0,
    })),
  };
}

describe("buildWidgetSnapshot", () => {
  const base = {
    now: NOW,
    settings: settings(),
    data: data(),
    calendar: calendar(
      [
        event("2026-08-12", "Taktik"),
        event("2026-08-12", "Endspiel", { completed: true }),
        event("2026-08-13", "Morgen"),
      ],
      { "2026-08-10": 40, "2026-08-12": 25, "2026-08-13": 30 }
    ),
    plus: true,
  };

  it("describes today and puts open units first", () => {
    const snapshot = buildWidgetSnapshot(base);

    expect(snapshot.version).toBe(WIDGET_SNAPSHOT_VERSION);
    expect(snapshot.day).toBe("2026-08-12");
    expect(snapshot.today.units.map((unit) => unit.title)).toEqual(["Taktik", "Endspiel"]);
    expect(snapshot.today.units[0].done).toBe(false);
    // Der Bereich reist mit · das Widget färbt danach den Punkt vor der Zeile.
    expect(snapshot.today.units[0].area).toBe("tactics");
    expect(snapshot.today.plannedMinutes).toBe(50);
    expect(snapshot.today.doneMinutes).toBe(25);
  });

  it("counts open tasks the same way the reminder does", () => {
    // Eine offene Einheit, vier fällige Wiederholungen, Puzzleziel erreicht,
    // Endspiel heute schon trainiert.
    expect(buildWidgetSnapshot(base).today.openTasks).toBe(5);

    const withPuzzles = buildWidgetSnapshot({
      ...base,
      data: data({ today_puzzle_attempts: 2 }),
    });
    expect(withPuzzles.today.openTasks).toBe(6);
  });

  it("sums only the days of the running week", () => {
    const snapshot = buildWidgetSnapshot(base);

    // 10., 12. und 13. August liegen in derselben Woche wie der 12.
    expect(snapshot.week.trainedMinutes).toBe(95);
    expect(snapshot.week.budgetMinutes).toBe(180);
    expect(snapshot.week.remainingMinutes).toBe(85);
    expect(snapshot.week.trainedDays).toBe(3);
    expect(snapshot.week.targetDays).toBe(3);
  });

  it("never reports a negative remainder", () => {
    const snapshot = buildWidgetSnapshot({ ...base, settings: settings({ weekly_minutes: 30 }) });

    expect(snapshot.week.remainingMinutes).toBe(0);
  });

  it("carries the entitlement so the widget can show the plus preview", () => {
    expect(buildWidgetSnapshot({ ...base, plus: false }).plus).toBe(false);
    expect(buildWidgetSnapshot(base).locale).toBe("de");
  });

  it("keeps at most three units, so the largest layout still fits", () => {
    const many = calendar(
      ["a", "b", "c", "d", "e"].map((title) => event("2026-08-12", title)),
      {}
    );
    expect(buildWidgetSnapshot({ ...base, calendar: many }).today.units).toHaveLength(3);
  });
});

describe("msUntilNextDay", () => {
  it("waits until local midnight", () => {
    expect(msUntilNextDay(new Date(2026, 7, 12, 23, 0, 0))).toBe(60 * 60 * 1000);
  });

  it("never schedules a busy loop right before midnight", () => {
    expect(msUntilNextDay(new Date(2026, 7, 12, 23, 59, 59))).toBe(60_000);
  });
});
