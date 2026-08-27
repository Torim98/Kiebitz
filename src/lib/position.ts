import { Chess } from "chess.js";
import { fenSquares } from "./boardSound";

/** Ein nachgespielter Zug in der Sprache des Bretts · Felder wie "e2". */
export interface PlayedMove {
  from: string;
  to: string;
  promo?: "q" | "r" | "b" | "n";
}

export interface Replay {
  fen: string;
  /** Die tatsächlich ausgeführten Züge · nach ungültigen Daten kürzer als `sans`. */
  moves: PlayedMove[];
}

/**
 * Spielt SAN-Züge nach und liefert Stellung und Züge in einem Durchgang.
 *
 * Beides zusammen, weil beides aus derselben Partie kommt: Die Seiten zeigen
 * die Stellung und markieren den Zug, der zu ihr geführt hat · zweimal
 * nachspielen wäre dieselbe Arbeit doppelt.
 *
 * `base` setzt die Ausgangsstellung · gebraucht für Stellungen, die nicht aus
 * der Grundstellung stammen: das freie Brett nach einem geteilten Link. Ein
 * unbrauchbares FEN fällt auf die Grundstellung zurück, statt zu werfen.
 */
export function replaySans(sans: string[] | undefined, count?: number, base?: string): Replay {
  let chess: Chess;
  try {
    chess = base ? new Chess(base) : new Chess();
  } catch {
    chess = new Chess();
  }
  const moves: PlayedMove[] = [];
  if (!sans) return { fen: chess.fen(), moves };
  const n = count ?? sans.length;
  try {
    for (let i = 0; i < n && i < sans.length; i++) {
      const move = chess.move(sans[i]);
      moves.push({
        from: move.from,
        to: move.to,
        ...(move.promotion ? { promo: move.promotion as PlayedMove["promo"] } : {}),
      });
    }
  } catch {
    // Demo-Daten: bei ungültigem Zug einfach die letzte gültige Stellung zeigen.
  }
  return { fen: chess.fen(), moves };
}

/**
 * Wendet SAN-Züge an und liefert nach ungültigen Demo-Daten die letzte gültige
 * Stellung.
 */
export function fenAfter(sans: string[] | undefined, count?: number, base?: string): string {
  return replaySans(sans, count, base).fen;
}

/**
 * Der Zug zwischen zwei Stellungen · für Bretter, die eine Zugliste gar nicht
 * führen (Aufgaben, Endspiele) und nur ihre Stellungen kennen.
 *
 * Gelesen wird der Unterschied, nicht geraten: Das Feld, das der Ziehende
 * geräumt hat, und das Feld, auf dem seine Figur danach steht. Rochade liefert
 * zwei solche Paare · genommen wird das des Königs, weil der Zug ihm gehört.
 * Alles, was kein einzelner Zug sein kann, ergibt `null`; ein Stellungswechsel
 * hat keinen letzten Zug.
 */
export function moveBetween(before: string, after: string): PlayedMove | null {
  if (!before || !after || before === after) return null;
  const from = fenSquares(before);
  const to = fenSquares(after);
  if (!from || !to) return null;

  const mover = before.trim().split(/\s+/)[1] === "b" ? "b" : "w";
  const owned = (piece: string) =>
    piece !== "" && (piece === piece.toUpperCase() ? "w" : "b") === mover;

  const changed: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (from[i] !== to[i]) changed.push(i);
  }
  // Ein Zug räumt ein Feld und besetzt eines (2), schlägt en passant (3) oder
  // rochiert (4). Mehr Änderungen sind ein Stellungswechsel.
  if (changed.length < 2 || changed.length > 4) return null;

  const left = changed.filter((i) => owned(from[i]) && to[i] === "");
  const entered = changed.filter((i) => owned(to[i]) && !owned(from[i]));
  if (left.length === 0 || entered.length === 0) return null;

  const king = left.find((i) => from[i].toLowerCase() === "k");
  const start = king ?? left[0];
  const target =
    king != null
      ? entered.find((i) => to[i].toLowerCase() === "k")
      : entered[0];
  if (start == null || target == null) return null;

  const name = (index: number) =>
    String.fromCharCode(97 + (index % 8)) + String(8 - Math.floor(index / 8));
  const promoted = from[start].toLowerCase() === "p" && to[target].toLowerCase() !== "p";
  return {
    from: name(start),
    to: name(target),
    ...(promoted ? { promo: to[target].toLowerCase() as PlayedMove["promo"] } : {}),
  };
}
