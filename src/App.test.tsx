import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "./lib/i18n";
import App from "./App";

vi.mock("./lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "android", version: "0.5.2" } }),
}));
vi.mock("./lib/db", () => ({ dbStats: () => Promise.resolve({ total: 12 }) }));
vi.mock("./lib/settings", () => ({
  getSettings: () => Promise.resolve({ sync_auto: false, sync_host: "" }),
}));
vi.mock("./lib/sync", () => ({ syncInfo: () => Promise.resolve({ last_sync: 0 }) }));
vi.mock("./lib/syncManager", () => ({
  configureAutoSync: vi.fn(),
  useSyncStatus: () => ({ active: false, phase: "idle", lastSync: 0 }),
}));
vi.mock("./lib/updater", () => ({
  installUpdate: vi.fn(),
  onUpdateAvailable: () => Promise.resolve(() => {}),
  onUpdateState: () => Promise.resolve(() => {}),
}));
vi.mock("./pages/Dashboard", () => ({ default: () => <div>Dashboard</div> }));
vi.mock("./pages/Games", () => ({ default: () => <div>Games</div> }));
vi.mock("./pages/Analysis", () => ({ default: () => <div>Analysis</div> }));
vi.mock("./pages/Repertoire", () => ({ default: () => <div>Repertoire</div> }));
vi.mock("./pages/Endgame", () => ({ default: () => <div>Endgame</div> }));
vi.mock("./pages/Puzzles", () => ({ default: () => <div>Puzzles</div> }));
vi.mock("./pages/Study", () => ({ default: () => <div>Study</div> }));
vi.mock("./pages/InsightsV2", () => ({ default: () => <div>Insights</div> }));
vi.mock("./pages/Settings", () => ({ default: () => <div>Settings</div> }));

afterEach(cleanup);

describe("mobile navigation", () => {
  it("uses the drawer on Android even at landscape-width breakpoints", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const permanentSidebar = container.querySelector("aside");
    expect(permanentSidebar?.className).toContain("hidden");
    expect(permanentSidebar?.className).not.toContain("md:flex");

    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    expect(screen.getAllByRole("button", { name: "Insights" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Einstellungen" })).toHaveLength(2);
    expect(container.querySelector(".mobile-landscape-hide")).toBeTruthy();
    expect(container.querySelector("aside.android-safe-bottom")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/12 Partien/).length).toBeGreaterThan(0));
  });
});
