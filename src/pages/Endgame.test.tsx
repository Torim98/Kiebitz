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
  default: ({ onPieceDrop }: { onPieceDrop: (from: string, to: string) => boolean }) => (
    <button onClick={() => onPieceDrop("a1", "a2")}>make move</button>
  ),
}));

afterEach(() => {
  cleanup();
  engineMove.mockClear();
});

describe("Endgame trainer", () => {
  it("keeps a fixed status slot while the engine starts thinking", () => {
    render(<Endgame />);
    fireEvent.click(screen.getByRole("button", { name: "eg.randomStart" }));

    const status = screen.getByTestId("endgame-status");
    expect(status.textContent).toBe("eg.yourTurn");
    expect(status.className).toContain("min-h-10");
    expect(status.parentElement?.className).toContain(
      "grid-cols-[minmax(0,1fr)_8rem]"
    );

    fireEvent.click(screen.getByRole("button", { name: "make move" }));
    expect(status.textContent).toBe("eg.thinking");
    expect(engineMove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("endgame-status")).toBe(status);
  });
});
