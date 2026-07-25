import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Board from "./Board";

vi.mock("react-chessboard", () => ({ Chessboard: () => <div data-testid="chessboard" /> }));

// jsdom kennt den ResizeObserver nicht, den das Brett fürs Mitwachsen nutzt.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Board badges", () => {
  it("centers the marker on the top-right corner of the target square", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "e4", label: "!!", color: "#22c08a", title: "Brillant" }]}
      />
    );

    const badge = screen.getByTitle("Brillant");
    // e-Linie = Index 4 → rechte Kante bei (4 + 1) × 12,5 %, Reihe 4 → 50 % von oben.
    expect(badge.style.left).toBe("62.5%");
    expect(badge.style.top).toBe("50%");
    expect(badge.style.transform).toBe("translate(-50%, -50%)");
  });

  it("mirrors the corner when the board is flipped", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        orientation="black"
        badges={[{ square: "e4", label: "??", color: "#e66767", title: "Patzer" }]}
      />
    );

    // Gedreht liegt die e-Linie an Index 3 und Reihe 4 in der vierten Zeile.
    const badge = screen.getByTitle("Patzer");
    expect(badge.style.left).toBe("50%");
    expect(badge.style.top).toBe("37.5%");
  });

  it("renders element labels such as the book symbol", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "d4", label: <svg data-testid="book-icon" />, color: "#a88865", title: "Buchzug" }]}
      />
    );

    expect(screen.getByTestId("book-icon")).toBeTruthy();
  });
});
