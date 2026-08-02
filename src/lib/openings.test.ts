import { describe, expect, it } from "vitest";
import { openingName } from "./openings";

describe("openingName", () => {
  it.each([
    [["e4", "c5"], "Sicilian Defense"],
    [["e4", "c6"], "Caro-Kann Defense"],
    [["e4", "e5", "Nf3", "Nc6", "Bb5"], "Ruy Lopez"],
    [["e4", "e5", "Nf3", "Nc6", "Bc4"], "Italian Game"],
  ])("recognizes %j as %s", (sans, expected) => {
    expect(openingName(sans)).toBe(expected);
  });

  it("keeps the last recognized name beyond the catalogued position", () => {
    expect(openingName(["e4", "c5", "Na3", "a6"]))
      .toBe("Sicilian Defense: Kronberger Variation");
  });
});
