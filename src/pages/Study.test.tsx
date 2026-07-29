import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import Study from "./Study";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const DAY = 86_400;

function liveStudy(overrides: Record<string, unknown> = {}) {
  const today = Math.floor(Date.now() / 1000 / DAY);
  return {
    due_now: 7,
    due_week: [7, 3, 0, 2, 1, 0, 4],
    unanalyzed: 2,
    today_puzzle_attempts: 3,
    puzzle_goal: 10,
    activity: [...Array(7)].map((_, index) => ({
      day_ts: (today - 6 + index) * DAY,
      puzzle_attempts: index === 6 ? 3 : 0,
      endgame_attempts: 0,
      rep_reviews: 0,
    })),
    streak_days: 4,
    ...overrides,
  };
}

function mockBackend(study = liveStudy(), themes: unknown[] = []) {
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "app_info":
        return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
      case "get_settings":
        return Promise.resolve({ locale: "de" });
      case "study_data":
        return Promise.resolve(study);
      case "list_games":
        return Promise.resolve([]);
      case "puzzle_stats":
        return Promise.resolve({ themes });
      case "error_stats":
        return Promise.resolve([]);
      case "study_calendar":
        return Promise.resolve({
          templates: [{ id: 1, title: "Taktik", duration_min: 20, tool: "Kiebitz Puzzles", description: "15–20 Aufgaben" }],
          events: [],
        });
      case "schedule_study_unit":
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
}

function renderStudy(go = vi.fn(), openPuzzles = vi.fn(), mobile = false) {
  render(
    <LocaleProvider>
      <ShellProvider mobile={mobile}>
        <Study go={go} openPuzzles={openPuzzles} />
      </ShellProvider>
    </LocaleProvider>
  );
  return { go, openPuzzles };
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
});

afterEach(cleanup);

describe("Study page", () => {
  it("loads and renders the data-backed daily plan through Tauri invoke", async () => {
    mockBackend();
    renderStudy();

    // Der Wochenkalender zeigt vor dem Backend-Callback Demo-Werte · daher auf
    // eine Zahl warten, die nur aus den Live-Daten stammen kann.
    expect(await screen.findByText("3 / 10")).toBeTruthy();
    expect(screen.getAllByText("7 fällig").length).toBeGreaterThan(0);
    expect(screen.getByText("2 Partien offen")).toBeTruthy();
    expect(screen.getByText("4 Tage Serie")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("study_data");
  });

  it("routes an unfinished puzzle task to the puzzle trainer", async () => {
    mockBackend();
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    // Wait for the live plan; the pending backend state briefly renders the
    // web-preview plan with an equivalent button.
    await screen.findByText("3 / 10");
    fireEvent.click(screen.getByRole("button", { name: "Lösen" }));
    expect(openPuzzles).toHaveBeenCalledWith();
  });

  it("turns a weak backend puzzle motif into a targeted interaction", async () => {
    mockBackend(liveStudy(), [{ theme: "fork", attempts: 10, solved: 3 }]);
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    expect(await screen.findByText("Schwaches Puzzle-Motiv: Gabel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Puzzles trainieren" }));
    expect(openPuzzles).toHaveBeenCalledWith("fork");
  });

  it("marks a fully completed backend plan as done", async () => {
    mockBackend(
      liveStudy({ due_now: 0, unanalyzed: 0, today_puzzle_attempts: 10 })
    );
    renderStudy();

    expect(await screen.findByText("Tagesplan komplett · starke Arbeit!")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Erledigt")).toHaveLength(3);
    });
  });

  it("acts as the training hub on mobile, but leaves the desktop page alone", async () => {
    mockBackend();
    const { go, openPuzzles } = renderStudy(vi.fn(), vi.fn(), true);
    // Der Wert steht mobil zweimal: als Kachel im Hub und im Tagesplan.
    await screen.findAllByText("3 / 10");

    const hub = within(screen.getByRole("navigation", { name: "Trainingsbereiche" }));
    expect(hub.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Repertoire7 fällig",
      "Puzzles3 / 10",
      "EndspieleTheorie gegen die Engine",
    ]);

    fireEvent.click(hub.getByRole("button", { name: /^Endspiele/ }));
    expect(go).toHaveBeenCalledWith("endgame");
    fireEvent.click(hub.getByRole("button", { name: /^Puzzles/ }));
    expect(openPuzzles).toHaveBeenCalledWith();

    cleanup();
    renderStudy();
    await screen.findByText("3 / 10");
    expect(screen.queryByRole("navigation", { name: "Trainingsbereiche" })).toBeNull();
  });

  it("stacks coaching actions below the text only in the mobile shell", async () => {
    mockBackend(liveStudy(), [{ theme: "fork", attempts: 10, solved: 3 }]);
    renderStudy(vi.fn(), vi.fn(), true);

    const mobileTitle = await screen.findByText("Schwaches Puzzle-Motiv: Gabel");
    const mobileCard = mobileTitle.closest("[data-coach-rec]") as HTMLElement;
    expect(mobileCard.className).toContain("p-4");
    expect(mobileCard.className).not.toContain("justify-between");
    expect(
      within(mobileCard).getByRole("button", { name: "Puzzles trainieren" }).className
    ).toContain("w-full");

    cleanup();
    mockBackend(liveStudy(), [{ theme: "fork", attempts: 10, solved: 3 }]);
    renderStudy();

    const desktopTitle = await screen.findByText("Schwaches Puzzle-Motiv: Gabel");
    const desktopCard = desktopTitle.closest("[data-coach-rec]") as HTMLElement;
    expect(desktopCard.className).toContain("justify-between");
    expect(
      within(desktopCard).getByRole("button", { name: "Puzzles trainieren" }).className
    ).not.toContain("w-full");
  });

  it("schedules an editable unit from the week calendar", async () => {
    mockBackend();
    renderStudy();
    await screen.findByText("3 / 10");

    // Die Vorlagen liegen eingeklappt unter dem Kalender.
    fireEvent.click(screen.getByRole("button", { name: /Lerneinheiten/ }));
    expect(await screen.findByText("15–20 Aufgaben")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Planen" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "schedule_study_unit",
        expect.objectContaining({ templateId: 1 })
      );
    });
  });
});
