import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
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
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
}

function renderStudy(go = vi.fn(), openPuzzles = vi.fn()) {
  render(
    <LocaleProvider>
      <Study go={go} openPuzzles={openPuzzles} />
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

    expect(await screen.findByText("7 fällig")).toBeTruthy();
    expect(screen.getByText("3 / 10")).toBeTruthy();
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

    expect(await screen.findByText("Tagesplan komplett — starke Arbeit!")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Erledigt")).toHaveLength(3);
    });
  });
});
