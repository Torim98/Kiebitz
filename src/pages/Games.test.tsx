import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import Games from "./Games";

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

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
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
    if (command === "list_games") return Promise.resolve([game]);
    if (command === "delete_game") return Promise.resolve(true);
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Games page", () => {
  it("deletes the selected database game after confirmation", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    expect(await screen.findByText("Testgegner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Partie löschen" }));

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
});
