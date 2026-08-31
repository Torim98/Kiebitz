/**
 * Die Figurensets · Liste, Freischaltung und Zeichnungen.
 *
 * Ein Set ist nichts weiter als eine Tabelle von zwölf SVG-Schnipseln mit den
 * Schlüsseln "wP" … "bK". Damit ist es dort einsetzbar, wo bisher der
 * klassische Satz stand: auf dem Brett (`components/Board.tsx`), in der
 * Schlagliste und auf der geteilten Bildkarte. Keine dieser Stellen muss
 * wissen, welches Set gerade gilt · sie fragt hier nach und zeichnet.
 *
 * Der klassische Satz bleibt der Vorgabewert und kommt weiterhin aus dem
 * Brett selbst (`components/pieceGlyphs.ts`, erzeugt aus `react-chessboard`).
 * Die beiden gezeichneten Sets liegen daneben in `./kiebitz.ts` und
 * `./monolith.ts`.
 */
import { PIECE_GLYPH, PIECE_VIEWBOX } from "../../components/pieceGlyphs";
import type { Key } from "../i18n";
import { buildGlyphs } from "./art";
import { KIEBITZ_ART } from "./kiebitz";
import { MONOLITH_ART } from "./monolith";

export type PieceSetId = "classic" | "kiebitz" | "monolith";

export interface PieceSetDef {
  id: PieceSetId;
  /** Nur mit Kiebitz Plus wählbar. */
  plus: boolean;
  nameKey: Key;
  descKey: Key;
}

/** Reihenfolge in der Auswahl: erst frei, dann Plus. */
export const PIECE_SETS: readonly PieceSetDef[] = [
  {
    id: "classic",
    plus: false,
    nameKey: "pieces.classic",
    descKey: "pieces.classicNote",
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

/**
 * Die zwölf Zeichnungen eines Sets · beim ersten Zugriff gebaut und behalten.
 *
 * Das Brett fragt bei jedem Neuzeichnen danach; die Zeichnungen sind aber
 * unveränderlich, also lohnt sich die Tabelle einmal und nie wieder.
 */
const built = new Map<PieceSetId, Record<string, string>>([["classic", PIECE_GLYPH]]);

export function pieceGlyphs(id: PieceSetId): Record<string, string> {
  const cached = built.get(id);
  if (cached) return cached;
  const glyphs = buildGlyphs(id === "kiebitz" ? KIEBITZ_ART : MONOLITH_ART);
  built.set(id, glyphs);
  return glyphs;
}

/**
 * Ausschnitt um eine Figur · für alle Sets derselbe, damit eine geschlagene
 * Figur genauso beschnitten ist wie dieselbe Figur auf dem Brett.
 */
export { PIECE_VIEWBOX };

/** Der Figurenbuchstabe eines FEN als Schlüssel ("P" → "wP", "k" → "bK"). */
export function glyphKey(piece: string): string {
  return (piece === piece.toUpperCase() ? "w" : "b") + piece.toUpperCase();
}
