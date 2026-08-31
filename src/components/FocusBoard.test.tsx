import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FocusBoard, { FocusButton } from "./FocusBoard";
import { ShellProvider } from "./MobileShell";
import type { PlusFeature } from "../lib/plus/types";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
}));

/**
 * Das Fokus-Brett gehört zu Kiebitz Plus. Hier geht es um die Ansicht selbst
 * und um das, was der Griff im gesperrten Fall tut · den Zustand dahinter
 * prüft plus/store.test.ts.
 */
const gate = { unlocked: true, pending: false };
vi.mock("../lib/plus/usePlus", () => ({
  usePlusGate: () => ({ ...gate, plus: {} }),
}));

const opened = vi.fn();
vi.mock("../lib/plus/dialog", () => ({
  openPlusDialog: (feature: PlusFeature) => opened(feature),
}));

beforeEach(() => {
  gate.unlocked = true;
  gate.pending = false;
  opened.mockClear();
});

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

  /**
   * Gesperrt bleibt der Griff stehen und erklärt sich · verschwinden würde er
   * nur als Fehler gelesen (siehe components/PlusLock.tsx).
   */
  it("sends the handle into the Plus explanation while it is locked", () => {
    gate.unlocked = false;
    const onClick = vi.fn();
    render(<FocusButton onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "board.focusPlus" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledWith("focus_board");
  });

  it("stays closed without Plus, even when a page asks for it", () => {
    gate.unlocked = false;
    open(false);
    expect(screen.queryByTestId("focus-board")).toBeNull();
  });

  /** Solange der Plus-Zustand lädt, bleibt alles offen · kein Aufblitzen. */
  it("keeps showing while the entitlement is still loading", () => {
    gate.unlocked = false;
    gate.pending = true;
    open(false);
    expect(screen.getByTestId("focus-board")).toBeTruthy();
  });
});
