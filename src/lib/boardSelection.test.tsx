import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBoardSelection } from "./boardMoves";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Minimales Brett: ein Knopf je Feld, plus Ausgabe der Feldstile. */
function Harness({ fen, play }: { fen: string; play: (from: string, to: string) => boolean }) {
  const { onSquareClick, squareStyles } = useBoardSelection(fen, play);
  return (
    <div>
      {["e2", "e4", "e7", "g1", "f3"].map((square) => (
        <button key={square} onClick={() => onSquareClick(square)}>
          {square}
        </button>
      ))}
      <span data-testid="styled">{Object.keys(squareStyles).sort().join(",")}</span>
      <span data-testid="dots">
        {Object.values(squareStyles).filter((s) => String(s.background).includes("radial-gradient")).length}
      </span>
    </div>
  );
}

afterEach(cleanup);

describe("click-to-move selection", () => {
  it("marks the selected piece and its targets", () => {
    render(<Harness fen={START} play={() => true} />);

    fireEvent.click(screen.getByRole("button", { name: "e2" }));
    expect(screen.getByTestId("styled").textContent).toBe("e2,e3,e4");
    // Beide Zielfelder tragen einen Zugpunkt.
    expect(screen.getByTestId("dots").textContent).toBe("2");
  });

  it("plays the move when a target square is clicked", () => {
    const play = vi.fn().mockReturnValue(true);
    render(<Harness fen={START} play={play} />);

    fireEvent.click(screen.getByRole("button", { name: "e2" }));
    fireEvent.click(screen.getByRole("button", { name: "e4" }));
    expect(play).toHaveBeenCalledWith("e2", "e4");
    // Nach dem Zug ist die Auswahl aufgehoben.
    expect(screen.getByTestId("styled").textContent).toBe("");
  });

  it("ignores the opponent's pieces", () => {
    render(<Harness fen={START} play={() => true} />);

    fireEvent.click(screen.getByRole("button", { name: "e7" }));
    expect(screen.getByTestId("styled").textContent).toBe("");
  });

  it("switches the selection to another own piece", () => {
    const play = vi.fn().mockReturnValue(false);
    render(<Harness fen={START} play={play} />);

    fireEvent.click(screen.getByRole("button", { name: "e2" }));
    fireEvent.click(screen.getByRole("button", { name: "g1" }));
    expect(play).toHaveBeenCalledWith("e2", "g1");
    expect(screen.getByTestId("styled").textContent).toBe("f3,g1,h3");
  });
});
