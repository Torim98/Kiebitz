import { beforeEach, describe, expect, it } from "vitest";
import { deInt, deShort, setFormatLocale } from "./format";

/**
 * Zahlen, die in eine Spalte passen müssen.
 *
 * Der Online-Bestand des Lichess-Explorers zählt in Milliarden. Ausgeschrieben
 * ist das eine dreizehnstellige Zahl, die in der Buchkarte über den Elo-Schnitt
 * daneben lief · genau das hatte `deShort` zu verhindern.
 */
describe("deShort", () => {
  beforeEach(() => setFormatLocale("de-DE"));

  it("leaves numbers alone as long as they fit", () => {
    expect(deShort(0)).toBe(deInt(0));
    expect(deShort(1_000)).toBe(deInt(1_000));
    // Sieben Stellen sind neun Zeichen · die Spalte trägt sie noch.
    expect(deShort(9_999_999)).toBe(deInt(9_999_999));
  });

  it("rounds what would not fit", () => {
    const billions = deShort(4_581_682_673);
    expect(billions).not.toContain("681");
    expect(billions.length).toBeLessThanOrEqual(10);
    expect(deShort(12_000_000).length).toBeLessThanOrEqual(10);
  });

  it("speaks the display language", () => {
    setFormatLocale("en-US");
    expect(deShort(4_581_682_673)).toBe("4.6B");
  });
});
