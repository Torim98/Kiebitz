/**
 * Die Zeile für den Layoutmodus.
 *
 * Die Themenauswahl daneben hat ihre Prüfung in theme.test.ts; hier geht es um
 * die eine Zeile darüber — darum, dass sie den Modus nennt, in den sie führt,
 * und dass sie auch ohne Plus schaltet statt in die Erklärung zu springen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AppearanceSection from "./AppearanceSection";
import { onPlusDialog } from "../../lib/plus/dialog";
import { DEFAULT_APPEARANCE, type Appearance } from "../../lib/theme";
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

beforeEach(() => {
  onChange.mockReset();
  grantPlus();
});

afterEach(cleanup);

describe("layout mode row", () => {
  it("stands above the themes", () => {
    show();
    const row = screen.getByText("set.diagramMode");
    const themes = screen.getByText("theme.dark");
    // "vorangestellt" heißt hier wörtlich: die Zeile steht im Dokument vor der
    // ersten Themenkachel.
    expect(row.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the other mode and switches to it", () => {
    show();
    fireEvent.click(screen.getByText("set.diagramMode"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: true });
  });

  it("names the way back once the diagram mode is on", () => {
    show({ diagram: true });
    expect(screen.queryByText("set.diagramMode")).toBeNull();
    fireEvent.click(screen.getByText("set.dashboardMode"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: false });
  });

  it("switches without Plus", () => {
    revokePlus();
    show();

    const asked: (string | null)[] = [];
    const stop = onPlusDialog((feature) => asked.push(feature));
    fireEvent.click(screen.getByText("set.diagramMode"));
    stop();

    // Der Layoutmodus hängt an keiner Freischaltung · kein Schloss, keine
    // Erklärung, nur der Wechsel.
    expect(asked).toEqual([]);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: true });
  });
});
