import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { randomDrill, RANDOM_TEMPLATE_IDS } from "./randomEndgame";

/**
 * Deterministischer Zufall für reproduzierbare Läufe. Der Zustand wird
 * vorgewärmt, sonst liefern benachbarte Seeds fast denselben ersten Wert.
 */
function seeded(seed: number): () => number {
  let state = (seed * 2_654_435_761) % 4_294_967_296;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

describe("random endgames", () => {
  it("always produces a legal position that is still to be played", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const drill = randomDrill(seeded(seed));
      const chess = new Chess(drill.fen);
      expect(chess.isGameOver()).toBe(false);
      expect(chess.isCheck()).toBe(false);
      expect(chess.moves().length).toBeGreaterThan(0);
      // Der Spieler zieht immer zuerst.
      expect(chess.turn()).toBe(drill.side === "white" ? "w" : "b");
      expect(RANDOM_TEMPLATE_IDS).toContain(drill.id);
      expect(drill.category).toBe("random");
    }
  });

  it("keeps both kings on the board and apart", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const board = new Chess(randomDrill(seeded(seed)).fen).board().flat();
      const kings = board.filter((square) => square?.type === "k");
      expect(kings).toHaveLength(2);
    }
  });

  it("varies material and colours across draws", () => {
    const ids = new Set<string>();
    const sides = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const drill = randomDrill(seeded(seed));
      ids.add(drill.id);
      sides.add(drill.side);
    }
    expect(ids.size).toBeGreaterThan(2);
    expect(sides.size).toBe(2);
  });
});
