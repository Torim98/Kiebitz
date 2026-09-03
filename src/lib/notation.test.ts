import { describe, expect, it } from "vitest";
import { notationLine, translateSan } from "./notation";

describe("translateSan", () => {
  it("swaps the piece letters where a language has its own", () => {
    expect(translateSan("Nf3", "de")).toBe("Sf3");
    expect(translateSan("Qd5+", "de")).toBe("Dd5+");
    expect(translateSan("Bb5", "de")).toBe("Lb5");
    expect(translateSan("Rxe5", "de")).toBe("Txe5");
    expect(translateSan("Kh8", "de")).toBe("Kh8");
  });

  it("leaves the capture sign and the squares alone", () => {
    // Das Schlagzeichen bleibt x, auch wo die Sprache es anders spricht.
    expect(translateSan("Nxe5", "de")).toBe("Sxe5");
    expect(translateSan("exd4", "de")).toBe("exd4");
    expect(translateSan("cxd4", "fr")).toBe("cxd4");
  });

  it("does not mistake a file for a piece", () => {
    // „b" ist hier die b-Linie · ein blindes Ersetzen machte einen Läufer daraus.
    expect(translateSan("bxc4", "de")).toBe("bxc4");
    expect(translateSan("b4", "de")).toBe("b4");
    // Und der Zusatz zur Unterscheidung bleibt ebenfalls stehen.
    expect(translateSan("Nbd2", "de")).toBe("Sbd2");
    expect(translateSan("R1e2", "de")).toBe("T1e2");
  });

  it("translates the promotion piece too", () => {
    expect(translateSan("e8=Q", "de")).toBe("e8=D");
    expect(translateSan("axb8=N+", "de")).toBe("axb8=S+");
  });

  it("sets castling with zeros and an en dash, in every language", () => {
    expect(translateSan("O-O", "de")).toBe("0\u20130");
    expect(translateSan("O-O-O", "de")).toBe("0\u20130\u20130");
    expect(translateSan("O-O+", "en")).toBe("0\u20130+");
    expect(translateSan("O-O-O#", "zh")).toBe("0\u20130\u20130#");
  });

  it("follows the language and is not wired to German", () => {
    expect(translateSan("Nf3", "fr")).toBe("Cf3");
    expect(translateSan("Bb5", "fr")).toBe("Fb5");
    expect(translateSan("Bb5", "es")).toBe("Ab5");
    expect(translateSan("Rd1", "es")).toBe("Td1");
    // Ohne eigene Buchstabennotation bleibt es beim englischen SAN.
    expect(translateSan("Nf3", "en")).toBe("Nf3");
    expect(translateSan("Nf3", "ar")).toBe("Nf3");
    expect(translateSan("Nf3", "hi")).toBe("Nf3");
    expect(translateSan("Nf3", "zh")).toBe("Nf3");
  });

  it("survives empty input", () => {
    expect(translateSan("", "de")).toBe("");
    expect(translateSan("   ", "de")).toBe("");
  });
});

describe("notationLine", () => {
  it("numbers the moves and translates each one", () => {
    expect(notationLine(["e4", "e5", "Nf3", "Nc6"], "de")).toBe("1.e4 e5 2.Sf3 Sc6");
  });

  it("starts at the right move when the line begins in mid-game", () => {
    // 26 Halbzüge davor · der nächste Zug ist der 14. von Weiß.
    expect(notationLine(["d4", "exd4", "cxd4"], "de", 26)).toBe("14.d4 exd4 15.cxd4");
  });

  it("marks a line that begins with Black", () => {
    expect(notationLine(["Nh7", "Ne5"], "de", 25)).toBe("13...Sh7 14.Se5");
  });
});
