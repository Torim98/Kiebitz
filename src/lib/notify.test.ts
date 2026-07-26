import { beforeEach, describe, expect, it, vi } from "vitest";
import { translator } from "./i18n";
import type { Settings } from "./settings";
import {
  ensurePermission,
  localDay,
  minutesOfDay,
  notify,
  reminderBody,
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
    onboarded: true,
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
});
