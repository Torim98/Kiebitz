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
 * `--board-max` im Stylesheet, und das steht im Fokus-Brett. Bretter reichen
 * ihn als `width` durch: Wie groß es wirklich wird, misst die Komponente am
 * Container, und der ist über `--board-edge` schon passend begrenzt.
 *
 * Deshalb muss jeder Container eines mitwachsenden Bretts diese Grenze auch
 * tragen (`max-w-[var(--board-edge)]` oder eine entsprechende Gitterspalte) ·
 * sonst gilt in einer einspaltigen Ansicht nur noch dieser Wert, und das Brett
 * ignoriert die Fensterhöhe.
 */
export const BOARD_MAX = 880;

/**
 * Kantenlänge der festen Vorschaubretter (Partienliste, Repertoire-Vorschau).
 * Sie stehen neben Listen und sollen dort *nicht* mitwachsen · ein Diagramm
 * neben einer Tabelle ist eine Abbildung, keine Spielfläche.
 */
export const BOARD_WIDTH = 528;
