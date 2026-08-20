/**
 * Geschlagene Figuren und Materialstand aus einer Stellung.
 *
 * Die Stellung allein sagt nicht, *wann* etwas geschlagen wurde · aber sie
 * sagt, was fehlt. Der Vergleich mit der Grundstellung reicht deshalb aus,
 * solange die Partie aus der Grundstellung stammt. Für gestellte Aufgaben
 * (Puzzles, Endspiel-Drills) ist genau diese Voraussetzung nicht erfüllt; dort
 * bleibt die Anzeige aus, statt eine erfundene Schlagliste zu zeigen.
 *
 * Der Materialstand wird aus dem *verbliebenen* Material gerechnet, nicht aus
 * der Schlagliste. Nur so stimmt er nach einer Umwandlung: ein zur Dame
 * gewordener Bauer zählt neun, obwohl kein Schlag stattgefunden hat.
 */

/** Figurenarten, die geschlagen werden können · der König gehört nie dazu. */
export type PieceKind = "p" | "n" | "b" | "r" | "q";

/** Reihenfolge der Anzeige · aufsteigend nach Wert, wie auf den großen Seiten. */
const ORDER: readonly PieceKind[] = ["p", "b", "n", "r", "q"];

/** Bauerneinheiten je Figur · die übliche Zählung, ohne Feinheiten. */
export const PIECE_VALUE: Record<PieceKind, number> = { p: 1, b: 3, n: 3, r: 5, q: 9 };

/** Grundstellung je Seite. */
const START: Record<PieceKind, number> = { p: 8, b: 2, n: 2, r: 2, q: 1 };

export interface CapturedView {
  /** Was Weiß geschlagen hat · also die fehlenden schwarzen Figuren. */
  white: PieceKind[];
  /** Was Schwarz geschlagen hat. */
  black: PieceKind[];
  /** Materialvorsprung aus Weiß-Sicht in Bauerneinheiten; negativ = Schwarz führt. */
  diff: number;
}

const EMPTY: CapturedView = { white: [], black: [], diff: 0 };

/** Zählt die Figuren beider Seiten im Stellungsteil eines FEN. */
function countPieces(placement: string): {
  white: Record<PieceKind, number>;
  black: Record<PieceKind, number>;
  kings: { white: number; black: number };
} | null {
  const white = { p: 0, b: 0, n: 0, r: 0, q: 0 };
  const black = { p: 0, b: 0, n: 0, r: 0, q: 0 };
  const kings = { white: 0, black: 0 };
  for (const ch of placement) {
    if (ch === "/" || (ch >= "1" && ch <= "8")) continue;
    const lower = ch.toLowerCase() as PieceKind | "k";
    const isWhite = ch !== lower;
    if (lower === "k") {
      if (isWhite) kings.white++;
      else kings.black++;
      continue;
    }
    if (!(lower in white)) return null;
    if (isWhite) white[lower]++;
    else black[lower]++;
  }
  return { white, black, kings };
}

/**
 * Schlagliste und Materialstand zu einem FEN.
 *
 * `fromStart` sagt, ob die Stellung aus der Grundstellung stammt. Ist sie es
 * nicht, kommt eine leere Ansicht zurück · siehe Modulkopf.
 */
export function capturedFromFen(fen: string | null | undefined, fromStart = true): CapturedView {
  if (!fen || !fromStart) return EMPTY;
  const counts = countPieces(fen.split(" ")[0] ?? "");
  // Ohne beide Könige ist es keine Partiestellung, sondern ein Bruchstück.
  if (!counts || counts.kings.white !== 1 || counts.kings.black !== 1) return EMPTY;

  const missing = (side: Record<PieceKind, number>) =>
    ORDER.flatMap((kind) => Array<PieceKind>(Math.max(0, START[kind] - side[kind])).fill(kind));
  const material = (side: Record<PieceKind, number>) =>
    ORDER.reduce((sum, kind) => sum + side[kind] * PIECE_VALUE[kind], 0);

  return {
    white: missing(counts.black),
    black: missing(counts.white),
    diff: material(counts.white) - material(counts.black),
  };
}
