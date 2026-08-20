import { beforeEach, describe, expect, it, vi } from "vitest";
import { translator } from "./i18n";
import type { Settings } from "./settings";
import {
  applyReminderSchedule,
  ensurePermission,
  localDay,
  minutesOfDay,
  notify,
  reminderBody,
  reminderMessage,
  type ReminderInput,
} from "./notify";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const t = translator("de");

beforeEach(() => invokeMock.mockReset());

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: "de",
    db_path: null,
    engine_path: null,
    engine_threads: 0,
    engine_hash_mb: 256,
    engine_multipv: 3,
    live_depth: 24,
    batch_depth: 14,
    syzygy_path: null,
    chessdb_enabled: true,
    auto_import: true,
    cc_user: "",
    li_user: "",
    display_name: "",
    import_months: 3,
    puzzle_goal: 20,
    puzzle_hide_theme: false,
    rep_due_limit: 20,
    rep_new_limit: 5,
    sound_enabled: true,
    sound_volume: 70,
    auto_update: true,
    sync_enabled: false,
    sync_code: "",
    sync_host: "",
    sync_fingerprint: "",
    sync_auto: false,
    notify_enabled: true,
    notify_time: "18:00",
    notify_study: true,
    notify_repertoire: true,
    notify_puzzles: true,
    notify_endgame: true,
    notify_analysis: true,
    weekly_minutes: 0,
    training_days: 0,
    goal_date: "",
    focus_cycle_days: 14,
    onboarded: true,
    analytics_enabled: false,
    analytics_installation_id: "",
    ...overrides,
  };
}

function due(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    study: 0,
    repertoire: 0,
    puzzlesLeft: 0,
    endgameDone: true,
    unanalyzed: 0,
    streakDays: 0,
    todayMinutes: 0,
    weekMinutes: 0,
    ...overrides,
  };
}

describe("reminder text", () => {
  it("lists every pending activity that is switched on", () => {
    const body = reminderBody(
      t,
      settings(),
      due({ study: 2, repertoire: 14, puzzlesLeft: 8, endgameDone: false, unanalyzed: 3 })
    );
    expect(body).toBe(
      "2 geplante Einheiten · 14 Wiederholungen fällig · 8 Puzzles bis zum Tagesziel · Endspiel-Training offen · 3 Partien unanalysiert"
    );
  });

  it("skips categories the user switched off", () => {
    const body = reminderBody(
      t,
      settings({ notify_repertoire: false, notify_endgame: false }),
      due({ repertoire: 14, endgameDone: false, puzzlesLeft: 5 })
    );
    expect(body).toBe("5 Puzzles bis zum Tagesziel");
  });

  it("stays silent when nothing is pending", () => {
    expect(reminderBody(t, settings(), due())).toBeNull();
    // Ein erledigtes Endspiel darf die Erinnerung nicht auslösen.
    expect(reminderBody(t, settings(), due({ endgameDone: true }))).toBeNull();
  });

  it("parses the reminder time and falls back to 18:00", () => {
    expect(minutesOfDay("07:30")).toBe(450);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("nope")).toBe(18 * 60);
    expect(minutesOfDay("25:00")).toBe(18 * 60);
  });

  it("builds a local day key", () => {
    expect(localDay(new Date(2026, 6, 5, 23, 30))).toBe("2026-07-05");
    expect(localDay(new Date(2026, 11, 31, 0, 5))).toBe("2026-12-31");
  });
});

// Mittwoch bzw. Sonntag · der Wochentag entscheidet über die Form der Meldung.
const WEDNESDAY = new Date(2026, 7, 12, 18, 0);
const SUNDAY = new Date(2026, 7, 16, 18, 0);

describe("reminder message", () => {
  it("puts the reason first and the list below it", () => {
    const message = reminderMessage(
      t,
      settings(),
      due({ repertoire: 14, weekMinutes: 20 }),
      WEDNESDAY
    );
    expect(message?.title).toBe("Kiebitz · Training");
    expect(message?.lead).toBe("Zeit fürs Training.");
    expect(message?.detail).toBe("14 Wiederholungen fällig");
    expect(message?.body).toBe("Zeit fürs Training.\n14 Wiederholungen fällig");
  });

  it("leads with a streak that would break tonight", () => {
    const message = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ repertoire: 3, streakDays: 12, todayMinutes: 0, weekMinutes: 90 }),
      WEDNESDAY
    );
    expect(message?.lead).toBe("12 Tage in Folge — heute noch nichts.");
  });

  it("drops the streak line once the day has minutes on it", () => {
    // Trainiert ist trainiert · dann steht dort das offene Wochenziel.
    const message = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ repertoire: 3, streakDays: 12, todayMinutes: 25, weekMinutes: 90 }),
      WEDNESDAY
    );
    expect(message?.lead).toBe("Noch 90 Min. bis zum Wochenziel.");
  });

  it("reviews the week on sunday, even with nothing left to do", () => {
    // Unter der Woche schweigt Kiebitz, wenn nichts offen ist · der Rückblick
    // berichtet aber über die Woche und nicht über diesen Abend.
    expect(reminderMessage(t, settings(), due(), WEDNESDAY)).toBeNull();

    const review = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ weekMinutes: 145 }),
      SUNDAY
    );
    expect(review?.title).toBe("Kiebitz · Woche");
    expect(review?.lead).toBe("145 von 180 Min. diese Woche.");
    expect(review?.detail).toBe("");
    expect(review?.body).toBe("145 von 180 Min. diese Woche.");
  });

  it("reviews without a budget too", () => {
    const review = reminderMessage(t, settings(), due({ weekMinutes: 45 }), SUNDAY);
    expect(review?.lead).toBe("45 Min. diese Woche trainiert.");
  });
});

