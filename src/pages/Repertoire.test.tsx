import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { fenAfter } from "../lib/util";
import type { RepNode } from "../lib/repertoire";
import Repertoire from "./Repertoire";

const mocks = vi.hoisted(() => ({
  repDue: vi.fn(),
  repList: vi.fn(),
  repStats: vi.fn(),
  repGaps: vi.fn(),
  repReview: vi.fn(),
  /** Der Zug, den ein Klick auf das Brett-Double auslöst. */
  drop: { from: "", to: "" },
  engineMove: "e2e4",
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
  engineInfo: vi.fn(() => Promise.resolve({ ok: false, name: "", path: "" })),
}));
vi.mock("../lib/repertoire", () => ({
  repAddLine: vi.fn(),
  repDelete: vi.fn(),
  repDue: mocks.repDue,
  repExportPgnFile: vi.fn(),
  repGaps: mocks.repGaps,
  repImportPgn: vi.fn(),
  repImportPgnFile: vi.fn(),
  repList: mocks.repList,
  repLookup: vi.fn(() => Promise.resolve([])),
  repNodeGames: vi.fn(),
  repReview: mocks.repReview,
  repSetNote: vi.fn(),
  repStats: mocks.repStats,
}));
vi.mock("../lib/settings", () => ({
  chessdbQuery: vi.fn(() => Promise.resolve({ status: "unknown", moves: [], cached: false })),
  getSettings: vi.fn(() => Promise.resolve({ rep_due_limit: 20, rep_new_limit: 5 })),
}));
vi.mock("../components/LiveEngine", () => ({
  default: ({ onMove }: { onMove?: (uci: string) => void }) =>
    onMove ? <button onClick={() => onMove(mocks.engineMove)}>play engine move</button> : null,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
// Das Brett-Double reicht den Zug durch, den der Test vorher in mocks.drop
// gelegt hat · so lässt sich ein Zug ohne echtes Drag-and-drop auslösen.
vi.mock("../components/Board", () => ({
  default: ({
    boardId,
    fen,
    onPieceDrop,
  }: {
    boardId: string;
    fen: string;
    onPieceDrop?: (from: string, to: string) => boolean;
  }) => (
    <div data-testid={`board-${boardId}`} data-fen={fen}>
      <button
        data-testid={`play-${boardId}`}
        onClick={() => onPieceDrop?.(mocks.drop.from, mocks.drop.to)}
      />
    </div>
  ),
}));

/** Vier Knoten: 1.e4 e5 2.Nf3 Nc6 · trainiert wird Schwarz. */
function blackTree(): RepNode[] {
  const base = { side: "black" as const, name: "", note: "", reps: 1, lapses: 0, due_ts: 0, stability: 1 };
  return [
    { ...base, id: 1, parent_id: 0, san: "e4", depth: 1, my_move: false, fen_key: "k1" },
    { ...base, id: 2, parent_id: 1, san: "e5", depth: 2, my_move: true, fen_key: "k2" },
    { ...base, id: 3, parent_id: 2, san: "Nf3", depth: 3, my_move: false, fen_key: "k3" },
    { ...base, id: 4, parent_id: 3, san: "Nc6", depth: 4, my_move: true, fen_key: "k4" },
  ];
}

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.drop = { from: "", to: "" };
  mocks.engineMove = "e2e4";
  mocks.repReview.mockResolvedValue({ due_ts: 0, interval_days: 1 });
  mocks.repList.mockResolvedValue([]);
  mocks.repGaps.mockResolvedValue([]);
  mocks.repStats.mockResolvedValue({
    my_positions: 1,
    due_now: 1,
    coverage_pct: 100,
    games_checked: 1,
    plies: 8,
    by_side: [],
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

async function startTraining() {
  render(
    <LocaleProvider>
      <Repertoire />
    </LocaleProvider>
  );
  fireEvent.click(await screen.findByRole("button", { name: /Training starten/ }));
  return await screen.findByTestId("board-rep-train");
}

describe("Repertoire training", () => {
  it("plays engine moves while adding a line and keeps a custom variation name", async () => {
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Variante hinzufügen" }));

    const name = screen.getByPlaceholderText("Name der Variante (optional)") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    await waitFor(() => expect(name.value).toBe("1.e4"));
    expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4"]));

    fireEvent.change(name, { target: { value: "Mein Königsbauer" } });
    mocks.engineMove = "e7e5";
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    await waitFor(() => expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4", "e5"])));
    expect(name.value).toBe("Mein Königsbauer");
  });

  it("points to the variation list below on mobile", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Repertoire />
        </ShellProvider>
      </LocaleProvider>
    );
    expect(
      await screen.findByText("Wähle unten eine Variante · oder lege mit „Variante hinzufügen“ los.")
    ).toBeTruthy();
  });

  it("navigates previous positions with the left and right arrow keys", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
  });

  // Nur "richtig" unter dem Brett zu melden, während die Figur zurückspringt,
  // fühlt sich an, als hätte man den Zug gar nicht gemacht.
  it("plays the correct answer on the board", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "b8", to: "c6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
    // Schnell beantwortet · das ist die leichteste FSRS-Note.
    expect(mocks.repReview).toHaveBeenCalledWith(7, 4);
  });

  it("keeps the position after a wrong move and plays the book move on request", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "g8", to: "f6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    expect(mocks.repReview).toHaveBeenCalledWith(7, 1);

    fireEvent.click(screen.getByRole("button", { name: /Zeigen/ }));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
  });

  // Ein Fehler soll noch in derselben Sitzung wiederkommen, nicht erst morgen.
  it("puts a failed move back at the end of the session", async () => {
    await startTraining();
    await screen.findByText("1 / 1");

    mocks.drop = { from: "g8", to: "f6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  // Eine Karte ist der Anfang einer Linie, keine Einzelstellung: der Gegner
  // antwortet selbst und die nächste eigene Antwort wird gleich mitgefragt.
  it("answers for the opponent and continues the line", async () => {
    mocks.repList.mockResolvedValue(blackTree());
    mocks.repDue.mockResolvedValue([
      {
        node_id: 2,
        side: "black",
        prompt_sans: ["e4"],
        expected_san: "e5",
        line: "Offene Spiele",
        is_new: false,
      },
    ]);

    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    });

    mocks.drop = { from: "e7", to: "e5" };
    fireEvent.click(screen.getByTestId("play-rep-train"));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    // Der Gegnerzug kommt von allein · danach ist wieder Schwarz gefragt.
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "b8", to: "c6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
    // Beide eigenen Züge der Linie wurden einzeln bewertet.
    expect(mocks.repReview).toHaveBeenCalledWith(2, 4);
    expect(mocks.repReview).toHaveBeenCalledWith(4, 4);
  });
});
