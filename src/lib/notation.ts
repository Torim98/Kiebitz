/**
 * Englisches SAN in die Notation der Oberflächensprache.
 *
 * Die App rechnet und speichert durchgehend in englischem SAN — chess.js
 * spricht es, die PGN-Dateien tragen es, und die Referenzdatenbank steht voll
 * davon. Übersetzt wird deshalb erst beim Setzen, und nur dort: Ein deutsches
 * „Sf3" darf nie in eine Datei, in einen Link oder zurück an chess.js geraten.
 *
 * Zwei Sprachen sind hier wirklich anders, nicht bloß anders geschrieben:
 * Deutsch (K D T L S) und Französisch (R D T F C) tauschen die Figurenbuch-
 * staben, Spanisch (R D T A C) ebenso. Englisch, Hindi, Arabisch und
 * Chinesisch bleiben bei den lateinischen Buchstaben — für sie gibt es keine
 * verbreitete eigene Buchstabennotation, und eine erfundene wäre schlechter
 * als die, die dort ohnehin jeder liest.
 *
 * Die Rochade schreibt der Buchsatz mit Nullen und Halbgeviertstrich (0–0),
 * wie es der Druck seit je tut; SAN schreibt sie mit Buchstaben-O und
 * Bindestrichen. Das ist keine Übersetzung, sondern Typografie, und gilt
 * deshalb in jeder Sprache.
 */
import type { Locale } from "./i18n";
import { notationText } from "./share/notation";

/** Die sechs Figuren in SAN-Reihenfolge · Bauer trägt in SAN keinen Buchstaben. */
const SAN_PIECES = "KQRBN";

/**
 * Figurenbuchstaben je Sprache, in der Reihenfolge König, Dame, Turm, Läufer,
 * Springer. Fehlt eine Sprache, bleibt es bei den englischen Buchstaben.
 */
const PIECE_LETTERS: Partial<Record<Locale, string>> = {
  de: "KDTLS",
  es: "RDTAC",
  fr: "RDTFC",
};

/**
 * Ein einzelner Zug.
 *
 * Erkannt wird der Figurenbuchstabe nur da, wo SAN ihn überhaupt zulässt: als
 * erstes Zeichen und als Umwandlungsfigur hinter dem Gleichheitszeichen. Ein
 * „b" ist sonst die b-Linie und kein Läufer — genau daran scheitert jedes
 * Suchen-und-Ersetzen über die ganze Zeile.
 */
export function translateSan(san: string, locale: Locale): string {
  const letters = PIECE_LETTERS[locale];
  const move = san.trim();
  if (!move) return move;

  // Rochade zuerst · sie enthält kein Feld und keinen Figurenbuchstaben.
  const castle = /^(O-O-O|O-O|0-0-0|0-0)([+#]?)(.*)$/.exec(move);
  if (castle) {
    const long = castle[1].length > 3;
    return `0\u20130${long ? "\u20130" : ""}${castle[2]}${castle[3]}`;
  }

  const translate = (letter: string): string => {
    if (!letters) return letter;
    const index = SAN_PIECES.indexOf(letter);
    return index < 0 ? letter : letters[index];
  };

  let out = move;
  // Der ziehende Stein · nur als erstes Zeichen.
  if (SAN_PIECES.includes(out[0])) out = translate(out[0]) + out.slice(1);
  // Die Umwandlungsfigur · „e8=Q" wird „e8=D".
  out = out.replace(/=([KQRBN])/, (_, piece: string) => "=" + translate(piece));
  return out;
}

/**
 * Eine ganze Zugfolge · „14.d4 exd4 15.cxd4".
 *
 * Gesetzt wird aus den einzelnen Zügen und nicht aus einer fertigen Zeile:
 * Ein „b" ist in „Bb5" ein Läufer und in „exb5" eine Linie, und wer das an
 * einer Zeichenkette entscheiden will, rät. Die Nummerierung kommt aus
 * `share/notation.ts` · dieselbe Form, die die Seiten heute schon zeigen.
 *
 * `offset` sind die Halbzüge davor (0 = die Folge beginnt mit 1.).
 */
export function notationLine(
  sans: readonly string[],
  locale: Locale,
  offset = 0,
  continuing = false
): string {
  return notationText(
    sans.map((san) => translateSan(san, locale)),
    offset,
    continuing
  );
}
