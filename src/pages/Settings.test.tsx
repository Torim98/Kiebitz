import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendState } from "../lib/backend";
import type { Settings } from "../lib/settings";
import SettingsPage from "./Settings";

const mocks = vi.hoisted(() => ({
  backend: { mode: "pending" } as BackendState,
  getSettings: vi.fn(),
}));

vi.mock("../lib/backend", () => ({ useBackendInfo: () => mocks.backend }));
vi.mock("../lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
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
  syncPair: vi.fn(),
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
  onboarded: true,
} satisfies Settings;

beforeEach(() => {
  mocks.backend = { mode: "pending" };
  mocks.getSettings.mockReset();
});

describe("Settings loading", () => {
  it("never renders web or desktop-only placeholders while Android settings load", async () => {
    let resolveSettings!: (settings: Settings) => void;
    mocks.getSettings.mockReturnValue(
      new Promise<Settings>((resolve) => {
        resolveSettings = resolve;
      })
    );
    const view = render(<SettingsPage />);

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    expect(screen.queryByText("set.langNote")).toBeNull();

    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "android" },
    };
    view.rerender(<SettingsPage />);

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();

    await act(async () => resolveSettings(androidSettings));

    expect(screen.queryByText("set.loading")).toBeNull();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    expect(screen.getByText("set.langNoteApp")).toBeTruthy();
    expect(screen.queryByText("set.langNote")).toBeNull();
  });
});
