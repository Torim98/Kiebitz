/**
 * Die eingefrorenen Testvektoren.
 *
 * Sie stehen wortgleich im Worker (`kiebitz-api/src/share/vectors.json`) und
 * werden dort genauso geprüft. Schlägt dieser Test fehl, hat sich das Format
 * geändert, und dann öffnen alle Links, die schon draußen sind, beim
 * Empfänger etwas anderes als beim Absender. Der richtige Weg dahin führt über
 * eine neue `SHARE_VERSION`, nicht über frische Vektoren.
 */
import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, type SharePayload } from "./codec";
import vectors from "./vectors.json";

describe("share vectors", () => {
  it("encodes every frozen case to exactly the recorded string", () => {
    for (const entry of vectors.cases) {
      expect(encodeShare(entry.payload as SharePayload), entry.name).toBe(entry.encoded);
    }
  });

  it("decodes every recorded string back to its payload", () => {
    for (const entry of vectors.cases) {
      const decoded = decodeShare(entry.encoded);
      expect(decoded, entry.name).not.toBeNull();
      // Die Nutzlast wird nicht Feld für Feld verglichen, sondern über ihre
      // Wirkung: Was zurückkommt, muss dieselbe Zeichenkette ergeben.
      expect(encodeShare(decoded!), entry.name).toBe(entry.encoded);
      expect(decoded!.fen, entry.name).toBe((entry.payload as SharePayload).fen);
    }
  });
});
