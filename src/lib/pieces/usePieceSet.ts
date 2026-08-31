/**
 * Das geltende Figurenset für React.
 *
 * `lib/theme.ts` führt den Zustand selbst und meldet jede Änderung an
 * denselben Abonnentenkreis · dieser Haken hängt das Brett und die
 * Schlagliste daran, ohne dass sie den Speicher kennen müssten. Er liefert
 * bewusst das *angewendete* Set: Ohne Plus steht in den Einstellungen
 * weiterhin die getroffene Wahl, auf dem Brett aber der klassische Satz.
 */
import { useSyncExternalStore } from "react";
import { appliedPieceSet, subscribeAppearance } from "../theme";
import { pieceGlyphs, type PieceSetId } from "./sets";

export function usePieceSet(): PieceSetId {
  return useSyncExternalStore(subscribeAppearance, appliedPieceSet, () => appliedPieceSet());
}

/** Die zwölf Zeichnungen des geltenden Sets · für Schlagliste und Brett. */
export function usePieceGlyphs(): Record<string, string> {
  return pieceGlyphs(usePieceSet());
}
