import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Endgame from "./Endgame";

const engineMove = vi.hoisted(() => vi.fn(() => new Promise<string>(() => {})));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));

vi.mock("../lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) => key,
  }),
  // Das Fokus-Brett und seine Schaltfläche beschriften sich selbst.
  useT: () => (key: string) => key,
}));

vi.mock("../lib/endgame", () => ({
  endgameMove: engineMove,
  endgameRecord: vi.fn(() => Promise.resolve()),
  endgameStats: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../lib/randomEndgame", () => ({
  randomDrill: () => ({
    id: "rnd-kr-k",
    category: "random",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: { de: "Zufall: Turm gegen König", en: "Random: rook vs. king" },
    hint: { de: "Hinweis", en: "Hint" },
  }),
}));

vi.mock("../components/Board", () => ({
  default: ({
    fen,
    onPieceDrop,
  }: {
    fen: string;
    onPieceDrop: (from: string, to: string) => boolean;
  }) => (
    <button data-testid="endgame-board" data-fen={fen} onClick={() => onPieceDrop("a1", "a2")}>
      make move
    </button>
  ),
}));

// Der Teilen-Dialog hat eigene Tests · hier zählt, was die Seite ihm mitgibt.
vi.mock("../components/ShareDialog", () => ({
  default: ({ subject }: { subject: Record<string, unknown> }) => (
    <div data-testid="share-subject">{JSON.stringify(subject)}</div>
  ),
}));

afterEach(() => {
  cleanup();
  engineMove.mockClear();
});

describe("Endgame trainer", () => {
  it("starts with a random position by default", () => {
    render(<Endgame />);

    expect(screen.getByText("Random: rook vs. king")).toBeTruthy();
    expect(screen.getByTestId("endgame-board").getAttribute("data-fen")).toBe(
      "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"
    );
  });

  it("shares the drill as it starts, with its goal, not the half-played position", () => {
    render(<Endgame />);
    fireEvent.click(screen.getByRole("button", { name: "make move" }));

    fireEvent.click(screen.getByTitle("sh.title"));
    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.kind).toBe("endgame");
    expect(subject.fen).toBe("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    expect(subject.orientation).toBe("white");
    expect(subject.title).toBe("Random: rook vs. king · eg.goalWin");
  });

  it("keeps a fixed status slot while the engine starts thinking", () => {
    render(<Endgame />);
    fireEvent.click(screen.getByRole("button", { name: "eg.randomStart" }));

    const status = screen.getByTestId("endgame-status");
    expect(status.textContent).toBe("eg.yourTurn");
    // Der Stand hat eine eigene Zeile mit reservierter Hoehe · er teilt sie
    // sich nur mit dem Ziel und rutscht deshalb nicht mit dem Namen mit.
    expect(status.className).toContain("min-h-5");
    expect(status.parentElement?.className).toContain("justify-between");

    fireEvent.click(screen.getByRole("button", { name: "make move" }));
    expect(status.textContent).toBe("eg.thinking");
    expect(engineMove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("endgame-status")).toBe(status);
  });
});
