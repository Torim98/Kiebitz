import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Board from "./Board";

const boardMock = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("react-chessboard", () => ({
  Chessboard: (props: Record<string, unknown>) => {
    boardMock.props = props;
    return (
      <div data-testid="chessboard">
        <div data-square="e2"><div data-piece="wP" /></div>
        <div data-square="e3" />
        <div
          data-square="e4"
          onClick={() => (props.onSquareClick as ((square: string) => void) | undefined)?.("e4")}
        />
      </div>
    );
  },
}));

// jsdom kennt den ResizeObserver nicht, den das Brett fürs Mitwachsen nutzt.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("Board badges", () => {
  it("shows legal targets while a piece is being dragged", () => {
    render(<Board boardId="test" fen={FEN} width={400} draggable />);

    act(() => {
      (boardMock.props?.onPieceDragBegin as (piece: string, square: string) => void)("wP", "e2");
    });
    const styles = boardMock.props?.customSquareStyles as Record<string, CSSStyleDeclaration>;
    expect(Object.keys(styles).sort()).toEqual(["e2", "e3", "e4"]);

    act(() => {
      (boardMock.props?.onPieceDragEnd as () => void)();
    });
    expect(boardMock.props?.customSquareStyles).toEqual({});
  });

  it("uses the shared pointer fallback without rebuilding react-dnd", () => {
    const onPieceDrop = vi.fn(() => true);
    const onSquareClick = vi.fn();
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        draggable
        mouseDrag
        onPieceDrop={onPieceDrop}
        onSquareClick={onSquareClick}
      />
    );

    expect(boardMock.props?.arePiecesDraggable).toBe(false);
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;
    const target = document.querySelector<HTMLElement>('[data-square="e4"]')!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });

    const styles = boardMock.props?.customSquareStyles as Record<string, CSSStyleDeclaration>;
    expect(Object.keys(styles).sort()).toEqual(["e2", "e3", "e4"]);

    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).toHaveBeenCalledWith("e2", "e4");
    expect(piece.style.visibility).toBe("");

    // Ein verspäteter Android-Kompatibilitätsklick darf den Zug nicht als
    // Click-&-Move-Eingabe wiederholen.
    fireEvent.click(target);
    expect(onSquareClick).not.toHaveBeenCalled();

    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("disables move animation on Android and blocks native text dragging", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36"
    );
    render(<Board boardId="android" fen={FEN} width={400} draggable mouseDrag />);

    expect(boardMock.props?.animationDuration).toBe(0);
    const wrapper = screen.getByTestId("chessboard").closest(".kiebitz-board")!;
    expect(fireEvent.dragStart(wrapper)).toBe(false);
  });

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
