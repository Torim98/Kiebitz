import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { fenAfter } from "../lib/util";
import Repertoire from "./Repertoire";

const mocks = vi.hoisted(() => ({
  repDue: vi.fn(),
  repList: vi.fn(),
  repStats: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/repertoire", () => ({
  repAddLine: vi.fn(),
  repDelete: vi.fn(),
  repDue: mocks.repDue,
  repList: mocks.repList,
  repNodeGames: vi.fn(),
  repReview: vi.fn(),
  repStats: mocks.repStats,
}));
vi.mock("../components/Board", () => ({
  default: ({ boardId, fen }: { boardId: string; fen: string }) => (
    <div data-testid={`board-${boardId}`} data-fen={fen} />
  ),
}));

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.repList.mockResolvedValue([]);
  mocks.repStats.mockResolvedValue({
    my_positions: 1,
    due_now: 1,
    coverage_pct: 100,
    games_checked: 1,
  });
  mocks.repDue.mockResolvedValue([
    {
      node_id: 7,
      side: "white",
      prompt_sans: ["e4", "e5", "Nf3"],
      expected_san: "Nc6",
      line: "Testlinie",
      is_new: false,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Repertoire training", () => {
  it("navigates previous positions with the left and right arrow keys", async () => {
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Training starten/ }));
    const board = await screen.findByTestId("board-rep-train");
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
  });
});
