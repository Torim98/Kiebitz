import { describe, expect, it } from "vitest";
import { PIECE_SETS, glyphKey, isPieceSetId, pieceSetDef } from "./sets";

describe("piece sets", () => {
  it("keeps exactly one free set", () => {
    expect(PIECE_SETS.filter((set) => !set.plus).map((set) => set.id)).toEqual(["classic"]);
  });

  it("discards values it does not know", () => {
    expect(isPieceSetId("kiebitz")).toBe(true);
    expect(isPieceSetId("origami")).toBe(false);
    expect(pieceSetDef("origami" as never).id).toBe("classic");
  });

  it("reads a FEN letter as a glyph key", () => {
    expect(glyphKey("P")).toBe("wP");
    expect(glyphKey("k")).toBe("bK");
  });
});
