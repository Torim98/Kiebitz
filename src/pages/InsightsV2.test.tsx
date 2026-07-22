import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import InsightsV2 from "./InsightsV2";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    Line: Empty,
    Bar: Container,
    Cell: Empty,
    LabelList: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    Legend: Empty,
  };
});

const games = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  source: "lichess",
  source_id: `game-${index}`,
  url: "",
  played_at: `2026-07-${String(index + 1).padStart(2, "0")}`,
  played_ts: 1_783_000_000 + index * 86_400,
  time_class: index % 2 ? "blitz" : "rapid",
  color: index % 2 ? "black" : "white",
  opponent: `Opponent ${index}`,
  opp_elo: 1450 + index * 10,
  my_elo: 1500,
  result: index < 2 ? "loss" : index === 2 ? "draw" : "win",
  opening: index < 4 ? "Italian Game" : "Sicilian Defense",
  eco: "C50",
  moves_count: 18 + index * 7,
  accuracy: 72 + index * 3,
  accuracy_opening: 80 + index,
  accuracy_middlegame: 70 + index,
  accuracy_endgame: 75 + index,
  moves: "e4 e5",
  note: "",
  tags: [],
  analyzed: true,
}));

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "app_info") return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
    if (command === "get_settings") return Promise.resolve({ locale: "de" });
    if (command === "list_games") return Promise.resolve(games);
    if (command === "error_stats") return Promise.resolve([
      { phase: "opening", inaccuracy: 2, mistake: 1, blunder: 0 },
      { phase: "middlegame", inaccuracy: 3, mistake: 2, blunder: 1 },
      { phase: "endgame", inaccuracy: 1, mistake: 0, blunder: 0 },
    ]);
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
  });
});

afterEach(cleanup);

describe("deep Insights", () => {
  it("loads real data and exposes the four analysis sub-pages", async () => {
    render(<LocaleProvider><InsightsV2 /></LocaleProvider>);
    expect(await screen.findByText(/Tiefenanalyse über 6 Partien/)).toBeTruthy();
    expect(screen.getByText("Analytische Diagnose")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Spielstärke/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Eröffnungen/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Muster & Gewohnheiten/ })).toBeTruthy();
  });

  it("shows detailed color-split opening records", async () => {
    render(<LocaleProvider><InsightsV2 /></LocaleProvider>);
    await screen.findByText("Analytische Diagnose");
    fireEvent.click(screen.getByRole("button", { name: /Eröffnungen/ }));
    expect(screen.getByText("Eröffnungsakte · getrennt nach Farbe")).toBeTruthy();
    expect(screen.getAllByText("Italian Game").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Weiß").length).toBeGreaterThan(0);
  });

  it("switches to performance and behavioral analysis", async () => {
    render(<LocaleProvider><InsightsV2 /></LocaleProvider>);
    await screen.findByText("Analytische Diagnose");
    fireEvent.click(screen.getByRole("button", { name: /Spielstärke/ }));
    expect(screen.getByText("Leistung nach Zeitkontrolle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Muster & Gewohnheiten/ }));
    expect(screen.getByText("Leistung nach Wochentag")).toBeTruthy();
    expect(screen.getByText("Punkte nach Niederlage")).toBeTruthy();
  });
});
