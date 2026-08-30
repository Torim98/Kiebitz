import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FocusBoard, { FocusButton } from "./FocusBoard";
import { ShellProvider } from "./MobileShell";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

function open(mobile: boolean, onClose = () => {}) {
  return render(
    <ShellProvider mobile={mobile}>
      <FocusBoard
        open
        onClose={onClose}
        title="Analyse"
        subtitle="Torim98 vs. Rival"
        above={<div>oben</div>}
        below={<div>unten</div>}
      >
        <div data-testid="board">Brett</div>
      </FocusBoard>
    </ShellProvider>
  );
}

describe("focus board", () => {
  it("renders nothing while it is closed", () => {
    render(
      <FocusBoard open={false} onClose={() => {}} title="Analyse">
        <div data-testid="board">Brett</div>
      </FocusBoard>
    );
    expect(screen.queryByTestId("focus-board")).toBeNull();
  });

  it("shows title, context and the surrounding rows around the board", () => {
    open(false);
    const layer = screen.getByTestId("focus-board");
    expect(layer.getAttribute("aria-label")).toBe("Analyse");
    expect(screen.getByText("Torim98 vs. Rival")).toBeTruthy();
    expect(screen.getByText("oben")).toBeTruthy();
    expect(screen.getByTestId("board")).toBeTruthy();
    expect(screen.getByText("unten")).toBeTruthy();
  });

  /**
   * Auf dem Desktop legt sich der Fokus als Karte über die unscharf gestellte
   * Seite; auf dem Handy ist er ein eigener, deckender Schirm.
   */
  it("blurs the page behind it on the desktop and covers it on the phone", () => {
    open(false);
    expect(screen.getByTestId("focus-board").className).toContain("backdrop-blur");
    cleanup();

    open(true);
    const layer = screen.getByTestId("focus-board");
    expect(layer.className).toContain("bg-bg");
    expect(layer.className).not.toContain("backdrop-blur");
  });

  it("closes on Escape and on a click next to the card", () => {
    const onClose = vi.fn();
    open(false, onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const layer = screen.getByTestId("focus-board");
    fireEvent.mouseDown(layer);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Ein Klick *in* die Karte schließt nicht.
    fireEvent.mouseDown(screen.getByTestId("board"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /**
   * Android-Zurück soll den Fokus schließen und nicht die App verlassen · der
   * eigene History-Eintrag liegt dafür auf derselben Stapeltiefe wie die Seite.
   */
  it("takes a history entry of its own so the back key closes it", () => {
    window.history.replaceState({ kd: 2 }, "");
    const onClose = vi.fn();
    open(false, onClose);

    expect((window.history.state as { sheet?: boolean }).sheet).toBe(true);
    expect((window.history.state as { kd?: number }).kd).toBe(2);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { kd: 2 } }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers a labelled handle for opening the focus", () => {
    const onClick = vi.fn();
    render(<FocusButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "board.focusOpen" }));
    expect(onClick).toHaveBeenCalled();
  });
});
