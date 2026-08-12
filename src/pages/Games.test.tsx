import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Games from "./Games";
import { emitDataChange } from "../lib/changes";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../components/Board", () => ({ default: () => <div data-testid="board" /> }));

const game = {
  id: 1,
  source: "lichess",
  source_id: "test-game",
  url: "https://lichess.org/test-game",
  played_at: "2026-07-15",
  played_ts: 1_784_067_200,
  time_class: "rapid",
  color: "white",
  opponent: "Testgegner",
  opp_elo: 1450,
  my_elo: 1500,
  result: "win",
  opening: "Italian Game",
  eco: "C50",
  moves_count: 12,
  accuracy: 83.4,
  accuracy_opening: 90,
  accuracy_middlegame: 80,
  accuracy_endgame: null,
  moves: "e4 e5 Nf3 Nc6",
  note: "",
  tags: [],
  analyzed: true,
};
let listedGame: typeof game & { analysis_excluded?: boolean } = { ...game };
let deleted = false;

beforeEach(() => {
  localStorage.clear();
  emitDataChange();
  listedGame = { ...game };
  deleted = false;
  invokeMock.mockReset();
  vi.mocked(openDialog).mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "app_info") {
      return Promise.resolve({ version: "0.5.0", backend: "tauri", platform: "windows" });
    }
    if (command === "get_settings") {
      return Promise.resolve({
        locale: "de",
        cc_user: "Tom",
        li_user: "Tom",
        display_name: "Tom",
        import_months: 3,
      });
    }
    if (command === "list_games_page") return Promise.resolve({
      items: deleted ? [] : [{ ...listedGame, has_moves: true, has_note: Boolean(listedGame.note) }],
      total: deleted ? 0 : 1,
      library_total: deleted ? 0 : 1,
    });
    if (command === "game_detail") return Promise.resolve(listedGame);
    if (command === "list_games_for_export") return Promise.resolve(deleted ? [] : [listedGame]);
    if (command === "delete_game") { deleted = true; return Promise.resolve(true); }
    if (command === "read_pgn_file") return Promise.resolve(`[Event "Friend"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0`);
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Games page", () => {
  it("loads only a paginated summary and the selected detail", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByText("Testgegner");

    expect(invokeMock).toHaveBeenCalledWith("list_games_page", {
      request: expect.objectContaining({ offset: 0, limit: 10 }),
    });
    expect(invokeMock).toHaveBeenCalledWith("game_detail", { id: 1 });
    expect(invokeMock).not.toHaveBeenCalledWith("list_games_for_export");
  });

  it("deletes the selected database game after confirmation", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    expect(await screen.findByText("Testgegner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Partie löschen" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Kiebitz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_game", { id: 1 }));
    expect(await screen.findByText("Keine Partien gefunden.")).toBeTruthy();
    expect(screen.queryByText("Testgegner")).toBeNull();
  });

  it("explains PGN player perspective and separates import from export", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByText("Testgegner");
    fireEvent.click(screen.getByRole("button", { name: /Import \/ Export/ }));

    expect(screen.getByText("PGN importieren")).toBeTruthy();
    expect(screen.getByText("PGN exportieren")).toBeTruthy();
    expect(screen.getByText(/ordnet beim Import Weiß\/Schwarz, Gegner, Elo und Ergebnis/)).toBeTruthy();
  });

  it("renders a player-name mismatch as a yellow warning", async () => {
    vi.mocked(openDialog).mockResolvedValue("friend.pgn");
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByText("Testgegner");
    fireEvent.click(screen.getByRole("button", { name: /Import \/ Export/ }));
    fireEvent.click(screen.getByRole("button", { name: "Datei wählen" }));
    await screen.findByText("friend.pgn");
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));

    const warning = await screen.findByText(/stimmt bei 1 PGN-Partie/);
    expect(warning.closest("div")?.className).toContain("text-gold");
  });

  it("swaps the wide table for cards on mobile without losing the row action", async () => {
    const { container } = render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    await screen.findByText("Testgegner");

    // Die achtspaltige Tabelle erzwingt sonst 760 px Breite.
    expect(container.querySelector("table")).toBeNull();
    // Alles Wesentliche steht weiterhin auf der Karte.
    const card = screen.getByText("Testgegner").closest("div")?.parentElement;
    expect(card?.textContent).toContain("1450");
    expect(card?.textContent).toContain("83,4 %");
    expect(card?.textContent).toContain("Italian Game");

    // Antippen wählt die Partie weiterhin aus und öffnet das Detail.
    fireEvent.click(screen.getByText("Testgegner"));
    expect(await screen.findByRole("button", { name: "Partie löschen" })).toBeTruthy();
  });

  it("keeps an excluded game individually openable in analysis", async () => {
    listedGame = { ...game, analyzed: false, analysis_excluded: true };
    const openAnalysis = vi.fn();
    render(<LocaleProvider><Games openAnalysis={openAnalysis} /></LocaleProvider>);

    expect(await screen.findByText("Nicht in Analysen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analysieren" }));
    expect(openAnalysis).toHaveBeenCalledWith(1);
  });
});
