import { describe, expect, it } from "vitest";
import {
  endForPosition,
  gameEnd,
  kingSquare,
  pgnTerminationHeader,
  TERMINATIONS,
  terminationFromChessCom,
  terminationFromLichess,
  terminationFromPgnHeader,
} from "./boardEnd";

/** Narrenmatt · Schwarz hat gerade Qh4# gesetzt, Weiß ist am Zug und matt. */
const FOOLS_MATE = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
const RUNNING = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("endForPosition", () => {
  it("nennt Matt samt Gewinner und mattem König", () => {
    expect(endForPosition(FOOLS_MATE)).toEqual({
      reason: "mate",
      winner: "black",
      square: "e1",
    });
  });

  it("nennt Patt ohne Gewinner", () => {
    expect(endForPosition(STALEMATE)).toEqual({
      reason: "stalemate",
      winner: null,
      square: "h8",
    });
  });

  it("erkennt ungenügendes Material", () => {
    expect(endForPosition("8/8/4k3/8/8/4K3/8/8 w - - 0 1")?.reason).toBe("insufficient");
  });

  it("schweigt zu laufenden und ungültigen Stellungen", () => {
    expect(endForPosition(RUNNING)).toBeNull();
    expect(endForPosition("kein fen")).toBeNull();
    expect(endForPosition("")).toBeNull();
  });
});

describe("kingSquare", () => {
  it("findet beide Könige", () => {
    expect(kingSquare(FOOLS_MATE, "white")).toBe("e1");
    expect(kingSquare(FOOLS_MATE, "black")).toBe("e8");
  });
});

describe("gameEnd", () => {
  it("nimmt den gespeicherten Grund, den die Stellung nicht kennt", () => {
    // Laufende Stellung: nur die Quelle weiß, dass hier aufgegeben wurde.
    expect(gameEnd({ fen: RUNNING, termination: "resign", result: "win", color: "white" })).toEqual(
      { reason: "resign", winner: "white", square: "e8" }
    );
  });

  it("leitet ohne gespeicherten Grund aus der Stellung ab", () => {
    expect(gameEnd({ fen: FOOLS_MATE, termination: "" })).toEqual({
      reason: "mate",
      winner: "black",
      square: "e1",
    });
  });

  it("zeigt bei unbekanntem Grund immerhin den Ausgang", () => {
    expect(gameEnd({ fen: RUNNING, termination: "", result: "loss", color: "white" })).toEqual({
      reason: null,
      winner: "black",
      square: "e1",
    });
  });

  it("markiert bei Remis keinen König, außer bei Patt", () => {
    expect(gameEnd({ fen: RUNNING, termination: "agreement", result: "draw", color: "white" }))
      .toEqual({ reason: "agreement", winner: null, square: null });
    expect(gameEnd({ fen: STALEMATE, termination: "stalemate", result: "draw", color: "white" }))
      .toEqual({ reason: "stalemate", winner: null, square: "h8" });
  });

  it("bleibt still, wenn weder Grund noch Ausgang vorliegen", () => {
    expect(gameEnd({ fen: RUNNING })).toBeNull();
  });

  it("verwirft einen unbekannten Grund, statt ihn durchzureichen", () => {
    expect(gameEnd({ fen: FOOLS_MATE, termination: "irgendwas" })?.reason).toBe("mate");
  });
});

describe("Quellen-Zuordnung", () => {
  it("liest chess.com von der Verliererseite", () => {
    expect(terminationFromChessCom("win", "checkmated")).toBe("mate");
    expect(terminationFromChessCom("timeout", "win")).toBe("timeout");
    expect(terminationFromChessCom("agreed", "agreed")).toBe("agreement");
    expect(terminationFromChessCom("win", "unbekannt")).toBe("");
  });

  it("liest den Lichess-Status", () => {
    expect(terminationFromLichess("outoftime")).toBe("timeout");
    expect(terminationFromLichess("mate")).toBe("mate");
    expect(terminationFromLichess("")).toBe("");
  });

  it("liest PGN-Sätze, ohne sich an Teilwörtern zu verschlucken", () => {
    expect(terminationFromPgnHeader("Torim98 won by resignation")).toBe("resign");
    expect(terminationFromPgnHeader("Time forfeit")).toBe("timeout");
    // "stalemate" und "material" enthalten beide "mate".
    expect(terminationFromPgnHeader("Game drawn by stalemate")).toBe("stalemate");
    expect(terminationFromPgnHeader("Insufficient material")).toBe("insufficient");
    expect(terminationFromPgnHeader("Normal")).toBe("");
  });

  it("schreibt Kopfzeilen, die es selbst wieder einliest", () => {
    for (const reason of TERMINATIONS) {
      expect(terminationFromPgnHeader(pgnTerminationHeader(reason))).toBe(reason);
    }
  });
});
