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
 * ist Absicht: Er sitzt im selben Abschnitt der Einstellungen, hängt an
 * derselben Freischaltung wie die Plus-Themen und soll wie sie sofort wirken.
 * Eine eigene Ablage hätte dieselben Einstellungen ein zweites Mal gelesen und
 * dieselbe Plus-Prüfung ein zweites Mal abonniert.
 *
 * Die Seiten fragen hier und nirgends sonst. Sie holen ihre Daten wie bisher
 * und wählen nur die Darstellung — der Modus ist keine Abzweigung der Logik.
 */
import { useSyncExternalStore } from "react";
import { appliedDiagramMode, subscribeAppearance } from "./theme";

/**
 * Gilt der Modus gerade?
 *
 * Geliefert wird bewusst der *angewendete* Stand und nicht die getroffene
 * Wahl: Ohne Kiebitz Plus steht in den Einstellungen weiterhin, was jemand
 * einmal angeschaltet hat, auf dem Bildschirm aber die gewöhnliche Fassung.
 */
export function useDiagramMode(): boolean {
  return useSyncExternalStore(subscribeAppearance, appliedDiagramMode, () => appliedDiagramMode());
}
