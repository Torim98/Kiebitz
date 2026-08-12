import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import InsightsV2 from "./InsightsV2";
import { demoDeepInsights } from "./insights/demo";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    RadarChart: Container,
    Line: Empty,
    Bar: Container,
    Radar: Empty,
    Cell: Empty,
    LabelList: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
    PolarGrid: Empty,
    PolarAngleAxis: Empty,
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

const noop = () => {};
const page = () => <InsightsV2 go={noop} openPuzzles={noop} openAnalysis={noop} />;

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "app_info")
      return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
    if (command === "get_settings") return Promise.resolve({ locale: "de" });
    if (command === "list_games") return Promise.resolve(games);
    if (command === "error_stats")
      return Promise.resolve([
        { phase: "opening", inaccuracy: 2, mistake: 1, blunder: 0 },
        { phase: "middlegame", inaccuracy: 3, mistake: 2, blunder: 1 },
        { phase: "endgame", inaccuracy: 1, mistake: 0, blunder: 0 },
      ]);
    if (command === "deep_insights") return Promise.resolve(demoDeepInsights());
    if (command === "rep_gaps") return Promise.resolve([]);
    if (command === "puzzle_insights")
      return Promise.reject(new Error("keine Puzzle-Datenbank im Test"));
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
  });
});

afterEach(cleanup);

describe("deep Insights", () => {
  it("loads real data and exposes all six sections", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    expect(await screen.findByText(/Tiefenanalyse über 6 Partien/)).toBeTruthy();
    for (const label of ["Übersicht", "Stärke", "Zeit", "Eröffnungen", "Muster", "Training"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("leads with ranked findings and the player DNA", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    expect(screen.getByText("Woran du arbeiten solltest")).toBeTruthy();
    expect(screen.getByText("Spieler-DNA")).toBeTruthy();
    // Die Demo-Daten müssen echte Befunde erzeugen, sonst prüft der Test nichts.
    expect(screen.queryByText(/Noch keine belastbaren Befunde/)).toBeNull();
  });

  it("derives the time-management findings from the clock data", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Zeit/ }));
    expect(screen.getByText("Züge in Zeitnot")).toBeTruthy();
    expect(screen.getByText("Tempo und Fehler")).toBeTruthy();
    // Blocks A und H stehen zusammen · beides hängt an denselben Uhrdaten.
    expect(screen.getByText("Zeitformate im Vergleich")).toBeTruthy();
  });

  it("compares the player against their own opponent field", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Stärke/ }));
    expect(screen.getByText("Du gegen dein Gegnerfeld")).toBeTruthy();
    expect(screen.getByText(/Gegnerfeld: 2,8/)).toBeTruthy();
  });

  it("splits repertoire deviations by who left the book first", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Eröffnungen/ }));
    expect(screen.getByText("Wer verlässt das Buch zuerst")).toBeTruthy();
    expect(screen.getByText("Wackelige Linien")).toBeTruthy();
    expect(await screen.findByText(/0 Stellen, an denen dein Buch/)).toBeTruthy();
  });

  it("shows the session curve under patterns", async () => {
    render(<LocaleProvider>{page()}</LocaleProvider>);
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Muster/ }));
    expect(screen.getByText("Leistung im Lauf der Sitzung")).toBeTruthy();
    expect(screen.getByText("Sofort weiter nach einer Niederlage")).toBeTruthy();
  });

  it("keeps every section reachable on mobile in two rows", async () => {
    const { container } = render(
      <LocaleProvider>
        <ShellProvider mobile>{page()}</ShellProvider>
      </LocaleProvider>
    );
    await screen.findByText(/Tiefenanalyse über 6 Partien/);

    const tabs = container.querySelector('nav[aria-label="Insights-Bereiche"]');
    // Quer scrollende Reiter werden übersehen · sechs passen in zwei Reihen.
    expect(tabs?.className).toContain("grid-cols-3");
    expect(tabs?.className).not.toContain("overflow-x-auto");
    expect(tabs?.querySelectorAll("button")).toHaveLength(6);
  });

  it("keeps the deep sections collapsed on mobile until opened", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>{page()}</ShellProvider>
      </LocaleProvider>
    );
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Zeit/ }));

    const section = screen.getByRole("button", { name: /Tempo und Fehler/ });
    expect(section.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(section);
    expect(section.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the opening file as cards on mobile", async () => {
    const { container } = render(
      <LocaleProvider>
        <ShellProvider mobile>{page()}</ShellProvider>
      </LocaleProvider>
    );
    await screen.findByText(/Tiefenanalyse über 6 Partien/);
    fireEvent.click(screen.getByRole("button", { name: /Eröffnungen/ }));
    expect(await screen.findByText(/0 Stellen, an denen dein Buch/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alle Eröffnungen nach Farbe getrennt/ }));

    expect(container.querySelector("table")).toBeNull();
    expect(screen.getAllByText(/Weiß · \d+ Partien · Genauigkeit/).length).toBeGreaterThan(0);
  });
});
