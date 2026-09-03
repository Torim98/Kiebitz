/**
 * Das Blatt des Starts.
 *
 * Geprüft wird, was den Modus ausmacht: ein gerechnetes Diagramm statt vier
 * Kacheln, Notation in der Sprache der Oberfläche, Formularzeilen statt
 * Karten — und dass die Wege dorthin führen, wohin die Karten von heute
 * führen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DashboardBlatt, { type Tagesdiagramm } from "./DashboardBlatt";
import type { UiGame } from "../../lib/gameUi";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

/** Stellung nach 1.e4 e5 2.Sf3 · echt gerechnet gehört sie in die Seite, nicht hierher. */
const FEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";

const spiel: Tagesdiagramm = {
  quelle: "game",
  fen: FEN,
  orientation: "white",
  amZug: "black",
  felder: [
    { label: "common.white", wert: "Tom", gross: true },
    { label: "common.black", wert: "DragonSlayer_88", gross: true },
    { label: "blatt.gameField", wert: "chess.com" },
    { label: "games.colOpening", wert: "C50" },
  ],
  ergebnis: "1 : 0",
  zeilen: ["Tom – DragonSlayer_88", "Stellung nach 2.Sf3"],
  davor: [{ san: "e4" }, { san: "e5" }],
  danach: [{ san: "Nf3" }, { san: "Nc6", nag: "??" }],
  offset: 0,
};

const partie = (over: Partial<UiGame> = {}): UiGame =>
  ({
    id: "g1",
    date: "11.07.2026",
    source: "chess.com",
    tc: "Rapid",
    color: "white",
    opponent: "DragonSlayer_88",
    oppElo: 1448,
    myElo: 1462,
    result: "win",
    opening: "Italienische Partie",
    eco: "C50",
    moves: 39,
    accuracy: 91.2,
    analyzed: true,
    tags: [],
    dbId: 7,
    ...over,
  }) as UiGame;

const wege = () => ({
  onRepertoire: vi.fn(),
  onAnalyse: vi.fn(),
  onPuzzles: vi.fn(),
  onAllePartien: vi.fn(),
  onPartie: vi.fn(),
});

function show(props: Partial<Parameters<typeof DashboardBlatt>[0]> = {}) {
  const handlers = wege();
  render(
    <DashboardBlatt
      mobile={false}
      bestand={1519}
      diagramm={spiel}
      wertungen={[{ id: "cc", platform: "chess.com", tc: "Rapid", value: 1462, delta: 24 }]}
      letzte={[partie()]}
      repDue={14}
      repNeben="Serie"
      unanalyzed={4}
      puzzles={{ done: 12, goal: 20 }}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("Blatt des Starts", () => {
  it("prints a diagram instead of four tiles", () => {
    show();
    // 64 Felder, gerechnet aus dem FEN · nicht gemalt.
    expect(document.querySelectorAll("[data-square]")).toHaveLength(64);
    // Und die Figuren stehen dort, wo die Stellung sie hat.
    expect(document.querySelector('[data-square="f3"] svg')).toBeTruthy();
    expect(document.querySelector('[data-square="e4"] svg')).toBeTruthy();
    expect(document.querySelector('[data-square="d4"] svg')).toBeNull();
  });

  it("sets the notation in the language of the interface", () => {
    show();
    // „Nf3" ist englisches SAN · auf einem deutschen Blatt steht Sf3.
    const satz = [...document.querySelectorAll(".notation")].map((n) => n.textContent).join(" ");
    expect(satz).toContain("Sf3");
    expect(satz).not.toContain("Nf3");
  });

  it("carries the verdict of the auto analysis next to the move", () => {
    show();
    expect(screen.getByText("??")).toBeTruthy();
  });

  it("leads where the cards of today lead", () => {
    const handlers = show();
    fireEvent.click(screen.getByText("dash.dueReviews"));
    expect(handlers.onRepertoire).toHaveBeenCalled();
    fireEvent.click(screen.getByText("dash.gamesWithoutAnalysis"));
    expect(handlers.onAnalyse).toHaveBeenCalled();
    fireEvent.click(screen.getByText("blatt.puzzlesToday"));
    expect(handlers.onPuzzles).toHaveBeenCalled();
    const eintraege = screen.getAllByText("DragonSlayer_88");
    fireEvent.click(eintraege[eintraege.length - 1]);
    expect(handlers.onPartie).toHaveBeenCalled();
  });

  it("shows where the diagram came from when no game is left", () => {
    show({
      diagramm: { ...spiel, quelle: "repertoire" },
      angebot: { repertoire: 3, puzzles: 8, endgame: true },
    });
    expect(screen.getByText("blatt.whereFrom")).toBeTruthy();
    expect(screen.getByText("blatt.srcRepertoireDue")).toBeTruthy();
  });

  it("says nothing at all rather than inventing a diagram", () => {
    show({ diagramm: null, angebot: undefined });
    expect(document.querySelectorAll("[data-square]")).toHaveLength(0);
    // Die Tagesliste bleibt · sie hängt nicht am Diagramm.
    expect(screen.getByText("dash.dueReviews")).toBeTruthy();
  });
});
