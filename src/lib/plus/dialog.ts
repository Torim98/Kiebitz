/**
 * Ein gemeinsamer Weg, die Plus-Erklärung zu öffnen.
 *
 * Die gesperrten Funktionen liegen über die ganze App verteilt; ihnen allen
 * einen Dialog samt Zustand mitzugeben, hieße denselben Props-Strang durch acht
 * Seiten zu ziehen. Stattdessen meldet ein kleines Ereignis, welche Funktion
 * angefragt wurde · den Dialog rendert die App genau einmal.
 */
import type { PlusFeature } from "./types";

const EVENT = "kiebitz:plus-dialog";

/**
 * Öffnet die Erklärung. `feature` benennt die angefragte Funktion, damit der
 * Dialog sagen kann, wofür der Nutzer gerade gekommen ist.
 */
export function openPlusDialog(feature?: PlusFeature): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PlusFeature | null>(EVENT, { detail: feature ?? null }));
}

export function onPlusDialog(cb: (feature: PlusFeature | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => cb((event as CustomEvent<PlusFeature | null>).detail ?? null);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
