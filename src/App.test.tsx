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
// Der Training-Hub reicht seine Navigations-Props durch; der Mock macht sie
// klickbar, damit die Detailebene auf App-Ebene prüfbar bleibt.
vi.mock("./pages/Study", () => ({
  default: ({ go, openPuzzles }: { go: (p: string) => void; openPuzzles: () => void }) => (
    <div>
      <div>Study</div>
      <button onClick={() => go("endgame")}>Zu den Endspielen</button>
      <button onClick={() => openPuzzles()}>Zu den Puzzles</button>
    </div>
  ),
}));
vi.mock("./pages/InsightsV2", () => ({ default: () => <div>Insights</div> }));
vi.mock("./pages/Settings", () => ({ default: () => <div>Settings</div> }));

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  // Ab Werk startet die App auf Englisch; hier werden deutsche Labels geprüft.
  localStorage.setItem("kiebitz.locale", "de");
  window.matchMedia = realMatchMedia;
});

afterEach(async () => {
  cleanup();
  // jsdom teilt die Session-History über alle Tests der Datei · zurückspulen,
  // damit jeder Test wieder auf einem leeren Stapel startet.
  const behind = window.history.length - 1;
  if (behind > 0) window.history.go(-behind);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

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
  it("replaces the drawer with an app bar carrying title, back and settings", () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    // Weder Hamburger noch Sidebar · die Leiste trägt die Ziele.
    expect(screen.queryByRole("button", { name: "Menü" })).toBeNull();
    expect(container.querySelector("aside")).toBeNull();

    const header = container.querySelector("header") as HTMLElement;
    const bar = within(header);
    // Die Marke steht auf jedem Tab; auf dem Start ergänzt sie der Claim.
    expect(header.textContent).toBe("Kiebitz · Zug um Zugvogel");
    expect(bar.queryByRole("button", { name: "Zurück" })).toBeNull();

    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    expect(header.textContent).toBe("Kiebitz · Partien");
    // Hauptziele erreicht man über die Leiste · dort ist kein Pfeil nötig.
    expect(bar.queryByRole("button", { name: "Zurück" })).toBeNull();
  });

  it("opens the settings from the app bar and offers a way back", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);

    fireEvent.click(bar.getByRole("button", { name: "Einstellungen" }));
    expect(pageTitle()).toBe("Settings");
    // Einstellungen sind kein Tab · von dort führt der Pfeil zurück.
    expect(activeTab()).toBeUndefined();

    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Dashboard"));
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

  it("opens a training area as a detail level under Training", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);

    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    fireEvent.click(screen.getByRole("button", { name: "Zu den Endspielen" }));

    expect(pageTitle()).toBe("Endgame");
    // Der Tab bleibt markiert, der Pfeil führt eine Ebene zurück ins Training.
    expect(activeTab()).toBe("Training");
    expect(window.history.state).toEqual({ kd: 3 });

    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Study"));
  });

  it("keeps the puzzle theme deep link under Training as well", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);
    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    fireEvent.click(screen.getByRole("button", { name: "Zu den Puzzles" }));

    expect(pageTitle()).toBe("Puzzles");
    expect(activeTab()).toBe("Training");

    window.history.back();
    await waitFor(() => expect(pageTitle()).toBe("Study"));
  });
});

describe("landscape phone", () => {
  it("moves the navigation to a rail so the scarce axis stays free", () => {
    // Im Querformat ist Höhe knapp und Breite reichlich · die Leiste wandert
    // an die linke Kante.
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("landscape"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(bar.className).toContain("mobile-nav-rail");
    expect(bar.className).not.toContain("mobile-bottom-nav");
    // Die Rail steht neben dem Inhalt, nicht darunter.
    expect(container.firstElementChild?.className).toContain("flex-row");
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
