/**
 * Der Claim unter der Marke · beim Start gezogen, für die ganze Sitzung.
 *
 * Kiebitz hat mehr als einen Satz über sich zu sagen, und keiner davon ist so
 * wichtig, dass er jeden Tag derselbe sein müsste. Beim Öffnen der App fällt
 * die Wahl einmal; sie gilt dann überall, wo der Claim steht — Seitenleiste,
 * App-Bar, Registerkopf. Zwei verschiedene Sätze nebeneinander auf einem
 * Schirm wären kein Wechsel, sondern ein Fehler.
 *
 * Gezogen wird ein *Schlüssel*, kein Text: Wer die Sprache wechselt, behält
 * denselben Satz, nur eben in der neuen Sprache.
 */
import type { Key } from "./locales/de";
import { isStoreCapture } from "./storeCapture";

/**
 * Die Sätze, aus denen die App wählt.
 *
 * Der erste ist der, den Kiebitz von Anfang an trägt · und im Aufnahmemodus
 * fällt das Los auf ihn, damit die Store-Bilder reproduzierbar bleiben. Auf
 * dem Telefon greift es dann auf den ersten, der dort auch hineinpasst.
 */
export const TAGLINES = [
  "app.tagline",
  "app.tagline2",
  "app.tagline3",
  "app.tagline4",
  "app.tagline5",
  "app.tagline6",
  "app.tagline7",
] as const satisfies readonly Key[];

/**
 * Das Breitenbudget des Claims in der App-Bar eines Telefons.
 *
 * Dort steht er hinter der Marke, zwischen Vogel und Plan-Abzeichen, und was
 * nicht mehr hineinpasst, wird nicht kleiner, sondern abgeschnitten:
 * „Bauernzug und Vog…" ist kein Claim, sondern eine Panne. Statt die Schrift zu
 * stauchen, zieht die App auf dem Telefon nur aus den Sätzen, die dort ganz
 * dastehen.
 *
 * Die Zahl ist gemessen, nicht geraten: Auf 360 px Schirmbreite · dem
 * schmalsten Gerät, das die App bedient · bleiben neben „Kiebitz ·" rund
 * 147 px für den Claim. Bei den 49 Sätzen aller sieben Sprachen liegt eine
 * Einheit zwischen 6,6 px und 8,7 px; bei 17 Einheiten ist der breiteste
 * gemessene Satz 138 px breit. Was darüber liegt, fängt an zu klemmen.
 */
export const COMPACT_LIMIT = 17;

/** Zeichen, die eine ganze Zelle belegen · CJK, Kana, Hangul, Vollbreitensatz. */
const VOLLBREIT =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Zeichen, die kaum Platz brauchen · Striche, Punkte, das schmale Alphabet. */
const SCHMAL = /[ .,:;'’!|iíjlt()[\]-]/;

/** Zeichen, die auffällig breit setzen · Versalien und die runden Kleinen. */
const BREIT = /[mwMWABCDEFGHIJKLNOPQRSTUVXYZ@%]/;

/**
 * Grobes Breitenmaß eines Satzes · in Einheiten von rund einem „n".
 *
 * Zeichen sind nicht gleich breit, und die bloße Zeichenzahl geht deshalb
 * daneben: „Wer kiebitzt, lernt" und „Regarde et apprends" haben beide
 * 19 Zeichen und unterscheiden sich um 23 px. Ein „i" zählt hier halb, ein „W"
 * ein Drittel mehr, ein „棋" doppelt · damit lag die Schätzung bei allen
 * Sätzen der App innerhalb von 15 %, und mehr braucht ein Budget nicht, das
 * ohnehin mit Sicherheitsabstand gesetzt ist.
 */
export function taglineWidth(text: string): number {
  let breite = 0;
  for (const zeichen of text) {
    if (VOLLBREIT.test(zeichen)) breite += 2;
    else if (SCHMAL.test(zeichen)) breite += 0.5;
    else if (BREIT.test(zeichen)) breite += 1.3;
    else breite += 1;
  }
  return breite;
}

/**
 * Das Los dieser Sitzung · eine Zahl zwischen 0 und 1, einmal gezogen.
 *
 * Gemerkt wird das Los und nicht der Satz. Welcher Satz daraus wird, hängt
 * davon ab, aus welchem Topf gegriffen wird: Auf dem Rechner sind es alle
 * sieben, auf dem Telefon nur die, die dort ganz hineinpassen. Wäre der Satz
 * gemerkt, entschiede der erste Bildaufbau über die ganze Sitzung — und der
 * läuft noch auf dem englischen Wörterbuch, weil das deutsche erst nachgeladen
 * wird. Der Topf wäre dann der englische, und auf einem deutschen Telefon
 * blieben von fünf passenden Sätzen zwei übrig.
 */
let los: number | null = null;

/**
 * Der Claim dieser Sitzung.
 *
 * Das Los fällt beim ersten Abruf und gilt dann für alles Weitere: So sieht
 * ein Test, der die Zufallsquelle vorher festlegt, ein bestimmtes Ergebnis,
 * und die vier Stellen in der Oberfläche bekommen alle denselben Satz.
 *
 * `passt` schränkt den Topf ein, wo der Platz es verlangt · die App-Bar auf
 * dem Telefon gibt nur `COMPACT_LIMIT` Einheiten her. Wer die Sprache
 * wechselt, behält denselben Satz, solange der Topf derselbe bleibt — auf dem
 * Rechner also immer. Auf dem Telefon kann ein Sprachwechsel einen anderen
 * Satz bringen, und das ist auch richtig so: Der alte passte in der neuen
 * Sprache womöglich gar nicht mehr.
 */
export function taglineKey(passt?: (key: Key) => boolean): Key {
  if (los == null) los = isStoreCapture() ? 0 : Math.random();
  const auswahl = passt ? TAGLINES.filter(passt) : TAGLINES;
  // Passt nichts, ist die Sperre falsch gesetzt · dann lieber ein zu langer
  // Satz als eine leere Zeile neben der Marke.
  const topf = auswahl.length > 0 ? auswahl : TAGLINES;
  return topf[Math.min(Math.floor(los * topf.length), topf.length - 1)];
}

/** Nur für Tests · die nächste Sitzung zieht wieder neu. */
export function resetTagline(): void {
  los = null;
}
