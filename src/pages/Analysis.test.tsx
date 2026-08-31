import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { grantPlus, revokePlus } from "../test/plus";
import Analysis from "./Analysis";

const mocks = vi.hoisted(() => ({
  listGames: vi.fn(),
  startAnalysis: vi.fn(),
  gameAnalysis: vi.fn(),
  setGameNote: vi.fn(),
  setGameTags: vi.fn(),
  getSettings: vi.fn(),
  engineMove: "f1c4",
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/db", () => ({
  listGameSummaries: () => mocks.listGames().then((games: typeof excludedGame[]) =>
    games.map((game) => ({ ...game, has_moves: Boolean(game.moves), has_note: Boolean(game.note) }))
  ),
  getGame: (id: number) => mocks.listGames().then((games: typeof excludedGame[]) =>
    games.find((game) => game.id === id)
  ),
  setGameNote: mocks.setGameNote,
  setGameTags: mocks.setGameTags,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
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
  default: ({ fen, onPieceDrop, draggable, muted, mouseDrag, arrows, badges, orientation }: {
    fen: string;
    onPieceDrop?: (from: string, to: string) => boolean;
    draggable?: boolean;
    muted?: boolean;
    mouseDrag?: boolean;
    orientation?: string;
    arrows?: unknown[];
    // `label` kann ein React-Element sein (Buch-Symbol) · nicht serialisierbar.
    badges?: { square: string; color: string; title?: string }[];
  }) => (
    <div
      data-testid="analysis-board"
      data-fen={fen}
      data-orientation={orientation}
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
vi.mock("../components/ShareDialog", () => ({
  default: ({ subject }: { subject: Record<string, unknown> }) => (
    <div data-testid="share-subject">{JSON.stringify(subject)}</div>
  ),
}));
vi.mock("../components/LiveEngine", () => ({
  default: ({ onMove }: { onMove?: (uci: string) => void }) => (
    <div data-testid="live-engine">
      {onMove && <button onClick={() => onMove(mocks.engineMove)}>play engine move</button>}
    </div>
  ),
}));
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

/** Importierte Partie mit gespeicherter Original-URL. */
const onlineGame = {
  ...excludedGame,
  id: 11,
  source: "chess.com",
  source_id: "cc-123",
  url: "https://www.chess.com/game/live/123456789",
  opponent: "Rival",
  analysis_excluded: false,
};

beforeEach(() => {
  // Die Oberfläche startet ab Werk auf Englisch; diese Tests prüfen die
  // deutschen Texte und stellen die Sprache deshalb explizit ein.
  localStorage.setItem("kiebitz.locale", "de");
  mocks.getSettings.mockResolvedValue({ locale: "de", chessdb_enabled: false, cc_user: "Torim98", li_user: "Torim98" });
  mocks.listGames.mockResolvedValue([excludedGame]);
  mocks.gameAnalysis.mockResolvedValue([]);
  mocks.startAnalysis.mockResolvedValue(undefined);
  mocks.setGameNote.mockResolvedValue(undefined);
  mocks.setGameTags.mockImplementation((_id: number, tags: string[]) => Promise.resolve(tags));
  mocks.engineMove = "f1c4";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Eine im Test erteilte Berechtigung ist ein Modul-Singleton · ohne das
  // Zurücksetzen liefe der nächste Test unbemerkt mit Plus weiter.
  revokePlus();
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

  describe("navigation", () => {
    /** Zwei Partien in der Liste · nur so gibt es ein „weiter". */
    const twoGames = [excludedGame, onlineGame];

    it("steps to the next game without opening the picker", async () => {
      mocks.listGames.mockResolvedValue(twoGames);
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      fireEvent.click(screen.getByRole("button", { name: "Nächste Partie" }));
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("11"));

      // Am Ende der Liste hört das Blättern auf, statt umzulaufen.
      expect((screen.getByRole("button", { name: "Nächste Partie" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Vorherige Partie" }));
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    });

    it("turns the board around and back", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
      // Die Partie wurde als Weiß gespielt · so beginnt auch das Brett.
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("white");

      fireEvent.click(screen.getByRole("button", { name: "Brett drehen" }));
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("black");
      // Die Namen tauschen mit: oben steht jetzt, wer unten stand.
      expect(screen.getByText("Dr. Tom Maurer (1500)")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Brett drehen" }));
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("white");
    });

    /**
     * Der Grund für den Wächter in der Tastatur-Navigation: Ein Pfeil im
     * Notizfeld gehört dem Cursor, nicht dem Brett.
     */
    it("leaves the arrow keys to the notes field while it has the focus", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
      const atEnd = screen.getByTestId("analysis-board").dataset.fen;

      fireEvent.keyDown(screen.getByPlaceholderText(/Gedanken zur Partie/), { key: "ArrowLeft" });
      expect(screen.getByTestId("analysis-board").dataset.fen).toBe(atEnd);

      // Außerhalb eines Eingabefelds blättert derselbe Tastendruck weiter.
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(screen.getByTestId("analysis-board").dataset.fen).not.toBe(atEnd);
      fireEvent.keyDown(document.body, { key: "End" });
      expect(screen.getByTestId("analysis-board").dataset.fen).toBe(atEnd);
    });

    /**
     * Das Fokus-Brett zeigt dieselbe Stellung ohne Zugliste, Kurve und
     * Engine-Panel · dieselben Namen, dieselbe Bedienung.
     */
    it("opens the same position as a focus board and closes it again", async () => {
      // Das Fokus-Brett gehört zu Kiebitz Plus · hier geht es um die Ansicht,
      // nicht um das Gate davor. Das prüft components/FocusBoard.test.tsx.
      grantPlus();
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
      expect(screen.getAllByTestId("analysis-board")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Fokus-Brett öffnen" }));

      const focus = screen.getByTestId("focus-board");
      expect(focus.getAttribute("aria-label")).toBe("Analyse");
      // Zwei Bretter: das der Seite dahinter und das im Fokus · beide zeigen
      // dieselbe Stellung.
      const boards = screen.getAllByTestId("analysis-board");
      expect(boards).toHaveLength(2);
      expect(boards[1].dataset.fen).toBe(boards[0].dataset.fen);
      expect(within(focus).getByText("Dr. Tom Maurer (1500)")).toBeTruthy();
      // Im Fokus fehlt der Griff zum Fokus · dort ist man schon.
      expect(within(focus).queryByRole("button", { name: "Fokus-Brett öffnen" })).toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("focus-board")).toBeNull();
      expect(screen.getAllByTestId("analysis-board")).toHaveLength(1);
    });

    /**
     * Die Stapelläufe stehen im Menü · in der Leiste soll genau eine
     * Schaltfläche laut sein.
     */
    it("keeps the batch runs in a menu next to the primary action", async () => {
      mocks.listGames.mockResolvedValue(twoGames);
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      // Zugeklappt ist die Leiste eine Zeile mit einem Hauptknopf.
      expect(screen.queryByRole("menuitem", { name: /Nächste 10/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Diese Partie analysieren" })).toBeTruthy();

      const trigger = screen.getByRole("button", { name: "Mehrere Partien" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("menuitem", { name: /Nächste 10/ })).toBeTruthy();
    });

    /**
     * Auf Handybreite ist für acht Tasten und die Bewertung kein Platz. Die
     * Leiste bleibt trotzdem einzeilig und vollständig sichtbar: Blättern
     * steht da, alles Seltenere klappt darüber auf.
     */
    it("folds the rare board actions into a menu on the phone", async () => {
      grantPlus();
      render(
        <ShellProvider mobile>
          <LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>
        </ShellProvider>
      );
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      // Blättern bleibt in der Leiste, das Seltenere ist zugeklappt.
      expect(screen.getByRole("button", { name: "An den Anfang" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Brett drehen" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Weitere Brettaktionen" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Brett drehen" }));

      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("black");
    });
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

  it("shares the position together with the moves that led to it", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    // Zwei Halbzüge zurück: geteilt wird, was auf dem Brett steht.
    fireEvent.click(screen.getByRole("button", { name: "e5" }));
    fireEvent.click(screen.getByTitle("Stellung teilen"));

    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.kind).toBe("analysis");
    expect(subject.history).toBe("1.e4 e5");
  });

  it("shows the notation a shared link brings and keeps counting from there", async () => {
    const shared = {
      kind: "analysis" as const,
      // Nach 1.e4 · Schwarz ist am Zug.
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      orientation: "white" as const,
      history: "1.e4",
    };
    render(<LocaleProvider><Analysis targetGameId={null} shared={shared} /></LocaleProvider>);

    expect(await screen.findByText("1.e4")).toBeTruthy();

    // Der eigene Anbau zählt weiter, statt wieder bei eins anzufangen · der
    // erste Zug ist ein schwarzer und trägt deshalb gar keine eigene Nummer.
    fireEvent.click(screen.getByRole("button", { name: "play e5" }));
    expect(await screen.findByRole("button", { name: "e5" })).toBeTruthy();
    expect(screen.queryByText("1.")).toBeNull();

    fireEvent.click(screen.getByTitle("Stellung teilen"));
    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.history).toBe("1.e4 e5");
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
    expect(screen.getByText(/Dr\. Tom Maurer vs\. Friend · Rapid · Italian Game/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "e4" }));

    const board = screen.getByTestId("analysis-board");
    // Buchzüge tragen ein Symbol statt eines Kürzels · der Titel bleibt lesbar.
    expect(board.dataset.badges).toContain("Buchzug");
    expect(board.dataset.arrows).toContain("c7");
    expect(board.dataset.arrows).toContain("e7");
    expect(screen.getByRole("button", { name: "e4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /e5\s*\?!/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nf3" })).toBeTruthy();
    // Exzellente Züge werden in der Zugliste jetzt ebenfalls markiert.
    expect(screen.getByRole("button", { name: /Bc4\s*✓/ })).toBeTruthy();
  });

  it("plays a clicked engine move on the analysis board", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));

    expect(await screen.findByText(/Variante ab Zug 3/)).toBeTruthy();
    expect(screen.getByTestId("analysis-board").dataset.fen).toContain("b KQkq");
    expect(screen.getByText(/Bc4/)).toBeTruthy();
  });

  it("shows overall and phase accuracy for both players in the same cells", async () => {
    mocks.listGames.mockResolvedValue([{
      ...excludedGame,
      analyzed: true,
      accuracy: 88.4,
      accuracy_opening: 91.2,
      accuracy_middlegame: 84.5,
      accuracy_endgame: 89.7,
      opponent_accuracy: 76.3,
      opponent_accuracy_opening: 82.1,
      opponent_accuracy_middlegame: 70.4,
      opponent_accuracy_endgame: 75.8,
    }]);
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

    const overall = screen.getByRole("group", { name: "Gesamt · Partie" });
    expect(within(overall).getByText("88,4 %")).toBeTruthy();
    expect(within(overall).getByText("76,3 %")).toBeTruthy();
    expect(within(overall).getByTitle("Dr. Tom Maurer")).toBeTruthy();
    expect(within(overall).getByTitle("Friend")).toBeTruthy();

    const opening = screen.getByRole("group", { name: "Eröffnung" });
    expect(within(opening).getByText("91,2 %")).toBeTruthy();
    expect(within(opening).getByText("82,1 %")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Mittelspiel" })).getByText("70,4 %")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Endspiel" })).getByText("75,8 %")).toBeTruthy();
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

  describe("clocks", () => {
    /** Restzeiten nach je vier Halbzügen · 10 Minuten ohne Zuschlag. */
    const timedGame = {
      ...excludedGame,
      id: 21,
      clocks: "59500 59300 58800 58100",
      time_control: "600",
    };

    it("shows both clocks and the time control once a game brings them", async () => {
      mocks.listGames.mockResolvedValue([timedGame]);
      render(<LocaleProvider><Analysis targetGameId={21} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("21"));

      // Am Ende der Partie: Weiß 588,00 s, Schwarz 581,00 s.
      expect(await screen.findByText("9:48")).toBeTruthy();
      expect(screen.getByText("9:41")).toBeTruthy();
      // Die Bedenkzeit-Vorgabe steht in der Kopfzeile hinter der Zeitklasse.
      expect(screen.getByText(/Rapid 10 ·/)).toBeTruthy();
    });

    it("follows the move list backwards", async () => {
      mocks.listGames.mockResolvedValue([timedGame]);
      render(<LocaleProvider><Analysis targetGameId={21} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("21"));
      await screen.findByText("9:48");

      // Zurück auf Halbzug 2: Weiß 595,00 s, Schwarz 593,00 s.
      fireEvent.click(await screen.findByRole("button", { name: "e5" }));
      expect(await screen.findByText("9:55")).toBeTruthy();
      expect(screen.getByText("9:53")).toBeTruthy();
    });

    it("shows nothing at all when a game has no clock data", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
    });
  });

  describe("link to the original game", () => {
    const originLink = () => screen.queryByRole("link", { name: /Original/ });

    it("uses the stored game URL", async () => {
      mocks.listGames.mockResolvedValue([onlineGame]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("11"));

      await waitFor(() => expect(originLink()).toBeTruthy());
      expect(originLink()?.getAttribute("href")).toBe("https://www.chess.com/game/live/123456789");
    });

    it("falls back to the account archive when the game has no URL", async () => {
      mocks.listGames.mockResolvedValue([{ ...onlineGame, source: "lichess", url: "" }]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("11"));

      await waitFor(() =>
        expect(originLink()?.getAttribute("href")).toBe("https://lichess.org/@/Torim98/all")
      );
    });

    /** Eine Archiv-URL ohne Benutzernamen wäre ein Link ins Leere. */
    it("omits the link when neither a URL nor an account handle is known", async () => {
      mocks.getSettings.mockResolvedValue({ locale: "de", chessdb_enabled: false, cc_user: "", li_user: "" });
      mocks.listGames.mockResolvedValue([{ ...onlineGame, url: "" }]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("11"));

      expect(originLink()).toBeNull();
    });

    it("omits the link for manually recorded games", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      expect(originLink()).toBeNull();
    });
  });
});
