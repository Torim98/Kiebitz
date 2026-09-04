/**
 * Der Weg von der Wahl zur Seite.
 *
 * Geprüft wird nicht die Auflösung (die steht in theme.test.ts), sondern die
 * Kette: Wahl → angewendeter Stand → das, was eine Seite abliest.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useDiagramMode } from "./diagramMode";
import { DEFAULT_APPEARANCE, setAppearance, setPlusUnlocked } from "./theme";

function Probe() {
  return <span data-testid="mode">{useDiagramMode() ? "an" : "aus"}</span>;
}

const mode = () => screen.getByTestId("mode").textContent;

afterEach(() => {
  cleanup();
  act(() => {
    setAppearance(DEFAULT_APPEARANCE);
    setPlusUnlocked(null);
  });
  localStorage.clear();
});

describe("useDiagramMode", () => {
  it("is off until it is switched on", () => {
    act(() => setPlusUnlocked(true));
    render(<Probe />);
    expect(mode()).toBe("aus");

    act(() => setAppearance({ ...DEFAULT_APPEARANCE, diagram: true }));
    expect(mode()).toBe("an");
  });

  it("stays on when Plus lapses · the mode is free", () => {
    act(() => {
      setPlusUnlocked(true);
      setAppearance({ ...DEFAULT_APPEARANCE, diagram: true });
    });
    render(<Probe />);
    expect(mode()).toBe("an");

    act(() => setPlusUnlocked(false));
    expect(mode()).toBe("an");
  });

  it("marks the document, so CSS can join in", () => {
    act(() => {
      setPlusUnlocked(true);
      setAppearance({ ...DEFAULT_APPEARANCE, diagram: true });
    });
    expect(document.documentElement.dataset.diagram).toBe("on");

    act(() => setAppearance(DEFAULT_APPEARANCE));
    expect(document.documentElement.dataset.diagram).toBeUndefined();
  });
});
