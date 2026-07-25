import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import Analysis from "./Analysis";

const mocks = vi.hoisted(() => ({
  listGames: vi.fn(),
  startAnalysis: vi.fn(),
  gameAnalysis: vi.fn(),
  setGameNote: vi.fn(),
  setGameTags: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/db", () => ({
  listGames: mocks.listGames,
  setGameNote: mocks.setGameNote,
  setGameTags: mocks.setGameTags,
}));
vi.mock("../lib/settings", () => ({
  getSettings: () => Promise.resolve({ chessdb_enabled: false }),
  chessdbQuery: vi.fn(),
}));
vi.mock("../lib/analysis", () => ({
  cancelAnalysis: vi.fn(),
  gameAnalysis: mocks.gameAnalysis,
  onAnalysisDone: () => Promise.resolve(() => {}),
  onAnalysisGameDone: () => Promise.resolve(() => {}),
  onAnalysisProgress: () => Promise.resolve(() => {}),
  searchPosition: () => Promise.resolve({ total_games: 0, next_moves: [], sample: [] }),
  startAnalysis: mocks.startAnalysis,
}));
vi.mock("../components/Board", () => ({
  default: ({ onPieceDrop, draggable, muted, mouseDrag, arrows, badges }: {
    onPieceDrop?: (from: string, to: string) => boolean;
    draggable?: boolean;
    muted?: boolean;
    mouseDrag?: boolean;
    arrows?: unknown[];
    // `label` kann ein React-Element sein (Buch-Symbol) — nicht serialisierbar.
    badges?: { square: string; color: string; title?: string }[];
  }) => (
    <div
      data-testid="analysis-board"
      data-draggable={String(!!draggable)}
      data-mouse-drag={String(!!mouseDrag)}
      data-muted={String(!!muted)}
      data-arrows={JSON.stringify(arrows ?? [])}
      data-badges={JSON.stringify(
        (badges ?? []).map(({ square, color, title }) => ({ square, color, title }))
      )}
    >
      {onPieceDrop && <button onClick={() => onPieceDrop("e2", "e4")}>play e4</button>}
      {onPieceDrop && <button onClick={() => onPieceDrop("e7", "e5")}>play e5</button>}
    </div>
  ),
}));
vi.mock("../components/LiveEngine", () => ({ default: () => <div data-testid="live-engine" /> }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  const Empty = () => null;
  return {
    Area: Empty,
    AreaChart: Container,
    ReferenceLine: Empty,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const excludedGame = {
  id: 7,
  source: "manual",
  source_id: "friend-game",
  url: "",
  played_at: "2026-07-20",
  played_ts: 1_784_500_000,
  time_class: "rapid",
  color: "white",
  my_name: "Dr. Tom Maurer",
  opponent: "Friend",
  opp_elo: 1400,
  my_elo: 1500,
  result: "win",
  opening: "Italian Game",
  eco: "C50",
  moves_count: 2,
  accuracy: null,
  moves: "e4 e5 Nf3 Nc6",
  note: "",
  tags: [],
  analyzed: false,
  analysis_excluded: true,
};

beforeEach(() => {
  mocks.listGames.mockResolvedValue([excludedGame]);
  mocks.gameAnalysis.mockResolvedValue([]);
  mocks.startAnalysis.mockResolvedValue(undefined);
  mocks.setGameNote.mockResolvedValue(undefined);
  mocks.setGameTags.mockImplementation((_id: number, tags: string[]) => Promise.resolve(tags));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Analysis page", () => {
  it("opens a playable new game when entered without a target", async () => {
    render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

    expect(await screen.findByText(/Neue Partie · Ziehe für beide Seiten/)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "play e4" }));
    expect(await screen.findByRole("button", { name: "e4" })).toBeTruthy();
  });

  it("allows an explicitly opened excluded game to run Stockfish analysis", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    expect(screen.queryByRole("button", { name: /Nächste 10/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Diese Partie analysieren" }));
    expect(mocks.startAnalysis).toHaveBeenCalledWith({ gameIds: [7] });
  });

  it("lets desktop users branch from a played move with drag and drop", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    expect(screen.getByTestId("analysis-board").dataset.draggable).toBe("true");
    expect(screen.getByTestId("analysis-board").dataset.mouseDrag).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "e4" }));
    fireEvent.click(screen.getByRole("button", { name: "play e5" }));

    expect(await screen.findByText(/Variante ab Zug 1/)).toBeTruthy();
    expect(screen.getByTestId("analysis-board").dataset.muted).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Partie" }));
    expect(screen.getByTestId("analysis-board").dataset.muted).toBe("false");
  });

  it("shows database player names with parenthesized ratings and previews the next move", async () => {
    mocks.listGames.mockResolvedValue([{ ...excludedGame, moves: "e4 e5 Nf3 Nc6 Bc4" }]);
    mocks.gameAnalysis.mockResolvedValue([
      { ply: 1, san: "e4", eval_cp: 20, mate_in: null, best_uci: "e2e4", judgment: "book", phase: "opening" },
      { ply: 2, san: "e5", eval_cp: 80, mate_in: null, best_uci: "c7c5", judgment: "inaccuracy", phase: "opening" },
      { ply: 3, san: "Nf3", eval_cp: 70, mate_in: null, best_uci: "g1f3", judgment: "best", phase: "opening" },
      { ply: 4, san: "Nc6", eval_cp: 160, mate_in: null, best_uci: "g8f6", judgment: "blunder", phase: "opening" },
      { ply: 5, san: "Bc4", eval_cp: 150, mate_in: null, best_uci: "f1c4", judgment: "excellent", phase: "opening" },
    ]);
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    expect(await screen.findByText("Dr. Tom Maurer (1500)")).toBeTruthy();
    expect(screen.getByText("Friend (1400)")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "e4" }));

    const board = screen.getByTestId("analysis-board");
    // Buchzüge tragen ein Symbol statt eines Kürzels — der Titel bleibt lesbar.
    expect(board.dataset.badges).toContain("Buchzug");
    expect(board.dataset.arrows).toContain("c7");
    expect(board.dataset.arrows).toContain("e7");
    expect(screen.getByRole("button", { name: "e4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "e5 ?!" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nf3" })).toBeTruthy();
    // Exzellente Züge werden in der Zugliste jetzt ebenfalls markiert.
    expect(screen.getByRole("button", { name: "Bc4 ✓" })).toBeTruthy();
  });

  it("saves notes and tags of the selected game from the analysis panel", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

    fireEvent.change(screen.getByPlaceholderText("Tag eingeben …"), { target: { value: "Eröffnung" } });
    fireEvent.click(screen.getByRole("button", { name: /Hinzufügen/ }));
    await waitFor(() => expect(mocks.setGameTags).toHaveBeenCalledWith(7, ["Eröffnung"]));

    fireEvent.change(screen.getByPlaceholderText(/Gedanken zur Partie/), {
      target: { value: "Zu passiv gespielt." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Notiz speichern/ }));
    await waitFor(() => expect(mocks.setGameNote).toHaveBeenCalledWith(7, "Zu passiv gespielt."));
  });
});
