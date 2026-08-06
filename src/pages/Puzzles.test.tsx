import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../lib/i18n";
import { fenAfter } from "../lib/util";
import Puzzles from "./Puzzles";

const mocks = vi.hoisted(() => ({
  nextPuzzle: vi.fn(),
  puzzleStats: vi.fn(),
  recordAttempt: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/puzzles", () => ({
  importLabel: () => "…",
  importPuzzles: vi.fn(),
  nextPuzzle: mocks.nextPuzzle,
  onPuzzleImportDone: vi.fn(() => Promise.resolve(vi.fn())),
  onPuzzleImportProgress: vi.fn(() => Promise.resolve(vi.fn())),
  puzzleHistory: vi.fn(() => Promise.resolve([])),
  puzzleStats: mocks.puzzleStats,
  recordAttempt: mocks.recordAttempt,
  themeLabel: (theme: string) => theme,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("../lib/changes", () => ({
  onDataChange: vi.fn(() => vi.fn()),
}));
vi.mock("../components/Board", () => ({
  default: ({ fen, draggable, onPieceDrop }: {
    fen: string;
    draggable?: boolean;
    onPieceDrop?: (from: string, to: string) => boolean;
  }) => (
    <div data-testid="puzzle-board" data-fen={fen} data-draggable={String(!!draggable)}>
      <button onClick={() => onPieceDrop?.("e2", "e4")}>play e4</button>
    </div>
  ),
}));

const initialFen = fenAfter([]);

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.puzzleStats.mockResolvedValue({
    personal_rating: 1500,
    db_total: 1,
    lichess_total: 1,
    own_total: 0,
    attempts: 0,
    solved: 0,
    today_solved: 0,
    today_attempts: 0,
    streak_days: 0,
    history: [],
    themes: [],
    importing: false,
    imported_at: null,
  });
  mocks.nextPuzzle.mockResolvedValue({
    id: "test-puzzle",
    fen: initialFen,
    moves: ["e2e4", "e7e5", "g1f3", "b8c6"],
    rating: 1500,
    themes: ["fork"],
    source: "own",
    source_game_id: 1,
    setup_plies: 0,
  });
  mocks.recordAttempt.mockResolvedValue({ rating_before: 1500, rating_after: 1508, delta: 8 });
  mocks.getSettings.mockResolvedValue({ puzzle_goal: 10, puzzle_hide_theme: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Puzzle training", () => {
  it("navigates through played positions with buttons and arrow keys", async () => {
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    const board = await screen.findByTestId("puzzle-board");
    await waitFor(() => expect(board.dataset.draggable).toBe("true"));
    expect(screen.getByText("0 / 0")).toBeTruthy();

    // Die automatische gegnerische Antwort bleibt angehalten, damit gezielt
    // durch genau den bereits gespielten Zug geblättert werden kann.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "play e4" }));
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    expect(screen.getByText("1 / 1")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Zur Ausgangsstellung"));
    expect(board.dataset.fen).toBe(initialFen);
    expect(board.dataset.draggable).toBe("false");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    expect(board.dataset.draggable).toBe("true");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(initialFen);
    fireEvent.click(screen.getByTitle("Zur aktuellen Stellung"));
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
  });

  it("asks for the Lichess dump even when own games already yield puzzles", async () => {
    mocks.puzzleStats.mockResolvedValue({
      personal_rating: 1500,
      db_total: 12,
      lichess_total: 0,
      own_total: 12,
      attempts: 0,
      solved: 0,
      today_solved: 0,
      today_attempts: 0,
      streak_days: 0,
      history: [],
      themes: [],
      importing: false,
      imported_at: null,
    });
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    // Eigene Aufgaben sind kein durchlaufener Import · die Einrichtung bleibt.
    await screen.findByText("Puzzle-Datenbank importieren");
    // Sie sperrt aber nicht aus, was schon da ist.
    fireEvent.click(screen.getByRole("button", { name: "Mit eigenen Aufgaben trainieren" }));
    expect(await screen.findByTestId("puzzle-board")).toBeTruthy();
  });

  it("keeps the theme covered until it is tapped", async () => {
    mocks.getSettings.mockResolvedValue({ puzzle_goal: 10, puzzle_hide_theme: true });
    mocks.nextPuzzle.mockResolvedValue({
      id: "lichess-puzzle",
      fen: initialFen,
      moves: ["e2e4"],
      rating: 1500,
      themes: ["backRankMate"],
      source: "lichess",
      source_game_id: null,
      setup_plies: 0,
    });
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    const cover = await screen.findByRole("button", { name: "Motiv verdeckt" });
    // Das Motiv steht auch als Filter-Chip auf der Seite · verdeckt ist nur die
    // Zeile über dem Brett, und die kommt beim Antippen dazu.
    expect(screen.queryAllByText("backRankMate")).toHaveLength(1);
    fireEvent.click(cover);
    await waitFor(() => expect(screen.queryAllByText("backRankMate")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Motiv verdeckt" })).toBeNull();
  });
});
