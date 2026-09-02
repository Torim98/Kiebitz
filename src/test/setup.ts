import { configure } from "@testing-library/dom";
import { loadLocale } from "../lib/locales/registry";

/**
 * Test-Setup: füllt Browser-APIs auf, die jsdom nicht mitbringt.
 *
 * `matchMedia` fehlt dort komplett; die App fragt damit das Querformat ab.
 * Der Stub meldet "passt nicht" · Tests, die eine bestimmte Antwort brauchen,
 * überschreiben `window.matchMedia` selbst.
 *
 * `scrollIntoView` fehlt ebenfalls: jsdom hat kein Layout und deshalb auch
 * nichts zu scrollen. Der geführte Rundgang holt damit sein Ziel ins Bild.
 */

// Die 64 Testdateien laufen parallel. Auf ausgelasteten CI-Runnern brauchen
// React-Effekte und Lazy-Imports gelegentlich länger als die voreingestellte
// Sekunde, obwohl sie korrekt abschließen.
configure({ asyncUtilTimeout: 5_000 });

// Deutsch ist ein nachgeladenes Sprachpaket (siehe lib/locales/registry.ts).
// Die Tests prüfen deutsche Oberflächentexte und tun das synchron gleich nach
// `render`; einmal vorab geholt, findet der Provider das Wörterbuch schon vor
// und beginnt in der richtigen Sprache statt für einen Bildaufbau in Englisch.
//
// Bewusst aus der Registry und nicht aus `lib/i18n`: Über den Provider hinge
// hier die Tauri-Brücke mit drin, und ein Testfile, das sie ersetzt, käme zu
// spät.
await loadLocale("de");

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

if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
