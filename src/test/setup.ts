import { configure } from "@testing-library/dom";

/**
 * Test-Setup: füllt Browser-APIs auf, die jsdom nicht mitbringt.
 *
 * `matchMedia` fehlt dort komplett; die App fragt damit das Querformat ab.
 * Der Stub meldet "passt nicht" · Tests, die eine bestimmte Antwort brauchen,
 * überschreiben `window.matchMedia` selbst.
 */

// Die 64 Testdateien laufen parallel. Auf ausgelasteten CI-Runnern brauchen
// React-Effekte und Lazy-Imports gelegentlich länger als die voreingestellte
// Sekunde, obwohl sie korrekt abschließen.
configure({ asyncUtilTimeout: 5_000 });

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
