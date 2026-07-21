import { describe, expect, it } from "vitest";
import { exportPgn, importPgn } from "./pgn";

const SAMPLE = `[Event "Club game"]
[Site "Berlin"]
[Date "2026.07.20"]
[Round "3"]
[White "Alice"]
[Black "Tom"]
[Result "0-1"]
[WhiteElo "1500"]
[BlackElo "1550"]
[ECO "C20"]
[Opening "King's Pawn"]
[KiebitzTags "OTB, Club"]
[KiebitzNote "Good finish"]

1. e4 e5 2. Nf3 Nc6 0-1`;

describe("PGN import/export", () => {
  it("imports player perspective, metadata, notes and tags", () => {
    const [game] = importPgn(SAMPLE, "Tom");
    expect(game).toMatchObject({ source: "manual", color: "black", result: "win", opponent: "Alice", eco: "C20" });
    expect(game.moves).toBe("e4 e5 Nf3 Nc6");
    expect(game.tags).toEqual(["OTB", "Club"]);
    expect(game.note).toBe("Good finish");
  });

  it("round-trips multiple games", () => {
    const game = importPgn(SAMPLE, "Tom")[0];
    const text = exportPgn([game, { ...game, source_id: "second" }], "Tom");
    const imported = importPgn(text, "Tom");
    expect(imported).toHaveLength(2);
    expect(imported[0].moves).toBe(game.moves);
    expect(imported[0].tags).toEqual(game.tags);
  });
});
