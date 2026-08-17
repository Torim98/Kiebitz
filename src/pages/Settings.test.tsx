import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendState } from "../lib/backend";
import { dbInfo, type Settings } from "../lib/settings";
import { puzzleStats } from "../lib/puzzles";
import { syncInfo } from "../lib/sync";
import { legalDocuments } from "../lib/legal";
import { ShellProvider } from "../components/MobileShell";
import SettingsPage from "./Settings";

const mocks = vi.hoisted(() => ({
  backend: { mode: "pending" } as BackendState,
  getSettings: vi.fn(),
}));

vi.mock("../lib/backend", () => ({ useBackendInfo: () => mocks.backend }));
vi.mock("../lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/i18n")>()),
  useI18n: () => ({
    locale: "en" as const,
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
  // Die Tour hängt an useT statt an useI18n · ohne diesen Zweig stünde sie
  // als einzige Komponente der Seite mit echten Texten im Test.
  useT: () => (key: string) => key,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
  refreshSettings: vi.fn(),
  setSettings: vi.fn(),
  dbInfo: vi.fn(() => new Promise(() => {})),
  backupDatabase: vi.fn(),
  factoryReset: vi.fn(),
  formatBytes: (bytes: number) => String(bytes),
  moveDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  testEngine: vi.fn(),
  useDatabase: vi.fn(),
  // Reine Helfer · die echten Implementierungen, damit die Trainingstage
  // im Test dasselbe tun wie in der App.
  trainingDayList: (mask: number) =>
    Array.from({ length: 7 }, (_, index) => (mask & (1 << index)) !== 0),
  trainingDayMask: (days: boolean[]) =>
    days.reduce((mask, active, index) => (active ? mask | (1 << index) : mask), 0),
}));
vi.mock("../lib/puzzles", () => ({
  importPuzzles: vi.fn(),
  onPuzzleImportDone: vi.fn(() => Promise.resolve(() => {})),
  onPuzzleImportProgress: vi.fn(() => Promise.resolve(() => {})),
  puzzleStats: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/updater", () => ({
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateState: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../lib/sync", () => ({
  scanPairingQr: vi.fn(),
  syncDiscover: vi.fn(),
  syncInfo: vi.fn(() => new Promise(() => {})),
  syncNow: vi.fn(),
  syncPair: vi.fn(() => new Promise(() => {})),
  syncServerStart: vi.fn(),
}));
vi.mock("../lib/legal", () => ({
  legalDocument: vi.fn(),
  legalDocuments: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/ext", () => ({ openExternal: vi.fn() }));
vi.mock("../lib/syncManager", () => ({
  configureAutoSync: vi.fn(),
  useSyncStatus: () => ({ active: false, phase: "idle", lastSync: 0, lastError: null }),
}));
vi.mock("../lib/notify", () => ({
  applyReminderSchedule: vi.fn(),
  sendTestReminder: vi.fn(),
}));
vi.mock("../lib/analysis", () => ({ indexPositions: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const androidSettings = {
  locale: "en",
  db_path: null,
  engine_path: null,
  engine_threads: 0,
  engine_hash_mb: 64,
  engine_multipv: 1,
  live_depth: 16,
  batch_depth: 18,
  syzygy_path: null,
  chessdb_enabled: true,
  auto_import: false,
  cc_user: "",
  li_user: "",
  display_name: "",
  import_months: 3,
  puzzle_goal: 10,
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
  notify_enabled: false,
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
} satisfies Settings;

const sectionLoads = [dbInfo, puzzleStats, syncInfo, legalDocuments].map((fn) => vi.mocked(fn));

beforeEach(() => {
  mocks.backend = { mode: "pending" };
  mocks.getSettings.mockReset();
  sectionLoads.forEach((fn) => fn.mockClear());
});

describe("Settings loading", () => {
  it("never renders web or desktop-only placeholders while Android settings load", async () => {
    let resolveSettings!: (settings: Settings) => void;
    mocks.getSettings.mockReturnValue(
      new Promise<Settings>((resolve) => {
        resolveSettings = resolve;
      })
    );
    // Die Android-Shell entscheidet über das kompakte Layout. Jeder Aufruf
    // baut ein neues Element · React überspringt sonst das erneute Rendern.
    const mobileShell = () => (
      <ShellProvider mobile>
        <SettingsPage />
      </ShellProvider>
    );
    const view = render(mobileShell());

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    expect(screen.queryByText("set.langNote")).toBeNull();

    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "android" },
    };
    view.rerender(mobileShell());

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();

    await act(async () => resolveSettings(androidSettings));

    expect(screen.queryByText("set.loading")).toBeNull();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    // Mobil sind die Bereiche zugeklappt · sichtbar ist die Zeile, nicht ihr Inhalt.
    expect(screen.getByText("set.language")).toBeTruthy();
    expect(screen.queryByText("set.langNoteApp")).toBeNull();
    expect(screen.queryByText("set.langNote")).toBeNull();

    // Aufgeklappt steht dort der App-Hinweis · nicht der Web-Hinweis.
    fireEvent.click(screen.getByRole("button", { name: /set\.language/ }));
    expect(screen.getByText("set.langNoteApp")).toBeTruthy();
    expect(screen.queryByText("set.langNote")).toBeNull();
  });

  // Auf dem Handy stehen alle Bereiche zugeklappt · dann darf die Seite beim
  // Öffnen auch keine Zählabfragen über Millionen Zeilen anstoßen.
  it("loads section data on Android only once a section is opened", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.1", backend: "tauri", platform: "android" },
    };

    await act(async () => {
      render(
        <ShellProvider mobile>
          <SettingsPage />
        </ShellProvider>
      );
    });

    sectionLoads.forEach((fn) => expect(fn).not.toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /set\.database/ }));
    expect(vi.mocked(dbInfo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(puzzleStats)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInfo)).not.toHaveBeenCalled();
    expect(vi.mocked(legalDocuments)).not.toHaveBeenCalled();
  });

  it("keeps every settings section open on the desktop", async () => {
    mocks.getSettings.mockResolvedValue({ ...androidSettings, locale: "de" });
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "windows" },
    };

    await act(async () => {
      render(<SettingsPage />);
    });

    // Kein Aufklappen nötig: der Inhalt steht direkt da.
    expect(screen.getByText("set.langNoteApp")).toBeTruthy();
    expect(screen.getByText("set.soundToggle")).toBeTruthy();
    expect(screen.queryByText("set.soundTest")).toBeNull();
    const soundToggle = screen
      .getByText("set.soundToggle")
      .closest("label")!
      .querySelector("input") as HTMLInputElement;
    expect(soundToggle.checked).toBe(true);
    fireEvent.click(soundToggle);
    expect(soundToggle.checked).toBe(false);
    expect(screen.getByText("set.engineNote")).toBeTruthy();
    // Dieselbe Gliederung wie auf dem Handy: die Expertenbereiche stehen hinter
    // einer Zwischenüberschrift · auf dem Desktop zusätzlich in der Sprungleiste.
    expect(screen.getAllByText("set.advanced").length).toBe(2);
    // Alltag zuerst, Erweitertes danach · und der Ton steht vor der Engine.
    const order = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(order).toEqual([
      "set.language",
      "set.tour",
      "plus.title",
      "set.accounts",
      "set.sound",
      "set.notify",
      "set.widgets",
      "set.sync",
      "set.updates",
      "set.adsPrivacy",
      "set.support",
      "set.engine",
      "set.database",
      "set.chessdb",
      "set.puzzleDb",
      "set.about",
      "set.reset",
    ]);
  });

  it("replays the onboarding tour on demand", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "windows" },
    };

    await act(async () => {
      render(<SettingsPage />);
    });

    // Nichts liegt über der Seite, bis der Bereich es öffnet.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "set.tourOpen" }));

    const tour = screen.getByRole("dialog");
    expect(tour.textContent).toContain("tour.s1.title");
    // Die Punkte unter der Folie springen direkt · fünf Stück, einer je Folie.
    const dots = screen.getAllByRole("button", { name: "tour.step" });
    expect(dots.length).toBe(5);
    fireEvent.click(dots[4]);
    expect(tour.textContent).toContain("tour.s5.title");
    // Auf der letzten Folie gibt es kein Überspringen mehr, nur noch Abschließen.
    expect(screen.queryByRole("button", { name: "tour.skip" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "tour.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
