/**
 * Die Figurensets · Liste und Freischaltung.
 *
 * Ein Set ist nichts weiter als eine Tabelle von zwölf SVG-Schnipseln mit den
 * Schlüsseln "wP" … "bK". Damit ist es dort einsetzbar, wo bisher der
 * klassische Satz stand: auf dem Brett (`components/Board.tsx`), in der
 * Schlagliste und auf der geteilten Bildkarte. Keine dieser Stellen muss
 * wissen, welches Set gerade gilt · sie fragt hier nach, welche es gibt, und
 * holt die Zeichnungen aus `./glyphs.ts`.
 *
 * Diese Datei bleibt bewusst leicht: Sie hängt am Erscheinungsbild und damit am
 * Start der App. Die Zeichnungen stehen deshalb nebenan, jedes Set in einer
 * eigenen Datei und jede erst geladen, wenn ihr Set gewählt ist.
 */
import type { Key } from "../i18n";

export type PieceSetId =
  | "classic"
  | "kiebitz"
  | "monolith"
  | "merida"
  | "fantasy"
  | "chessnut";

export interface PieceSetDef {
  id: PieceSetId;
  /** Nur mit Kiebitz Plus wählbar. */
  plus: boolean;
  nameKey: Key;
  descKey: Key;
  /**
   * Nachweis für fremde Zeichnungen · fehlt bei den eigenen.
   *
   * Er steht hier und nicht in den Wörterbüchern: Ein Name und eine Lizenz
   * werden nicht übersetzt, und er muss auch dort auftauchen, wo keine
   * Oberfläche daneben steht — auf dem geteilten Bild, das ohne Landeseite
   * weiterwandert (`lib/share/card.ts`).
   */
  credit?: string;
}

/** Reihenfolge in der Auswahl: erst frei, dann Plus. */
export const PIECE_SETS: readonly PieceSetDef[] = [
  {
    id: "classic",
    plus: false,
    nameKey: "pieces.classic",
    descKey: "pieces.classicNote",
    credit: "Cburnett · CC BY-SA 3.0",
  },
  {
    id: "kiebitz",
    plus: true,
    nameKey: "pieces.kiebitz",
    descKey: "pieces.kiebitzNote",
  },
  {
    id: "monolith",
    plus: true,
    nameKey: "pieces.monolith",
    descKey: "pieces.monolithNote",
  },
  {
    id: "merida",
    plus: true,
    nameKey: "pieces.merida",
    descKey: "pieces.meridaNote",
    credit: "Merida: Armando H. Marroquin · GPLv2+",
  },
  {
    id: "fantasy",
    plus: true,
    nameKey: "pieces.fantasy",
    descKey: "pieces.fantasyNote",
    credit: "Fantasy: Maurizio Monge · MIT",
  },
  {
    id: "chessnut",
    plus: true,
    nameKey: "pieces.chessnut",
    descKey: "pieces.chessnutNote",
    credit: "Chessnut: Alexis Luengas · Apache 2.0",
  },
];

export const DEFAULT_PIECE_SET: PieceSetId = "classic";

const SET_BY_ID = new Map(PIECE_SETS.map((set) => [set.id, set]));

export function pieceSetDef(id: PieceSetId): PieceSetDef {
  return SET_BY_ID.get(id) ?? SET_BY_ID.get(DEFAULT_PIECE_SET)!;
}

/** Prüft einen gespeicherten Wert (Einstellungen, localStorage). */
export function isPieceSetId(value: unknown): value is PieceSetId {
  return typeof value === "string" && SET_BY_ID.has(value as PieceSetId);
}

/** Der Figurenbuchstabe eines FEN als Schlüssel ("P" → "wP", "k" → "bK"). */
export function glyphKey(piece: string): string {
  return (piece === piece.toUpperCase() ? "w" : "b") + piece.toUpperCase();
}
