import { Chess } from "chess.js";

/**
 * Wendet SAN-Züge an und liefert nach ungültigen Demo-Daten die letzte gültige
 * Stellung.
 *
 * `base` setzt die Ausgangsstellung · gebraucht für Stellungen, die nicht aus
 * der Grundstellung stammen: das freie Brett nach einem geteilten Link. Ein
 * unbrauchbares FEN fällt auf die Grundstellung zurück, statt zu werfen.
 */
export function fenAfter(sans: string[] | undefined, count?: number, base?: string): string {
  let chess: Chess;
  try {
    chess = base ? new Chess(base) : new Chess();
  } catch {
    chess = new Chess();
  }
  if (!sans) return chess.fen();
  const n = count ?? sans.length;
  try {
    for (let i = 0; i < n && i < sans.length; i++) chess.move(sans[i]);
  } catch {
    // Demo-Daten: bei ungültigem Zug einfach die letzte gültige Stellung zeigen.
  }
  return chess.fen();
}
