import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "./lib/i18n";
import App from "./App";

vi.mock("./lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "android", version: "0.5.2" } }),
}));
vi.mock("./lib/db", () => ({ dbStats: () => Promise.resolve({ total: 12 }) }));
vi.mock("./lib/settings", () => ({
  // `onboarded` verhindert, dass die Ersteinrichtung die Navigation überdeckt.
  getSettings: () => Promise.resolve({ sync_auto: false, sync_host: "", onboarded: true }),
}));
vi.mock("./lib/sync", () => ({ syncInfo: () => Promise.resolve({ last_sync: 0 }) }));
vi.mock("./lib/notify", () => ({ startReminders: vi.fn(), stopReminders: vi.fn() }));
vi.mock("./lib/autoImport", () => ({ startAutoImport: vi.fn(), stopAutoImport: vi.fn() }));
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

beforeEach(() => {
  // Ab Werk startet die App auf Englisch; hier werden deutsche Labels geprüft.
  localStorage.setItem("kiebitz.locale", "de");
});

afterEach(async () => {
  cleanup();
  // jsdom teilt die Session-History über alle Tests der Datei · zurückspulen,
  // damit jeder Test wieder auf einem leeren Stapel startet.
  const behind = window.history.length - 1;
  if (behind > 0) window.history.go(-behind);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Der geöffnete Drawer · die versteckte Desktop-Sidebar rendert dieselben Einträge. */
function drawer(container: HTMLElement) {
  fireEvent.click(screen.getByRole("button", { name: "Menü" }));
  return within(container.querySelector("aside.android-safe-bottom") as HTMLElement);
}

/** Die mobile Bottom-Leiste. */
function bottomBar() {
  return within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
}

/** Der aktive Eintrag der Bottom-Leiste. */
function activeTab() {
  return bottomBar()
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "page")?.textContent;
}

/** Die gerenderte Seite · die Mocks geben den Namen als <div> aus. */
function pageTitle() {
  return screen.getByText(/^(Dashboard|Games|Analysis|Repertoire|Endgame|Puzzles|Study|Insights|Settings)$/, {
    selector: "div",
  }).textContent;
}

describe("mobile navigation", () => {
  it("uses the drawer on Android even at landscape-width breakpoints", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const permanentSidebar = container.querySelector("aside");
    expect(permanentSidebar?.className).toContain("hidden");
    expect(permanentSidebar?.className).not.toContain("md:flex");

    const menu = drawer(container);
    // Der Drawer trägt mobil nur noch, was nicht in die Bottom-Leiste passt.
    expect(menu.getByRole("button", { name: "Repertoire" })).toBeTruthy();
    expect(menu.queryByRole("button", { name: "Partien" })).toBeNull();
    expect(menu.getByRole("button", { name: "Einstellungen" })).toBeTruthy();
    expect(container.querySelector(".mobile-landscape-hide")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/12 Partien/).length).toBeGreaterThan(0));
  });

  it("shows the five main destinations in the bottom bar and marks the active one", () => {
    render(<LocaleProvider><App /></LocaleProvider>);
    const labels = bottomBar()
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual(["Dashboard", "Partien", "Training", "Analyse", "Insights"]);
    expect(activeTab()).toBe("Dashboard");

    fireEvent.click(bottomBar().getByRole("button", { name: "Insights" }));
    expect(pageTitle()).toBe("Insights");
    expect(activeTab()).toBe("Insights");
  });

  it("marks Training while a page that will move under it is open", () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    fireEvent.click(drawer(container).getByRole("button", { name: "Endspiele" }));

    expect(pageTitle()).toBe("Endgame");
    expect(activeTab()).toBe("Training");
  });
});

describe("back navigation", () => {
  it("adds a history entry per level so the Android back button has something to pop", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);

    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    expect(pageTitle()).toBe("Games");
    expect(window.history.state).toEqual({ kd: 2 });

    window.history.back();
    await waitFor(() => expect(window.history.state).toEqual({ kd: 1 }));
    expect(pageTitle()).toBe("Dashboard");
  });

  it("returns to the start destination from any main destination", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);

    // Mehrfaches Wechseln zwischen Hauptzielen darf den Stapel nicht wachsen
    // lassen · sonst braucht der Nutzer vier Mal Zurück, um herauszukommen.
    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    fireEvent.click(bottomBar().getByRole("button", { name: "Analyse" }));
    fireEvent.click(bottomBar().getByRole("button", { name: "Insights" }));
    expect(window.history.state).toEqual({ kd: 2 });

    window.history.back();
    await waitFor(() => expect(pageTitle()).toBe("Dashboard"));
  });
});
