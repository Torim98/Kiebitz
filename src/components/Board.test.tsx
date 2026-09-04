import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Board from "./Board";

const boardMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  renders: 0,
}));
/**
 * Seit Version 5 nimmt das Brett alles in einem `options`-Objekt entgegen ·
 * die Prüfungen hier lesen deshalb dieses Objekt, nicht die Props.
 */
vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: Record<string, unknown> }) => {
    boardMock.props = options;
    boardMock.renders += 1;
    const onSquareClick = options.onSquareClick as
      | ((args: { piece: null; square: string }) => void)
      | undefined;
    return (
      <div data-testid="chessboard">
        <div data-square="e2"><div data-piece="wP" /></div>
        <div data-square="e3" />
        <div
          data-square="e4"
          onClick={() => onSquareClick?.({ piece: null, square: "e4" })}
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
  boardMock.props = null;
  boardMock.renders = 0;
});

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN_AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("Board badges", () => {
  it("shows legal targets while a piece is being dragged", () => {
    render(<Board boardId="test" fen={FEN} width={400} draggable />);

    act(() => {
      (boardMock.props?.onPieceDrag as (args: {
        isSparePiece: boolean;
        piece: { pieceType: string };
        square: string | null;
      }) => void)({ isSparePiece: false, piece: { pieceType: "wP" }, square: "e2" });
    });
    const styles = boardMock.props?.squareStyles as Record<string, CSSStyleDeclaration>;
    expect(Object.keys(styles).sort()).toEqual(["e2", "e3", "e4"]);

    act(() => {
      (boardMock.props?.onPieceDragCancel as () => void)();
    });
    expect(boardMock.props?.squareStyles).toEqual({});
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

    expect(boardMock.props?.allowDragging).toBe(false);
    expect(boardMock.props?.animationDurationInMs).toBe(0);
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;
    const target = document.querySelector<HTMLElement>('[data-square="e4"]')!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });

    const styles = boardMock.props?.squareStyles as Record<string, CSSStyleDeclaration>;
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

  it("keeps engine overlays and changing callbacks out of the 64-square render tree", () => {
    const firstDrop = vi.fn(() => true);
    const latestDrop = vi.fn(() => true);
    const view = render(
      <Board
        boardId="stable"
        fen={FEN}
        width={400}
        draggable
        onPieceDrop={firstDrop}
        arrows={[["e2", "e4", "#22c08a"]]}
      />
    );
    expect(boardMock.renders).toBe(1);

    view.rerender(
      <Board
        boardId="stable"
        fen={FEN}
        width={400}
        draggable
        onPieceDrop={latestDrop}
        squareStyles={{}}
        arrows={[["d2", "d4", "#d9a028"]]}
      />
    );

    // The lightweight SVG changed, but react-chessboard did not reconcile.
    expect(boardMock.renders).toBe(1);
    expect(screen.getByTestId("board-arrows").querySelector("line")?.getAttribute("stroke"))
      .toBe("#d9a028");

    const drop = boardMock.props?.onPieceDrop as (args: {
      piece: { isSparePiece: boolean; position: string; pieceType: string };
      sourceSquare: string;
      targetSquare: string | null;
    }) => boolean;
    expect(
      drop({
        piece: { isSparePiece: false, position: "e2", pieceType: "wP" },
        sourceSquare: "e2",
        targetSquare: "e4",
      })
    ).toBe(true);
    expect(firstDrop).not.toHaveBeenCalled();
    expect(latestDrop).toHaveBeenCalledWith("e2", "e4");
  });

  it("marks both squares of the last move, under everything a page marks itself", () => {
    const view = render(
      <Board
        boardId="test"
        fen={FEN_AFTER_E4}
        width={400}
        lastMove={{ from: "e2", to: "e4" }}
        squareStyles={{ e4: { background: "own" } }}
      />
    );

    let styles = boardMock.props?.squareStyles as Record<string, { background: string }>;
    expect(String(styles.e2.background)).toBe("var(--color-mark-soft)");
    // Was die Seite selbst setzt, schlägt die Markierung.
    expect(String(styles.e4.background)).toBe("own");

    view.rerender(<Board boardId="test" fen={FEN_AFTER_E4} width={400} />);
    styles = boardMock.props?.squareStyles as Record<string, { background: string }>;
    expect(styles).toEqual({});
  });

  it("cancels the imperative drag when the position changes", () => {
    const onPieceDrop = vi.fn(() => true);
    const view = render(
      <Board
        boardId="changing"
        fen={FEN}
        width={400}
        draggable
        mouseDrag
        silent
        onPieceDrop={onPieceDrop}
      />
    );
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });
    expect(piece.style.visibility).toBe("hidden");
    expect(document.querySelectorAll('[data-piece="wP"]')).toHaveLength(2);

    view.rerender(
      <Board
        boardId="changing"
        fen={FEN_AFTER_E4}
        width={400}
        draggable
        mouseDrag
        silent
        onPieceDrop={onPieceDrop}
      />
    );
    expect(piece.style.visibility).toBe("");
    expect(document.querySelectorAll('[data-piece="wP"]')).toHaveLength(1);

    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).not.toHaveBeenCalled();
  });

  it("does not complete a drag on a square from another board", () => {
    const onPieceDrop = vi.fn(() => true);
    render(
      <>
        <Board boardId="active" fen={FEN} width={400} draggable mouseDrag onPieceDrop={onPieceDrop} />
        <div data-square="d4" data-testid="foreign-square" />
      </>
    );
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;
    const foreignSquare = screen.getByTestId("foreign-square");
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => foreignSquare),
    });

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).not.toHaveBeenCalled();

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  it("disables move animation on Android and blocks native text dragging", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36"
    );
    render(<Board boardId="android" fen={FEN} width={400} draggable mouseDrag />);

    expect(boardMock.props?.animationDurationInMs).toBe(0);
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

  it("keeps a marker at the edge of the board fully on the board", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "h8", label: "?", color: "#e66767", title: "Fehler" }]}
      />
    );

    // Ohne Grenze stünde der Marker bei 100 % / 0 % und damit zur Hälfte
    // neben dem Brett · auf dem Handy bekäme die Seite dadurch eine
    // waagerechte Bildlaufleiste. Er rückt um seinen halben Durchmesser
    // (6,5 % / 2) herein und schließt so genau mit der Brettkante ab.
    const badge = screen.getByTitle("Fehler");
    expect(badge.style.left).toBe("96.75%");
    expect(badge.style.top).toBe("3.25%");
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

