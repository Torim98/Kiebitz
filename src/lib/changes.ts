/**
 * Leichter Signalkanal für lokale Datenänderungen (Import, Notiz, Puzzle-/
 * Endspiel-Versuch, Repertoire-Änderung). Der Auto-Sync hört darauf und stößt
 * einen gebündelten Sync an — so bleibt die Mutations-Schicht entkoppelt
 * (kein Import des Sync-Managers in db.ts & Co.).
 */
const CHANGE_EVENT = "kiebitz:data-change";

/** Signalisiert, dass sich lokale Daten geändert haben. */
export function emitDataChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Abonniert Datenänderungen; liefert eine Abmelde-Funktion. */
export function onDataChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}