describe("native notification bridge", () => {
  it("requests Android permission through the native plugin", async () => {
    invokeMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("granted");

    await expect(ensurePermission()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "plugin:notification|is_permission_granted"
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "plugin:notification|request_permission"
    );
  });

  it("sends an Android test notification without window.Notification", async () => {
    invokeMock.mockImplementation((command?: string) => {
      // The notification package performs one capability probe without a
      // command in jsdom; it is unrelated to the native path under test.
      if (!command) return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") {
        return Promise.resolve(true);
      }
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|notify") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await notify("Kiebitz", "Test");
    expect(invokeMock).toHaveBeenCalledWith("plugin:notification|notify", {
      options: { title: "Kiebitz", body: "Test" },
    });
  });

  it("persists one alarm per weekday and verifies each without serializing native pending objects", async () => {
    invokeMock.mockImplementation((command?: string) => {
      if (!command) return Promise.resolve();
      if (command === "get_settings") {
        return Promise.resolve(settings({ notify_time: "07:35" }));
      }
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|cancel") return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") {
        return Promise.resolve(true);
      }
      if (command === "study_data") {
        return Promise.resolve({
          due_now: 4,
          puzzle_goal: 20,
          today_puzzle_attempts: 2,
          unanalyzed: 1,
          activity: [{ endgame_attempts: 0 }],
          streak_days: 0,
        });
      }
      if (command === "study_calendar") {
        return Promise.resolve({ events: [], days: [] });
      }
      // Der AlarmManager bestätigt alle sieben · die Prüfung verlangt genau das.
      if (command === "plugin:notification|batch") {
        return Promise.resolve([4711, 4712, 4713, 4714, 4715, 4716, 4717]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await applyReminderSchedule();

    const batchCall = invokeMock.mock.calls.find(
      ([command]) => command === "plugin:notification|batch"
    );
    const batch = batchCall?.[1]?.notifications ?? [];
    // Ein Alarm je Wochentag, `weekday` zählt ab Sonntag = 1 · ein einzelner
    // täglicher Alarm könnte den Sonntagsrückblick nicht vom Rest trennen.
    expect(batch.map((entry: { id: number }) => entry.id)).toEqual([
      4711, 4712, 4713, 4714, 4715, 4716, 4717,
    ]);
    expect(
      batch.map(
        (entry: { schedule: { interval: { interval: { weekday: number } } } }) =>
          entry.schedule.interval.interval.weekday
      )
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Der Sonntag trägt den Rückblick, die übrigen sechs die Erinnerung.
    expect(batch[0].title).toBe("Kiebitz · Woche");
    expect(batch.slice(1).every((entry: { title: string }) => entry.title === "Kiebitz · Training")).toBe(
      true
    );

    expect(batch[1]).toEqual(
      expect.objectContaining({
        schedule: expect.objectContaining({
          interval: { interval: { weekday: 2, hour: 7, minute: 35 }, allowWhileIdle: false },
        }),
        sourceJson: expect.any(String),
      })
    );
    expect(JSON.parse(batch[1].sourceJson)).toEqual(
      expect.objectContaining({
        id: 4712,
        title: expect.any(String),
        body: expect.any(String),
        schedule: {
          interval: {
            interval: { weekday: 2, hour: 7, minute: 35 },
            allowWhileIdle: false,
          },
        },
      })
    );
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:notification|get_pending");
  });

  it("refuses a week the alarm manager only half accepted", async () => {
    invokeMock.mockImplementation((command?: string) => {
      if (!command) return Promise.resolve();
      if (command === "get_settings") return Promise.resolve(settings());
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|cancel") return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") return Promise.resolve(true);
      if (command === "study_data") {
        return Promise.resolve({
          due_now: 1,
          puzzle_goal: 20,
          today_puzzle_attempts: 0,
          unanalyzed: 0,
          activity: [{ endgame_attempts: 0 }],
          streak_days: 0,
        });
      }
      if (command === "study_calendar") return Promise.resolve({ events: [], days: [] });
      // Drei fehlen · eine halb angelegte Woche ist schlimmer als keine.
      if (command === "plugin:notification|batch") return Promise.resolve([4711, 4712, 4713, 4714]);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await expect(applyReminderSchedule()).rejects.toThrow(/nicht registriert/);
  });
});