describe("Board end overlay", () => {
  const END = {
    square: "e1",
    mark: "#",
    color: "var(--color-loss)",
    label: "Schwarz gewinnt durch Matt",
    dismissLabel: "Hinweis ausblenden",
  };

  it("marks the king's square and shows the result strip", () => {
    render(<Board boardId="test" fen={FEN} width={400} end={END} />);

    const mark = screen.getByTestId("board-end-mark");
    // e1 aus Weiß-Sicht: fünfte Spalte (Index 4), unterste Reihe (Index 7) ·
    // der Marker sitzt auf der oberen rechten Feldecke wie die Zugmarker.
    expect(mark.style.left).toBe("62.5%");
    expect(mark.style.top).toBe("87.5%");
    expect(screen.getByText("Schwarz gewinnt durch Matt")).toBeTruthy();
  });

  it("follows the board orientation", () => {
    render(<Board boardId="test" fen={FEN} width={400} orientation="black" end={END} />);

    // Gedreht liegt e1 in Spalte 3 und der obersten Reihe · dort rückt der
    // Marker um seinen halben Durchmesser (7,5 % / 2) herein, statt zur
    // Hälfte über die Brettkante hinauszustehen.
    const mark = screen.getByTestId("board-end-mark");
    expect(mark.style.left).toBe("50%");
    expect(mark.style.top).toBe("3.75%");
  });

  it("hides the strip on click and brings it back for the next ending", () => {
    const { rerender } = render(<Board boardId="test" fen={FEN} width={400} end={END} />);

    fireEvent.click(screen.getByText("Schwarz gewinnt durch Matt"));
    expect(screen.queryByText("Schwarz gewinnt durch Matt")).toBeNull();
    // Der Marker bleibt · weggeklickt wird nur der Satz.
    expect(screen.getByTestId("board-end-mark")).toBeTruthy();

    rerender(
      <Board boardId="test" fen={FEN} width={400} end={{ ...END, label: "Remis durch Patt" }} />
    );
    expect(screen.getByText("Remis durch Patt")).toBeTruthy();
  });

  it("keeps the marker alone when there is no sentence to show", () => {
    render(<Board boardId="test" fen={FEN} width={400} end={{ ...END, label: "" }} />);

    expect(screen.getByTestId("board-end-mark")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing at all without an ending", () => {
    render(<Board boardId="test" fen={FEN} width={400} />);

    expect(screen.queryByTestId("board-end")).toBeNull();
  });
});
