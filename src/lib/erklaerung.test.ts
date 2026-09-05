/**
 * Die Satzmaschine der Analyse.
 *
 * Geprüft wird, was den Unterschied zwischen „hilfreich" und „peinlich"
 * ausmacht: dass ohne Motiv geschwiegen wird, dass Notation und Zahlen in der
 * Sprache der Oberfläche stehen, und dass ein Schlüssel aus der Datenbank
 * nicht ungeprüft auf die Seite kommt.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { erklaereFazit, erklaereZug, type Zugzeile } from "./erklaerung";
import { loadLocale, translator } from "./locales/registry";
import { setFormatLocale } from "./format";

beforeAll(async () => {
  await loadLocale("de");
});

const de = () => translator("de");

function zeile(over: Partial<Zugzeile> = {}): Zugzeile {
  return {
    ply: 34,
    san: "Nxe5",
    judgment: "blunder",
    ...over,
  };
}

describe("Erklärung eines Zuges", () => {
  it("schweigt zu einem Zug, an dem nichts auffiel", () => {
    const satz = erklaereZug(zeile({ judgment: "", motif: "" }), {
      t: de(),
      locale: "de",
    });
    expect(satz).toBeNull();
  });

  it("nennt die Gabel mit Figur und Feld", () => {
    const satz = erklaereZug(
      zeile({
        motif: "fork",
        motif_detail: JSON.stringify({
          reply: "Qd5+",
          piece: "Q",
          square: "d5",
          targets: [
            { piece: "K", square: "g8" },
            { piece: "N", square: "e5" },
          ],
        }),
      }),
      { t: de(), locale: "de" }
    );
    expect(satz).toContain("d5");
    expect(satz).toContain("König");
    expect(satz).toContain("Springer");
    // Deutsche Notation, nicht englische.
    expect(satz).toContain("Dd5+");
    expect(satz).not.toContain("Qd5+");
  });

  it("fällt auf den Preis zurück, wenn kein Motiv gefunden wurde", () => {
    setFormatLocale("de-DE");
    const satz = erklaereZug(
      zeile({
        motif: "none",
        motif_detail: JSON.stringify({ best: "Nf3" }),
        loss_cp: 120,
      }),
      { t: de(), locale: "de" }
    );
    // Der Verlust steht in Bauern und in deutscher Schreibweise.
    expect(satz).toContain("1,2");
    expect(satz).toContain("Sf3");
  });

  it("behauptet kein Motiv, dem die Felder fehlen", () => {
    // „fork" ohne Ziele ist keine Gabel, sondern eine kaputte Zeile.
    const satz = erklaereZug(
      zeile({ motif: "fork", motif_detail: JSON.stringify({ reply: "Qd5+" }), loss_cp: 90 }),
      { t: de(), locale: "de" }
    );
    expect(satz).not.toBeNull();
    expect(satz).not.toContain("Gabel");
  });

  it("liest denselben Zug immer gleich und zwei Züge verschieden", () => {
    const t = de();
    const eins = { t, locale: "de" as const, seed: "7:34" };
    const zwei = { t, locale: "de" as const, seed: "7:35" };
    const row = zeile({ motif: "back_rank", motif_detail: JSON.stringify({ square: "g1" }) });
    expect(erklaereZug(row, eins)).toBe(erklaereZug(row, eins));
    // Über die beiden Formulierungen hinweg trifft irgendein Samenpaar auch
    // zwei verschiedene · sonst wäre die Auswahl wirkungslos.
    const alle = new Set(
      ["a", "b", "c", "d", "e"].map((seed) => erklaereZug(row, { t, locale: "de", seed }))
    );
    expect(alle.size).toBeGreaterThan(1);
    expect(erklaereZug(row, zwei)).not.toBeUndefined();
  });

  it("nimmt ein unbekanntes Motiv nicht für bare Münze", () => {
    // Eine spätere Rust-Fassung könnte ein Motiv liefern, das diese Fassung
    // nicht kennt. Dann darf kein roher Schlüssel auf der Seite stehen.
    const satz = erklaereZug(
      zeile({ motif: "zwischenzug", motif_detail: "{}", loss_cp: 40 }),
      { t: de(), locale: "de" }
    );
    expect(satz).not.toContain("expl.");
  });
});

describe("Fazit der Partie", () => {
  const fazit = JSON.stringify([
    { key: "verdict.grade.solid", params: { acc: 84.2 } },
    { key: "verdict.turningPoint", params: { n: 17, san: "Nxe5" } },
    { key: "verdict.recurring", params: { n: 2, motif: "fork" } },
  ]);

  it("setzt die Bausteine in der Sprache der Oberfläche", () => {
    setFormatLocale("de-DE");
    const saetze = erklaereFazit(fazit, { t: de(), locale: "de" });
    expect(saetze).toHaveLength(3);
    expect(saetze[0]).toContain("84,2");
    expect(saetze[1]).toContain("Sxe5");
    expect(saetze[2]).toContain("Gabel");
  });

  it("lässt einen Baustein weg, den es nicht kennt", () => {
    const mit = JSON.stringify([
      { key: "verdict.grade.solid", params: { acc: 84.2 } },
      { key: "verdict.erfunden", params: {} },
    ]);
    expect(erklaereFazit(mit, { t: de(), locale: "de" })).toHaveLength(1);
  });

  it("verträgt ein fehlendes oder kaputtes Fazit", () => {
    expect(erklaereFazit(undefined, { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit("", { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit("kein JSON", { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit('{"key":"x"}', { t: de(), locale: "de" })).toEqual([]);
  });
});
