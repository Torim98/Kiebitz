/**
 * Brettmaße der App.
 *
 * Das Analyse-Brett ist der Maßstab: es war das einzige Brett, das auf einem
 * Desktop-Fenster groß genug war, um Figuren und Zugqualitäts-Marker ohne
 * Zoomen zu lesen. Alle spielbaren Bretter benutzen jetzt denselben Wert, damit
 * ein Puzzle, ein Endspiel-Drill und eine Repertoire-Wiederholung nicht drei
 * verschiedene Brettgrößen sind.
 *
 * Die Grid-Spalten der Seiten tragen den Wert als Tailwind-Literal
 * (`grid-cols-[528px_…]`), weil Tailwind nur statische Klassennamen im Quelltext
 * findet · beide Stellen müssen zusammen geändert werden.
 */

/** Maximale Kantenlänge eines spielbaren Bretts in px. */
export const BOARD_WIDTH = 528;

/**
 * Kleines Vorschaubrett (Partienliste): kein Spielbrett, sondern ein Blick auf
 * die Endstellung neben der Partie-Zusammenfassung.
 */
export const BOARD_PREVIEW_WIDTH = 300;
