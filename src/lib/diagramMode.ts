/**
 * Der Diagramm-Modus („Das Blatt") für React.
 *
 * Der Modus ist kein Farbthema, sondern eine zweite Darstellung derselben
 * Daten: Angeschaltet setzt die App ihre Seiten wie eine Seite aus einem
 * Schachbuch — gedruckte Diagramme statt Kacheln, Haarlinien und
 * Formularzeilen statt Karten, Register statt Navigationsleiste. Die Farbwelt
 * bleibt davon unberührt; kein Token wird getauscht.
 *
 * Geführt wird er in `lib/theme.ts` als Teil der Erscheinungsbild-Wahl. Das
 * ist Absicht: Er sitzt im selben Abschnitt der Einstellungen und soll wie die
 * Farbwelt sofort wirken. Eine eigene Ablage hätte dieselben Einstellungen ein
 * zweites Mal gelesen. Freigeschaltet werden muss er nicht · siehe
 * `resolveDiagramMode` in lib/theme.ts.
 *
 * Die Seiten fragen hier und nirgends sonst. Sie holen ihre Daten wie bisher
 * und wählen nur die Darstellung — der Modus ist keine Abzweigung der Logik.
 */
import { useSyncExternalStore } from "react";
import { appliedDiagramMode, subscribeAppearance } from "./theme";

/**
 * Gilt der Modus gerade?
 *
 * Geliefert wird der *angewendete* Stand: derselbe Wert, den `apply()` ans
 * Dokument geschrieben hat, und damit dieselbe Auskunft für React wie für die
 * CSS-Regeln am `data-diagram`.
 */
export function useDiagramMode(): boolean {
  return useSyncExternalStore(subscribeAppearance, appliedDiagramMode, () => appliedDiagramMode());
}
