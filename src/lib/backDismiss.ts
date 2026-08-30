/**
 * Android-Zurück schließt eine Schicht, statt die App zu verlassen.
 *
 * Der Seiten-Stapel (`lib/nav`) spiegelt seine Tiefe in die Session-History,
 * weil die generierte `WryActivity` die Zurück-Taste nur dann an die WebView
 * gibt, wenn dort echte Einträge liegen. Eine modale Schicht ist keine neue
 * Seite · sie bekommt deshalb einen eigenen Eintrag auf *derselben* Tiefe: Der
 * Stapel vergleicht nur `kd` und lässt ihn dadurch in Ruhe.
 *
 * Der Zähler ist bewusst modulweit und nicht pro Schicht: Detailblatt und
 * Fokus-Brett können gleichzeitig offen sein, und dann darf nur die letzte
 * schließende Schicht den Eintrag abräumen.
 *
 * Beide Richtungen sind gegen den doppelten Effektlauf des StrictMode
 * gesichert · ein zweiter Eintrag entsteht nicht (die Marke steht schon), und
 * das Abräumen prüft erst im nächsten Task, ob wirklich keine Schicht mehr
 * offen ist.
 */
import { useEffect, useRef } from "react";

/** Wie viele Schichten offen sind · nur die letzte räumt den Eintrag ab. */
let openLayers = 0;

/** Steht die eigene Marke im aktuellen History-Eintrag? */
function layerState(state: unknown): boolean {
  return (state as { sheet?: boolean } | null)?.sheet === true;
}

export function useBackDismiss(onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!layerState(window.history.state)) {
      const depth = (window.history.state as { kd?: number } | null)?.kd ?? 1;
      window.history.pushState({ kd: depth, sheet: true }, "");
    }
    openLayers += 1;
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      openLayers -= 1;
      if (popped) return;
      // Über die Schaltfläche geschlossen · den eigenen Eintrag abräumen,
      // sofern nicht sofort wieder eine Schicht aufgeht (StrictMode).
      setTimeout(() => {
        if (openLayers === 0 && layerState(window.history.state)) window.history.back();
      }, 0);
    };
  }, []);
}
