import { Chess } from "chess.js";

/** Wendet SAN-Züge an und liefert nach ungültigen Demo-Daten die letzte gültige Stellung. */
export function fenAfter(sans: string[] | undefined, count?: number): string {
  const chess = new Chess();
  if (!sans) return chess.fen();
  const n = count ?? sans.length;
  try {
    for (let i = 0; i < n && i < sans.length; i++) chess.move(sans[i]);
  } catch {
    // Demo-Daten: bei ungültigem Zug einfach die letzte gültige Stellung zeigen.
  }
  return chess.fen();
}
