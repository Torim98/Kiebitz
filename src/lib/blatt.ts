/**
 * Die Regeln des Blattes, die sich rechnen lassen — ohne React, ohne Daten
 * holen, damit sie prüfbar bleiben.
 */
import type { MoveEvalRow } from "./analysis";

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
 * Zurück kommt die Zahl der Halbzüge *vor* dem Diagramm, also genau das, was
 * `fenAfter` als `count` erwartet.
 */
export function criticalPly(rows: readonly MoveEvalRow[], moveCount: number): number {
  const find = (judgment: MoveEvalRow["judgment"]) =>
    rows.findIndex((row) => row.judgment === judgment);
  const index = [find("blunder"), find("mistake")].find((value) => value >= 0);
  return index == null ? moveCount : index;
}
