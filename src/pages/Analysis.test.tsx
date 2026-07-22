import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import Analysis from "./Analysis";

const mocks = vi.hoisted(() => ({
  listGames: vi.fn(),
  startAnalysis: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/db", () => ({ listGames: mocks.listGames }));
vi.mock("../lib/settings", () => ({
  getSettings: () => Promise.resolve({ chessdb_enabled: false }),
  chessdbQuery: vi.fn(),
}));
vi.mock("../lib/analysis", () => ({
  cancelAnalysis: vi.fn(),
  gameAnalysis: () => Promise.resolve([]),
  onAnalysisDone: () => Promise.resolve(() => {}),
  onAnalysisGameDone: () => Promise.resolve(() => {}),
  onAnalysisProgress: () => Promise.resolve(() => {}),
  searchPosition: () => Promise.resolve({ total_games: 0, next_moves: [], sample: [] }),
  startAnalysis: mocks.startAnalysis,
}));
vi.mock("../components/Board", () => ({
  default: ({ onPieceDrop }: { onPieceDrop?: (from: string, to: string) => boolean }) => (
    <div data-testid="analysis-board">
      {onPieceDrop && <button onClick={() => onPieceDrop("e2", "e4")}>play e4</button>}
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
  mocks.startAnalysis.mockResolvedValue(undefined);
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
});
