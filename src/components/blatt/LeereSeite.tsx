/**
 * Die leere Seite des Diagramm-Modus.
 *
 * Sie steht überall dort, wo das Blatt noch nicht gesetzt werden kann: solange
 * die nachgeladene Fassung unterwegs ist, und solange die Daten fehlen, die
 * sie braucht.
 *
 * Das zweite ist der eigentliche Grund für diese Datei. Eine Seite, die ihre
 * Blatt-Fassung erst zeigt, wenn die Zahlen da sind, zeigt bis dahin ihre
 * gewöhnliche — beim Wechsel auf den Reiter blitzte für einen Augenblick die
 * Kachelfassung auf, bevor das Blatt kam. Wer den Modus anschaltet, hat sich
 * gegen diese Fassung entschieden; er darf sie auch nicht für einen Wimper-
 * schlag zu sehen bekommen.
 *
 * Leer und nicht „Lädt …": Eine Zeile Text, die nach einem Augenblick wieder
 * verschwindet, ist selbst ein Zucken. Die Höhe hält den Platz, damit die
 * Seite beim Eintreffen nicht springt.
 *
 * Eine eigene Datei ohne weitere Bezüge · so hängt keine Seite, die sie als
 * Rückfallanzeige einbindet, am ganzen Satzkasten aus Satz.tsx.
 */
export function LeereSeite() {
  return <div className="min-h-[40vh]" aria-busy="true" />;
}
