/**
 * Die Regeln des Blattes, die sich rechnen lassen — ohne React, ohne Daten
 * holen, damit sie prüfbar bleiben.
 */

/**
 * Die Quellen des Diagramms des Tages, in fester Reihenfolge.
 *
 * Ein Tag ohne neue Partie darf das Blatt nicht leer lassen: Die Stellung
 * rückt aus der nächsten Quelle nach, die etwas anzubieten hat. Die
 * Reihenfolge steht hier und nicht in den Einstellungen — ein zweiter Schalter
 * neben einem Schalter, der selbst noch „Experimentell" heißt, wäre einer zu
 * viel. Nachrüsten lässt sie sich, wenn sich zeigt, dass jemand sie ändern will.
 */
export const DIAGRAM_SOURCES = ["game", "repertoire", "puzzle", "endgame"] as const;

export type DiagramSource = (typeof DIAGRAM_SOURCES)[number];

/** Was jede Quelle gerade anzubieten hat · `false` heißt: nichts. */
export type DiagramOffer = Record<DiagramSource, boolean>;

/** Die erste Quelle, die etwas hat · `null`, wenn keine etwas hat. */
export function chooseDiagramSource(offer: DiagramOffer): DiagramSource | null {
  return DIAGRAM_SOURCES.find((source) => offer[source]) ?? null;
}

/**
 * Der Halbzug, vor dem das Diagramm stehen soll.
 *
 * Ein Buch druckt nicht die Schlussstellung, sondern die Stelle, an der die
 * Partie entschieden wurde. Die Auto-Analyse hat das schon beurteilt: Der
 * erste grobe Fehler ist diese Stelle, der erste Fehler die nächstbeste
 * Auskunft. Ohne beides bleibt es bei der Schlussstellung — geraten wird nicht.
 *
 * Gelesen werden die Marken, nicht die Analysezeilen: So gilt dieselbe Regel
 * für eine gerechnete Partie und für eine, die ihre Marken mitbringt.
 *
 * Zurück kommt die Zahl der Halbzüge *vor* dem Diagramm, also genau das, was
 * `fenAfter` als `count` erwartet.
 */
export function criticalPly(nags: readonly (string | undefined)[], moveCount: number): number {
  const find = (mark: string) => nags.findIndex((nag) => nag === mark);
  const index = [find("??"), find("?")].find((value) => value >= 0);
  return index == null ? moveCount : index;
}

/**
 * Der Zeitraum, auf den das Partienverzeichnis eingeschränkt ist.
 *
 * Vier Stufen, mehr nicht: Ein Registerband kennt „alles", „heute", „dieser
 * Monat", „dieses Jahr" — ein Datumsbereich mit zwei Kalendern wäre ein
 * Werkzeug und kein Formularfeld.
 */
export const ZEITRAEUME = ["alle", "heute", "monat", "jahr"] as const;

export type Zeitraum = (typeof ZEITRAEUME)[number];

/**
 * Die untere Grenze eines Zeitraums in Unix-Sekunden · 0 heißt „alle".
 *
 * Gerechnet wird in der Zeitzone des Geräts, weil „heute" das ist, was der
 * Nutzer heute nennt, und nicht, was in UTC gerade gilt.
 */
export function zeitraumStart(zeitraum: Zeitraum, jetzt: Date = new Date()): number {
  const grenze =
    zeitraum === "heute"
      ? new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())
      : zeitraum === "monat"
        ? new Date(jetzt.getFullYear(), jetzt.getMonth(), 1)
        : zeitraum === "jahr"
          ? new Date(jetzt.getFullYear(), 0, 1)
          : null;
  return grenze ? Math.floor(grenze.getTime() / 1000) : 0;
}

/** Der nächste Zeitraum im Ringschluss · das Feld schaltet weiter. */
export function naechsterZeitraum(zeitraum: Zeitraum): Zeitraum {
  return ZEITRAEUME[(ZEITRAEUME.indexOf(zeitraum) + 1) % ZEITRAEUME.length];
}
