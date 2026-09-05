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
 * Der erste ist der, den Kiebitz von Anfang an trägt · er bleibt auch der
 * Satz für die Aufnahmen der Store-Bilder, damit die reproduzierbar bleiben.
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

let gezogen: Key | null = null;

/**
 * Der Claim dieser Sitzung.
 *
 * Erst beim ersten Abruf gezogen und dann gemerkt: So sieht ein Test, der die
 * Zufallsquelle vorher festlegt, ein bestimmtes Ergebnis, und die vier Stellen
 * in der Oberfläche bekommen alle denselben Satz.
 */
export function taglineKey(): Key {
  if (gezogen) return gezogen;
  gezogen = isStoreCapture()
    ? TAGLINES[0]
    : TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
  return gezogen;
}

/** Nur für Tests · die nächste Sitzung zieht wieder neu. */
export function resetTagline(): void {
  gezogen = null;
}
