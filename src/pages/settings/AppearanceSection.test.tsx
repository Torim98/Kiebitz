/**
 * Der Schalter des Diagramm-Modus.
 *
 * Die Themenauswahl daneben hat ihre Prüfung in theme.test.ts; hier geht es
 * um die eine Zeile, die neu dazugekommen ist — und darum, dass sie gesperrt
 * das übliche Verhalten zeigt, statt zu verschwinden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AppearanceSection from "./AppearanceSection";
import { onPlusDialog } from "../../lib/plus/dialog";
import { DEFAULT_APPEARANCE, THEME_FEATURE, type Appearance } from "../../lib/theme";
import { grantPlus, revokePlus } from "../../test/plus";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
}));

// Die Zeichnungen kommen sonst über die Tauri-Brücke · für diese Zeile zählt
// nur, dass die Vorschau daneben rendert.
vi.mock("../../lib/pieces/glyphs", () => ({
  PIECE_VIEWBOX: "0 0 45 45",
  glyphsVersion: () => 0,
  loadPieceGlyphs: () => Promise.resolve({}),
  pieceGlyphs: () => ({}),
  subscribeGlyphs: () => () => {},
}));

const onChange = vi.fn();

function show(overrides: Partial<Appearance> = {}) {
  render(<AppearanceSection appearance={{ ...DEFAULT_APPEARANCE, ...overrides }} onChange={onChange} />);
}

const toggle = () => screen.getByRole("switch");

beforeEach(() => {
  onChange.mockReset();
  grantPlus();
});

afterEach(cleanup);

describe("diagram mode switch", () => {
  it("stands above the themes and says it is experimental", () => {
    show();
    expect(screen.getByText("set.diagramModeBadge")).toBeTruthy();
    const section = screen.getByText("set.diagramMode").closest("div");
    const themes = screen.getByText("theme.dark");
    // "vorangestellt" heißt hier wörtlich: der Schalter steht im Dokument vor
    // der ersten Themenkachel.
    expect(section!.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reports the state and hands the change up", () => {
    show();
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: true });
  });

  it("switches back off", () => {
    show({ diagram: true });
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: false });
  });

  it("stays visible without Plus, but locked", () => {
    revokePlus();
    show();
    expect(screen.getByText("set.diagramMode")).toBeTruthy();
    // Kein Schalter mehr · die ganze Zeile führt zur Plus-Erklärung.
    expect(screen.queryByRole("switch")).toBeNull();

    const asked: (string | null)[] = [];
    const stop = onPlusDialog((feature) => asked.push(feature));
    fireEvent.click(screen.getByText("set.diagramModeNote"));
    stop();

    expect(asked).toEqual([THEME_FEATURE]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
