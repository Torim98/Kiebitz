/**
 * Bausteine der Figurensets.
 *
 * Ein Set beschreibt sechs Figuren, nicht zwölf: Weiß und Schwarz sind
 * dieselbe Zeichnung in zwei Paletten. Das ist nicht nur weniger Arbeit,
 * sondern die Bedingung dafür, dass ein weißer und ein schwarzer Springer
 * wirklich derselbe Springer sind · zwei getrennt gezeichnete Fassungen laufen
 * beim ersten Nachbessern auseinander.
 *
 * Gezeichnet wird in demselben 45×45-Feld, in dem auch die klassischen
 * Zeichnungen liegen (`components/pieceGlyphs.ts`), damit alle Sets denselben
 * Ausschnitt vertragen und Brett, Schlagliste und Bildkarte nichts vom Set
 * wissen müssen.
 *
 * Farben stehen hier als feste Werte und nicht als CSS-Variablen: Die
 * Bildkarte rastert dieselben Zeichnungen außerhalb des Dokuments, wo kein
 * Thema gilt · eine Figur, die dort grau bliebe, wäre schlimmer als eine, die
 * sich nicht mitfärbt.
 */

/** Die sechs Figuren · Kleinbuchstaben wie im FEN. */
export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";

export const PIECE_KINDS: readonly PieceKind[] = ["p", "n", "b", "r", "q", "k"];

/**
 * Die drei Rollen, aus denen jede Zeichnung besteht.
 *
 * `fill` ist der Körper, `line` sein Umriss, `mark` alles, was *innerhalb* der
 * Figur zu sehen sein muss (Auge, Schnabel, Federkante). Nur so bleibt eine
 * Figur auf beiden Feldfarben lesbar: Der Umriss trennt sie vom Feld, die
 * Binnenzeichnung trennt sie von sich selbst.
 */
export interface PiecePalette {
  fill: string;
  line: string;
  mark: string;
}

/** Weiße Figuren · heller Körper, dunkle Zeichnung. */
export const WHITE_PALETTE: PiecePalette = {
  fill: "#f7f4ec",
  line: "#1c1a17",
  mark: "#1c1a17",
};

/** Schwarze Figuren · dunkler Körper, helle Binnenzeichnung. */
export const BLACK_PALETTE: PiecePalette = {
  fill: "#24211d",
  line: "#100f0d",
  mark: "#f2ede2",
};

/** Eine Zeichnung: innerer SVG-Inhalt für eine der beiden Paletten. */
export type PieceDrawing = (palette: PiecePalette) => string;

export type PieceArt = Record<PieceKind, PieceDrawing>;

/**
 * Alle zwölf Zeichnungen eines Sets, mit denselben Schlüsseln wie
 * `PIECE_GLYPH` ("wP" … "bK") · damit ist ein Set überall dort einsetzbar, wo
 * bisher der klassische Satz stand.
 */
export function buildGlyphs(art: PieceArt): Record<string, string> {
  const glyphs: Record<string, string> = {};
  for (const kind of PIECE_KINDS) {
    const code = kind.toUpperCase();
    glyphs[`w${code}`] = `<g>${art[kind](WHITE_PALETTE)}</g>`;
    glyphs[`b${code}`] = `<g>${art[kind](BLACK_PALETTE)}</g>`;
  }
  return glyphs;
}

/** Gefüllte Fläche mit Umriss · der Normalfall in jeder Zeichnung. */
export function body(d: string, palette: PiecePalette, width = 1.5): string {
  return (
    `<path d="${d}" fill="${palette.fill}" stroke="${palette.line}" stroke-width="${width}"`
    + ` stroke-linejoin="round" stroke-linecap="round" />`
  );
}

/** Binnenzeichnung · eine Linie, die auf dem Körper liegen bleibt. */
export function mark(d: string, palette: PiecePalette, width = 1.1): string {
  return (
    `<path d="${d}" fill="none" stroke="${palette.mark}" stroke-width="${width}"`
    + ` stroke-linejoin="round" stroke-linecap="round" />`
  );
}

/** Gefüllte Binnenform · Auge, Schnabel, alles Kleine und Volle. */
export function inlay(d: string, palette: PiecePalette): string {
  return `<path d="${d}" fill="${palette.mark}" />`;
}

/** Punkt in der Binnenfarbe. */
export function dot(cx: number, cy: number, r: number, palette: PiecePalette): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.mark}" />`;
}

/** Gefüllter Kreis mit Umriss · gehört zum Körper, nicht zur Zeichnung. */
export function disc(
  cx: number,
  cy: number,
  r: number,
  palette: PiecePalette,
  width = 1.5
): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.fill}"`
    + ` stroke="${palette.line}" stroke-width="${width}" />`
  );
}
