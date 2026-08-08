/**
 * Opt-in capture mode for reproducible store assets.
 *
 * It is only active in development and keeps browser-preview labels and
 * personal demo handles out of screenshots. Production builds ignore the
 * query parameter entirely.
 */
export function isStoreCapture(): boolean {
  return devFlag("store-capture");
}

/**
 * Erzwingt die mobile App-Shell (Bottom-Navigation, Drawer als Überlauf) in der
 * Browser-Vorschau, wo kein Tauri-Backend eine Plattform meldet. Nur zum
 * Entwickeln der Android-Oberfläche · Produktions-Builds ignorieren das.
 */
export function isMobilePreview(): boolean {
  return devFlag("mobile-preview");
}

/**
 * Startseite für den Aufnahmelauf (scripts/capture-store-assets.mjs). Ohne sie
 * müsste das Skript sich durch eine lokalisierte Navigation klicken · und die
 * Seiten Repertoire und Puzzles liegen mobil ohnehin nur im Überlaufmenü.
 * Nur im Aufnahmemodus wirksam, Produktions-Builds sehen den Parameter nie.
 */
export function capturePage(): string | null {
  if (!isStoreCapture()) return null;
  return new URLSearchParams(window.location.search).get("page");
}

function devFlag(name: string): boolean {
  const localPreview = window.location.hostname === "127.0.0.1"
    || window.location.hostname === "localhost";
  return localPreview && new URLSearchParams(window.location.search).has(name);
}
