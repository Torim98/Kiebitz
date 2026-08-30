/**
 * Brettmaße der App.
 *
 * Die eigentliche Rechnung steht im Stylesheet (`src/index.css`, Abschnitt
 * „Brettmaße"): `--board-edge` ist die Kantenlänge eines spielbaren Bretts und
 * ergibt sich aus der Fensterbreite, der verbleibenden Höhe und einer
 * Obergrenze, die mit dem Fenster wächst. Seiten benutzen die Variable direkt ·
 * als Gitterspalte (`grid-cols-[minmax(0,var(--board-edge))_…]`) und als
 * Maximalbreite (`max-w-[var(--board-edge)]`).
 *
 * Warum CSS und nicht ein Hook: Die Brettgröße hängt an Fensterhöhe,
 * Fensterbreite, Orientierung und daran, ob die mobile Shell läuft. In CSS ist
 * das ein `min()`, das der Browser bei jedem Resize selbst nachrechnet · in
 * JavaScript wären es vier Listener und ein Renderdurchlauf pro Pixel.
 *
 * Die beiden Konstanten hier sind nur noch, was JavaScript davon braucht: die
 * `width`-Prop der Brett-Komponente ist eine Zahl (react-chessboard rechnet in
 * Pixeln), und sie deckelt, was der gemessene Container hergibt.
 */

/**
 * Obergrenze eines mitwachsenden Bretts in px · derselbe Wert wie das größte
 * `--board-max` im Stylesheet. Bretter, die die Variable benutzen, reichen ihn
 * als `width` durch: die tatsächliche Größe misst die Komponente am Container.
 */
export const BOARD_MAX = 704;

/**
 * Kantenlänge der festen Vorschaubretter (Partienliste, Repertoire-Vorschau).
 * Sie stehen neben Listen und sollen dort *nicht* mitwachsen · ein Diagramm
 * neben einer Tabelle ist eine Abbildung, keine Spielfläche.
 */
export const BOARD_WIDTH = 528;
